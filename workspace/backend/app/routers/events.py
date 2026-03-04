# -*- coding: utf-8 -*-
"""
ONM Event endpoints — the core of the event-native API.

POST /v1/events    Send any event into the mod pipeline
GET  /v1/events    Poll events (filter by after, target, channel, type)
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EventRecord, Workspace
from app.pipeline_factory import pipeline
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _workspace_filter
from openagents.core.onm_events import Event
from openagents.core.onm_mods import EventRejected, PipelineContext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Events"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SendEventRequest(BaseModel):
    type: str
    source: str
    target: str
    payload: Optional[dict] = None
    metadata: Optional[dict] = None
    visibility: Optional[str] = "channel"
    network: Optional[str] = None   # workspace ID or slug


# ---------------------------------------------------------------------------
# POST /v1/events — send an event through the pipeline
# ---------------------------------------------------------------------------

def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Extract bearer token from Authorization header."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


@router.post("/events")
async def send_event(
    body: SendEventRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Send an event into the network pipeline.

    The event flows through mod/auth → mod/workspace → mod/persistence
    before delivery to the target.
    """
    if not body.network:
        return json_response(ResponseCode.BAD_REQUEST, "Missing required field: network")

    # Resolve workspace
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(body.network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    # Build ONM Event
    event = Event(
        type=body.type,
        source=body.source,
        target=body.target,
        payload=body.payload,
        metadata=body.metadata or {},
        visibility=body.visibility or "channel",
        network=str(workspace.id),
    )

    # Build pipeline context — extra kwargs become context.extra dict
    context = PipelineContext(
        network_id=str(workspace.id),
        agent_address=body.source,
        db=db,
        workspace=workspace,
        token=x_workspace_token,
        bearer_token=_extract_bearer(authorization),
    )

    # Run through pipeline
    try:
        result = await pipeline.process(event, context)
    except EventRejected:
        return json_response(ResponseCode.UNAUTHORIZED, "Event rejected by pipeline")

    db.commit()

    return success_response({
        "id": result.id,
        "type": result.type,
        "source": result.source,
        "target": result.target,
        "timestamp": result.timestamp,
        "metadata": result.metadata,
    })


# ---------------------------------------------------------------------------
# GET /v1/events — poll events
# ---------------------------------------------------------------------------

@router.get("/events")
async def poll_events(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    after: Optional[str] = Query(None, description="Return events after this event ID"),
    target: Optional[str] = Query(None, description="Filter by target address"),
    channel: Optional[str] = Query(None, description="Filter by channel name"),
    type: Optional[str] = Query(None, description="Filter by event type prefix"),
    limit: int = Query(50, ge=1, le=200, description="Max events to return"),
    db: Session = Depends(get_db),
):
    """
    Poll events from the network.

    Supports filtering by target, channel, type, and cursor-based pagination
    using the `after` parameter (event ID — events are sorted by timestamp).
    """
    # Resolve workspace
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    query = select(EventRecord).where(EventRecord.network_id == workspace.id)

    if after:
        cursor_event = db.execute(
            select(EventRecord.timestamp).where(EventRecord.id == after)
        ).scalar_one_or_none()
        if cursor_event is not None:
            query = query.where(EventRecord.timestamp > cursor_event)

    if target:
        query = query.where(EventRecord.target == target)

    if channel:
        query = query.where(EventRecord.target == f"channel/{channel}")

    if type:
        query = query.where(EventRecord.type.startswith(type))

    query = query.order_by(EventRecord.timestamp.asc()).limit(limit + 1)
    rows = db.execute(query).scalars().all()

    has_more = len(rows) > limit
    events = rows[:limit]

    return success_response({
        "events": [
            {
                "id": e.id,
                "type": e.type,
                "source": e.source,
                "target": e.target,
                "payload": e.payload,
                "metadata": e.metadata_,
                "timestamp": e.timestamp,
                "visibility": e.visibility,
            }
            for e in events
        ],
        "has_more": has_more,
    })
