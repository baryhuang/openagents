# -*- coding: utf-8 -*-
"""Add cloud_agent_configs table for server-proxied cloud agents.

Revision ID: 017
Revises: 016
Create Date: 2026-05-25
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def _has_table(inspector, table_name):
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "cloud_agent_configs"):
        op.create_table(
            "cloud_agent_configs",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_name", sa.Text(), nullable=False),
            sa.Column("provider", sa.Text(), nullable=False),
            sa.Column("model", sa.Text(), nullable=False),
            sa.Column("category", sa.Text(), nullable=False, server_default="chat"),
            sa.Column("api_key", sa.Text(), nullable=False),
            sa.Column("system_prompt", sa.Text(), nullable=True),
            sa.Column("max_tokens", sa.Integer(), nullable=True),
            sa.Column("status", sa.Text(), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("workspace_id", "agent_name", name="uq_cloud_agent_workspace_name"),
        )
        op.create_index("idx_cloud_agent_workspace", "cloud_agent_configs", ["workspace_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "cloud_agent_configs"):
        op.drop_index("idx_cloud_agent_workspace", table_name="cloud_agent_configs")
        op.drop_table("cloud_agent_configs")
