"""
Claude Code adapter for OpenAgents workspace.

Bridges Claude Code to an OpenAgents workspace via:
- Polling loop for incoming messages
- Claude Agent SDK for task execution
- MCP server for workspace tool access
"""

import asyncio
import logging
import os
import sys
from typing import Optional

from openagents.workspace_client import WorkspaceClient, DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

# Max retries on rate limit before giving up on a message
MAX_RATE_LIMIT_RETRIES = 3
RATE_LIMIT_BASE_DELAY = 15  # seconds


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
        self.session_id = session_id
        self.token = token
        self.agent_name = agent_name
        self.endpoint = endpoint
        self.client = WorkspaceClient(endpoint=endpoint)
        self.last_seen_id: Optional[str] = None
        self._running = False
        self._processed_ids: set = set()
        self._conversation_id: Optional[str] = None

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
        """Poll for new messages and dispatch to Claude."""
        idle_count = 0
        while self._running:
            try:
                messages = await self.client.poll_messages(
                    workspace_id=self.workspace_id,
                    session_id=self.session_id,
                    token=self.token,
                    after=self.last_seen_id,
                )
            except Exception as e:
                logger.warning(f"Poll failed: {e}")
                await asyncio.sleep(5)
                continue

            # Filter: only process messages from others, skip status/processed
            incoming = []
            for msg in messages:
                msg_id = msg.get("id") or msg.get("messageId")
                if msg_id:
                    self.last_seen_id = msg_id
                if msg.get("senderName") == self.agent_name:
                    continue
                if msg.get("messageType") == "status":
                    continue
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
                # Sync cursor to skip messages posted during execution
                await self._sync_cursor()
            else:
                idle_count += 1

            # Adaptive polling: 2s active, up to 15s idle
            delay = min(2 + idle_count, 15) if not incoming else 2
            await asyncio.sleep(delay)

    async def _sync_cursor(self):
        """Update cursor to latest message to skip own responses."""
        try:
            messages = await self.client.poll_messages(
                workspace_id=self.workspace_id,
                session_id=self.session_id,
                token=self.token,
                limit=1,
            )
            if messages:
                msg_id = messages[-1].get("id") or messages[-1].get("messageId")
                if msg_id:
                    self.last_seen_id = msg_id
        except Exception:
            pass

    async def _handle_message(self, msg: dict):
        """Process a single incoming message via Claude Agent SDK."""
        content = msg.get("content", "").strip()
        if not content:
            return

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender}: {content[:80]}...")

        # Post status update
        try:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                session_id=self.session_id,
                token=self.token,
                content="thinking...",
                sender_type="agent",
                sender_name=self.agent_name,
                message_type="status",
            )
        except Exception:
            pass

        try:
            from claude_agent_sdk import (
                query,
                ClaudeAgentOptions,
                AssistantMessage,
                TextBlock,
                ToolUseBlock,
                ResultMessage,
            )
            from claude_agent_sdk._errors import MessageParseError
        except ImportError:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                session_id=self.session_id,
                token=self.token,
                content=(
                    "Error: claude-agent-sdk is not installed. "
                    "Install with: pip install claude-agent-sdk"
                ),
                sender_type="agent",
                sender_name=self.agent_name,
            )
            return

        # Build a clean env without CLAUDECODE to allow nested sessions
        clean_env = {
            k: v for k, v in os.environ.items()
            if k not in ("CLAUDECODE", "CLAUDE_CODE_SESSION")
        }

        # Retry loop for rate limits
        for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
            try:
                options = ClaudeAgentOptions(
                    system_prompt={
                        "type": "preset",
                        "preset": "claude_code",
                        "append": (
                            f"\nYou are agent '{self.agent_name}' connected to an "
                            f"OpenAgents workspace.\n"
                            f"You MUST use the workspace_send_message MCP tool to "
                            f"communicate your responses.\n"
                            f"Text you generate is NOT visible to anyone unless you "
                            f"call workspace_send_message.\n"
                            f"Use workspace_get_history to read previous messages.\n"
                            f"Use workspace_get_agents to see other agents.\n"
                        ),
                    },
                    env=clean_env,
                    continue_conversation=self._conversation_id is not None,
                    resume=self._conversation_id,
                    mcp_servers={
                        "openagents-workspace": {
                            "type": "stdio",
                            "command": "openagents",
                            "args": [
                                "mcp-server",
                                "--workspace-id",
                                self.workspace_id,
                                "--session-id",
                                self.session_id,
                                "--agent-name",
                                self.agent_name,
                                "--endpoint",
                                self.endpoint,
                            ],
                            "env": {"OA_WORKSPACE_TOKEN": self.token},
                        },
                    },
                    allowed_tools=[
                        "mcp__openagents-workspace__workspace_send_message",
                        "mcp__openagents-workspace__workspace_get_history",
                        "mcp__openagents-workspace__workspace_get_agents",
                        "mcp__openagents-workspace__workspace_status",
                        "Read",
                        "Write",
                        "Edit",
                        "Bash",
                        "Glob",
                        "Grep",
                    ],
                    permission_mode="acceptEdits",
                    max_turns=25,
                )

                used_send_tool = False
                any_tool_used = False
                response_text = []
                rate_limited = False

                try:
                    async for message in query(prompt=content, options=options):
                        if isinstance(message, AssistantMessage):
                            for block in message.content:
                                if isinstance(block, TextBlock):
                                    response_text.append(block.text)
                                elif isinstance(block, ToolUseBlock):
                                    any_tool_used = True
                                    if "workspace_send_message" in block.name:
                                        used_send_tool = True
                                    else:
                                        # Stream intermediate tool use as status
                                        tool_label = block.name
                                        tool_input = str(block.input)[:200]
                                        try:
                                            await self.client.send_message(
                                                workspace_id=self.workspace_id,
                                                session_id=self.session_id,
                                                token=self.token,
                                                content=f"**Using tool:** `{tool_label}`\n```\n{tool_input}\n```",
                                                sender_type="agent",
                                                sender_name=self.agent_name,
                                                message_type="status",
                                            )
                                        except Exception:
                                            pass
                        elif isinstance(message, ResultMessage):
                            # Save conversation ID for continue_conversation
                            if hasattr(message, "session_id") and message.session_id:
                                self._conversation_id = message.session_id
                            if message.is_error:
                                logger.warning(f"Claude error: {message.result}")
                except MessageParseError as e:
                    if "rate_limit" in str(e):
                        rate_limited = True
                    else:
                        logger.warning(f"Skipping unknown SDK message: {e}")

                # Only retry rate limits if the agent did NO work at all
                # (no tools used, no text generated, no MCP message sent)
                did_work = used_send_tool or any_tool_used or bool(response_text)
                if rate_limited and not did_work:
                    if attempt < MAX_RATE_LIMIT_RETRIES:
                        delay = RATE_LIMIT_BASE_DELAY * (2 ** attempt)
                        logger.warning(
                            f"Rate limited (attempt {attempt + 1}/{MAX_RATE_LIMIT_RETRIES}) "
                            f"— retrying in {delay}s"
                        )
                        await asyncio.sleep(delay)
                        continue

                # Fallback: if Claude didn't use workspace_send_message,
                # post the text response or a fallback message
                if not used_send_tool:
                    if response_text:
                        full_response = "\n".join(response_text).strip()
                        if full_response:
                            await self.client.send_message(
                                workspace_id=self.workspace_id,
                                session_id=self.session_id,
                                token=self.token,
                                content=full_response,
                                sender_type="agent",
                                sender_name=self.agent_name,
                            )
                    elif rate_limited and any_tool_used:
                        await self.client.send_message(
                            workspace_id=self.workspace_id,
                            session_id=self.session_id,
                            token=self.token,
                            content="Task partially completed but hit rate limit. Check the results directly.",
                            sender_type="agent",
                            sender_name=self.agent_name,
                        )
                    elif rate_limited:
                        await self.client.send_message(
                            workspace_id=self.workspace_id,
                            session_id=self.session_id,
                            token=self.token,
                            content="Rate limited — please try again in a moment.",
                            sender_type="agent",
                            sender_name=self.agent_name,
                        )

                # Done (success or final failure)
                break

            except Exception as e:
                logger.exception(f"Error handling message: {e}")
                try:
                    await self.client.send_message(
                        workspace_id=self.workspace_id,
                        session_id=self.session_id,
                        token=self.token,
                        content=f"Error processing message: {e}",
                        sender_type="agent",
                        sender_name=self.agent_name,
                    )
                except Exception:
                    pass
                break
