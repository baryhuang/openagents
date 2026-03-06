"""
Daemon manager — runs multiple agent adapters with auto-restart.

Works on Linux, macOS, and Windows.

Usage:
    from openagents.daemon import DaemonManager
    from openagents.daemon_config import load_config

    config = load_config()
    manager = DaemonManager(config)
    asyncio.run(manager.start())
"""

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from openagents.agent_setup import setup_agent
from openagents.daemon_config import (
    AgentEntry,
    DaemonConfig,
    WorkspaceEntry,
    PID_PATH,
    LOG_PATH,
    STATUS_PATH,
    write_status,
)

logger = logging.getLogger(__name__)

IS_WINDOWS = sys.platform == "win32"


# ---------------------------------------------------------------------------
# Agent status tracking
# ---------------------------------------------------------------------------

@dataclass
class AgentStatus:
    name: str
    type: str
    workspace_slug: str
    state: str = "starting"  # starting, online, reconnecting, stopped, error
    started_at: Optional[str] = None
    restarts: int = 0
    last_error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "type": self.type,
            "workspace": self.workspace_slug,
            "state": self.state,
            "started_at": self.started_at,
            "restarts": self.restarts,
            "last_error": self.last_error,
        }


# ---------------------------------------------------------------------------
# Daemon manager
# ---------------------------------------------------------------------------

class DaemonManager:
    """Manages multiple agent adapters in a single asyncio event loop."""

    def __init__(self, config: DaemonConfig):
        self.config = config
        self.tasks: dict[str, asyncio.Task] = {}
        self.agent_status: dict[str, AgentStatus] = {}
        self._shutting_down = False
        self._shutdown_event = asyncio.Event()

    async def start(self):
        """Start all configured agents and block until shutdown."""
        # Start all agents
        for ws in self.config.workspaces:
            for agent_cfg in ws.agents:
                self._launch_agent(ws, agent_cfg)

        total = sum(len(ws.agents) for ws in self.config.workspaces)
        logger.info(
            f"Started {total} agent(s) across "
            f"{len(self.config.workspaces)} workspace(s)"
        )

        # Install signal handlers
        loop = asyncio.get_running_loop()
        if IS_WINDOWS:
            # Windows doesn't support loop.add_signal_handler;
            # use signal.signal() and schedule callback on the event loop
            def _sig_handler(*_args):
                loop.call_soon_threadsafe(self._handle_signal)
            signal.signal(signal.SIGINT, _sig_handler)
            signal.signal(signal.SIGTERM, _sig_handler)
        else:
            for sig in (signal.SIGTERM, signal.SIGINT):
                loop.add_signal_handler(sig, self._handle_signal)

        # Periodically write status file
        status_task = asyncio.create_task(self._status_loop())

        # Wait for shutdown signal
        await self._shutdown_event.wait()

        # Cleanup
        status_task.cancel()
        await self._cancel_all()
        self._write_status()
        logger.info("Daemon stopped")

    def _handle_signal(self):
        """Signal handler — trigger graceful shutdown."""
        if not self._shutting_down:
            logger.info("Shutdown signal received")
            self._shutting_down = True
            # On Windows, signal handlers run in the main thread, not the
            # event loop thread, so we need thread-safe event setting.
            self._shutdown_event.set()

    def _launch_agent(self, ws: WorkspaceEntry, agent_cfg: AgentEntry):
        """Create status entry and launch agent task."""
        status = AgentStatus(
            name=agent_cfg.name,
            type=agent_cfg.type,
            workspace_slug=ws.slug,
        )
        self.agent_status[agent_cfg.name] = status
        self.tasks[agent_cfg.name] = asyncio.create_task(
            self._run_with_restart(ws, agent_cfg, status)
        )

    async def _run_with_restart(
        self,
        ws: WorkspaceEntry,
        agent_cfg: AgentEntry,
        status: AgentStatus,
    ):
        """Run an adapter with exponential backoff on crash."""
        backoff = 2
        while not self._shutting_down:
            try:
                status.state = "starting"
                self._write_status()

                adapter = await setup_agent(
                    agent_type=agent_cfg.type,
                    agent_name=agent_cfg.name,
                    workspace_id=ws.id,
                    token=ws.token,
                    endpoint=ws.endpoint,
                    role=agent_cfg.role,
                    options=agent_cfg.options,
                    quiet=True,
                )

                status.state = "online"
                status.started_at = datetime.now(timezone.utc).isoformat()
                self._write_status()
                logger.info(f"{agent_cfg.name} is online")

                await adapter.run()
                # Clean exit
                logger.info(f"{agent_cfg.name} exited cleanly")
                break

            except asyncio.CancelledError:
                logger.debug(f"{agent_cfg.name} cancelled")
                break

            except Exception as e:
                status.restarts += 1
                status.state = "reconnecting"
                status.last_error = str(e)[:200]
                self._write_status()
                logger.warning(
                    f"{agent_cfg.name} crashed: {e}, "
                    f"restarting in {backoff}s (attempt {status.restarts})"
                )
                try:
                    await asyncio.sleep(backoff)
                except asyncio.CancelledError:
                    break
                backoff = min(backoff * 2, 60)

        status.state = "stopped"

    async def _cancel_all(self):
        """Cancel all running agent tasks."""
        for name, task in self.tasks.items():
            if not task.done():
                task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks.values(), return_exceptions=True)

    async def _status_loop(self):
        """Periodically write status file for `openagents status` to read."""
        try:
            while True:
                self._write_status()
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            pass

    def _write_status(self):
        """Write current agent statuses to disk."""
        try:
            statuses = {
                name: s.to_dict()
                for name, s in self.agent_status.items()
            }
            write_status(statuses, os.getpid())
        except Exception as e:
            logger.debug(f"Failed to write status: {e}")


# ---------------------------------------------------------------------------
# Daemonization helpers (cross-platform)
# ---------------------------------------------------------------------------

def _is_process_alive(pid: int) -> bool:
    """Check if a process is alive. Works on all platforms."""
    if IS_WINDOWS:
        # Use tasklist to check; os.kill(pid, 0) is unreliable on Windows
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True, text=True, timeout=5,
            )
            return str(pid) in result.stdout
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except (ProcessLookupError, PermissionError):
            return False


def daemonize():
    """Start the daemon in the background.

    On Unix: double-fork + setsid (classic daemon pattern).
    On Windows: re-launch as a detached subprocess.

    In both cases, writes PID file and redirects output to log.
    Call this BEFORE asyncio.run() in the parent process.
    """
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    PID_PATH.parent.mkdir(parents=True, exist_ok=True)

    if IS_WINDOWS:
        _daemonize_windows()
    else:
        _daemonize_unix()


def _daemonize_unix():
    """Unix double-fork daemon."""
    # First fork
    pid = os.fork()
    if pid > 0:
        print(f"Daemon started (PID {pid})")
        print(f"Logs: {LOG_PATH}")
        print(f"Stop: openagents down")
        sys.exit(0)

    # Child — create new session
    os.setsid()

    # Second fork (prevent terminal reacquisition)
    pid = os.fork()
    if pid > 0:
        sys.exit(0)

    # Redirect stdio to log file
    log_fd = open(LOG_PATH, "a")
    os.dup2(log_fd.fileno(), sys.stdout.fileno())
    os.dup2(log_fd.fileno(), sys.stderr.fileno())
    devnull = open(os.devnull, "r")
    os.dup2(devnull.fileno(), sys.stdin.fileno())

    # Write PID file
    PID_PATH.write_text(str(os.getpid()))

    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=log_fd,
    )


def _daemonize_windows():
    """Windows: re-launch this command as a detached subprocess."""
    import shutil

    # Find the openagents CLI entry point
    openagents_bin = shutil.which("openagents")
    if openagents_bin:
        args = [openagents_bin, "up", "--foreground"]
    else:
        args = [sys.executable, "-m", "openagents", "up", "--foreground"]

    # Pass through --config if it was provided
    for i, a in enumerate(sys.argv):
        if a in ("--config", "-c") and i + 1 < len(sys.argv):
            args.extend(["--config", sys.argv[i + 1]])
            break

    log_file = open(LOG_PATH, "a")
    # CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS detaches from parent console
    creation_flags = (
        getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        | getattr(subprocess, "DETACHED_PROCESS", 0)
    )
    proc = subprocess.Popen(
        args,
        stdout=log_file,
        stderr=log_file,
        stdin=subprocess.DEVNULL,
        creationflags=creation_flags,
    )

    PID_PATH.write_text(str(proc.pid))
    print(f"Daemon started (PID {proc.pid})")
    print(f"Logs: {LOG_PATH}")
    print(f"Stop: openagents down")
    sys.exit(0)


def read_daemon_pid() -> Optional[int]:
    """Read PID from pid file. Returns None if not running."""
    if not PID_PATH.exists():
        return None
    try:
        pid = int(PID_PATH.read_text().strip())
        if _is_process_alive(pid):
            return pid
        # Stale PID file
        PID_PATH.unlink(missing_ok=True)
        return None
    except (ValueError, OSError):
        PID_PATH.unlink(missing_ok=True)
        return None


def stop_daemon() -> bool:
    """Stop running daemon. Returns True if stopped."""
    pid = read_daemon_pid()
    if pid is None:
        return False

    import time

    if IS_WINDOWS:
        # Windows: use taskkill for graceful then forced termination
        subprocess.run(
            ["taskkill", "/PID", str(pid)],
            capture_output=True, timeout=5,
        )
        for _ in range(20):
            if not _is_process_alive(pid):
                PID_PATH.unlink(missing_ok=True)
                STATUS_PATH.unlink(missing_ok=True)
                return True
            time.sleep(0.5)
        # Force kill
        subprocess.run(
            ["taskkill", "/F", "/PID", str(pid)],
            capture_output=True, timeout=5,
        )
    else:
        # Unix: SIGTERM then SIGKILL
        os.kill(pid, signal.SIGTERM)
        for _ in range(20):
            if not _is_process_alive(pid):
                PID_PATH.unlink(missing_ok=True)
                STATUS_PATH.unlink(missing_ok=True)
                return True
            time.sleep(0.5)
        # Force kill
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    PID_PATH.unlink(missing_ok=True)
    STATUS_PATH.unlink(missing_ok=True)
    return True
