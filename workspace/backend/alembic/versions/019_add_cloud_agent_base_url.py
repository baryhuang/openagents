# -*- coding: utf-8 -*-
"""Add base_url column to cloud_agent_configs for custom endpoints.

Revision ID: 019
Revises: 018
Create Date: 2026-05-26
"""

import sqlalchemy as sa
from alembic import op

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column):
    if table not in inspector.get_table_names():
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_column(inspector, "cloud_agent_configs", "base_url"):
        op.add_column("cloud_agent_configs", sa.Column("base_url", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_column(inspector, "cloud_agent_configs", "base_url"):
        op.drop_column("cloud_agent_configs", "base_url")
