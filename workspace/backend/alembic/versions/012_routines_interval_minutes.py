# -*- coding: utf-8 -*-
"""Add minute-interval schedule mode to routines.

Revision ID: 012
Revises: 011
Create Date: 2026-05-17
"""

from alembic import op
import sqlalchemy as sa


revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "routines",
        sa.Column("schedule_interval_minutes", sa.Integer(), nullable=True),
    )
    op.alter_column("routines", "schedule_hour", existing_type=sa.Integer(), nullable=True)
    op.alter_column("routines", "schedule_minute", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column("routines", "schedule_minute", existing_type=sa.Integer(), nullable=False)
    op.alter_column("routines", "schedule_hour", existing_type=sa.Integer(), nullable=False)
    op.drop_column("routines", "schedule_interval_minutes")
