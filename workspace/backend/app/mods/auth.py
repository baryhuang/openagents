# -*- coding: utf-8 -*-
"""
mod/auth — verify workspace token or Firebase bearer token.

Guard mod (priority 0). Rejects events from unauthorized sources.

Supports two auth paths:
  1. Workspace token (X-Workspace-Token header) — for agents
  2. Firebase bearer token (Authorization: Bearer) — for logged-in workspace owners

Expects context.extra to contain:
  - token: str (workspace password / API key)
  - bearer_token: str (Firebase ID token, optional)
  - workspace: Workspace ORM object
"""

import logging
from typing import List, Optional

from openagents.core.onm_events import Event
from openagents.core.onm_mods import GuardMod, PipelineContext

logger = logging.getLogger(__name__)


class AuthMod(GuardMod):
    """Verify that the event source is authorized for this network."""
    name = "auth"
    intercepts: List[str] = []   # Match all events
    priority = 0

    async def process(self, event: Event, context: PipelineContext) -> Optional[Event]:
        workspace = context.extra.get("workspace")
        token = context.extra.get("token")
        bearer_token = context.extra.get("bearer_token")

        if not workspace:
            logger.warning("auth: no workspace in context, rejecting event")
            return None

        # If workspace has a password, verify auth
        if workspace.password_hash:
            # Path 1: Workspace token matches
            if token and token == workspace.password_hash:
                event.network = str(workspace.id)
                return event

            # Path 2: Firebase bearer token for workspace owner
            if bearer_token:
                from app.firebase_auth import verify_firebase_token
                email = verify_firebase_token(bearer_token)
                if email and workspace.creator_email and email == workspace.creator_email:
                    event.network = str(workspace.id)
                    return event

            # Neither auth path succeeded
            logger.warning("auth: invalid credentials for workspace %s", workspace.id)
            return None

        # No password on workspace — allow all
        event.network = str(workspace.id)
        return event
