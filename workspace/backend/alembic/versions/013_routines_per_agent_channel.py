# -*- coding: utf-8 -*-
"""Move every routine into a per-agent routine channel.

Routines used to land in whatever channel the caller passed in, which
meant scheduled output mixed with regular conversation. With this
migration every (workspace, agent) gets a single dedicated channel
``routines:<agent>`` that acts as the agent's job queue.

For each existing routine:
  1. Derive bare agent name from ``created_by`` (strip ``openagents:`` if present)
  2. Find-or-create the per-agent channel in this routine's workspace
  3. Add the agent as a channel member
  4. Update the routine row: ``channel_name`` → new channel, ``created_by`` → bare

Revision ID: 013
Revises: 012
Create Date: 2026-05-17
"""

from alembic import op
import sqlalchemy as sa


revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def _bare_agent(created_by: str) -> str:
    if created_by and created_by.startswith("openagents:"):
        return created_by[len("openagents:"):]
    return created_by or ""


def upgrade() -> None:
    conn = op.get_bind()

    routines = conn.execute(
        sa.text(
            "SELECT id, workspace_id, created_by, channel_name "
            "FROM routines WHERE status = 'active'"
        )
    ).fetchall()

    for routine_id, workspace_id, created_by, _old_channel in routines:
        agent = _bare_agent(created_by)
        if not agent:
            continue

        channel_name = f"routines:{agent}"

        channel_row = conn.execute(
            sa.text(
                "SELECT id FROM channels "
                "WHERE workspace_id = :ws AND name = :n"
            ),
            {"ws": workspace_id, "n": channel_name},
        ).first()

        if channel_row is None:
            new_channel = conn.execute(
                sa.text(
                    "INSERT INTO channels "
                    "(workspace_id, name, title, master_agent, created_by, status) "
                    "VALUES (:ws, :n, :t, :ma, 'system:routine', 'active') "
                    "RETURNING id"
                ),
                {"ws": workspace_id, "n": channel_name, "t": agent, "ma": agent},
            ).first()
            channel_id = new_channel[0]
            conn.execute(
                sa.text(
                    "INSERT INTO channel_members (channel_id, agent_name) "
                    "VALUES (:cid, :a)"
                ),
                {"cid": channel_id, "a": agent},
            )
        else:
            channel_id = channel_row[0]
            existing_member = conn.execute(
                sa.text(
                    "SELECT 1 FROM channel_members "
                    "WHERE channel_id = :cid AND agent_name = :a"
                ),
                {"cid": channel_id, "a": agent},
            ).first()
            if existing_member is None:
                conn.execute(
                    sa.text(
                        "INSERT INTO channel_members (channel_id, agent_name) "
                        "VALUES (:cid, :a)"
                    ),
                    {"cid": channel_id, "a": agent},
                )

        conn.execute(
            sa.text(
                "UPDATE routines SET channel_name = :n, created_by = :a "
                "WHERE id = :id"
            ),
            {"n": channel_name, "a": agent, "id": routine_id},
        )


def downgrade() -> None:
    # No-op: we don't know the original channel each routine came from.
    pass
