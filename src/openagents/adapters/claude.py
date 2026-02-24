"""
Claude Code adapter for OpenAgents workspace.

Bridges Claude Code to an OpenAgents workspace via:
- Polling loop for incoming messages
- Claude CLI subprocess (stream-json) for task execution
- MCP server for workspace tool access

Uses `claude` CLI directly instead of claude-agent-sdk to avoid
SDK parsing issues with rate_limit_event and other unknown message types.
"""

import asyncio
import json
import logging
import os
import shutil
from typing import Optional

from openagents.workspace_client import WorkspaceClient, DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)


class ClaudeAdapter:
    """Connects Claude Code to an OpenAgents workspace."""

    def __init__(
        self,
        workspace_id: str,
        session_id: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
    ):
        self.workspace_id = workspace_id
        self.session_id = session_id  # default/initial session
        self.token = token
        self.agent_name = agent_name
        self.endpoint = endpoint
        self.client = WorkspaceClient(endpoint=endpoint)
        self.last_seen_id: Optional[str] = None
        self._last_seen_ts: Optional[str] = None  # ISO timestamp for cross-session polling
        self._running = False
        self._processed_ids: set = set()
        self._claude_session_id: Optional[str] = None

    async def run(self):
        """Start the adapter: heartbeat + poll loop."""
        self._running = True
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        try:
            await self._poll_loop()
        except asyncio.CancelledError:
            pass
        finally:
            self._running = False
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            await self.client.disconnect(
                self.workspace_id, self.agent_name, self.token
            )

    async def _heartbeat_loop(self):
        """Send heartbeat every 30 seconds."""
        while self._running:
            try:
                await self.client.heartbeat(
                    self.workspace_id, self.agent_name, self.token
                )
            except Exception as e:
                logger.debug(f"Heartbeat failed: {e}")
            await asyncio.sleep(30)

    async def _poll_loop(self):
        """Poll for new messages across all sessions and dispatch to Claude."""
        idle_count = 0
        while self._running:
            try:
                messages = await self.client.poll_pending(
                    workspace_id=self.workspace_id,
                    token=self.token,
                    agent_name=self.agent_name,
                    after=self._last_seen_ts,
                )
            except Exception as e:
                logger.warning(f"Poll failed: {e}")
                await asyncio.sleep(5)
                continue

            # Filter out already-processed messages
            incoming = []
            for msg in messages:
                msg_id = msg.get("id") or msg.get("messageId")
                # Advance timestamp cursor
                ts = msg.get("createdAt")
                if ts:
                    self._last_seen_ts = ts
                if msg_id and msg_id in self._processed_ids:
                    continue
                incoming.append(msg)

            if incoming:
                idle_count = 0
                for msg in incoming:
                    msg_id = msg.get("id") or msg.get("messageId")
                    if msg_id:
                        self._processed_ids.add(msg_id)
                    await self._handle_message(msg)
            else:
                idle_count += 1

            # Adaptive polling: 2s active, up to 15s idle
            delay = min(2 + idle_count, 15) if not incoming else 2
            await asyncio.sleep(delay)

    def _build_claude_cmd(self, prompt: str, session_id: str) -> list[str]:
        """Build the claude CLI command for a specific session."""
        claude_bin = shutil.which("claude")
        if not claude_bin:
            raise FileNotFoundError(
                "claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash"
            )

        cmd = [
            claude_bin,
            "-p", prompt,
            "--output-format", "stream-json",
            "--verbose",
            "--permission-mode", "acceptEdits",
            "--append-system-prompt",
            (
                f"\nYou are agent '{self.agent_name}' connected to an "
                f"OpenAgents workspace.\n"
                f"You MUST use the workspace_send_message MCP tool to "
                f"communicate your responses.\n"
                f"Text you generate is NOT visible to anyone unless you "
                f"call workspace_send_message.\n"
                f"Use workspace_get_history to read previous messages.\n"
                f"Use workspace_get_agents to see other agents.\n"
            ),
            "--allowedTools",
            "mcp__openagents-workspace__workspace_send_message",
            "mcp__openagents-workspace__workspace_get_history",
            "mcp__openagents-workspace__workspace_get_agents",
            "mcp__openagents-workspace__workspace_status",
            "Read", "Write", "Edit", "Bash", "Glob", "Grep",
        ]

        # Resume existing conversation for context continuity
        if self._claude_session_id:
            cmd.extend(["--resume", self._claude_session_id])

        # MCP config for workspace tools — uses the message's session_id
        mcp_config = {
            "mcpServers": {
                "openagents-workspace": {
                    "type": "stdio",
                    "command": "openagents",
                    "args": [
                        "mcp-server",
                        "--workspace-id", self.workspace_id,
                        "--session-id", session_id,
                        "--agent-name", self.agent_name,
                        "--endpoint", self.endpoint,
                    ],
                    "env": {"OA_WORKSPACE_TOKEN": self.token},
                },
            },
        }
        cmd.extend(["--mcp-config", json.dumps(mcp_config)])

        return cmd

    async def _handle_message(self, msg: dict):
        """Process a single incoming message via Claude CLI subprocess."""
        content = msg.get("content", "").strip()
        if not content:
            return

        # Use the message's session_id so responses go to the correct session
        msg_session_id = msg.get("sessionId") or self.session_id

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender} in session {msg_session_id}: {content[:80]}...")

        # Post "thinking..." status
        try:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                session_id=msg_session_id,
                token=self.token,
                content="thinking...",
                sender_type="agent",
                sender_name=self.agent_name,
                message_type="status",
            )
        except Exception:
            pass

        try:
            cmd = self._build_claude_cmd(content, msg_session_id)
        except FileNotFoundError as e:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                session_id=msg_session_id,
                token=self.token,
                content=str(e),
                sender_type="agent",
                sender_name=self.agent_name,
            )
            return

        # Build clean env without CLAUDECODE to allow nested sessions
        clean_env = {
            k: v for k, v in os.environ.items()
            if k not in ("CLAUDECODE", "CLAUDE_CODE_SESSION")
        }

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=clean_env,
            )

            used_send_tool = False
            response_text = []

            # Read stream-json output line by line
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                line = line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    logger.debug(f"Non-JSON line from CLI: {line[:100]}")
                    continue

                event_type = event.get("type")

                if event_type == "assistant":
                    # Process content blocks from assistant message
                    message_data = event.get("message", {})
                    for block in message_data.get("content", []):
                        block_type = block.get("type")
                        if block_type == "text":
                            response_text.append(block.get("text", ""))
                        elif block_type == "tool_use":
                            tool_name = block.get("name", "")
                            if "workspace_send_message" in tool_name:
                                used_send_tool = True
                            else:
                                # Stream intermediate tool use as status
                                tool_input = str(block.get("input", ""))[:200]
                                try:
                                    await self.client.send_message(
                                        workspace_id=self.workspace_id,
                                        session_id=msg_session_id,
                                        token=self.token,
                                        content=f"**Using tool:** `{tool_name}`\n```\n{tool_input}\n```",
                                        sender_type="agent",
                                        sender_name=self.agent_name,
                                        message_type="status",
                                    )
                                except Exception:
                                    pass

                elif event_type == "result":
                    # Save session_id for conversation continuity
                    session_id = event.get("session_id")
                    if session_id:
                        self._claude_session_id = session_id
                    if event.get("is_error"):
                        logger.warning(f"Claude error: {event.get('result', '')[:200]}")

                elif event_type == "system":
                    logger.debug(f"CLI init: session={event.get('session_id')}")

                elif event_type == "rate_limit_event":
                    # Informational — CLI handles rate limits internally
                    info = event.get("rate_limit_info", {})
                    logger.debug(f"Rate limit status: {info.get('status')}")

                else:
                    # Skip unknown event types gracefully
                    logger.debug(f"Skipping event type: {event_type}")

            await process.wait()

            if process.returncode != 0:
                stderr = await process.stderr.read()
                stderr_text = stderr.decode("utf-8", errors="replace").strip()
                if stderr_text:
                    logger.warning(f"CLI stderr: {stderr_text[:300]}")

            # Fallback: if Claude didn't use workspace_send_message,
            # post the text response directly
            if not used_send_tool and response_text:
                full_response = "\n".join(response_text).strip()
                if full_response:
                    await self.client.send_message(
                        workspace_id=self.workspace_id,
                        session_id=msg_session_id,
                        token=self.token,
                        content=full_response,
                        sender_type="agent",
                        sender_name=self.agent_name,
                    )
            elif not used_send_tool and not response_text:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    session_id=msg_session_id,
                    token=self.token,
                    content="No response generated. Please try again.",
                    sender_type="agent",
                    sender_name=self.agent_name,
                )

        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            try:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    session_id=msg_session_id,
                    token=self.token,
                    content=f"Error processing message: {e}",
                    sender_type="agent",
                    sender_name=self.agent_name,
                )
            except Exception:
                pass
