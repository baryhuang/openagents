# -*- coding: utf-8 -*-
"""
mod/workspace — session routing, presence tracking, delegation.

Transform mod (priority 50). Handles workspace-specific event processing:
- Agent join/leave/ping → update WorkspaceMember
- Channel create/join/leave → manage Channel + ChannelMember rows
- Message posted by human → route to channel master

Expects context.extra to contain:
  - db: SQLAlchemy Session
  - workspace: Workspace ORM object
"""

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select

from openagents.core.onm_events import Event, WorkspaceEventTypes
from openagents.core.onm_mods import PipelineContext, TransformMod

logger = logging.getLogger(__name__)


class WorkspaceMod(TransformMod):
    """Workspace-specific event processing."""
    name = "workspace"
    intercepts: List[str] = []  # Match all events — we dispatch internally
    priority = 50

    async def process(self, event: Event, context: PipelineContext) -> Optional[Event]:
        handler = _HANDLERS.get(event.type)
        if handler:
            return await handler(event, context)
        # Pass through unhandled event types unchanged
        return event


# ---------------------------------------------------------------------------
# Per-type handlers
# ---------------------------------------------------------------------------

async def _handle_agent_join(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.agent.join → upsert WorkspaceMember, set online."""
    from app.models import WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        logger.warning("workspace_mod: agent.join missing agent_name in payload")
        return None

    existing = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)

    agent_type = event.payload.get("agent_type") if event.payload else None
    server_host = event.payload.get("server_host") if event.payload else None
    working_dir = event.payload.get("working_dir") if event.payload else None

    if existing:
        existing.status = "online"
        existing.last_heartbeat = now
        if agent_type and not existing.agent_type:
            existing.agent_type = agent_type
        if server_host:
            existing.server_host = server_host
        if working_dir:
            existing.working_dir = working_dir
    else:
        role = event.payload.get("role", "member")
        member = WorkspaceMember(
            workspace_id=workspace.id,
            agent_name=agent_name,
            role=role,
            agent_type=agent_type,
            server_host=server_host,
            working_dir=working_dir,
            status="online",
            last_heartbeat=now,
        )
        db.add(member)

    workspace.last_activity_at = now
    db.flush()

    # Enrich event metadata with resolved info
    event.metadata["role"] = existing.role if existing else event.payload.get("role", "member")
    event.metadata["network_id"] = str(workspace.id)
    return event


async def _handle_agent_leave(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.agent.leave → set member offline."""
    from app.models import WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        return None

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return None

    member.status = "offline"
    db.flush()
    return event


async def _handle_agent_remove(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.agent.remove → delete WorkspaceMember, reassign master if needed."""
    from app.models import Channel, WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        logger.warning("workspace_mod: agent.remove missing agent_name in payload")
        return None

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return None

    was_master = member.role == "master"
    db.delete(member)
    db.flush()

    new_master_name = None

    # If removed agent was master, promote the next available agent
    if was_master:
        next_master = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
            ).order_by(WorkspaceMember.joined_at.asc())
        ).scalar_one_or_none()

        if next_master:
            next_master.role = "master"
            new_master_name = next_master.agent_name
            db.flush()

    # Reassign channel masters: any channel where removed agent was master
    channels = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.master_agent == agent_name,
        )
    ).scalars().all()

    for ch in channels:
        ch.master_agent = new_master_name
    db.flush()

    event.metadata["removed_agent"] = agent_name
    if new_master_name:
        event.metadata["new_master"] = new_master_name
    return event


async def _handle_ping(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.ping → update heartbeat timestamp."""
    from app.models import WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        return None

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return None

    now = datetime.now(timezone.utc)
    member.status = "online"
    member.last_heartbeat = now
    db.flush()
    return event


async def _handle_channel_create(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.channel.create → create Channel + initial ChannelMember rows."""
    from app.models import Channel, ChannelMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}

    channel = Channel(
        workspace_id=workspace.id,
        name=payload.get("name", f"channel-{event.id[:8]}"),
        title=payload.get("title"),
        created_by=event.source,
        master_agent=payload.get("master"),
        resume_from=payload.get("resume_from"),
        status="active",
    )
    db.add(channel)
    db.flush()  # get channel.id

    # Add initial participants
    participants = payload.get("participants", [])
    for agent_name in participants:
        db.add(ChannelMember(channel_id=channel.id, agent_name=agent_name))

    db.flush()

    # Enrich event with created channel info
    event.metadata["channel_id"] = str(channel.id)
    event.metadata["channel_name"] = channel.name
    event.target = f"channel/{channel.name}"
    return event


async def _handle_channel_join(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.channel.join → add ChannelMember."""
    from app.models import Channel, ChannelMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}
    channel_name = payload.get("channel")
    agent_name = payload.get("agent_name")
    if not channel_name or not agent_name:
        return None

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        return None

    # Check if already a member
    existing = db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel.id,
            ChannelMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not existing:
        db.add(ChannelMember(channel_id=channel.id, agent_name=agent_name))
        db.flush()

    return event


async def _handle_channel_leave(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.channel.leave → remove ChannelMember."""
    from app.models import Channel, ChannelMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}
    channel_name = payload.get("channel")
    agent_name = payload.get("agent_name")
    if not channel_name or not agent_name:
        return None

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        return None

    member = db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel.id,
            ChannelMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if member:
        db.delete(member)
        db.flush()

    return event


def _extract_mentions(content: str, known_agents: List[str]) -> List[str]:
    """Parse @agent-name mentions from message text, validated against known agents."""
    if not content or not known_agents:
        return []
    # Match @word patterns (agent names are alphanumeric + hyphens)
    raw_mentions = re.findall(r"@([\w-]+)", content)
    # Only return mentions that match actual workspace members
    known_set = set(known_agents)
    return [m for m in raw_mentions if m in known_set]


def _extract_leading_mention(content: str, known_agents: List[str]) -> Optional[str]:
    """Return the agent name if the message starts with @agent-name, else None."""
    if not content or not known_agents:
        return None
    m = re.match(r"^\s*@([\w-]+)", content)
    if m and m.group(1) in set(known_agents):
        return m.group(1)
    return None


_DEFAULT_TITLES = {"New Thread", "Session 1", None, ""}


def _auto_title_channel(channel, content: str, db) -> None:
    """Set channel title from message content if still using a default title."""
    if channel.title not in _DEFAULT_TITLES:
        return
    if not content or not content.strip():
        return
    # Use first line, truncated to 60 chars
    first_line = content.strip().split("\n")[0]
    title = first_line[:60].rstrip()
    if len(first_line) > 60:
        title += "..."
    channel.title = title
    db.flush()


async def _handle_message_posted(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """
    workspace.message.posted → route messages to the right agents.

    Routing rules (human messages):
    - Starts with @agent-name → route to that agent only
    - No leading @mention → channel master (or all participants if no master)

    Routing rules (agent messages):
    - Any @mentions in body → route to mentioned agents
    - No mentions → no targeting (visible in UI only)
    """
    from app.models import Channel, WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}
    content = payload.get("content", "")

    # Parse @mentions from message content
    known_agents = [
        m.agent_name for m in db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
            )
        ).scalars().all()
    ]
    mentions = _extract_mentions(content, known_agents)

    # Agent messages: route to mentioned agents only
    if event.source.startswith("openagents:"):
        if mentions:
            event.metadata["target_agents"] = mentions
        return event

    # Human messages → route to channel master
    if not event.source.startswith("human:"):
        return event

    # Extract channel from target
    if not event.target.startswith("channel/"):
        return event

    channel_name = event.target[len("channel/"):]
    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()

    if not channel:
        return event

    # Auto-name channel from first human message if title is default/empty
    _auto_title_channel(channel, content, db)

    # If message starts with @agent-name, route directly to that agent.
    # Other @mentions in the body are just references, not routing targets.
    leading = _extract_leading_mention(content, known_agents)
    if leading:
        event.metadata["target_agents"] = [leading]
    elif channel.master_agent:
        # Default: route to channel master
        event.metadata["target_agents"] = [channel.master_agent]
    else:
        # Fall back to all channel participants
        event.metadata["target_agents"] = [
            p.agent_name for p in (channel.participants or [])
        ]

    return event


# ---------------------------------------------------------------------------
# Handler dispatch table
# ---------------------------------------------------------------------------

_HANDLERS = {
    "network.agent.join": _handle_agent_join,
    "network.agent.leave": _handle_agent_leave,
    "network.agent.remove": _handle_agent_remove,
    "network.ping": _handle_ping,
    "network.channel.create": _handle_channel_create,
    "network.channel.join": _handle_channel_join,
    "network.channel.leave": _handle_channel_leave,
    WorkspaceEventTypes.MESSAGE_POSTED: _handle_message_posted,
}
