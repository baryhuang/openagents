"""
OpenClaw adapter for OpenAgents workspace.

Bridges OpenClaw to an OpenAgents workspace via:
- Polling loop for incoming messages
- OpenClaw Gateway HTTP API (/v1/chat/completions) for task execution
- Workspace context injected via system prompt

OpenClaw runs as a Node.js daemon with an OpenAI-compatible API.
No native MCP support — workspace tools are exposed via system prompt
instructions, and the adapter posts responses to the workspace directly.
"""

import asyncio
import json
import logging
from typing import Optional

import aiohttp

from openagents.workspace_client import WorkspaceClient, DEFAULT_ENDPOINT
from openagents.adapters.utils import generate_session_title, SESSION_DEFAULT_RE

logger = logging.getLogger(__name__)

# Max conversation history entries to keep in memory
MAX_HISTORY_ENTRIES = 50


class OpenClawAdapter:
    """Connects OpenClaw to an OpenAgents workspace."""

    def __init__(
        self,
        workspace_id: str,
        session_id: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
        openclaw_host: str = "127.0.0.1",
        openclaw_port: int = 18789,
        openclaw_token: Optional[str] = None,
        openclaw_agent_id: str = "main",
    ):
        self.workspace_id = workspace_id
        self.session_id = session_id  # default/initial session
        self.token = token
        self.agent_name = agent_name
        self.endpoint = endpoint
        self.client = WorkspaceClient(endpoint=endpoint)
        self.last_seen_id: Optional[str] = None
        self._last_seen_ts: Optional[str] = None
        self._running = False
        self._processed_ids: set = set()
        self._titled_sessions: set = set()

        # OpenClaw connection
        self.openclaw_host = openclaw_host
        self.openclaw_port = openclaw_port
        self.openclaw_token = openclaw_token
        self.openclaw_agent_id = openclaw_agent_id
        self.openclaw_url = (
            f"http://{openclaw_host}:{openclaw_port}/v1/chat/completions"
        )

        # Conversation history for multi-turn context
        self._conversation_history: list[dict] = []

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
        """Poll for new messages across all sessions and dispatch to OpenClaw."""
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

    def _build_system_prompt(self, session_id: str) -> str:
        """Build system prompt with workspace context."""
        return (
            f"You are agent '{self.agent_name}' connected to an "
            f"OpenAgents workspace.\n\n"
            f"## Workspace\n"
            f"- Workspace ID: {self.workspace_id}\n"
            f"- Session ID: {session_id}\n\n"
            f"## Instructions\n"
            f"- You are responding to messages from the workspace chat.\n"
            f"- Your response will be posted to the workspace automatically.\n"
            f"- Be helpful, concise, and direct.\n"
            f"- You can write code, explain concepts, and help with tasks.\n"
            f"- Use markdown formatting for code blocks and structure.\n"
        )

    async def _get_recent_history_text(self, session_id: str) -> str:
        """Fetch recent workspace messages and format as context."""
        try:
            messages = await self.client.poll_messages(
                workspace_id=self.workspace_id,
                session_id=session_id,
                token=self.token,
                limit=10,
            )
            if not messages:
                return ""

            lines = ["## Recent Workspace Messages"]
            for msg in messages:
                sender = msg.get("senderName") or msg.get("senderType", "?")
                content = msg.get("content", "")
                msg_type = msg.get("messageType", "chat")
                if msg_type == "status":
                    continue
                lines.append(f"- **{sender}:** {content[:200]}")
            return "\n".join(lines) + "\n"
        except Exception:
            return ""

    async def _handle_message(self, msg: dict):
        """Process a single incoming message via OpenClaw API."""
        content = msg.get("content", "").strip()
        if not content:
            return

        # Use the message's session_id so responses go to the correct session
        msg_session_id = msg.get("sessionId") or self.session_id

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender} in session {msg_session_id}: {content[:80]}...")

        # Auto-title session on first message if title is still default
        if msg_session_id not in self._titled_sessions:
            self._titled_sessions.add(msg_session_id)
            title = generate_session_title(content)
            if title:
                try:
                    info = await self.client.get_session(
                        self.workspace_id, msg_session_id, self.token,
                    )
                    if SESSION_DEFAULT_RE.match(info.get("title", "")):
                        await self.client.update_session(
                            self.workspace_id, msg_session_id, self.token,
                            title=title,
                        )
                        logger.debug(f"Auto-titled session: {title}")
                except Exception as e:
                    logger.debug(f"Failed to auto-title session: {e}")

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
            # Build messages for the API call
            history_text = await self._get_recent_history_text(msg_session_id)
            system_prompt = self._build_system_prompt(msg_session_id)
            if history_text:
                system_prompt += "\n" + history_text

            # Build the messages array
            messages = [{"role": "system", "content": system_prompt}]
            # Add conversation history for multi-turn
            messages.extend(self._conversation_history)
            # Add the new user message
            messages.append({"role": "user", "content": content})

            # Call OpenClaw API with streaming
            response_text = await self._stream_completion(messages)

            if response_text:
                # Store in conversation history
                self._conversation_history.append(
                    {"role": "user", "content": content}
                )
                self._conversation_history.append(
                    {"role": "assistant", "content": response_text}
                )
                # Trim history to prevent unbounded growth
                if len(self._conversation_history) > MAX_HISTORY_ENTRIES * 2:
                    self._conversation_history = (
                        self._conversation_history[-MAX_HISTORY_ENTRIES * 2:]
                    )

                # Post response to workspace
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    session_id=msg_session_id,
                    token=self.token,
                    content=response_text,
                    sender_type="agent",
                    sender_name=self.agent_name,
                )
            else:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    session_id=msg_session_id,
                    token=self.token,
                    content="No response generated. Please try again.",
                    sender_type="agent",
                    sender_name=self.agent_name,
                )

        except aiohttp.ClientConnectorError:
            error_msg = (
                f"Cannot connect to OpenClaw Gateway at "
                f"{self.openclaw_host}:{self.openclaw_port}. "
                f"Is OpenClaw running? Start with: openclaw gateway start"
            )
            logger.error(error_msg)
            try:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    session_id=msg_session_id,
                    token=self.token,
                    content=error_msg,
                    sender_type="agent",
                    sender_name=self.agent_name,
                )
            except Exception:
                pass
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

    async def _stream_completion(self, messages: list[dict]) -> str:
        """Call OpenClaw /v1/chat/completions with streaming and return response."""
        headers = {"Content-Type": "application/json"}
        if self.openclaw_token:
            headers["Authorization"] = f"Bearer {self.openclaw_token}"
        headers["x-openclaw-agent-id"] = self.openclaw_agent_id

        payload = {
            "model": f"openclaw:{self.openclaw_agent_id}",
            "messages": messages,
            "stream": True,
            "user": f"openagents-ws-{self.workspace_id}",
        }

        response_parts = []

        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.openclaw_url,
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    raise RuntimeError(
                        f"OpenClaw API returned {resp.status}: {body[:300]}"
                    )

                # Parse SSE stream
                async for line in resp.content:
                    line = line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    if not line.startswith("data: "):
                        continue

                    data = line[6:]  # Strip "data: " prefix
                    if data == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        logger.debug(f"Non-JSON SSE chunk: {data[:100]}")
                        continue

                    # Extract content delta from OpenAI-compatible format
                    choices = chunk.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        text = delta.get("content")
                        if text:
                            response_parts.append(text)

        return "".join(response_parts).strip()
