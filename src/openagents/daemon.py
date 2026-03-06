"""
Daemon manager — runs multiple agent adapters with auto-restart.

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
# Daemonization helpers
# ---------------------------------------------------------------------------

def daemonize():
    """Fork into background, write PID file, redirect stdio to log.

    Call this BEFORE asyncio.run() in the parent process.
    """
    # First fork
    pid = os.fork()
    if pid > 0:
        # Parent — print info and exit
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

    # Redirect stdio
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log_fd = open(LOG_PATH, "a")
    os.dup2(log_fd.fileno(), sys.stdout.fileno())
    os.dup2(log_fd.fileno(), sys.stderr.fileno())

    # Redirect stdin to /dev/null
    devnull = open(os.devnull, "r")
    os.dup2(devnull.fileno(), sys.stdin.fileno())

    # Write PID file
    PID_PATH.parent.mkdir(parents=True, exist_ok=True)
    PID_PATH.write_text(str(os.getpid()))

    # Setup logging to go to file
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=log_fd,
    )


def read_daemon_pid() -> Optional[int]:
    """Read PID from pid file. Returns None if not running."""
    if not PID_PATH.exists():
        return None
    try:
        pid = int(PID_PATH.read_text().strip())
        # Check if process is alive
        os.kill(pid, 0)
        return pid
    except (ValueError, ProcessLookupError, PermissionError):
        # Stale PID file
        PID_PATH.unlink(missing_ok=True)
        return None


def stop_daemon() -> bool:
    """Send SIGTERM to running daemon. Returns True if stopped."""
    pid = read_daemon_pid()
    if pid is None:
        return False

    os.kill(pid, signal.SIGTERM)

    # Wait up to 10 seconds for graceful shutdown
    import time
    for _ in range(20):
        try:
            os.kill(pid, 0)
            time.sleep(0.5)
        except ProcessLookupError:
            # Process exited
            PID_PATH.unlink(missing_ok=True)
            STATUS_PATH.unlink(missing_ok=True)
            return True

    # Still alive after 10s — force kill
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    PID_PATH.unlink(missing_ok=True)
    STATUS_PATH.unlink(missing_ok=True)
    return True
