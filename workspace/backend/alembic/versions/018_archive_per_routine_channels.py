# -*- coding: utf-8 -*-
"""Archive orphaned per-routine channels.

Backend commit ad061c2c (May 2026) briefly switched routines to
per-routine channels named `routine:<routine-id>`. That design has
been reverted in favour of one routine channel per agent
(`routines:<agent>`) — same convention as before — so the user-facing
Inbox stays grouped by agent. Any `routine:<id>` channels created
under the old design no longer receive new fires; archive them so they
drop out of the Chats / Inbox surfaces while preserving message
history for forensics.

Revision ID: 018
Revises: 017
Create Date: 2026-05-26
"""

from alembic import op


revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE channels
        SET status = 'archived'
        WHERE name LIKE 'routine:%'
          AND status = 'active'
        """
    )


def downgrade():
    # Best-effort revert: re-activate channels we archived. We can't know
    # which `routine:%` rows were already archived before this migration
    # ran, so a perfect reversal isn't possible — the upgrade is one-way
    # for practical purposes.
    op.execute(
        """
        UPDATE channels
        SET status = 'active'
        WHERE name LIKE 'routine:%'
          AND status = 'archived'
        """
    )
