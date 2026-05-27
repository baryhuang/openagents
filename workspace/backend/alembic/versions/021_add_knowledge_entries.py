# -*- coding: utf-8 -*-
"""Add knowledge_entries table for shared knowledge base.

Revision ID: 021
Revises: 020
Create Date: 2026-05-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def _has_table(inspector, table_name):
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "knowledge_entries"):
        op.create_table(
            "knowledge_entries",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("slug", sa.Text(), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("storage_key", sa.Text(), nullable=True),
            sa.Column("content_size", sa.Integer(), nullable=True),
            sa.Column("created_by", sa.Text(), nullable=False),
            sa.Column("updated_by", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )
        op.create_unique_constraint(
            "uq_knowledge_workspace_slug", "knowledge_entries", ["workspace_id", "slug"],
        )
        op.create_index(
            "idx_knowledge_workspace_status", "knowledge_entries", ["workspace_id", "status"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "knowledge_entries"):
        op.drop_index("idx_knowledge_workspace_status", table_name="knowledge_entries")
        op.drop_constraint("uq_knowledge_workspace_slug", "knowledge_entries", type_="unique")
        op.drop_table("knowledge_entries")
