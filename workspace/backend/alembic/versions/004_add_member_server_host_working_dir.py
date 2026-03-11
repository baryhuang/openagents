# -*- coding: utf-8 -*-
"""Add server_host and working_dir columns to workspace_members table.

Revision ID: 004
Revises: 003
Create Date: 2026-03-11
"""

from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_members",
        sa.Column("server_host", sa.Text(), nullable=True),
    )
    op.add_column(
        "workspace_members",
        sa.Column("working_dir", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "working_dir")
    op.drop_column("workspace_members", "server_host")
