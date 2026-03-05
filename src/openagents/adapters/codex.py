"""
Codex CLI adapter for OpenAgents workspace.

Bridges OpenAI Codex CLI to an OpenAgents workspace via:
- Polling loop for incoming messages
- Codex CLI subprocess (exec --json) for task execution
- Response text captured from JSONL stream and posted to workspace

Uses `codex exec --json --full-auto` directly as a subprocess,
parsing JSONL events for tool calls, file changes, and agent messages.

Note: MCP workspace tools are not used because the Python MCP server
uses NDJSON framing while Codex's Rust MCP client uses Content-Length
framing (LSP-style). The adapter posts responses directly instead.
"""

import asyncio
import json
import logging
import shutil
from typing import Optional

from openagents.workspace_client import WorkspaceClient, DEFAULT_ENDPOINT
from openagents.adapters.utils import generate_session_title, SESSION_DEFAULT_RE

logger = logging.getLogger(__name__)


class CodexAdapter:
    """Connects OpenAI Codex CLI to an OpenAgents workspace."""

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
        self._last_event_id: Optional[str] = None
        self._running = False
        self._processed_ids: set = set()
        self._titled_sessions: set = set()
        self._codex_thread_id: Optional[str] = None

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
        """Poll for new messages across all channels and dispatch to Codex."""
        idle_count = 0
        while self._running:
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
            else:
                idle_count += 1

            # Adaptive polling: 2s active, up to 15s idle
            delay = min(2 + idle_count, 15) if not incoming else 2
            await asyncio.sleep(delay)

    def _build_codex_cmd(self, prompt: str) -> list[str]:
        """Build the codex CLI command."""
        codex_bin = shutil.which("codex")
        if not codex_bin:
            raise FileNotFoundError(
                "codex CLI not found. Install with: "
                "npm install -g @openai/codex"
            )

        cmd = [codex_bin, "exec"]

        # Resume existing thread for context continuity
        if self._codex_thread_id:
            cmd.extend(["resume", self._codex_thread_id])

        cmd.extend([
            "--json",       # JSONL output to stdout
            "--full-auto",  # workspace-write sandbox + auto-approve
        ])

        cmd.append(prompt)
        return cmd

    async def _handle_message(self, msg: dict):
        """Process a single incoming message via Codex CLI subprocess."""
        content = msg.get("content", "").strip()
        if not content:
            return

        # Use the message's channel so responses go to the correct channel
        msg_channel = msg.get("sessionId") or self.channel_name

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender} in channel {msg_channel}: {content[:80]}...")

        # Auto-title: skip if user has manually renamed the thread
        if msg_channel not in self._titled_sessions:
            self._titled_sessions.add(msg_channel)
            title = generate_session_title(content)
            if title:
                try:
                    info = await self.client.get_session(
                        self.workspace_id, msg_channel, self.token,
                    )
                    if not info.get("titleManuallySet") and SESSION_DEFAULT_RE.match(info.get("title", "")):
                        await self.client.update_session(
                            self.workspace_id, msg_channel, self.token,
                            title=title, auto_title=True,
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
            )
        except Exception:
            pass

        try:
            cmd = self._build_codex_cmd(content)
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

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=10 * 1024 * 1024,  # 10 MB line buffer
            )

            response_texts = []

            # Read JSONL output line by line
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

                if event_type == "thread.started":
                    thread_id = event.get("thread_id")
                    if thread_id:
                        self._codex_thread_id = thread_id
                    logger.debug(
                        f"Codex thread started: {thread_id}"
                    )

                elif event_type == "item.completed":
                    item = event.get("item", {})
                    item_type = item.get("type")

                    if item_type == "agent_message":
                        text = item.get("text", "")
                        if text:
                            response_texts.append(text)

                    elif item_type == "command_execution":
                        cmd_text = item.get("command", "")[:200]
                        try:
                            await self.client.send_message(
                                workspace_id=self.workspace_id,
                                channel_name=msg_channel,
                                token=self.token,
                                content=(
                                    f"**Running:** `{cmd_text}`"
                                ),
                                sender_type="agent",
                                sender_name=self.agent_name,
                                message_type="status",
                            )
                        except Exception:
                            pass

                    elif item_type == "file_change":
                        filename = item.get("filename", "")
                        try:
                            await self.client.send_message(
                                workspace_id=self.workspace_id,
                                channel_name=msg_channel,
                                token=self.token,
                                content=(
                                    f"**Editing:** `{filename}`"
                                ),
                                sender_type="agent",
                                sender_name=self.agent_name,
                                message_type="status",
                            )
                        except Exception:
                            pass

                elif event_type == "item.started":
                    item = event.get("item", {})
                    logger.debug(
                        f"Item started: {item.get('type')} "
                        f"{item.get('id', '')}"
                    )

                elif event_type == "turn.completed":
                    usage = event.get("usage", {})
                    logger.debug(
                        f"Turn completed — tokens: "
                        f"in={usage.get('input_tokens', '?')}, "
                        f"out={usage.get('output_tokens', '?')}"
                    )

                elif event_type == "turn.failed":
                    error = event.get("error", {})
                    logger.warning(
                        f"Codex turn failed: "
                        f"{error.get('message', str(error))}"
                    )

                elif event_type == "error":
                    logger.warning(f"Codex error: {event}")

                else:
                    # Skip unknown event types gracefully
                    logger.debug(f"Skipping event type: {event_type}")

            await process.wait()

            if process.returncode != 0:
                stderr = await process.stderr.read()
                stderr_text = stderr.decode(
                    "utf-8", errors="replace"
                ).strip()
                if stderr_text:
                    logger.warning(f"CLI stderr: {stderr_text[:300]}")

            # Post the agent_message text to workspace
            if response_texts:
                full_response = "\n".join(response_texts).strip()
                if full_response:
                    await self.client.send_message(
                        workspace_id=self.workspace_id,
                        channel_name=msg_channel,
                        token=self.token,
                        content=full_response,
                        sender_type="agent",
                        sender_name=self.agent_name,
                    )
            else:
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
