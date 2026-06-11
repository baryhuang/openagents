# -*- coding: utf-8 -*-
"""Add share_snapshots table for public conversation sharing.

Revision ID: 020
Revises: 019
Create Date: 2026-05-26
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def _has_table(inspector, table_name):
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "share_snapshots"):
        op.create_table(
            "share_snapshots",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=False),
            sa.Column("title", sa.Text(), nullable=True),
            sa.Column("created_by", sa.Text(), nullable=False),
            sa.Column("snapshot_data", sa.JSON(), nullable=False),
            sa.Column("share_token", sa.Text(), unique=True, nullable=False),
            sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.Text(), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )
        op.create_index("idx_share_snapshots_workspace", "share_snapshots", ["workspace_id"])
        op.create_index("idx_share_snapshots_token", "share_snapshots", ["share_token"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "share_snapshots"):
        op.drop_index("idx_share_snapshots_token", table_name="share_snapshots")
        op.drop_index("idx_share_snapshots_workspace", table_name="share_snapshots")
        op.drop_table("share_snapshots")
