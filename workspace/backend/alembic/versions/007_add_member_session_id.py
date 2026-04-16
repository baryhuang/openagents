# -*- coding: utf-8 -*-
"""Add session_id to workspace_members.

Revision ID: 007
Revises: 006
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa


revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Opaque session token issued on each /v1/join. Heartbeats and
    # message posts must carry this id; a newer join rotates it so any
    # stale client (ghost adapter, duplicate daemon) posting with the
    # old id gets rejected and stops.
    op.add_column(
        "workspace_members",
        sa.Column("session_id", sa.Text(), nullable=True),
    )
    op.add_column(
        "workspace_members",
        sa.Column("session_started_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "session_started_at")
    op.drop_column("workspace_members", "session_id")
