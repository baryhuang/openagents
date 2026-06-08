# -*- coding: utf-8 -*-
"""Add performance indexes on `channels` for discover + timer-loop archive scan.

Revision ID: 024
Revises: 023
Create Date: 2026-06-08

Two composite indexes that turn full-table scans into index lookups:

  - `idx_channels_workspace_status` (workspace_id, status) — serves
    `GET /v1/discover`, which lists a workspace's channels with
    `WHERE workspace_id = ? AND status != 'deleted'`. Without it, discover
    scans every channel row for the workspace.

  - `idx_channels_status_last_event` (status, last_event_at) — serves the
    background timer loop's auto-archive sweep
    (`status = 'active' AND last_event_at < cutoff`). That sweep ran on the
    event loop every 10s; an unindexed scan over a growing channels table
    held a pooled DB connection for tens of seconds and starved the pool.

Created with IF NOT EXISTS so the migration is idempotent if the indexes
were added manually during the incident.
"""

from alembic import op


revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "idx_channels_workspace_status",
        "channels",
        ["workspace_id", "status"],
        if_not_exists=True,
    )
    op.create_index(
        "idx_channels_status_last_event",
        "channels",
        ["status", "last_event_at"],
        if_not_exists=True,
    )


def downgrade():
    op.drop_index("idx_channels_status_last_event", table_name="channels", if_exists=True)
    op.drop_index("idx_channels_workspace_status", table_name="channels", if_exists=True)
