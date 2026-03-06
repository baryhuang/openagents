# -*- coding: utf-8 -*-
"""Add agent_type column to workspace_members table.

Revision ID: 003
Revises: 002
Create Date: 2026-03-06
"""

from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_members",
        sa.Column("agent_type", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "agent_type")
