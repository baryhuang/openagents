# -*- coding: utf-8 -*-
"""
mod/auth — verify workspace token and stamp network identity.

Guard mod (priority 0). Rejects events from unauthorized sources.

Expects context.extra to contain:
  - token: str (workspace password / API key)
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

        if not workspace:
            logger.warning("auth: no workspace in context, rejecting event")
            return None

        # If workspace has a password, verify it
        if workspace.password_hash:
            if not token or token != workspace.password_hash:
                logger.warning("auth: invalid token for workspace %s", workspace.id)
                return None

        # Stamp the network ID onto the event so downstream mods can trust it
        event.network = str(workspace.id)

        return event
