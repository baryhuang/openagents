# -*- coding: utf-8 -*-
"""
To-do list endpoints — agent planning support.

PUT  /v1/todos   Replace the calling agent's entire to-do list in a channel
GET  /v1/todos   Query to-dos for a channel (own or all agents)
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TodoRecord, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _emit_event,
    _resolve_workspace,
    _verify_workspace_access,
)
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Todos"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class TodoItem(BaseModel):
    content: str
    status: str = "pending"
    assignee: Optional[str] = None


class PutTodosRequest(BaseModel):
    todos: List[TodoItem]
    network: str
    source: str
    channel: Optional[str] = None
    thread_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _agent_name_from_source(source: str) -> str:
    if source.startswith("openagents:"):
        return source[len("openagents:"):]
    return source


def _serialize_todo(t: TodoRecord) -> dict:
    return {
        "id": t.id,
        "content": t.content,
        "status": t.status,
        "assignee": t.assignee,
        "created_by": t.created_by,
        "channel_name": t.channel_name,
        "thread_id": t.thread_id,
        "position": t.position,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


# ---------------------------------------------------------------------------
# PUT /v1/todos
# ---------------------------------------------------------------------------

@router.put("/todos")
async def put_todos(
    body: PutTodosRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Replace the calling agent's entire to-do list for a channel/thread."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    created_by = body.source
    agent_name = _agent_name_from_source(created_by)
    channel_name = body.channel or "default"

    # Delete existing todos for this agent in this scope
    stmt = delete(TodoRecord).where(
        TodoRecord.workspace_id == str(workspace.id),
        TodoRecord.channel_name == channel_name,
        TodoRecord.created_by == created_by,
    )
    if body.thread_id:
        stmt = stmt.where(TodoRecord.thread_id == body.thread_id)
    db.execute(stmt)

    # Insert new todos
    records = []
    for i, item in enumerate(body.todos):
        assignee = item.assignee or agent_name
        rec = TodoRecord(
            workspace_id=str(workspace.id),
            channel_name=channel_name,
            thread_id=body.thread_id,
            created_by=created_by,
            assignee=assignee,
            content=item.content,
            status=item.status,
            position=i,
        )
        db.add(rec)
        records.append(rec)
    db.flush()

    # Emit as a workspace event so the chat stream picks it up
    todo_payload = [
        {"content": r.content, "status": r.status, "assignee": r.assignee}
        for r in records
    ]
    event = Event(
        type="workspace.message.posted",
        source=created_by,
        target=f"channel/{channel_name}",
        payload={
            "content": "\n".join(
                f"{'✅' if t['status'] == 'completed' else '🔄' if t['status'] == 'in_progress' else '⬜'} {t['content']}"
                for t in todo_payload
            ),
            "message_type": "todos",
            "todos": todo_payload,
        },
        metadata={},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token)

    db.commit()
    return success_response({"todos": [_serialize_todo(r) for r in records]})


# ---------------------------------------------------------------------------
# GET /v1/todos
# ---------------------------------------------------------------------------

@router.get("/todos")
async def get_todos(
    network: str = Query(...),
    channel: Optional[str] = Query(None),
    thread_id: Optional[str] = Query(None),
    agent: Optional[str] = Query(None),
    all: Optional[bool] = Query(False),
    source: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Get to-dos for a channel. Default: own todos only; all=true for everyone."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    query = select(TodoRecord).where(
        TodoRecord.workspace_id == str(workspace.id),
    )
    if channel:
        query = query.where(TodoRecord.channel_name == channel)
    if thread_id:
        query = query.where(TodoRecord.thread_id == thread_id)
    if agent:
        query = query.where(TodoRecord.assignee.contains(agent))
    elif not all and source:
        query = query.where(TodoRecord.created_by == source)

    query = query.order_by(TodoRecord.created_by, TodoRecord.position)
    rows = db.execute(query).scalars().all()

    return success_response({"todos": [_serialize_todo(r) for r in rows]})
