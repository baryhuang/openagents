# -*- coding: utf-8 -*-
"""Add device_tokens table for iOS / mobile push notification registration.

Revision ID: 008
Revises: 007
Create Date: 2026-05-09
"""

from alembic import op
import sqlalchemy as sa


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_tokens",
        sa.Column("id", sa.Text(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", sa.Text(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fcm_token", sa.Text(), nullable=False),
        sa.Column("device_type", sa.Text(), nullable=False),
        sa.Column("bundle_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("workspace_id", "fcm_token", name="uq_device_token_workspace_fcm"),
    )
    op.create_index("idx_device_tokens_workspace", "device_tokens", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("idx_device_tokens_workspace", "device_tokens")
    op.drop_table("device_tokens")
