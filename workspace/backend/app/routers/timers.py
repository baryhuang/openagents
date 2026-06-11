# -*- coding: utf-8 -*-
"""
Timer endpoints — agent planning support.

POST   /v1/timers          Create a timer (fires a message after delay)
GET    /v1/timers          List active timers in scope
DELETE /v1/timers/{id}     Cancel a timer
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TimerRecord, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Timers"])

MAX_DELAY = 86400  # 24 hours


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateTimerRequest(BaseModel):
    delay: int
    message: str
    network: str
    source: str
    channel: Optional[str] = None
    thread_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_timer(t: TimerRecord) -> dict:
    return {
        "id": t.id,
        "message": t.message,
        "delay_seconds": t.delay_seconds,
        "fires_at": t.fires_at.isoformat() if t.fires_at else None,
        "status": t.status,
        "created_by": t.created_by,
        "channel_name": t.channel_name,
        "thread_id": t.thread_id,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ---------------------------------------------------------------------------
# POST /v1/timers
# ---------------------------------------------------------------------------

@router.post("/timers")
def create_timer(
    body: CreateTimerRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Create a timer that posts a message to the channel after a delay."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    if body.delay < 1 or body.delay > MAX_DELAY:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"delay must be between 1 and {MAX_DELAY} seconds",
        )

    now = datetime.now(timezone.utc)
    channel_name = body.channel or "default"

    timer = TimerRecord(
        workspace_id=str(workspace.id),
        channel_name=channel_name,
        thread_id=body.thread_id,
        created_by=body.source,
        message=body.message,
        delay_seconds=body.delay,
        fires_at=now + timedelta(seconds=body.delay),
    )
    db.add(timer)
    db.commit()

    return success_response(_serialize_timer(timer))


# ---------------------------------------------------------------------------
# GET /v1/timers
# ---------------------------------------------------------------------------

@router.get("/timers")
def list_timers(
    network: str = Query(...),
    channel: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List active timers in scope."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    query = select(TimerRecord).where(
        TimerRecord.workspace_id == str(workspace.id),
        TimerRecord.status == "active",
    )
    if channel:
        query = query.where(TimerRecord.channel_name == channel)

    query = query.order_by(TimerRecord.fires_at.asc())
    rows = db.execute(query).scalars().all()

    return success_response({"timers": [_serialize_timer(t) for t in rows]})


# ---------------------------------------------------------------------------
# DELETE /v1/timers/{timer_id}
# ---------------------------------------------------------------------------

@router.delete("/timers/{timer_id}")
def cancel_timer(
    timer_id: str = Path(...),
    network: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Cancel an active timer."""
    timer = db.execute(
        select(TimerRecord).where(TimerRecord.id == timer_id)
    ).scalar_one_or_none()
    if not timer:
        return json_response(ResponseCode.NOT_FOUND, "Timer not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == timer.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    if timer.status != "active":
        return json_response(ResponseCode.BAD_REQUEST, f"Timer is already {timer.status}")

    timer.status = "cancelled"
    db.commit()

    return success_response({"id": timer.id, "status": "cancelled"})
