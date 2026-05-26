# -*- coding: utf-8 -*-
"""Add notifications table for workspace inbox.

Revision ID: 018
Revises: 017
Create Date: 2026-05-25
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def _has_table(inspector, table_name):
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_by", sa.Text(), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("priority", sa.Text(), nullable=False, server_default="normal"),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("FALSE")),
            sa.Column("channel_name", sa.Text(), nullable=True),
            sa.Column("thread_id", sa.Text(), nullable=True),
            sa.Column("link_url", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("idx_notifications_workspace_status", "notifications", ["workspace_id", "status"])
        op.create_index("idx_notifications_workspace_read", "notifications", ["workspace_id", "is_read"])
        op.create_index("idx_notifications_created_at", "notifications", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "notifications"):
        op.drop_index("idx_notifications_created_at", table_name="notifications")
        op.drop_index("idx_notifications_workspace_read", table_name="notifications")
        op.drop_index("idx_notifications_workspace_status", table_name="notifications")
        op.drop_table("notifications")
