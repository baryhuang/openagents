# -*- coding: utf-8 -*-
"""
Account-level endpoints for the signed-in end user (Google or Apple identity).

DELETE /v1/account    Permanently delete the calling user's account data.

This exists to satisfy App Store Review Guideline 5.1.1(v), which requires apps
that support account creation to let users initiate account deletion from inside
the app. Auth is the user's identity bearer token (Authorization: Bearer <id>)
— NOT a workspace token — because deletion spans every workspace the user
touched, so it can't be scoped to a single workspace's token.

Scope of deletion: the user is identified only by email (the app has no
app-managed credential; identity is delegated to Google / Apple). We purge every
row keyed to that email — workspace collaborator memberships, channel human
memberships, and registered device push tokens — across all workspaces. We do
NOT delete whole workspaces the user created, since those may hold other
collaborators' data; their `creator_email` is left intact.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.firebase_auth import verify_identity_token
from app.models import ChannelHumanMember, DeviceToken, Workspace, WorkspaceCollaborator
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _extract_bearer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Account"])


def _authed_email(authorization: Optional[str]) -> Optional[str]:
    """Resolve the calling user's normalized email from the identity bearer,
    or None if absent/invalid."""
    bearer = _extract_bearer(authorization)
    if not bearer:
        return None
    email = verify_identity_token(bearer)
    return email.strip().lower() if email else None


@router.get("/account/workspaces")
def list_account_workspaces(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """List every workspace the signed-in user can access — as creator or as an
    email collaborator — so they can pick one on any device without re-pasting a
    URL. This is the account-backed replacement for device-local history.

    Each entry includes the workspace's shared access token (`token`) so the
    client can connect directly; the caller is already a verified member, which
    is exactly who is entitled to that token.
    """
    email = _authed_email(authorization)
    if not email:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")

    # role per workspace for this user (collaborator rows are lowercase-keyed).
    collab_roles = {
        str(wid): role
        for wid, role in db.execute(
            select(WorkspaceCollaborator.workspace_id, WorkspaceCollaborator.role)
            .where(WorkspaceCollaborator.email == email)
        ).all()
    }

    workspaces = db.execute(
        select(Workspace)
        .where(
            Workspace.status != "deleted",
            or_(
                func.lower(Workspace.creator_email) == email,
                Workspace.id.in_(
                    select(WorkspaceCollaborator.workspace_id)
                    .where(WorkspaceCollaborator.email == email)
                ),
            ),
        )
        .order_by(Workspace.last_activity_at.desc())
    ).scalars().all()

    results = []
    for ws in workspaces:
        is_owner = (ws.creator_email or "").strip().lower() == email
        results.append({
            "workspaceId": str(ws.id),
            "name": ws.name,
            "slug": ws.slug,
            # Shared workspace access token (password_hash stores the raw token,
            # compared by equality in _verify_workspace_access). May be null for
            # an open workspace with no token set.
            "token": ws.password_hash,
            "role": "owner" if is_owner else collab_roles.get(str(ws.id), "editor"),
            "lastActivityAt": ws.last_activity_at.isoformat() if ws.last_activity_at else None,
        })

    return success_response(results)


@router.delete("/account")
def delete_account(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Delete all data belonging to the calling user.

    Identifies the user from the verified identity token's email, then removes
    every email-keyed row across all workspaces. Idempotent: a second call (or a
    user with no stored data) succeeds with zero deletions.
    """
    bearer = _extract_bearer(authorization)
    if not bearer:
        return json_response(ResponseCode.UNAUTHORIZED, "Missing identity token")

    email = verify_identity_token(bearer)
    if not email:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")

    email_lower = email.strip().lower()

    collaborators_deleted = db.query(WorkspaceCollaborator).filter(
        WorkspaceCollaborator.email == email_lower
    ).delete(synchronize_session=False)

    channel_memberships_deleted = db.query(ChannelHumanMember).filter(
        ChannelHumanMember.user_email == email_lower
    ).delete(synchronize_session=False)

    devices_deleted = db.query(DeviceToken).filter(
        DeviceToken.user_email == email_lower
    ).delete(synchronize_session=False)

    db.commit()

    logger.info(
        "account: deleted account for %s (collaborators=%s channel_members=%s devices=%s)",
        email_lower, collaborators_deleted, channel_memberships_deleted, devices_deleted,
    )

    return success_response({
        "email": email_lower,
        "deleted": {
            "collaborators": collaborators_deleted,
            "channel_memberships": channel_memberships_deleted,
            "devices": devices_deleted,
        },
    })
