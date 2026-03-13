"""
Platform start tests for Claude Code agent.

Tests that `openagents start claude` can launch the agent daemon
across Linux, macOS, and Windows.

Run:
    pytest tests/platform/start/test_claude.py -v
"""

import shutil
import time

import pytest

from tests.platform.conftest import run_cmd, run_openagents, safe_print


AGENT_NAME = "claude"
BINARY_NAME = "claude"


@pytest.fixture(autouse=True)
def cleanup_daemon():
    """Stop daemon and remove agent config after each test."""
    yield
    # Stop daemon if running
    run_openagents("down", timeout=30)
    # Remove the agent from config
    run_openagents("remove", AGENT_NAME, "--yes", timeout=10)


class TestClaudeStart:
    """Test starting Claude Code via `openagents start claude`."""

    def test_agent_installed(self):
        """Claude must be installed before we can start it."""
        assert shutil.which(BINARY_NAME) is not None, (
            f"'{BINARY_NAME}' not on PATH. "
            f"Run install tests first: pytest tests/platform/install/test_claude.py"
        )

    def test_openagents_start(self):
        """`openagents start claude` should launch the daemon.

        Uses stdin pipe so the interactive workspace prompt auto-selects
        'skip' (the default choice).
        """
        result = run_openagents(
            "start", AGENT_NAME, "--no-browser",
            timeout=30,
            stdin_text="\n",  # Accept default "skip" for workspace prompt
        )
        # Exit code 0 = success, but also accept cases where
        # the agent isn't fully "ready" (no API key) — the important
        # thing is the command didn't crash
        assert result.returncode == 0, (
            f"`openagents start {AGENT_NAME}` failed "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )

    def test_daemon_running(self):
        """After start, `openagents status` should show daemon running."""
        # Start the agent first
        run_openagents("start", AGENT_NAME, "--no-browser", timeout=30)

        # Give daemon a moment to spin up
        time.sleep(2)

        result = run_openagents("status", timeout=10)
        output = result.stdout.lower()
        # Status should mention the daemon is running or show the agent
        assert "running" in output or "pid" in output or AGENT_NAME in output, (
            f"`openagents status` does not show daemon running.\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )

    def test_daemon_stop(self):
        """`openagents down` should stop the daemon cleanly."""
        # Start first
        run_openagents("start", AGENT_NAME, "--no-browser", timeout=30)
        time.sleep(2)

        # Stop
        result = run_openagents("down", timeout=30)
        assert result.returncode == 0, (
            f"`openagents down` failed (exit {result.returncode}).\n"
            f"stderr: {result.stderr[-500:]}"
        )


class TestClaudeStartReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details (always passes, for diagnostics)."""
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path,
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
