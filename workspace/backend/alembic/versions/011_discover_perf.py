# -*- coding: utf-8 -*-
"""Add composite index on events and denormalize last_event_at onto channels.

Revision ID: 011
Revises: 010
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa


revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Composite index covering the discover aggregation query
    op.create_index(
        "idx_events_network_type_target_ts",
        "events",
        ["network_id", "type", "target", "timestamp"],
    )

    # Denormalized column so discover skips the aggregation entirely
    op.add_column("channels", sa.Column("last_event_at", sa.BigInteger(), nullable=True))

    # Backfill from existing events
    op.execute("""
        UPDATE channels c
        SET last_event_at = sub.last_ts
        FROM (
            SELECT target, MAX(timestamp) AS last_ts
            FROM events
            WHERE type LIKE 'workspace.message%%'
            GROUP BY target
        ) sub
        WHERE sub.target = 'channel/' || c.name
    """)


def downgrade() -> None:
    op.drop_column("channels", "last_event_at")
    op.drop_index("idx_events_network_type_target_ts", "events")
