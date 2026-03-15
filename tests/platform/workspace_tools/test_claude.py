"""
Platform workspace tools tests for Claude Code agent.

Tests that the MCP server correctly exposes workspace tools that
Claude Code would use via MCP. Verifies the tool registry and
schema without requiring an actual LLM call.

Run:
    pytest tests/platform/workspace_tools/test_claude.py -v
"""

import asyncio
import shutil

import pytest

from tests.platform.conftest import safe_print


AGENT_TYPE = "claude"
BINARY_NAME = "claude"

# Expected workspace tools that should always be available
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

BROWSER_TOOLS = {
    "workspace_browser_open",
    "workspace_browser_navigate",
    "workspace_browser_click",
    "workspace_browser_type",
    "workspace_browser_screenshot",
    "workspace_browser_snapshot",
    "workspace_browser_list_tabs",
    "workspace_browser_close",
}

TUNNEL_TOOLS = {
    "tunnel_expose",
    "tunnel_close",
    "tunnel_list",
}


@pytest.fixture()
def mcp_tools():
    """Create an MCP server and list its tools."""
    from openagents.mcp_server import create_mcp_server

    server = create_mcp_server(
        workspace_id="test-workspace",
        channel_name="test-channel",
        token="test-token",
        agent_name="test-claude",
    )

    # Get the list_tools handler and call it
    tools = asyncio.run(server.list_tools())
    tool_names = {t.name for t in tools}
    return tool_names, tools


class TestClaudeWorkspaceTools:
    """Test workspace tool availability for Claude Code."""

    def test_agent_installed(self):
        """Claude must be installed."""
        assert shutil.which(BINARY_NAME) is not None

    def test_core_tools_available(self, mcp_tools):
        """Core workspace tools (history, agents, status) must be present."""
        tool_names, _ = mcp_tools
        for tool in CORE_TOOLS:
            assert tool in tool_names, (
                f"Core tool '{tool}' not found. "
                f"Available: {sorted(tool_names)}"
            )

    def test_file_tools_available(self, mcp_tools):
        """File tools (write, read, list, delete) must be present."""
        tool_names, _ = mcp_tools
        for tool in FILE_TOOLS:
            assert tool in tool_names, (
                f"File tool '{tool}' not found. "
                f"Available: {sorted(tool_names)}"
            )

    def test_browser_tools_available(self, mcp_tools):
        """Browser tools must be present."""
        tool_names, _ = mcp_tools
        for tool in BROWSER_TOOLS:
            assert tool in tool_names, (
                f"Browser tool '{tool}' not found. "
                f"Available: {sorted(tool_names)}"
            )

    def test_tunnel_tools_available(self, mcp_tools):
        """Tunnel tools must be present."""
        tool_names, _ = mcp_tools
        for tool in TUNNEL_TOOLS:
            assert tool in tool_names, (
                f"Tunnel tool '{tool}' not found. "
                f"Available: {sorted(tool_names)}"
            )

    def test_tools_have_schemas(self, mcp_tools):
        """All tools must have valid input schemas."""
        _, tools = mcp_tools
        for tool in tools:
            assert tool.inputSchema is not None, (
                f"Tool '{tool.name}' has no inputSchema"
            )
            assert isinstance(tool.inputSchema, dict), (
                f"Tool '{tool.name}' inputSchema is not a dict: "
                f"{type(tool.inputSchema)}"
            )

    def test_disabled_modules(self):
        """Disabling modules should remove their tools."""
        from openagents.mcp_server import create_mcp_server

        server = create_mcp_server(
            workspace_id="test",
            channel_name="test",
            token="test",
            agent_name="test",
            disabled_modules={"files", "browser"},
        )

        tools = asyncio.run(server.list_tools())
        tool_names = {t.name for t in tools}

        # Core and tunnel tools should still be present
        for tool in CORE_TOOLS:
            assert tool in tool_names

        # File and browser tools should be absent
        for tool in FILE_TOOLS:
            assert tool not in tool_names, (
                f"Disabled file tool '{tool}' still present"
            )
        for tool in BROWSER_TOOLS:
            assert tool not in tool_names, (
                f"Disabled browser tool '{tool}' still present"
            )


class TestClaudeWorkspaceToolsReport:
    """Collect environment info."""

    def test_report_environment(self, os_platform, openagents_version):
        safe_print(f"  platform: {os_platform}")
        safe_print(f"  openagents_version: {openagents_version}")
        safe_print(f"  agent_binary: {shutil.which(BINARY_NAME)}")
