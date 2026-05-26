# -*- coding: utf-8 -*-
"""
Cloud agent CRUD endpoints — add, list, update, remove cloud-based agents.

POST   /v1/cloud-agents              Add a cloud agent
GET    /v1/cloud-agents              List cloud agents in workspace
GET    /v1/cloud-agents/providers    List available providers and models
PATCH  /v1/cloud-agents/{name}       Update cloud agent config
DELETE /v1/cloud-agents/{name}       Remove cloud agent
"""

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CloudAgentConfig, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services.cloud_providers import providers_catalog, validate_provider_model

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Cloud Agents"])

_AGENT_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{1,62}[a-zA-Z0-9]$")


def _mask_api_key(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return key[:4] + "..." + key[-4:]


def _format_cloud_agent(cfg: CloudAgentConfig) -> dict:
    return {
        "agentName": cfg.agent_name,
        "provider": cfg.provider,
        "model": cfg.model,
        "category": cfg.category,
        "apiKeyMasked": _mask_api_key(cfg.api_key),
        "baseUrl": cfg.base_url,
        "systemPrompt": cfg.system_prompt,
        "maxTokens": cfg.max_tokens,
        "status": cfg.status,
        "createdAt": cfg.created_at.isoformat() if cfg.created_at else None,
    }


# ---------------------------------------------------------------------------
# GET /v1/cloud-agents/providers
# ---------------------------------------------------------------------------

@router.get("/cloud-agents/providers")
async def list_providers():
    """List available cloud agent providers and their models."""
    return success_response({"providers": providers_catalog()})


# ---------------------------------------------------------------------------
# POST /v1/cloud-agents
# ---------------------------------------------------------------------------

class AddCloudAgentRequest(BaseModel):
    network: str
    agent_name: str
    provider: str
    model: str
    api_key: str
    base_url: Optional[str] = None
    system_prompt: Optional[str] = None
    max_tokens: Optional[int] = None


@router.post("/cloud-agents")
async def add_cloud_agent(
    body: AddCloudAgentRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Add a cloud-based agent to the workspace."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if not _AGENT_NAME_RE.match(body.agent_name):
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Agent name must be 3-64 chars, alphanumeric/hyphen/underscore",
        )

    model_info = validate_provider_model(body.provider, body.model)
    if not model_info:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Unknown provider/model: {body.provider}/{body.model}",
        )

    existing = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == body.agent_name,
        )
    ).scalar_one_or_none()
    if existing:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Agent '{body.agent_name}' already exists in this workspace",
        )

    if body.provider == "custom" and not body.base_url:
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Custom provider requires a base_url",
        )

    cfg = CloudAgentConfig(
        workspace_id=str(workspace.id),
        agent_name=body.agent_name,
        provider=body.provider,
        model=body.model,
        category=model_info.category,
        api_key=body.api_key,
        base_url=body.base_url,
        system_prompt=body.system_prompt,
        max_tokens=body.max_tokens,
    )
    db.add(cfg)

    member = WorkspaceMember(
        workspace_id=str(workspace.id),
        agent_name=body.agent_name,
        role="member",
        agent_type=f"cloud:{body.provider}",
        status="online",
        description=f"Cloud agent: {model_info.label} ({body.provider})",
    )
    db.add(member)

    db.commit()

    logger.info(
        "cloud_agents: added %s (%s/%s) to workspace %s",
        body.agent_name, body.provider, body.model, workspace.id,
    )

    return success_response(_format_cloud_agent(cfg))


# ---------------------------------------------------------------------------
# GET /v1/cloud-agents
# ---------------------------------------------------------------------------

@router.get("/cloud-agents")
async def list_cloud_agents(
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List cloud agents in a workspace."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    configs = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == str(workspace.id),
        )
    ).scalars().all()

    return success_response({
        "cloud_agents": [_format_cloud_agent(c) for c in configs],
    })


# ---------------------------------------------------------------------------
# PATCH /v1/cloud-agents/{agent_name}
# ---------------------------------------------------------------------------

class UpdateCloudAgentRequest(BaseModel):
    network: str
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    system_prompt: Optional[str] = None
    max_tokens: Optional[int] = None
    status: Optional[str] = None


@router.patch("/cloud-agents/{agent_name}")
async def update_cloud_agent(
    agent_name: str,
    body: UpdateCloudAgentRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Update a cloud agent's configuration."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    cfg = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == str(workspace.id),
            CloudAgentConfig.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not cfg:
        return json_response(ResponseCode.NOT_FOUND, "Cloud agent not found")

    if body.model is not None:
        model_info = validate_provider_model(cfg.provider, body.model)
        if not model_info:
            return json_response(
                ResponseCode.BAD_REQUEST,
                f"Unknown model: {body.model} for provider {cfg.provider}",
            )
        cfg.model = body.model
        cfg.category = model_info.category

        member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name == agent_name,
            )
        ).scalar_one_or_none()
        if member:
            member.description = f"Cloud agent: {model_info.label} ({cfg.provider})"

    if body.api_key is not None:
        cfg.api_key = body.api_key

    if body.base_url is not None:
        cfg.base_url = body.base_url or None

    if body.system_prompt is not None:
        cfg.system_prompt = body.system_prompt or None

    if body.max_tokens is not None:
        cfg.max_tokens = body.max_tokens or None

    if body.status is not None and body.status in ("active", "disabled"):
        cfg.status = body.status

    db.commit()

    return success_response(_format_cloud_agent(cfg))


# ---------------------------------------------------------------------------
# DELETE /v1/cloud-agents/{agent_name}
# ---------------------------------------------------------------------------

@router.delete("/cloud-agents/{agent_name}")
async def remove_cloud_agent(
    agent_name: str,
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove a cloud agent from the workspace."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    cfg = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == str(workspace.id),
            CloudAgentConfig.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not cfg:
        return json_response(ResponseCode.NOT_FOUND, "Cloud agent not found")

    db.delete(cfg)

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    if member:
        db.delete(member)

    db.commit()

    logger.info("cloud_agents: removed %s from workspace %s", agent_name, workspace.id)

    return success_response({"agentName": agent_name, "status": "removed"})
