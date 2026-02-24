"""
Workspace client for agent workspace operations.

Handles:
- Local identity management (~/.openagents/identity.json)
- Workspace creation and management
- Agent heartbeat/presence
- Message sending/polling
- Login and rename flows
"""

import asyncio
import json
import logging
import secrets
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "https://endpoint.openagents.org"
IDENTITY_DIR = Path.home() / ".openagents"
IDENTITY_FILE = IDENTITY_DIR / "identity.json"


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class LocalAgentIdentity:
    """A locally-stored agent identity (one per agent type)."""
    agent_name: str
    agent_type: str  # claude, codex, gemini, etc.
    api_key: Optional[str] = None  # agent-scoped key from registration
    created_at: Optional[str] = None


@dataclass
class WorkspaceInfo:
    """Info about a connected workspace."""
    workspace_id: str
    name: str
    token: str
    url: str
    session_id: str


# ---------------------------------------------------------------------------
# Identity storage (~/.openagents/identity.json)
# ---------------------------------------------------------------------------

def _load_identities() -> dict:
    """Load all identities from local storage."""
    if IDENTITY_FILE.exists():
        try:
            return json.loads(IDENTITY_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"agents": {}, "user_email": None}


def _save_identities(data: dict) -> None:
    """Save identities to local storage."""
    IDENTITY_DIR.mkdir(parents=True, exist_ok=True)
    IDENTITY_FILE.write_text(json.dumps(data, indent=2, default=str))
    try:
        IDENTITY_FILE.chmod(0o600)
    except OSError:
        pass


def get_identity(agent_type: str) -> Optional[LocalAgentIdentity]:
    """Get the saved identity for an agent type."""
    data = _load_identities()
    entry = data.get("agents", {}).get(agent_type)
    if entry:
        return LocalAgentIdentity(
            agent_name=entry["agent_name"],
            agent_type=agent_type,
            api_key=entry.get("api_key"),
            created_at=entry.get("created_at"),
        )
    return None


def save_identity(identity: LocalAgentIdentity) -> None:
    """Save an agent identity to local storage."""
    data = _load_identities()
    data["agents"][identity.agent_type] = {
        "agent_name": identity.agent_name,
        "api_key": identity.api_key,
        "created_at": identity.created_at or datetime.now(timezone.utc).isoformat(),
    }
    _save_identities(data)


def get_user_email() -> Optional[str]:
    """Get the logged-in user email."""
    return _load_identities().get("user_email")


def set_user_email(email: str) -> None:
    """Set the logged-in user email."""
    data = _load_identities()
    data["user_email"] = email
    _save_identities(data)


def clear_user_email() -> None:
    """Clear the logged-in user email (logout)."""
    data = _load_identities()
    data["user_email"] = None
    _save_identities(data)


def generate_agent_name(agent_type: str) -> str:
    """Generate an auto-name: {type}-{4hex}."""
    return f"{agent_type}-{secrets.token_hex(2)}"


# ---------------------------------------------------------------------------
# Workspace API client
# ---------------------------------------------------------------------------

class WorkspaceClient:
    """HTTP client for workspace API operations."""

    def __init__(self, endpoint: str = DEFAULT_ENDPOINT):
        self.endpoint = endpoint.rstrip("/")

    async def register_agent(
        self, agent_name: str, api_key: Optional[str] = None,
        origin: str = "cli",
    ) -> dict:
        """Register an agent identity via /v1/agentid/register."""
        import aiohttp
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/agentid/register",
                json={"agent_name": agent_name, "origin": origin},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                if resp.status == 409:
                    # Already registered — that's fine for reconnect
                    return {"already_exists": True, "data": data.get("data", data)}
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Agent registration failed: {msg}")
                return data.get("data", data)

    async def create_workspace(
        self, agent_name: str, name: Optional[str] = None,
    ) -> WorkspaceInfo:
        """Create a workspace via POST /v1/ws."""
        import aiohttp
        payload: Dict[str, Any] = {"agent_name": agent_name}
        if name:
            payload["name"] = name
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/ws",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Workspace creation failed: {msg}")
                result = data.get("data", data)
                return WorkspaceInfo(
                    workspace_id=result["workspaceId"],
                    name=result["name"],
                    token=result["token"],
                    url=result["url"],
                    session_id=result["session"]["sessionId"],
                )

    async def heartbeat(
        self, workspace_id: str, agent_name: str, token: str,
    ) -> dict:
        """Send heartbeat via POST /v1/ws/{id}/agents/{name}/heartbeat."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/ws/{workspace_id}/agents/{agent_name}/heartbeat",
                headers={"Authorization": f"Bearer {token}"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                return data.get("data", data)

    async def disconnect(
        self, workspace_id: str, agent_name: str, token: str,
    ) -> None:
        """Disconnect agent via POST /v1/ws/{id}/agents/{name}/disconnect."""
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.endpoint}/v1/ws/{workspace_id}/agents/{agent_name}/disconnect",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    pass
        except Exception:
            pass  # best-effort on shutdown

    async def send_message(
        self,
        workspace_id: str,
        session_id: str,
        token: str,
        content: str,
        sender_type: str = "agent",
        sender_name: Optional[str] = None,
        mentions: Optional[List[str]] = None,
        message_type: str = "chat",
        metadata: Optional[dict] = None,
    ) -> dict:
        """Send message via POST /v1/ws/{id}/sessions/{sid}/messages."""
        import aiohttp
        payload: Dict[str, Any] = {
            "sender_type": sender_type,
            "content": content,
            "message_type": message_type,
        }
        if sender_name:
            payload["sender_name"] = sender_name
        if mentions:
            payload["mentions"] = mentions
        if metadata:
            payload["metadata"] = metadata

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/ws/{workspace_id}/sessions/{session_id}/messages",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                },
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Failed to send message: {msg}")
                return data.get("data", data)

    async def get_session(
        self,
        workspace_id: str,
        session_id: str,
        token: str,
    ) -> dict:
        """Get session details via GET /v1/ws/{id}/sessions/{sid}."""
        import aiohttp
        async with aiohttp.ClientSession() as s:
            async with s.get(
                f"{self.endpoint}/v1/ws/{workspace_id}/sessions/{session_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                if resp.status != 200:
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Failed to get session: {msg}")
                return data.get("data", data)

    async def update_session(
        self,
        workspace_id: str,
        session_id: str,
        token: str,
        title: Optional[str] = None,
        status: Optional[str] = None,
    ) -> dict:
        """Update session title or status via PATCH /v1/ws/{id}/sessions/{sid}."""
        import aiohttp
        payload: Dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        if status is not None:
            payload["status"] = status
        if not payload:
            return {}

        async with aiohttp.ClientSession() as s:
            async with s.patch(
                f"{self.endpoint}/v1/ws/{workspace_id}/sessions/{session_id}",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                },
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Failed to update session: {msg}")
                return data.get("data", data)

    async def poll_messages(
        self,
        workspace_id: str,
        session_id: str,
        token: str,
        after: Optional[str] = None,
        limit: int = 50,
    ) -> List[dict]:
        """Poll for new messages via GET /v1/ws/{id}/sessions/{sid}/messages."""
        import aiohttp
        params: Dict[str, Any] = {"page_size": limit}
        if after:
            params["after"] = after

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/ws/{workspace_id}/sessions/{session_id}/messages",
                params=params,
                headers={"Authorization": f"Bearer {token}"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                result = data.get("data") or data
                # Handle both cursor mode and pagination mode
                if isinstance(result, dict) and "messages" in result:
                    return result["messages"]
                if isinstance(result, dict) and "items" in result:
                    return result["items"]
                return []

    async def poll_pending(
        self,
        workspace_id: str,
        token: str,
        agent_name: str,
        after: Optional[str] = None,
        limit: int = 50,
    ) -> List[dict]:
        """Poll for pending messages across all sessions via GET /v1/ws/{id}/pending."""
        import aiohttp
        params: Dict[str, Any] = {"agent_name": agent_name, "limit": limit}
        if after:
            params["after"] = after

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/ws/{workspace_id}/pending",
                params=params,
                headers={"Authorization": f"Bearer {token}"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                result = data.get("data") or data
                if isinstance(result, dict) and "messages" in result:
                    return result["messages"]
                return []

    async def get_agents(
        self, workspace_id: str, token: str,
    ) -> List[dict]:
        """Get workspace agents via GET /v1/ws/{id}/agents."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/ws/{workspace_id}/agents",
                headers={"Authorization": f"Bearer {token}"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                return data.get("data", [])

    # ── Invitation methods (Phase 2) ──

    async def check_invitations(self, agent_name: str) -> List[dict]:
        """Check for pending invitations for this agent."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/ws/invitations/pending",
                params={"agent_name": agent_name},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                return data.get("data", [])

    async def accept_invitation(self, invite_token: str) -> dict:
        """Accept a workspace invitation. Returns workspace info."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/ws/invitations/{invite_token}/accept",
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Accept invitation failed: {msg}")
                return data.get("data", data)

    async def reject_invitation(self, invite_token: str) -> None:
        """Reject a workspace invitation."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/ws/invitations/{invite_token}/reject",
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status not in (200, 201):
                    data = await resp.json()
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Reject invitation failed: {msg}")
