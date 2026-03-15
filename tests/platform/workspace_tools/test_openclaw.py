"""
Platform workspace tools tests for OpenClaw agent.

Tests that the MCP server correctly exposes workspace tools that
OpenClaw would use (via system prompt injection of HTTP endpoints).
Verifies the tool registry since the same MCP server powers both
agent types.

Run:
    pytest tests/platform/workspace_tools/test_openclaw.py -v
"""

import asyncio
import shutil

import pytest

from tests.platform.conftest import safe_print


AGENT_TYPE = "openclaw"
BINARY_NAME = "openclaw"

# Same workspace tools should be available for all agent types
CORE_TOOLS = {
    "workspace_get_history",
    "workspace_get_agents",
    "workspace_status",
}

FILE_TOOLS = {
    "workspace_write_file",
    "workspace_read_file",
    "workspace_list_files",
    "workspace_delete_file",
}


def _get_tools_from_server(server):
    """Extract tool list from an MCP server by calling its ListTools handler."""
    from mcp import types as mcp_types

    handler = server.request_handlers[mcp_types.ListToolsRequest]
    req = mcp_types.ListToolsRequest(method="tools/list")
    result = asyncio.run(handler(req))
    tools = result.root.tools
    return tools


@pytest.fixture()
def mcp_tools():
    """Create an MCP server and list its tools."""
    from openagents.mcp_server import create_mcp_server

    server = create_mcp_server(
        workspace_id="test-workspace",
        channel_name="test-channel",
        token="test-token",
        agent_name="test-openclaw",
    )

    tools = _get_tools_from_server(server)
    tool_names = {t.name for t in tools}
    return tool_names, tools


class TestOpenClawWorkspaceTools:
    """Test workspace tool availability for OpenClaw."""

    def test_agent_installed(self):
        """OpenClaw must be installed."""
        assert shutil.which(BINARY_NAME) is not None

    def test_core_tools_available(self, mcp_tools):
        """Core workspace tools must be present."""
        tool_names, _ = mcp_tools
        for tool in CORE_TOOLS:
            assert tool in tool_names, (
                f"Core tool '{tool}' not found. "
                f"Available: {sorted(tool_names)}"
            )

    def test_file_tools_available(self, mcp_tools):
        """File tools must be present."""
        tool_names, _ = mcp_tools
        for tool in FILE_TOOLS:
            assert tool in tool_names, (
                f"File tool '{tool}' not found. "
                f"Available: {sorted(tool_names)}"
            )

    def test_tools_have_descriptions(self, mcp_tools):
        """All tools must have descriptions (used for OpenClaw prompt injection)."""
        _, tools = mcp_tools
        for tool in tools:
            assert tool.description, (
                f"Tool '{tool.name}' has no description"
            )

    def test_total_tool_count(self, mcp_tools):
        """Verify a reasonable number of tools are registered."""
        tool_names, _ = mcp_tools
        # At minimum: 3 core + 4 file + 8 browser + 3 tunnel = 18
        assert len(tool_names) >= 15, (
            f"Only {len(tool_names)} tools registered, expected >= 15. "
            f"Tools: {sorted(tool_names)}"
        )


class TestOpenClawWorkspaceToolsReport:
    """Collect environment info."""

    def test_report_environment(self, os_platform, openagents_version):
        safe_print(f"  platform: {os_platform}")
        safe_print(f"  openagents_version: {openagents_version}")
        safe_print(f"  agent_binary: {shutil.which(BINARY_NAME)}")
