# -*- coding: utf-8 -*-
"""Add user identity columns for human @-mentions and per-user push targeting.

Revision ID: 023
Revises: 022
Create Date: 2026-05-28

Adds two columns to support pushing notifications to *specific humans*
when they're @-mentioned in a chat:

  - `device_tokens.user_email` — the Google email of the signed-in user
    on the device that registered. NULL for older clients; populated by
    new iOS / macOS builds that pass `userEmail` in
    `POST /v1/devices/register`. The push fan-out filters by this column
    when a mention resolves to a human collaborator so only that human's
    devices get woken up (not the whole workspace).

  - `workspace_collaborators.display_name` — the Google `displayName`
    captured the first time a human posts in the workspace. Used by the
    backend's mention filter to resolve "@bary" → collaborator → device
    tokens. The web's mention picker shows it alongside the avatar.

Both columns are nullable so existing rows keep working; new writes
populate them via clients we control.
"""

from alembic import op
import sqlalchemy as sa


revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "device_tokens",
        sa.Column("user_email", sa.Text(), nullable=True),
    )
    op.create_index(
        "idx_device_tokens_workspace_user",
        "device_tokens",
        ["workspace_id", "user_email"],
    )

    op.add_column(
        "workspace_collaborators",
        sa.Column("display_name", sa.Text(), nullable=True),
    )

    # channel_human_members — Slack-style "humans participating in this
    # thread". Separate from channel_members (agents only) so the existing
    # agent routing queries stay unchanged. Auto-populated on first human
    # post in a channel; consulted by push.py to decide whose devices get
    # a banner for a non-mention chat message.
    #
    # Create WITHOUT the FK first to avoid ACCESS EXCLUSIVE lock on
    # channels (deadlocks with live replicas polling that table during
    # rolling deploys). Add the constraint NOT VALID afterwards — it
    # skips scanning existing rows so no long lock is needed.
    op.create_table(
        "channel_human_members",
        sa.Column(
            "channel_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            nullable=False,
        ),
        sa.Column("user_email", sa.Text(), nullable=False),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("channel_id", "user_email"),
    )
    op.execute(
        'ALTER TABLE channel_human_members '
        'ADD CONSTRAINT fk_channel_human_members_channel_id '
        'FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE '
        'NOT VALID'
    )
    op.create_index(
        "idx_channel_human_members_email",
        "channel_human_members",
        ["user_email"],
    )


def downgrade():
    op.drop_index("idx_channel_human_members_email", table_name="channel_human_members")
    op.execute('ALTER TABLE channel_human_members DROP CONSTRAINT IF EXISTS fk_channel_human_members_channel_id')
    op.drop_table("channel_human_members")
    op.drop_index("idx_device_tokens_workspace_user", table_name="device_tokens")
    op.drop_column("device_tokens", "user_email")
    op.drop_column("workspace_collaborators", "display_name")
