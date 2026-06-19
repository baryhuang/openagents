"""
Goose adapter for OpenAgents workspace.

Bridges the Goose CLI (block/goose) to an OpenAgents workspace using Goose's
official **headless** mode:

    goose run --output-format stream-json --name <session> [--resume] \
              --no-profile --with-builtin developer \
              --max-turns N --max-tool-repetitions M --system <ctx> -i -

- The task prompt is written to the child's **stdin** (`-i -`), never argv.
- stdout is parsed incrementally as NDJSON ``stream-json`` (see
  :mod:`openagents.adapters.goose_stream`); stderr is drained concurrently.
- Each (workspace, agent, channel) maps to a **stable, unique** Goose session
  name so conversations resume per-channel and never cross-talk.
- Providers/models/keys/host come from native Goose env vars; the key is never
  placed on the command line or in logs.
- ``GOOSE_MODE=auto`` makes tools run without interactive approval (required for
  headless); only the built-in ``developer`` extension is enabled by default.

Verified against block/goose v1.38.0. See goose_stream.py for the exact event
schema. Goose is currently marked **Beta** — real end-to-end runs are pending.
"""

import asyncio
import hashlib
import logging
import os
import platform
import re
import shutil
import signal
from pathlib import Path
from typing import Optional

from openagents.adapters.base import BaseAdapter
from openagents.adapters.goose_stream import (
    GooseStreamParser,
    classify_goose_error,
    redact_secrets,
)
from openagents.adapters.workspace_prompt import (
    build_collaboration_prompt,
    build_mode_prompt,
    build_workspace_identity,
)
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"

# Backstop for a truly hung run: if Goose emits nothing on stdout *or* stderr for
# this long while the process is alive, treat it as hung and kill it. Long but
# legitimate tasks keep emitting tool/assistant events, so this distinguishes a
# real hang from a long task. Override with GOOSE_INACTIVITY_TIMEOUT (seconds).
_DEFAULT_INACTIVITY_TIMEOUT = 900
# Bound runaway loops via Goose's own limits (preferred over a wall-clock cap).
_DEFAULT_MAX_TURNS = 100
_DEFAULT_MAX_TOOL_REPETITIONS = 12
# Cap how much stderr we retain for error classification.
_STDERR_CAP = 64 * 1024
# Truncate noisy intermediate reasoning we surface as workspace status.
_STATUS_PREVIEW = 280

# Minimum Goose CLI version verified against the stable tag (block/goose v1.37.0):
# every flag used here (`-i -`, `--output-format stream-json`, `--name`,
# `--resume`, `--no-profile`, `--with-builtin`, `--max-turns`,
# `--max-tool-repetitions`) and the stream-json event schema exist there. Older
# releases may lack stream-json / these flags, so we refuse them with a clear
# upgrade prompt rather than failing obscurely.
MIN_GOOSE_VERSION = (1, 37, 0)


def parse_goose_version(text: Optional[str]) -> Optional[tuple]:
    """Parse ``goose --version`` output (e.g. ``"goose 1.37.0"``) → ``(1, 37, 0)``.

    Returns ``None`` when no ``X.Y.Z`` can be found so callers can stay lenient
    (an undeterminable version must not block a working setup).
    """
    if not text:
        return None
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)))


def goose_version_meets_minimum(parsed: Optional[tuple],
                                minimum: tuple = MIN_GOOSE_VERSION) -> bool:
    """True if ``parsed`` >= ``minimum`` (or unknown — lenient)."""
    if parsed is None:
        return True
    return tuple(parsed) >= tuple(minimum)


def _too_old_message(parsed: Optional[tuple]) -> str:
    cur = ".".join(map(str, parsed)) if parsed else "unknown"
    minv = ".".join(map(str, MIN_GOOSE_VERSION))
    return (
        f"Goose CLI {cur} is too old — OpenAgents requires Goose >= {minv} "
        "(headless stream-json support). Upgrade it: curl -fsSL "
        "https://github.com/block/goose/releases/download/stable/download_cli.sh "
        "| CONFIGURE=false bash"
    )


def goose_session_name(workspace_id: str, agent_name: str, channel: str) -> str:
    """Return a stable, unique, filesystem-safe Goose session name for a channel.

    The name is a short SHA-256 of ``workspace_id|agent_name|channel`` so it:
    - is unique per (workspace, agent, channel) — no cross-talk, no reuse;
    - is stable across restarts (deterministic from the same inputs);
    - leaks no raw token/workspace id/channel/user content;
    - contains only ``[a-z0-9_]`` — no path traversal or shell metacharacters.
    """
    digest = hashlib.sha256(
        f"{workspace_id}|{agent_name}|{channel}".encode("utf-8")
    ).hexdigest()
    return f"oa_{digest[:16]}"


def find_goose_binary() -> Optional[str]:
    """Locate the real ``goose`` CLI across platforms.

    Uses the standard PATH lookup first, then well-known install locations that
    the official installer uses but which may be absent from a GUI/daemon PATH:
    ``~/.local/bin`` (Linux/macOS default), Homebrew, ``/usr/local/bin``, and on
    Windows ``%USERPROFILE%\\goose`` plus ``.exe``. Does NOT validate that the
    binary is the CLI vs. the Desktop app — call :func:`goose_cli_version` for
    that (it runs ``goose --version``).
    """
    home = Path.home()
    if IS_WINDOWS:
        for name in ("goose.exe", "goose.cmd", "goose"):
            found = shutil.which(name)
            if found:
                return found
        candidates = [
            home / "goose" / "goose.exe",
            Path(os.environ.get("USERPROFILE", str(home))) / "goose" / "goose.exe",
            home / ".local" / "bin" / "goose.exe",
        ]
    else:
        found = shutil.which("goose")
        if found:
            return found
        candidates = [
            home / ".local" / "bin" / "goose",            # official installer default
            Path("/opt/homebrew/bin/goose"),              # macOS Homebrew (Apple silicon)
            Path("/usr/local/bin/goose"),                 # macOS Homebrew (Intel) / Linux
            home / "bin" / "goose",
        ]
    for cand in candidates:
        try:
            if cand.is_file() and (IS_WINDOWS or os.access(cand, os.X_OK)):
                return str(cand)
        except OSError:
            continue
    return None


class GooseAdapter(BaseAdapter):
    """Connects the Goose CLI to an OpenAgents workspace via headless ``goose run``."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
        disabled_modules: set | None = None,
        working_dir: str | None = None,
    ):
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)
        self.disabled_modules = disabled_modules or set()
        self.working_dir = working_dir

        # channel → Goose session name. Presence ⇒ a session has been created,
        # so subsequent turns resume it. Persisted so the mapping survives an
        # agent restart (Goose itself stores the conversation in its SQLite DB).
        self._channel_sessions: dict[str, str] = {}
        self._sessions_file = (
            Path.home() / ".openagents" / "sessions"
            / f"{workspace_id}_{agent_name}_goose.json"
        )
        self._load_sessions()

        # Per-channel process tracking for stop / cleanup.
        self._channel_processes: dict[str, asyncio.subprocess.Process] = {}
        self._stopping_channels: set[str] = set()

        # One-time minimum-version pre-flight (cached for the adapter lifetime).
        self._version_checked = False
        self._version_ok = True

        self._goose_binary = find_goose_binary()
        if self._goose_binary:
            logger.info("Using Goose CLI: %s", self._goose_binary)
        else:
            logger.warning(
                "goose CLI not found. Install it (non-interactively): "
                "curl -fsSL "
                "https://github.com/block/goose/releases/download/stable/download_cli.sh "
                "| CONFIGURE=false bash"
            )

        # Collect secret values present in the environment so we can redact them
        # from any stderr/error text before logging or posting to the workspace.
        self._secrets = self._collect_secret_values()

    # ------------------------------------------------------------------
    # Session mapping persistence
    # ------------------------------------------------------------------

    def _load_sessions(self):
        try:
            if self._sessions_file.exists():
                import json
                data = json.loads(self._sessions_file.read_text())
                if isinstance(data, dict):
                    self._channel_sessions.update(
                        {k: v for k, v in data.items() if isinstance(v, str)}
                    )
                    logger.info(
                        "Loaded %d Goose session mapping(s) from %s",
                        len(self._channel_sessions), self._sessions_file.name,
                    )
        except Exception:
            logger.debug("Could not load Goose sessions file, starting fresh")

    def _save_sessions(self):
        try:
            import json
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self._sessions_file.write_text(json.dumps(self._channel_sessions))
        except Exception:
            logger.debug("Could not save Goose sessions file")

    # ------------------------------------------------------------------
    # Environment / provider configuration
    # ------------------------------------------------------------------

    @staticmethod
    def _collect_secret_values() -> list:
        secrets = []
        for key, val in os.environ.items():
            if not val or len(val) < 4:
                continue
            upper = key.upper()
            if ("API_KEY" in upper or "TOKEN" in upper or "SECRET" in upper
                    or upper.endswith("__API_KEY")):
                secrets.append(val)
        return secrets

    def _build_env(self) -> dict:
        """Build the subprocess environment.

        Provider/model/key/host are inherited from the parent environment
        (the launcher sets GOOSE_PROVIDER, GOOSE_MODEL, GOOSE_PROVIDER__API_KEY,
        GOOSE_PROVIDER__HOST from the agent's saved config). We do NOT clear any
        existing provider env, so an unconfigured agent can still fall back to
        the user's global Goose config/keyring. We only force a headless-safe
        tool-permission mode, scoped to this child process.
        """
        env = dict(os.environ)
        mode = (env.get("GOOSE_MODE") or "").strip().lower()
        if mode in ("auto", "chat"):
            env["GOOSE_MODE"] = mode
        else:
            if mode in ("approve", "smart_approve"):
                logger.warning(
                    "GOOSE_MODE=%s waits for interactive approval and cannot run "
                    "headless; overriding to 'auto' for this agent.", mode,
                )
            env["GOOSE_MODE"] = "auto"
        return env

    def _max_turns(self) -> int:
        try:
            return max(1, int(os.environ.get("GOOSE_MAX_TURNS", _DEFAULT_MAX_TURNS)))
        except (TypeError, ValueError):
            return _DEFAULT_MAX_TURNS

    def _max_tool_repetitions(self) -> int:
        try:
            return max(1, int(os.environ.get(
                "GOOSE_MAX_TOOL_REPETITIONS", _DEFAULT_MAX_TOOL_REPETITIONS)))
        except (TypeError, ValueError):
            return _DEFAULT_MAX_TOOL_REPETITIONS

    def _inactivity_timeout(self) -> float:
        try:
            return max(30.0, float(os.environ.get(
                "GOOSE_INACTIVITY_TIMEOUT", _DEFAULT_INACTIVITY_TIMEOUT)))
        except (TypeError, ValueError):
            return float(_DEFAULT_INACTIVITY_TIMEOUT)

    def _build_system_prompt(self, channel_name: str) -> str:
        """Compact, stable system context passed via ``--system`` every turn.

        It is a *system* prompt (replaced each run), not appended to the
        conversation, so re-passing it on resume does not bloat context. No
        workspace token is included.
        """
        parts = [
            build_workspace_identity(
                self.agent_name, self.workspace_id, channel_name, self._mode,
            ),
            build_collaboration_prompt(),
            build_mode_prompt(self._mode),
        ]
        if self.working_dir:
            parts.append(
                f"\n## Project Directory\nYou are working in: {self.working_dir}\n"
                "Make all file changes within this directory.\n"
            )
        return "".join(parts)

    # ------------------------------------------------------------------
    # Working directory validation
    # ------------------------------------------------------------------

    def _resolve_cwd(self) -> str:
        """Return a validated project working directory, or raise.

        Goose runs with this as its cwd — the only place its developer extension
        should read/write. We validate it exists and is a directory before
        spawning (Goose offers no path flag and no sandbox).
        """
        if not self.working_dir:
            # Fall back to a guaranteed-writable per-agent directory.
            d = Path.home() / ".openagents" / "workspaces" / _safe_name(self.agent_name)
            d.mkdir(parents=True, exist_ok=True)
            return str(d)
        p = Path(self.working_dir)
        if not p.exists():
            raise NotADirectoryError(
                f"Project directory does not exist: {self.working_dir}"
            )
        if not p.is_dir():
            raise NotADirectoryError(
                f"Project path is not a directory: {self.working_dir}"
            )
        return str(p)

    # ------------------------------------------------------------------
    # Control actions (stop)
    # ------------------------------------------------------------------

    async def _on_control_action(self, action: Optional[str], payload: dict):
        if action == "stop":
            channel = payload.get("channel") if isinstance(payload, dict) else None
            if channel:
                await self._stop_channel(channel, "Execution stopped by user.")
            else:
                await self._stop_all("Execution stopped by user.")
            return
        await super()._on_control_action(action, payload)

    async def _stop_channel(self, channel: str, message: str):
        proc = self._channel_processes.get(channel)
        had_queue = bool(self._channel_queues.get(channel))
        if proc:
            self._stopping_channels.add(channel)
            await self._stop_process(proc)
            self._channel_processes.pop(channel, None)
        self._channel_queues.pop(channel, None)
        if proc or had_queue:
            try:
                await self._send_status(channel, message)
            except Exception:
                pass

    async def _stop_all(self, message: str):
        for channel in list(self._channel_processes.keys()):
            await self._stop_channel(channel, message)

    async def _stop_process(self, proc: asyncio.subprocess.Process):
        """Terminate a Goose subprocess and every child it spawned.

        POSIX: signal the whole process group (Goose's shell commands, dev
        servers, and any MCP/extension children share it because we spawn with
        ``start_new_session=True``). Windows: ``taskkill /F /T`` kills the tree.
        """
        if not proc or proc.returncode is not None:
            return
        try:
            if IS_WINDOWS:
                try:
                    proc.send_signal(signal.SIGINT)
                except Exception:
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=1.5)
                    return
                except asyncio.TimeoutError:
                    pass
                try:
                    killer = await asyncio.create_subprocess_exec(
                        "taskkill", "/F", "/T", "/PID", str(proc.pid),
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await asyncio.wait_for(killer.wait(), timeout=5)
                except Exception:
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2)
                except asyncio.TimeoutError:
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                    await proc.wait()
                return

            # POSIX: kill the process group.
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError, OSError):
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=2)
            except asyncio.TimeoutError:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                await proc.wait()
        except ProcessLookupError:
            pass

    # ------------------------------------------------------------------
    # Message handler
    # ------------------------------------------------------------------

    async def _handle_message(self, msg: dict):
        content = (msg.get("content") or "").strip()
        if not content:
            return

        msg_channel = msg.get("sessionId") or self.channel_name
        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(
            "Processing message from %s in channel %s: %s...",
            sender, msg_channel, content[:80],
        )

        await self._auto_title_channel(msg_channel, content)
        await self._send_status(msg_channel, "thinking...")

        try:
            # _run_goose returns: None → stopped or a failure it already reported
            # (stay silent); "" → success but no answer text; str → the answer.
            result = await self._run_goose(content, msg_channel)
            if result is None:
                return
            if result:
                await self._send_response(msg_channel, result)
            else:
                await self._send_response(
                    msg_channel,
                    "Goose ran but produced no response. This usually means no "
                    "provider/model is configured — set GOOSE_PROVIDER and GOOSE_MODEL "
                    "(and a key) for this agent, or run `goose configure` once outside "
                    "OpenAgents.",
                )
        except FileNotFoundError as e:
            await self._send_error(msg_channel, str(e))
        except NotADirectoryError as e:
            await self._send_error(msg_channel, str(e))
        except Exception as e:
            logger.exception("Error handling message: %s", e)
            if msg_channel not in self._stopping_channels:
                await self._send_error(
                    msg_channel, f"Error processing message: {self._safe(str(e))}",
                )
        finally:
            self._stopping_channels.discard(msg_channel)

    def _safe(self, text: str) -> str:
        return redact_secrets(text, self._secrets)

    # ------------------------------------------------------------------
    # Subprocess execution
    # ------------------------------------------------------------------

    def _build_cmd(self, session_name: str, resume: bool, system_prompt: str) -> list:
        binary = self._goose_binary or find_goose_binary()
        if not binary:
            raise FileNotFoundError(
                "goose CLI not found. Install it (non-interactively): "
                "curl -fsSL "
                "https://github.com/block/goose/releases/download/stable/download_cli.sh "
                "| CONFIGURE=false bash"
            )
        self._goose_binary = binary
        cmd = [
            binary, "run",
            "--output-format", "stream-json",
            "--name", session_name,
            "--no-profile",                 # ignore globally-enabled extensions
            "--with-builtin", "developer",  # enable ONLY the developer extension
            "--max-turns", str(self._max_turns()),
            "--max-tool-repetitions", str(self._max_tool_repetitions()),
        ]
        if resume:
            cmd.append("--resume")
        cmd.extend(["--system", system_prompt, "-i", "-"])
        return cmd

    async def _ensure_version_ok(self, channel: str) -> bool:
        """Check the installed Goose CLI meets :data:`MIN_GOOSE_VERSION` once.

        Runs ``goose --version`` (cached for the adapter's lifetime). Returns
        True when the version is new enough OR cannot be determined (lenient —
        an undeterminable version must not block a working setup); returns False
        and posts a clear upgrade error only when the CLI is definitively too old.
        """
        if self._version_checked:
            return self._version_ok
        self._version_checked = True
        binary = self._goose_binary or find_goose_binary()
        if not binary:
            return True  # a missing binary is surfaced separately by _build_cmd
        try:
            proc = await asyncio.create_subprocess_exec(
                binary, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            parsed = parse_goose_version(out.decode("utf-8", errors="replace"))
        except Exception as e:
            logger.debug("Could not determine Goose version: %s", e)
            return True
        if not goose_version_meets_minimum(parsed):
            self._version_ok = False
            await self._send_error(channel, _too_old_message(parsed))
            return False
        return True

    async def _run_goose(self, content: str, channel: str, _retry: bool = False):
        """Run one headless ``goose run``.

        Returns ``None`` if the run was stopped or failed (an error was already
        posted), ``""`` on an empty success, or the final answer text.
        """
        loop = asyncio.get_running_loop()
        try:
            cwd = self._resolve_cwd()
        except NotADirectoryError as e:
            await self._send_error(channel, str(e))
            return None

        # Refuse a Goose CLI older than the verified-stable minimum, with a
        # clear upgrade prompt (lenient when the version can't be determined).
        if not await self._ensure_version_ok(channel):
            return None

        session_name = self._channel_sessions.get(channel) or goose_session_name(
            self.workspace_id, self.agent_name, channel,
        )
        resume = channel in self._channel_sessions
        system_prompt = self._build_system_prompt(channel)
        cmd = self._build_cmd(session_name, resume, system_prompt)

        env = self._build_env()

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
                limit=10 * 1024 * 1024,  # 10 MB line buffer for big tool output
                start_new_session=not IS_WINDOWS,  # own process group for tree kill
            )
        except Exception as e:
            await self._send_error(
                channel, f"Failed to start Goose: {self._safe(str(e))}",
            )
            return None

        self._channel_processes[channel] = process

        parser = GooseStreamParser()
        final_text: Optional[str] = None
        stderr_chunks: list = []
        stderr_len = 0
        last_activity = loop.time()

        async def write_stdin():
            try:
                process.stdin.write(content.encode("utf-8"))
                await process.stdin.drain()
            except Exception as e:
                logger.debug("Goose stdin write failed: %s", e)
            finally:
                try:
                    process.stdin.close()
                except Exception:
                    pass

        async def read_stderr():
            nonlocal stderr_len, last_activity
            while True:
                try:
                    line = await process.stderr.readline()
                except Exception:
                    break
                if not line:
                    break
                last_activity = loop.time()
                if stderr_len < _STDERR_CAP:
                    chunk = line.decode("utf-8", errors="replace")
                    stderr_chunks.append(chunk)
                    stderr_len += len(chunk)

        async def watchdog():
            timeout = self._inactivity_timeout()
            while True:
                await asyncio.sleep(min(30.0, timeout))
                if process.returncode is not None:
                    return
                if loop.time() - last_activity > timeout:
                    logger.warning(
                        "Goose produced no output for %ss — treating as hung, killing.",
                        timeout,
                    )
                    self._stopping_channels.add(channel)
                    await self._stop_process(process)
                    try:
                        await self._send_error(
                            channel,
                            "Goose appears to have hung (no output for a long time) "
                            "and was stopped. Try a smaller task or check the provider.",
                        )
                    except Exception:
                        pass
                    return

        stdin_task = asyncio.create_task(write_stdin())
        stderr_task = asyncio.create_task(read_stderr())
        watchdog_task = asyncio.create_task(watchdog())

        try:
            while True:
                try:
                    line = await process.stdout.readline()
                except (asyncio.LimitOverrunError, ValueError):
                    # Line longer than the buffer limit — skip it defensively.
                    continue
                except Exception:
                    break
                if not line:
                    break
                last_activity = loop.time()
                text = line.decode("utf-8", errors="replace")
                for event in parser.feed(text):
                    ft = await self._dispatch_event(channel, event)
                    if ft is not None:
                        final_text = ft
            for event in parser.finish():
                ft = await self._dispatch_event(channel, event)
                if ft is not None:
                    final_text = ft
        finally:
            watchdog_task.cancel()
            await asyncio.gather(stdin_task, stderr_task, watchdog_task,
                                 return_exceptions=True)
            await process.wait()
            self._channel_processes.pop(channel, None)

        stderr_text = "".join(stderr_chunks).strip()
        returncode = process.returncode

        if channel in self._stopping_channels:
            return None

        # Auto-heal a stale/missing session: Goose exits non-zero with this
        # message when --resume names a session it can't find. Recreate once.
        if (resume and returncode and not _retry
                and "no session found" in stderr_text.lower()):
            logger.info("Goose session %s missing; creating a fresh one.", session_name)
            self._channel_sessions.pop(channel, None)
            self._save_sessions()
            await self._send_status(
                channel,
                "Previous Goose session was unavailable — starting a new one "
                "(earlier context is reset).",
            )
            return await self._run_goose(content, channel, _retry=True)

        # Failure: non-zero exit OR an error event (Goose can exit 0 after an
        # agent error). Never report success on a non-zero exit even if some
        # text was produced.
        if returncode != 0 or parser.had_error:
            detail = parser.error_message or stderr_text
            message = classify_goose_error(detail) or (
                self._safe(detail)[:500] if detail
                else f"Goose exited with code {returncode}."
            )
            await self._send_error(channel, self._safe(message))
            return None

        # First successful run for this channel created the session — record it
        # so future turns resume instead of starting over.
        if channel not in self._channel_sessions:
            self._channel_sessions[channel] = session_name
            self._save_sessions()

        return final_text or ""

    async def _dispatch_event(self, channel: str, event: dict) -> Optional[str]:
        """Map a parser event to workspace status, or return the final answer text."""
        kind = event.get("kind")
        if kind == "final":
            return event.get("text") or ""
        if kind == "tool":
            name = event.get("name") or "tool"
            summary = self._safe(event.get("summary") or "")
            label = f"🔧 {name}" + (f" — {summary}" if summary else "")
            await self._send_status(channel, label)
        elif kind in ("progress", "thinking"):
            # Intermediate assistant narration (progress) and genuine model
            # thinking are both surfaced as transient workspace status (the
            # Python BaseAdapter has no separate "thinking" channel).
            text = self._safe(event.get("text") or "").strip()
            if text:
                if len(text) > _STATUS_PREVIEW:
                    text = text[:_STATUS_PREVIEW] + "…"
                await self._send_status(channel, text)
        elif kind == "notification":
            text = self._safe(event.get("text") or "").strip()
            if text:
                await self._send_status(channel, text[:_STATUS_PREVIEW])
        # tool_result / complete / error → no direct status (error handled by caller)
        return None


def _safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in (name or "default")) or "default"
