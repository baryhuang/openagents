"""
MCP server exposing workspace tools for agent CLIs.

Run as: openagents mcp-server --workspace <id> --token <token>

Exposes 4 tools:
- workspace_send_message: Post message to workspace chat
- workspace_get_history: Read recent messages
- workspace_get_agents: List agents in workspace
- workspace_status: Post status update
"""

import asyncio
import json
import logging
import sys
from typing import Optional

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

from openagents.workspace_client import WorkspaceClient, DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)


def create_mcp_server(
    workspace_id: str,
    channel_name: str,
    token: str,
    agent_name: str,
    endpoint: str = DEFAULT_ENDPOINT,
) -> Server:
    """Create an MCP server with workspace tools."""

    server = Server("openagents-workspace")
    client = WorkspaceClient(endpoint=endpoint)

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [
            types.Tool(
                name="workspace_send_message",
                description=(
                    "Post a message to the workspace chat. "
                    "You MUST use this tool to communicate — generating text alone is not seen by anyone. "
                    "Mention other agents by name to delegate work to them."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "Message text to post",
                        },
                        "mentions": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Agent names to delegate to (optional)",
                        },
                    },
                    "required": ["content"],
                },
            ),
            types.Tool(
                name="workspace_get_history",
                description="Read recent messages in the current workspace channel.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "integer",
                            "description": "Number of messages to return (default 20)",
                            "default": 20,
                        },
                    },
                },
            ),
            types.Tool(
                name="workspace_get_agents",
                description="List all agents in this workspace and their current status.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
            types.Tool(
                name="workspace_status",
                description='Post a status update visible to workspace viewers (e.g., "running tests...", "reading codebase...").',
                inputSchema={
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "description": "Short status description",
                        },
                    },
                    "required": ["status"],
                },
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
        try:
            if name == "workspace_send_message":
                content = arguments.get("content", "")
                mentions = arguments.get("mentions", [])
                msg_type = "delegation" if mentions else "chat"
                result = await client.send_message(
                    workspace_id=workspace_id,
                    channel_name=channel_name,
                    token=token,
                    content=content,
                    sender_type="agent",
                    sender_name=agent_name,
                    mentions=mentions,
                    message_type=msg_type,
                )
                return [types.TextContent(
                    type="text",
                    text=f"Message sent (id: {result.get('messageId', 'unknown')})",
                )]

            elif name == "workspace_get_history":
                limit = arguments.get("limit", 20)
                messages = await client.poll_messages(
                    workspace_id=workspace_id,
                    channel_name=channel_name,
                    token=token,
                    limit=limit,
                )
                if not messages:
                    return [types.TextContent(type="text", text="No messages yet.")]
                lines = []
                for msg in messages:
                    sender = msg.get("senderName", msg.get("senderType", "unknown"))
                    content = msg.get("content", "")
                    lines.append(f"[{sender}] {content}")
                return [types.TextContent(type="text", text="\n".join(lines))]

            elif name == "workspace_get_agents":
                agents = await client.get_agents(workspace_id, token)
                if not agents:
                    return [types.TextContent(type="text", text="No agents in workspace.")]
                lines = []
                for a in agents:
                    lines.append(
                        f"- {a['agentName']} (role: {a['role']}, status: {a['status']})"
                    )
                return [types.TextContent(type="text", text="\n".join(lines))]

            elif name == "workspace_status":
                status_text = arguments.get("status", "")
                await client.send_message(
                    workspace_id=workspace_id,
                    channel_name=channel_name,
                    token=token,
                    content=status_text,
                    sender_type="agent",
                    sender_name=agent_name,
                    message_type="status",
                )
                return [types.TextContent(type="text", text=f"Status updated: {status_text}")]

            else:
                return [types.TextContent(type="text", text=f"Unknown tool: {name}")]

        except Exception as e:
            return [types.TextContent(type="text", text=f"Error: {e}")]

    return server


async def run_mcp_server(
    workspace_id: str,
    channel_name: str,
    token: str,
    agent_name: str,
    endpoint: str = DEFAULT_ENDPOINT,
) -> None:
    """Run the MCP server on stdio."""
    server = create_mcp_server(
        workspace_id=workspace_id,
        channel_name=channel_name,
        token=token,
        agent_name=agent_name,
        endpoint=endpoint,
    )
    options = server.create_initialization_options()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, options)
