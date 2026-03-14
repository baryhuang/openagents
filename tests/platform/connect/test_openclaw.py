"""
Platform connect tests for OpenClaw agent.

Tests that `openagents start openclaw --create-workspace ...` can create a
workspace and connect the agent to it across Linux, macOS, and Windows.

Uses a unique --name for each test run so it doesn't collide with any
existing agent entries in the daemon config.

Run:
    pytest tests/platform/connect/test_openclaw.py -v
"""

import shutil
import time
import uuid

import pytest

from tests.platform.conftest import run_openagents, safe_print


AGENT_TYPE = "openclaw"
BINARY_NAME = "openclaw"


@pytest.fixture()
def agent_name():
    """Generate a unique agent name for this test."""
    name = f"ci-oclaw-{uuid.uuid4().hex[:8]}"
    yield name
    # Cleanup: stop daemon and remove the agent
    run_openagents("down", timeout=30)
    run_openagents("remove", name, timeout=10, stdin_text="y\n")


def _start_with_workspace(agent_name: str, ws_name: str, timeout: int = 60):
    """Start the agent with a unique name and create a workspace."""
    return run_openagents(
        "start", AGENT_TYPE,
        "--name", agent_name,
        "--create-workspace", ws_name,
        "--no-browser",
        timeout=timeout,
    )


class TestOpenClawConnect:
    """Test connecting OpenClaw to a workspace."""

    def test_agent_installed(self):
        """OpenClaw must be installed before we can connect it."""
        assert shutil.which(BINARY_NAME) is not None, (
            f"'{BINARY_NAME}' not on PATH. "
            f"Run install tests first: pytest tests/platform/install/test_openclaw.py"
        )

    def test_create_workspace_and_connect(self, agent_name):
        """`openagents start openclaw --create-workspace` should create a
        workspace and connect the agent to it."""
        ws_name = f"ws-{agent_name}"
        result = _start_with_workspace(agent_name, ws_name)
        assert result.returncode == 0, (
            f"Failed to start {AGENT_TYPE} with --create-workspace "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )
        # Output should mention the workspace or "Created"
        combined = (result.stdout + result.stderr).lower()
        assert (
            ws_name.lower() in combined
            or "workspace" in combined
            or "created" in combined
        ), (
            f"Output doesn't mention workspace.\n"
            f"stdout:\n{result.stdout[-500:]}"
        )

    def test_status_shows_workspace(self, agent_name):
        """After connecting, `openagents status` should show the workspace."""
        ws_name = f"ws-{agent_name}"
        start = _start_with_workspace(agent_name, ws_name)
        assert start.returncode == 0, (
            f"Start failed (exit {start.returncode}).\n"
            f"stderr: {start.stderr[-500:]}"
        )

        # Give daemon a moment to report status
        time.sleep(3)

        result = run_openagents("status", timeout=10)
        output = result.stdout
        output_lower = output.lower()

        # Agent name should appear in status (may be truncated by Rich table)
        # e.g. "ci-oclaw-f4db92e8" → "ci-oclaw…"
        name_prefix = agent_name[:7]
        assert name_prefix in output_lower, (
            f"Agent '{agent_name}' (prefix '{name_prefix}') "
            f"not in status output.\n"
            f"stdout:\n{output}"
        )
        # The agent row should NOT show "(local)" — it should have a
        # workspace slug/id in the Network column
        agent_lines = [
            line for line in output.split("\n")
            if name_prefix in line.lower()
        ]
        if agent_lines:
            assert "(local)" not in agent_lines[0].lower(), (
                f"Agent shows as (local) instead of connected to workspace.\n"
                f"Agent line: {agent_lines[0]}"
            )

    def test_daemon_stop_after_connect(self, agent_name):
        """`openagents down` should stop cleanly after workspace connect."""
        ws_name = f"ws-{agent_name}"
        _start_with_workspace(agent_name, ws_name)
        time.sleep(2)

        result = run_openagents("down", timeout=30)
        assert result.returncode == 0, (
            f"`openagents down` failed (exit {result.returncode}).\n"
            f"stderr: {result.stderr[-500:]}"
        )


class TestOpenClawConnectReport:
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
