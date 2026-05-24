# -*- coding: utf-8 -*-
"""Add context column and migrate to per-routine channels.

Each routine gets its own dedicated channel (``routine:<routine_id>``)
instead of sharing a per-agent channel (``routines:<agent>``). A new
``context`` column stores comprehensive background that gets posted
into the routine's thread on every fire.

Revision ID: 014
Revises: 013
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa


revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def _bare_agent(created_by: str) -> str:
    if created_by and created_by.startswith("openagents:"):
        return created_by[len("openagents:"):]
    return created_by or ""


def upgrade() -> None:
    op.add_column("routines", sa.Column("context", sa.Text(), nullable=True))

    conn = op.get_bind()

    routines = conn.execute(
        sa.text(
            "SELECT id, workspace_id, created_by, name "
            "FROM routines WHERE status = 'active'"
        )
    ).fetchall()

    for routine_id, workspace_id, created_by, routine_name in routines:
        agent = _bare_agent(created_by)
        if not agent:
            continue

        channel_name = f"routine:{routine_id}"

        existing = conn.execute(
            sa.text(
                "SELECT id FROM channels "
                "WHERE workspace_id = :ws AND name = :n"
            ),
            {"ws": workspace_id, "n": channel_name},
        ).first()

        if existing is None:
            new_channel = conn.execute(
                sa.text(
                    "INSERT INTO channels "
                    "(workspace_id, name, title, master_agent, created_by, status) "
                    "VALUES (:ws, :n, :t, :ma, 'system:routine', 'active') "
                    "RETURNING id"
                ),
                {"ws": workspace_id, "n": channel_name,
                 "t": routine_name or agent, "ma": agent},
            ).first()
            channel_id = new_channel[0]
            conn.execute(
                sa.text(
                    "INSERT INTO channel_members (channel_id, agent_name) "
                    "VALUES (:cid, :a)"
                ),
                {"cid": channel_id, "a": agent},
            )

        conn.execute(
            sa.text(
                "UPDATE routines SET channel_name = :n WHERE id = :id"
            ),
            {"n": channel_name, "id": routine_id},
        )


def downgrade() -> None:
    op.drop_column("routines", "context")
