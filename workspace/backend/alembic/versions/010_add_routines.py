# -*- coding: utf-8 -*-
"""Add routines table for recurring scheduled tasks.

Revision ID: 010
Revises: 009
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "routines",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_name", sa.Text(), nullable=False),
        sa.Column("thread_id", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("schedule_hour", sa.Integer(), nullable=False),
        sa.Column("schedule_minute", sa.Integer(), nullable=False),
        sa.Column("schedule_days", JSONB(), nullable=True),
        sa.Column("timezone", sa.Text(), server_default="UTC"),
        sa.Column("next_fires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_fired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_routines_workspace_channel", "routines", ["workspace_id", "channel_name"])
    op.create_index("idx_routines_next_fires_status", "routines", ["next_fires_at", "status"])


def downgrade() -> None:
    op.drop_index("idx_routines_next_fires_status", "routines")
    op.drop_index("idx_routines_workspace_channel", "routines")
    op.drop_table("routines")
