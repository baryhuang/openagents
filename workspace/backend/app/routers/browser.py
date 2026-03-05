# -*- coding: utf-8 -*-
"""
Shared browser endpoints — open, navigate, click, type, screenshot, snapshot.

POST   /v1/browser/tabs                    Open a new tab
GET    /v1/browser/tabs                    List active tabs
GET    /v1/browser/tabs/{tab_id}           Get tab info
POST   /v1/browser/tabs/{tab_id}/navigate  Navigate to URL
POST   /v1/browser/tabs/{tab_id}/click     Click element
POST   /v1/browser/tabs/{tab_id}/type      Type text
GET    /v1/browser/tabs/{tab_id}/screenshot Get PNG screenshot
GET    /v1/browser/tabs/{tab_id}/snapshot   Get accessibility tree
POST   /v1/browser/tabs/{tab_id}/share     Share with agent
DELETE /v1/browser/tabs/{tab_id}           Close tab
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.browser import BrowserManager
from app.database import get_db
from app.models import BrowserTab, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _emit_event,
    _resolve_workspace,
    _verify_workspace_access,
)
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/browser", tags=["Browser"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class OpenTabRequest(BaseModel):
    url: Optional[str] = "about:blank"
    network: str
    source: Optional[str] = "human:user"


class NavigateRequest(BaseModel):
    url: str


class ClickRequest(BaseModel):
    selector: str


class TypeRequest(BaseModel):
    selector: str
    text: str


class ShareRequest(BaseModel):
    agent_name: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tab_to_dict(tab: BrowserTab) -> dict:
    return {
        "id": tab.id,
        "url": tab.url,
        "title": tab.title,
        "status": tab.status,
        "created_by": tab.created_by,
        "shared_with": tab.shared_with or [],
        "created_at": tab.created_at.isoformat() if tab.created_at else None,
        "last_active_at": tab.last_active_at.isoformat() if tab.last_active_at else None,
    }


def _get_tab(db: Session, tab_id: str) -> Optional[BrowserTab]:
    return db.execute(
        select(BrowserTab).where(BrowserTab.id == tab_id)
    ).scalar_one_or_none()


def _touch(tab: BrowserTab):
    tab.last_active_at = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs — open new tab
# ---------------------------------------------------------------------------

@router.post("/tabs")
async def open_tab(
    body: OpenTabRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    tab_id = str(uuid.uuid4())
    manager = BrowserManager.get()

    try:
        result = await manager.open_tab(tab_id, body.url or "about:blank")
    except RuntimeError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    except Exception as e:
        logger.error("Failed to open browser tab: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Failed to open browser tab")

    record = BrowserTab(
        id=tab_id,
        workspace_id=str(workspace.id),
        url=result.get("url", body.url or "about:blank"),
        title=result.get("title"),
        created_by=body.source or "human:user",
        shared_with=[],
    )
    db.add(record)

    event = Event(
        type="workspace.browser.tab.opened",
        source=body.source or "human:user",
        target="core",
        payload={"tab_id": tab_id, "url": record.url},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response(_tab_to_dict(record))


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs — list tabs
# ---------------------------------------------------------------------------

@router.get("/tabs")
async def list_tabs(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    status: str = Query("active"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    rows = db.execute(
        select(BrowserTab)
        .where(BrowserTab.workspace_id == str(workspace.id))
        .where(BrowserTab.status == status)
        .order_by(BrowserTab.last_active_at.desc())
    ).scalars().all()

    return success_response({
        "tabs": [_tab_to_dict(t) for t in rows],
        "total": len(rows),
    })


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id} — get tab info
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}")
async def get_tab(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/navigate
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/navigate")
async def navigate_tab(
    tab_id: str,
    body: NavigateRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    manager = BrowserManager.get()
    try:
        result = await manager.navigate(tab_id, body.url)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Navigate failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Navigation failed")

    tab.url = result.get("url", body.url)
    tab.title = result.get("title")
    _touch(tab)

    event = Event(
        type="workspace.browser.tab.navigated",
        source="system",
        target="core",
        payload={"tab_id": tab_id, "url": tab.url, "title": tab.title},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/click
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/click")
async def click_tab(
    tab_id: str,
    body: ClickRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    manager = BrowserManager.get()
    try:
        result = await manager.click(tab_id, body.selector)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Click failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Click failed: {e}")

    tab.url = result.get("url", tab.url)
    tab.title = result.get("title", tab.title)
    _touch(tab)
    db.flush()

    return success_response({"tab_id": tab_id, "clicked": body.selector, "url": tab.url})


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/type
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/type")
async def type_in_tab(
    tab_id: str,
    body: TypeRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    manager = BrowserManager.get()
    try:
        await manager.type_text(tab_id, body.selector, body.text)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Type failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Type failed: {e}")

    _touch(tab)
    db.flush()

    return success_response({"tab_id": tab_id, "typed": body.selector})


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id}/screenshot
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}/screenshot")
async def get_screenshot(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    manager = BrowserManager.get()
    try:
        data = await manager.screenshot(tab_id)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Screenshot failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Screenshot failed")

    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "no-cache, no-store"},
    )


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id}/snapshot
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}/snapshot")
async def get_snapshot(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    manager = BrowserManager.get()
    try:
        tree = await manager.snapshot(tab_id)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Snapshot failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Snapshot failed")

    return Response(content=tree, media_type="text/plain")


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/share
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/share")
async def share_tab(
    tab_id: str,
    body: ShareRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    shared = list(tab.shared_with or [])
    if body.agent_name not in shared:
        shared.append(body.agent_name)
        tab.shared_with = shared
    db.flush()

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# DELETE /v1/browser/tabs/{tab_id} — close tab
# ---------------------------------------------------------------------------

@router.delete("/tabs/{tab_id}")
async def close_tab(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    tab.status = "closed"

    manager = BrowserManager.get()
    await manager.close_tab(tab_id)

    event = Event(
        type="workspace.browser.tab.closed",
        source="system",
        target="core",
        payload={"tab_id": tab_id},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({"id": tab_id, "status": "closed"})
