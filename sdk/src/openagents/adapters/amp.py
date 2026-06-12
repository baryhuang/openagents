"""
Amp adapter for OpenAgents workspace.

Bridges Sourcegraph's Amp CLI to an OpenAgents workspace by running the
agent in its official non-interactive *execute* mode with structured output:

    amp -x --stream-json                       # first turn (new thread)
    amp threads continue <thread_id> -x --stream-json   # follow-up turns

The prompt is fed on **stdin** (the documented ``echo "..." | amp -x`` path),
which avoids ARG_MAX / shell-quoting issues with the large workspace system
context. Amp's ``--stream-json`` output is intentionally compatible with Claude
Code's stream-json schema, so the event handling here mirrors the Claude
adapter: ``system`` (init / session id), ``assistant`` (text + tool_use blocks),
and ``result`` (final text + session id).

Per-channel Amp thread IDs are persisted so each workspace thread keeps its own
Amp conversation context across messages. Authentication uses ``AMP_API_KEY``
(or a prior ``amp login``); the key is read from the environment and is never
written to logs, error messages, or workspace messages.

This adapter reuses all of the shared connectivity, process-dispatch, and
state machinery in :class:`~openagents.adapters.base.BaseAdapter`; only the
Amp-specific subprocess invocation and output parsing live here.
"""

import asyncio
import json
import logging
import os
import platform
import shutil
import signal
import subprocess
from pathlib import Path
from typing import Optional

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import format_attachments_for_prompt
from openagents.adapters.workspace_prompt import build_openclaw_system_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

# Per-read timeout while streaming Amp's stdout. A turn can pause for a while
# (model latency, long tool runs), so we tolerate several idle reads before
# treating the process as hung.
_READ_TIMEOUT = 15.0
# After this many consecutive idle reads (~5 min) with the process still alive
# and no output, assume it is wedged and terminate it rather than block forever.
_MAX_IDLE_READS = 20


class AmpAdapter(BaseAdapter):
    """Connects the Amp CLI to an OpenAgents workspace."""

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

        # channel -> Amp thread id (for `amp threads continue <id>`)
        self._channel_threads: dict[str, str] = {}
        # channel -> running subprocess (for stop / cleanup)
        self._channel_processes: dict[str, asyncio.subprocess.Process] = {}
        # channels the user explicitly stopped (suppress "no response" noise)
        self._stopping_channels: set[str] = set()

        self._sessions_file = (
            Path.home() / ".openagents" / "sessions"
            / f"{workspace_id}_{agent_name}_amp.json"
        )
        self._load_sessions()

        self._amp_binary = self._find_amp_binary()
        if self._amp_binary:
            logger.info("Using Amp CLI: %s", self._amp_binary)
        else:
            logger.warning(
                "Amp binary not found. Install with: "
                "curl -fsSL https://ampcode.com/install.sh | bash"
            )

    # ------------------------------------------------------------------
    # Session (thread id) persistence
    # ------------------------------------------------------------------

    def _load_sessions(self):
        try:
            if self._sessions_file.exists():
                data = json.loads(self._sessions_file.read_text())
                if isinstance(data, dict):
                    self._channel_threads.update(data)
                    logger.info(
                        "Loaded %d Amp thread(s) from %s",
                        len(data), self._sessions_file.name,
                    )
        except Exception:
            logger.debug("Could not load Amp sessions file, starting fresh")

    def _save_sessions(self):
        try:
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self._sessions_file.write_text(json.dumps(self._channel_threads))
        except Exception:
            logger.debug("Could not save Amp sessions file")

    # ------------------------------------------------------------------
    # Binary resolution (cross-platform, mirrors the registry loader rules)
    # ------------------------------------------------------------------

    @staticmethod
    def _find_amp_binary() -> Optional[str]:
        """Locate the ``amp`` executable across platforms.

        Detection order: PATH (preferring Windows ``.cmd``/``.exe`` shims, since
        the bare name can resolve to a non-executable script) → npm global
        prefix → the official installer's canonical ``~/.amp/bin`` plus its
        symlink targets (``~/.local/bin``, ``~/bin``). The ``~/.amp/bin``
        fallback is what makes detection work when a GUI- or daemon-spawned
        process didn't inherit the user's interactive shell PATH — the common
        "installed but not found" case.
        """
        home = Path.home()
        if platform.system() == "Windows":
            found = (
                shutil.which("amp.cmd")
                or shutil.which("amp.exe")
                or shutil.which("amp")
            )
            if found:
                return found
            try:
                npm_prefix = subprocess.check_output(
                    ["npm", "config", "get", "prefix"],
                    text=True, timeout=5,
                ).strip()
                if npm_prefix:
                    for ext in (".cmd", ".exe", ""):
                        candidate = os.path.join(npm_prefix, f"amp{ext}")
                        if os.path.isfile(candidate):
                            return candidate
            except Exception:
                pass
            for candidate in (
                home / ".amp" / "bin" / "amp.exe",
                Path(os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local"))) / "amp" / "amp.exe",
            ):
                if candidate.is_file():
                    return str(candidate)
            return None

        found = shutil.which("amp")
        if found:
            return found
        for candidate in (
            home / ".amp" / "bin" / "amp",
            home / ".local" / "bin" / "amp",
            home / "bin" / "amp",
        ):
            try:
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    return str(candidate)
            except OSError:
                continue
        return None

    # ------------------------------------------------------------------
    # Prompt / command construction
    # ------------------------------------------------------------------

    def _build_system_context(self, channel_name: str, browser_enabled: bool = False) -> str:
        return build_openclaw_system_prompt(
            agent_name=self.agent_name,
            workspace_id=self.workspace_id,
            channel_name=channel_name,
            endpoint=self.endpoint,
            token=self.token,
            mode=self._mode,
            disabled_modules=self.disabled_modules,
            browser_enabled=browser_enabled,
        )

    def _build_amp_cmd(self, channel_name: str, resume: bool) -> list[str]:
        """Build the Amp CLI argv for a channel.

        ``resume`` continues this channel's existing Amp thread; otherwise a
        fresh thread is started and its id captured from the stream output.
        The prompt itself is supplied on stdin, not as an argument.
        """
        amp_bin = self._amp_binary or self._find_amp_binary()
        if amp_bin:
            self._amp_binary = amp_bin
        if not amp_bin:
            raise FileNotFoundError(
                "amp CLI not found. Install with: "
                "curl -fsSL https://ampcode.com/install.sh | bash"
            )

        thread_id = self._channel_threads.get(channel_name) if resume else None
        if thread_id:
            cmd = [amp_bin, "threads", "continue", thread_id, "-x", "--stream-json"]
        else:
            cmd = [amp_bin, "-x", "--stream-json"]
        return cmd

    # ------------------------------------------------------------------
    # Control actions (stop)
    # ------------------------------------------------------------------

    async def _on_control_action(self, action: Optional[str], payload: dict):
        if action == "stop":
            await self._stop_all_processes()

    async def _stop_all_processes(self):
        """Terminate any running Amp subprocess (stop button)."""
        for channel, proc in list(self._channel_processes.items()):
            self._stopping_channels.add(channel)
            await self._stop_process(proc)
            self._channel_processes.pop(channel, None)
            self._channel_queues.pop(channel, None)
            await self._send_status(channel, "Execution stopped by user")

    async def _stop_process(self, proc: asyncio.subprocess.Process):
        """Kill a single Amp subprocess and its child process group."""
        if not proc or proc.returncode is not None:
            return
        try:
            if platform.system() == "Windows":
                try:
                    killer = await asyncio.create_subprocess_exec(
                        "taskkill", "/F", "/T", "/PID", str(proc.pid),
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await asyncio.wait_for(killer.wait(), timeout=5)
                except Exception:
                    proc.kill()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                return

            # POSIX: kill the whole process group so child tool processes
            # (started with start_new_session=True) are reaped too.
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError, OSError):
                proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=2)
            except asyncio.TimeoutError:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    proc.kill()
                await proc.wait()
        except ProcessLookupError:
            pass

    # ------------------------------------------------------------------
    # Message handler
    # ------------------------------------------------------------------

    async def _handle_message(self, msg: dict):
        content = (msg.get("content") or "").strip()
        attachments = msg.get("attachments", [])
        att_text = format_attachments_for_prompt(attachments)
        if att_text:
            content = (content + att_text) if content else att_text.strip()
        if not content:
            return

        msg_channel = msg.get("sessionId") or self.channel_name
        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(
            "Processing message from %s in channel %s: %s...",
            sender, msg_channel, content[:80],
        )

        await self._auto_title_channel(msg_channel, content)
        self._stopping_channels.discard(msg_channel)
        await self._send_status(msg_channel, "thinking...")

        try:
            response_text = await self._run_amp(content, msg_channel)
        except FileNotFoundError as e:
            await self._send_error(msg_channel, str(e))
            return
        except Exception as e:
            logger.exception("Error handling message: %s", e)
            await self._send_error(msg_channel, f"Error processing message: {e}")
            return

        if msg_channel in self._stopping_channels:
            self._stopping_channels.discard(msg_channel)
            return

        if response_text:
            await self._send_response(msg_channel, response_text)
        else:
            await self._send_response(
                msg_channel, "No response generated. Please try again."
            )

    # ------------------------------------------------------------------
    # Subprocess execution + stream-json parsing
    # ------------------------------------------------------------------

    async def _run_amp(self, content: str, msg_channel: str) -> str:
        """Run Amp for a message, retrying once with a fresh thread if a
        resumed thread turns out to be stale."""
        browser_enabled = await self.get_browser_enabled()

        for attempt in range(2):
            resume = attempt == 0 and msg_channel in self._channel_threads
            cmd = self._build_amp_cmd(msg_channel, resume=resume)

            if resume:
                # The Amp thread already carries the workspace context.
                prompt = content
            else:
                context = self._build_system_context(
                    msg_channel, browser_enabled=browser_enabled
                )
                prompt = f"{context}\n\n---\n\n{content}"

            text, exit_code, stale = await self._spawn_amp(cmd, prompt, msg_channel)

            if msg_channel in self._stopping_channels:
                return ""
            if text:
                return text
            if stale and resume:
                logger.info(
                    "Amp thread for channel %s appears stale — retrying fresh",
                    msg_channel,
                )
                self._channel_threads.pop(msg_channel, None)
                self._save_sessions()
                continue
            return ""
        return ""

    async def _spawn_amp(self, cmd: list[str], prompt: str, msg_channel: str):
        """Spawn Amp, stream stdout, and return (final_text, exit_code, stale).

        ``stale`` is True when the process failed in a way that suggests the
        resumed thread id is no longer valid, so the caller can retry fresh.
        """
        # Pass a copy of the environment so AMP_API_KEY / AMP_URL flow through.
        # We never log these values.
        env = dict(os.environ)

        is_windows = platform.system() == "Windows"
        spawn_cmd = list(cmd)
        if is_windows and spawn_cmd[0].lower().endswith(".cmd"):
            spawn_cmd = ["cmd.exe", "/c"] + spawn_cmd

        process = await asyncio.create_subprocess_exec(
            *spawn_cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.working_dir,
            env=env,
            limit=10 * 1024 * 1024,  # 10 MB line buffer for large tool output
            start_new_session=not is_windows,  # own process group for stop
        )
        self._channel_processes[msg_channel] = process

        # Feed the prompt on stdin (documented `echo "..." | amp -x` path).
        try:
            if process.stdin:
                process.stdin.write(prompt.encode("utf-8"))
                await process.stdin.drain()
                process.stdin.close()
        except Exception:
            pass

        last_turn_text: list[str] = []
        result_text = ""
        has_tool_use_since_text = False
        idle_reads = 0

        try:
            while True:
                try:
                    line = await asyncio.wait_for(
                        process.stdout.readline(), timeout=_READ_TIMEOUT
                    )
                    idle_reads = 0
                except asyncio.TimeoutError:
                    idle_reads += 1
                    if process.returncode is not None:
                        break
                    if idle_reads > _MAX_IDLE_READS:
                        logger.warning(
                            "Amp produced no output for ~%ds — terminating",
                            int(_MAX_IDLE_READS * _READ_TIMEOUT),
                        )
                        await self._stop_process(process)
                        break
                    continue

                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").strip()
                if not decoded:
                    continue

                try:
                    event = json.loads(decoded)
                except json.JSONDecodeError:
                    logger.debug("Non-JSON line from Amp: %s", decoded[:100])
                    continue

                turn_text, is_result = await self._handle_event(
                    event, msg_channel, last_turn_text, has_tool_use_since_text
                )
                last_turn_text = turn_text["last_turn_text"]
                has_tool_use_since_text = turn_text["has_tool_use"]
                if is_result:
                    result_text = turn_text.get("result_text", "") or result_text

            await process.wait()
        finally:
            self._channel_processes.pop(msg_channel, None)

        exit_code = process.returncode or 0
        stderr_text = ""
        if exit_code != 0:
            try:
                stderr = await process.stderr.read()
                stderr_text = stderr.decode("utf-8", errors="replace").strip()
            except Exception:
                stderr_text = ""
            if stderr_text:
                logger.warning("Amp stderr: %s", stderr_text[:300])

        final = "\n".join(t for t in last_turn_text if t).strip() or result_text.strip()
        # A non-zero exit with no usable output on a resumed thread most likely
        # means the thread id is stale/invalid.
        stale = bool(exit_code != 0 and not final)
        return final, exit_code, stale

    async def _handle_event(
        self,
        event: dict,
        msg_channel: str,
        last_turn_text: list[str],
        has_tool_use_since_text: bool,
    ):
        """Process one stream-json event. Streams thinking/status to the
        workspace and returns the running turn state."""
        event_type = event.get("type")
        result_text = ""

        if event_type == "system":
            # init event carries the Amp thread/session id
            session_id = event.get("session_id")
            if session_id:
                self._remember_thread(msg_channel, session_id)

        elif event_type == "assistant":
            message_data = event.get("message", {}) or {}
            for block in message_data.get("content", []) or []:
                block_type = block.get("type")
                if block_type == "text":
                    text = (block.get("text") or "").strip()
                    if not text:
                        continue
                    # A tool call since the last text starts a new reasoning
                    # segment — reset so only the final turn is posted as chat.
                    if has_tool_use_since_text:
                        last_turn_text = []
                        has_tool_use_since_text = False
                    last_turn_text.append(text)
                    await self._send_thinking(msg_channel, text)
                elif block_type == "tool_use":
                    has_tool_use_since_text = True
                    last_turn_text = []
                    tool_name = block.get("name", "")
                    tool_input = str(block.get("input", {}))[:200]
                    await self._send_status(
                        msg_channel,
                        f"**Using tool:** `{tool_name}`\n```\n{tool_input}\n```",
                    )

        elif event_type == "result":
            session_id = event.get("session_id")
            if session_id:
                self._remember_thread(msg_channel, session_id)
            if event.get("is_error"):
                logger.warning("Amp result error: %s", str(event.get("result", ""))[:200])
            result_text = event.get("result", "") or ""

        return (
            {
                "last_turn_text": last_turn_text,
                "has_tool_use": has_tool_use_since_text,
                "result_text": result_text,
            },
            event_type == "result",
        )

    def _remember_thread(self, channel: str, thread_id: str):
        if not thread_id:
            return
        if self._channel_threads.get(channel) != thread_id:
            self._channel_threads[channel] = thread_id
            self._save_sessions()
            logger.info("Amp thread for channel %s: %s", channel, thread_id)

    async def _send_thinking(self, channel: str, content: str):
        """Stream intermediate reasoning as a 'thinking' message."""
        try:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                channel_name=channel,
                token=self.token,
                content=content,
                sender_type="agent",
                sender_name=self.agent_name,
                message_type="thinking",
                metadata={"agent_mode": self._mode},
            )
        except Exception:
            pass
