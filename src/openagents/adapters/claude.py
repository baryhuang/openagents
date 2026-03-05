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
from openagents.adapters.utils import generate_session_title, SESSION_DEFAULT_RE

logger = logging.getLogger(__name__)


class ClaudeAdapter:
    """Connects Claude Code to an OpenAgents workspace."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
    ):
        self.workspace_id = workspace_id
        self.channel_name = channel_name  # default/initial channel
        self.token = token
        self.agent_name = agent_name
        self.endpoint = endpoint
        self.client = WorkspaceClient(endpoint=endpoint)
        self.last_seen_id: Optional[str] = None
        self._last_event_id: Optional[str] = None  # event ID cursor for polling
        self._running = False
        self._processed_ids: set = set()
        self._titled_sessions: set = set()
        self._claude_session_id: Optional[str] = None
        self._mode: str = "execute"  # "execute" or "plan"
        self._last_control_id: Optional[str] = None
        self._current_process: Optional[asyncio.subprocess.Process] = None
        self._message_queue: list[dict] = []  # messages arriving while busy

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

    async def _poll_control(self):
        """Check for control events (e.g. mode changes) targeted at this agent."""
        try:
            events = await self.client.poll_control(
                workspace_id=self.workspace_id,
                token=self.token,
                agent_name=self.agent_name,
                after=self._last_control_id,
            )
            for ev in events:
                ev_id = ev.get("id")
                if ev_id:
                    self._last_control_id = ev_id
                payload = ev.get("payload") or {}
                action = payload.get("action")
                if action == "set_mode":
                    new_mode = payload.get("mode", "execute")
                    if new_mode in ("execute", "plan") and new_mode != self._mode:
                        old_mode = self._mode
                        self._mode = new_mode
                        logger.info(f"Mode changed: {old_mode} -> {new_mode}")
                        label = "Execute" if new_mode == "execute" else "Plan"
                        try:
                            await self.client.send_message(
                                workspace_id=self.workspace_id,
                                channel_name=self.channel_name,
                                token=self.token,
                                content=f"Switched to **{label}** mode",
                                sender_type="agent",
                                sender_name=self.agent_name,
                                message_type="status",
                                metadata={"agent_mode": new_mode},
                            )
                        except Exception:
                            pass
                elif action == "stop":
                    await self._stop_current_process()
        except Exception as e:
            logger.debug(f"Control poll failed: {e}")

    async def _stop_current_process(self):
        """Kill the currently running Claude subprocess, if any."""
        proc = self._current_process
        if proc and proc.returncode is None:
            logger.info("Stopping current Claude process...")
            try:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
            except ProcessLookupError:
                pass
            self._current_process = None
            # Send stopped status to all known channels
            try:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    channel_name=self.channel_name,
                    token=self.token,
                    content="Execution stopped by user",
                    sender_type="agent",
                    sender_name=self.agent_name,
                    message_type="status",
                    metadata={"agent_mode": self._mode},
                )
            except Exception:
                pass

    async def _control_poller(self):
        """Background loop that polls control events and queues new messages while a subprocess runs."""
        while self._current_process and self._current_process.returncode is None:
            await self._poll_control()
            await self._poll_queue()
            await asyncio.sleep(2)

    async def _poll_queue(self):
        """Check for new messages that arrived while busy and queue them."""
        try:
            messages = await self.client.poll_pending(
                workspace_id=self.workspace_id,
                token=self.token,
                agent_name=self.agent_name,
                after=self._last_event_id,
            )
        except Exception:
            return

        for msg in messages:
            msg_id = msg.get("id") or msg.get("messageId")
            if msg_id:
                self._last_event_id = msg_id
            if msg_id and msg_id in self._processed_ids:
                continue
            self._processed_ids.add(msg_id)
            self._message_queue.append(msg)
            # Notify the user their message is queued
            channel = msg.get("sessionId") or self.channel_name
            try:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    channel_name=channel,
                    token=self.token,
                    content="message queued — will process after current task",
                    sender_type="agent",
                    sender_name=self.agent_name,
                    message_type="status",
                    metadata={"agent_mode": self._mode},
                )
            except Exception:
                pass

    async def _poll_loop(self):
        """Poll for new messages across all channels and dispatch to Claude."""
        idle_count = 0
        while self._running:
            # Check for control events (mode changes) before processing messages
            await self._poll_control()

            try:
                messages = await self.client.poll_pending(
                    workspace_id=self.workspace_id,
                    token=self.token,
                    agent_name=self.agent_name,
                    after=self._last_event_id,
                )
            except Exception as e:
                logger.warning(f"Poll failed: {e}")
                await asyncio.sleep(5)
                continue

            # Filter out already-processed messages
            incoming = []
            for msg in messages:
                msg_id = msg.get("id") or msg.get("messageId")
                # Advance event ID cursor
                if msg_id:
                    self._last_event_id = msg_id
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

                # Process any messages that were queued during execution
                while self._message_queue:
                    queued = self._message_queue.pop(0)
                    await self._handle_message(queued)
            else:
                idle_count += 1

            # Adaptive polling: 2s active, up to 15s idle
            delay = min(2 + idle_count, 15) if not incoming else 2
            await asyncio.sleep(delay)

    def _build_claude_cmd(self, prompt: str, channel_name: str) -> list[str]:
        """Build the claude CLI command for a specific channel."""
        claude_bin = shutil.which("claude")
        if not claude_bin:
            raise FileNotFoundError(
                "claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash"
            )

        system_prompt = (
            f"\nYou are agent '{self.agent_name}' connected to an "
            f"OpenAgents workspace.\n"
            f"You MUST use the workspace_send_message MCP tool to "
            f"communicate your responses.\n"
            f"Text you generate is NOT visible to anyone unless you "
            f"call workspace_send_message.\n"
            f"Use workspace_get_history to read previous messages.\n"
            f"Use workspace_get_agents to see other agents.\n"
            f"\n## Multi-Agent Delegation\n"
            f"To delegate work to another agent, @mention them in "
            f"your message. Example: workspace_send_message(content="
            f"'@agent-b Please review the tests'). Only @mentioned "
            f"agents will receive the message.\n"
            f"IMPORTANT: Do NOT @mention an agent just to say thanks "
            f"or acknowledge — that wakes them up for nothing. Only "
            f"@mention when you need them to do work. When the task "
            f"is complete, report results to the user without "
            f"@mentioning other agents.\n"
            f"Use workspace_get_agents to discover available agents.\n"
        )

        cmd = [
            claude_bin,
            "-p", prompt,
            "--output-format", "stream-json",
            "--verbose",
        ]

        # Mode-dependent permission and tool flags
        mcp_tools = [
            "mcp__openagents-workspace__workspace_send_message",
            "mcp__openagents-workspace__workspace_get_history",
            "mcp__openagents-workspace__workspace_get_agents",
            "mcp__openagents-workspace__workspace_status",
            "mcp__openagents-workspace__workspace_list_files",
            "mcp__openagents-workspace__workspace_read_file",
        ]
        mcp_write_tools = [
            "mcp__openagents-workspace__workspace_write_file",
            "mcp__openagents-workspace__workspace_delete_file",
        ]

        if self._mode == "plan":
            cmd.extend(["--permission-mode", "plan"])
            allowed = mcp_tools + ["Read", "Glob", "Grep"]
            system_prompt += (
                "\nYou are in PLAN mode. Only read, analyze, and propose "
                "changes. Do not make edits. Share your plan via "
                "workspace_send_message.\n"
            )
        else:
            cmd.append("--dangerously-skip-permissions")
            allowed = mcp_tools + mcp_write_tools + ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]

        cmd.extend(["--append-system-prompt", system_prompt])
        cmd.extend(["--allowedTools"] + allowed)

        # Resume existing conversation for context continuity
        if self._claude_session_id:
            cmd.extend(["--resume", self._claude_session_id])

        # MCP config for workspace tools — uses the message's channel
        mcp_config = {
            "mcpServers": {
                "openagents-workspace": {
                    "type": "stdio",
                    "command": "openagents",
                    "args": [
                        "mcp-server",
                        "--workspace-id", self.workspace_id,
                        "--channel-name", channel_name,
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

        # Use the message's channel so responses go to the correct channel
        msg_channel = msg.get("sessionId") or self.channel_name

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender} in channel {msg_channel}: {content[:80]}...")

        # Auto-title: get_session/update_session are stubs now — skip if they fail
        if msg_channel not in self._titled_sessions:
            self._titled_sessions.add(msg_channel)
            title = generate_session_title(content)
            if title:
                try:
                    info = await self.client.get_session(
                        self.workspace_id, msg_channel, self.token,
                    )
                    if SESSION_DEFAULT_RE.match(info.get("title", "")):
                        await self.client.update_session(
                            self.workspace_id, msg_channel, self.token,
                            title=title,
                        )
                        logger.debug(f"Auto-titled channel: {title}")
                except Exception as e:
                    logger.debug(f"Failed to auto-title channel: {e}")

        # Post "thinking..." status
        try:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                channel_name=msg_channel,
                token=self.token,
                content="thinking...",
                sender_type="agent",
                sender_name=self.agent_name,
                message_type="status",
                metadata={"agent_mode": self._mode},
            )
        except Exception:
            pass

        try:
            cmd = self._build_claude_cmd(content, msg_channel)
        except FileNotFoundError as e:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                channel_name=msg_channel,
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
                limit=10 * 1024 * 1024,  # 10 MB line buffer (default 64KB too small for large tool outputs)
            )
            self._current_process = process

            # Start background control poller so stop commands work during execution
            control_task = asyncio.create_task(self._control_poller())

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
                                        channel_name=msg_channel,
                                        token=self.token,
                                        content=f"**Using tool:** `{tool_name}`\n```\n{tool_input}\n```",
                                        sender_type="agent",
                                        sender_name=self.agent_name,
                                        message_type="status",
                                        metadata={"agent_mode": self._mode},
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
            self._current_process = None
            control_task.cancel()

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
                        channel_name=msg_channel,
                        token=self.token,
                        content=full_response,
                        sender_type="agent",
                        sender_name=self.agent_name,
                    )
            elif not used_send_tool and not response_text:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    channel_name=msg_channel,
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
                    channel_name=msg_channel,
                    token=self.token,
                    content=f"Error processing message: {e}",
                    sender_type="agent",
                    sender_name=self.agent_name,
                )
            except Exception:
                pass
