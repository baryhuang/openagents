"""
Platform respond tests for Claude Code agent.

Tests that a Claude Code agent connected to a workspace can receive
a message via the workspace API. Verifies the message infrastructure
works end-to-end (send message → poll → message appears).

Note: On CI the agent isn't logged in, so it can't generate real
responses. This test verifies the workspace messaging pipeline, not
the agent's LLM capability.

Run:
    pytest tests/platform/respond/test_claude.py -v
"""

import asyncio
import shutil
import uuid

import pytest

from tests.platform.conftest import run_openagents, safe_print


AGENT_TYPE = "claude"
BINARY_NAME = "claude"
ENDPOINT = "https://workspace-endpoint.openagents.org"


@pytest.fixture()
def workspace_env():
    """Create a workspace via the Python API and clean up after."""
    from openagents.client.workspace_client import WorkspaceClient

    agent_name = f"ci-claude-{uuid.uuid4().hex[:8]}"
    ws_name = f"ws-{agent_name}"
    client = WorkspaceClient(endpoint=ENDPOINT)

    # Create workspace
    ws = asyncio.run(
        client.create_workspace(name=ws_name, agent_name=agent_name, agent_type=AGENT_TYPE)
    )

    yield {
        "agent_name": agent_name,
        "ws_name": ws_name,
        "workspace_id": ws.workspace_id,
        "token": ws.token,
        "channel_name": ws.channel_name,
        "slug": ws.slug,
        "client": client,
    }

    # Cleanup
    run_openagents("down", timeout=30)
    run_openagents("remove", agent_name, timeout=10, stdin_text="y\n")


class TestClaudeRespond:
    """Test sending messages to a workspace with Claude Code."""

    def test_agent_installed(self):
        """Claude must be installed."""
        assert shutil.which(BINARY_NAME) is not None, (
            f"'{BINARY_NAME}' not on PATH."
        )

    def test_send_message_to_workspace(self, workspace_env):
        """Send a message to the workspace via the API — should succeed."""
        env = workspace_env
        client = env["client"]
        msg_content = f"Hello from CI test {uuid.uuid4().hex[:8]}"

        result = asyncio.run(
            client.send_message(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                content=msg_content,
                sender_type="human",
                sender_name="ci-tester",
            )
        )

        assert result is not None, "send_message returned None"
        assert result.get("messageId") or result.get("id"), (
            f"No message ID in response: {result}"
        )

    def test_message_appears_in_channel(self, workspace_env):
        """After sending, the message should appear when polling the channel."""
        env = workspace_env
        client = env["client"]
        msg_content = f"Poll test {uuid.uuid4().hex[:8]}"

        # Send
        asyncio.run(
            client.send_message(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                content=msg_content,
                sender_type="human",
                sender_name="ci-tester",
            )
        )

        # Poll
        messages = asyncio.run(
            client.poll_messages(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                limit=10,
            )
        )

        # Find our message
        found = any(
            msg_content in (m.get("content", "") or "")
            for m in messages
        )
        assert found, (
            f"Message '{msg_content}' not found in channel.\n"
            f"Got {len(messages)} messages: "
            f"{[m.get('content', '')[:50] for m in messages]}"
        )

    def test_start_agent_with_workspace(self, workspace_env):
        """Start the agent and join it to the existing workspace."""
        env = workspace_env

        result = run_openagents(
            "start", AGENT_TYPE,
            "--name", env["agent_name"],
            "--join-workspace", env["token"],
            "--no-browser",
            timeout=60,
            stdin_text="y\n",
        )
        # Accept either success or warning (agent may not be logged in)
        assert result.returncode == 0, (
            f"Failed to start and join workspace "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-500:]}\n"
            f"stderr:\n{result.stderr[-500:]}"
        )

    def test_send_message_with_agent_running(self, workspace_env):
        """With agent running, send a message and verify it's received."""
        env = workspace_env
        client = env["client"]

        # Start agent and join workspace
        run_openagents(
            "start", AGENT_TYPE,
            "--name", env["agent_name"],
            "--join-workspace", env["token"],
            "--no-browser",
            timeout=60,
            stdin_text="y\n",
        )

        msg_content = f"Agent test {uuid.uuid4().hex[:8]}"

        # Send message
        asyncio.run(
            client.send_message(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                content=msg_content,
                sender_type="human",
                sender_name="ci-tester",
            )
        )

        # Poll — message should appear
        messages = asyncio.run(
            client.poll_messages(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                limit=20,
            )
        )

        found = any(
            msg_content in (m.get("content", "") or "")
            for m in messages
        )
        assert found, (
            f"Message not found in channel after sending with agent running.\n"
            f"Got {len(messages)} messages."
        )


class TestClaudeRespondReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details."""
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path,
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
