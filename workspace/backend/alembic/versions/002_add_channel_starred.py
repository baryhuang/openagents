# -*- coding: utf-8 -*-
"""Add starred column to channels table.

Revision ID: 002
Revises: 001
Create Date: 2026-03-05
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column("starred", sa.Boolean(), server_default=sa.text("FALSE"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("channels", "starred")
