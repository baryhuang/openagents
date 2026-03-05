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

# Common extension → MIME type mapping
_MIME_MAP = {
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
    ".json": "application/json", ".xml": "application/xml",
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".py": "text/x-python", ".rs": "text/x-rust", ".go": "text/x-go",
    ".ts": "text/typescript", ".tsx": "text/typescript",
    ".yaml": "application/yaml", ".yml": "application/yaml",
    ".sh": "text/x-shellscript", ".toml": "text/plain",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf",
    ".zip": "application/zip",
}


def _guess_content_type(filename: str) -> str:
    """Guess MIME type from filename extension."""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _MIME_MAP.get(ext, "application/octet-stream")


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
                    "Use @agent-name in your message to delegate work to another agent."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "Message text to post. Use @agent-name to mention and delegate to other agents.",
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
            types.Tool(
                name="workspace_write_file",
                description="Write a file to the workspace shared file storage. All workspace members can see it.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "filename": {
                            "type": "string",
                            "description": "Name of the file (e.g. 'report.md', 'data.json')",
                        },
                        "content": {
                            "type": "string",
                            "description": "File content as UTF-8 text (for text files) or base64-encoded string (for binary files)",
                        },
                        "content_type": {
                            "type": "string",
                            "description": "MIME type (default: auto-detected from filename)",
                        },
                    },
                    "required": ["filename", "content"],
                },
            ),
            types.Tool(
                name="workspace_read_file",
                description="Read a file from the workspace shared file storage by its ID.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_id": {
                            "type": "string",
                            "description": "File ID to read",
                        },
                    },
                    "required": ["file_id"],
                },
            ),
            types.Tool(
                name="workspace_list_files",
                description="List all files in the workspace shared file storage.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
            types.Tool(
                name="workspace_delete_file",
                description="Delete a file from the workspace shared file storage.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_id": {
                            "type": "string",
                            "description": "File ID to delete",
                        },
                    },
                    "required": ["file_id"],
                },
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
        try:
            if name == "workspace_send_message":
                content = arguments.get("content", "")
                result = await client.send_message(
                    workspace_id=workspace_id,
                    channel_name=channel_name,
                    token=token,
                    content=content,
                    sender_type="agent",
                    sender_name=agent_name,
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

            elif name == "workspace_write_file":
                filename = arguments.get("filename", "")
                content_str = arguments.get("content", "")
                content_type = arguments.get("content_type", "")
                if not content_type:
                    content_type = _guess_content_type(filename)
                # For text types, encode as UTF-8; for binary, decode base64
                if content_type.startswith("text/") or content_type in (
                    "application/json", "application/xml", "application/javascript",
                    "application/yaml", "application/x-yaml",
                ):
                    data = content_str.encode("utf-8")
                else:
                    import base64
                    try:
                        data = base64.b64decode(content_str)
                    except Exception:
                        data = content_str.encode("utf-8")
                result = await client.upload_file(
                    workspace_id=workspace_id,
                    token=token,
                    filename=filename,
                    content=data,
                    content_type=content_type,
                    source=f"openagents:{agent_name}",
                    channel_name=channel_name,
                )
                return [types.TextContent(
                    type="text",
                    text=f"File written: {filename} (id: {result.get('id', 'unknown')}, size: {result.get('size', 0)} bytes)",
                )]

            elif name == "workspace_read_file":
                file_id = arguments.get("file_id", "")
                data = await client.read_file(
                    workspace_id=workspace_id,
                    token=token,
                    file_id=file_id,
                )
                # Try to decode as text, fall back to base64
                try:
                    text = data.decode("utf-8")
                    return [types.TextContent(type="text", text=text)]
                except UnicodeDecodeError:
                    import base64
                    encoded = base64.b64encode(data).decode("ascii")
                    return [types.TextContent(
                        type="text",
                        text=f"[Binary file, {len(data)} bytes, base64-encoded]\n{encoded}",
                    )]

            elif name == "workspace_list_files":
                result = await client.list_files(
                    workspace_id=workspace_id,
                    token=token,
                )
                files = result.get("files", []) if isinstance(result, dict) else []
                if not files:
                    return [types.TextContent(type="text", text="No files in workspace.")]
                lines = []
                for f in files:
                    size = f.get("size", 0)
                    size_str = f"{size}" if size < 1024 else f"{size // 1024}KB"
                    lines.append(
                        f"- {f['filename']} (id: {f['id']}, {size_str}, by {f.get('uploaded_by', '?')})"
                    )
                return [types.TextContent(type="text", text="\n".join(lines))]

            elif name == "workspace_delete_file":
                file_id = arguments.get("file_id", "")
                await client.delete_file(
                    workspace_id=workspace_id,
                    token=token,
                    file_id=file_id,
                )
                return [types.TextContent(type="text", text=f"File deleted: {file_id}")]

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
