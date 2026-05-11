# -*- coding: utf-8 -*-
"""
Push-notification fan-out for mobile clients (currently iOS only).

Wired into `routers/events.py` via FastAPI BackgroundTasks:
on every `POST /v1/events`, after the response is sent, this module decides
whether the event warrants a push, looks up registered device tokens for the
workspace, and dispatches via Firebase Admin → APNs.

Filtering rules (see `_should_push`):
  - workspace.message.posted, type=chat, source=openagents:* → always push
  - workspace.message.posted, type=status, content matches a TERMINAL
    pattern (done / completed / failed / error / stopped / stopping failed
    / session restarted / restart failed) → push
  - workspace.message.posted, content contains @<agent-name> where the
    agent is a member of this workspace → push (mention)
  - everything else → skip

Failure handling: tokens that FCM marks `UNREGISTERED` or `INVALID_ARGUMENT`
are pruned from `device_tokens`. Send failures are logged but never raised
back to the request that triggered them.
"""

import logging
import re
from typing import Any, Optional

from sqlalchemy import select

from app.database import SessionLocal
from app.models import DeviceToken, WorkspaceMember

logger = logging.getLogger(__name__)

# Mirrors the Swift client's isTerminalStatus regex plus the natural-English
# verbs an adapter might emit when a run completes successfully or fails.
# Match is case-insensitive substring; keep the list short so it stays
# debuggable.
_TERMINAL_STATUS_PATTERNS = (
    "stopped",
    "stopping failed",
    "session restarted",
    "restart failed",
    "completed",
    "done",
    "failed",
    "error",
)

_MENTION_RE = re.compile(r"@([\w][\w\-_]{0,63})")


def _content_of(event: dict) -> str:
    payload = event.get("payload") or {}
    content = payload.get("content")
    return str(content) if content else ""


def _message_type_of(event: dict) -> str:
    payload = event.get("payload") or {}
    return str(payload.get("message_type") or "chat")


def _source_kind(event: dict) -> str:
    """Return 'agent' / 'human' based on the event's source prefix."""
    src = str(event.get("source") or "")
    if src.startswith("openagents:"):
        return "agent"
    if src.startswith("human:"):
        return "human"
    return "other"


def _is_terminal_status(content: str) -> bool:
    lower = content.lower()
    return any(pat in lower for pat in _TERMINAL_STATUS_PATTERNS)


def _extract_mentions(content: str) -> set[str]:
    return {m.group(1).lower() for m in _MENTION_RE.finditer(content or "")}


def _should_push(event: dict, workspace_agent_names: set[str]) -> tuple[bool, str]:
    """Decide whether `event` warrants a push.

    Returns (should_push, reason) — reason is a short tag used in the
    notification's `data` payload so the iOS app can render different
    sounds/categories later.
    """
    if event.get("type") != "workspace.message.posted":
        return False, ""

    msg_type = _message_type_of(event)
    content = _content_of(event)
    source_kind = _source_kind(event)

    # Mentions take priority — applies to both chat and status, agent or human.
    mentions = _extract_mentions(content)
    if mentions and mentions & {n.lower() for n in workspace_agent_names}:
        return True, "mention"

    if msg_type == "chat":
        # Agent chat messages → push. Human chat → don't push to self.
        if source_kind == "agent":
            return True, "chat"
        return False, ""

    if msg_type in ("status", "thinking"):
        # Per-decision: only push on TERMINAL state transitions so we don't
        # flood on every "thinking" heartbeat.
        if _is_terminal_status(content):
            return True, "status"
        return False, ""

    return False, ""


def _build_notification(event: dict, reason: str):
    """Build a Firebase messaging.Notification — title + body."""
    from firebase_admin import messaging

    source = str(event.get("source") or "")
    sender_name = source.split(":", 1)[1] if ":" in source else source

    if reason == "mention":
        title = f"{sender_name} mentioned you"
    elif reason == "status":
        title = f"{sender_name}"
    else:  # chat
        title = sender_name

    body = _content_of(event).strip()
    if len(body) > 240:
        body = body[:237] + "…"
    if not body:
        body = "(no content)"

    return messaging.Notification(title=title, body=body)


def _build_data_payload(event: dict, reason: str) -> dict[str, str]:
    """Build the FCM `data` dict — client receives this in userInfo.

    All values MUST be strings (FCM requirement).
    """
    target = str(event.get("target") or "")
    channel = target[len("channel/"):] if target.startswith("channel/") else ""
    return {
        "reason": reason,
        "channel": channel,
        "event_id": str(event.get("id") or ""),
        "event_type": str(event.get("type") or ""),
        "source": str(event.get("source") or ""),
    }


def _workspace_agent_names(db, workspace_id: str) -> set[str]:
    rows = db.execute(
        select(WorkspaceMember.agent_name).where(WorkspaceMember.workspace_id == workspace_id)
    ).scalars().all()
    return set(rows)


def fanout_for_event(workspace_id: str, event: dict) -> None:
    """Entry point for the BackgroundTasks hook. Opens its own DB session
    (the request's session is closed by the time this runs)."""
    try:
        _fanout_impl(workspace_id, event)
    except Exception as e:
        # Never let push send failures propagate — the event has already
        # been committed; we don't want background-task exceptions to
        # corrupt anything downstream.
        logger.warning("push: fanout failed for workspace=%s: %s", workspace_id, e)


def _fanout_impl(workspace_id: str, event: dict) -> None:
    db = SessionLocal()
    try:
        agent_names = _workspace_agent_names(db, workspace_id)
        should, reason = _should_push(event, agent_names)
        if not should:
            return

        tokens: list[DeviceToken] = db.execute(
            select(DeviceToken).where(DeviceToken.workspace_id == workspace_id)
        ).scalars().all()
        if not tokens:
            return

        # Lazy-init Firebase Admin — same path that firebase_auth uses, but
        # the messaging module is available once init succeeds.
        from app.firebase_auth import _init_firebase
        if not _init_firebase():
            logger.warning("push: firebase not configured, skipping fan-out")
            return
        from firebase_admin import messaging

        notification = _build_notification(event, reason)
        data = _build_data_payload(event, reason)
        apns = messaging.APNSConfig(
            payload=messaging.APNSPayload(
                aps=messaging.Aps(
                    alert=messaging.ApsAlert(
                        title=notification.title,
                        body=notification.body,
                    ),
                    sound="default",
                    mutable_content=True,
                    thread_id=data.get("channel") or None,
                ),
            ),
        )
        messages = [
            messaging.Message(
                token=t.fcm_token,
                notification=notification,
                data=data,
                apns=apns,
            )
            for t in tokens
        ]

        response = messaging.send_each(messages)
        _prune_invalid_tokens(db, tokens, response)
        logger.info(
            "push: sent reason=%s workspace=%s success=%d failure=%d",
            reason, workspace_id, response.success_count, response.failure_count,
        )
    finally:
        db.close()


def _prune_invalid_tokens(db, tokens: list[DeviceToken], response) -> None:
    """Delete rows whose FCM token is dead (UNREGISTERED or INVALID_ARGUMENT)."""
    from firebase_admin import messaging as _fb_messaging

    invalid_ids: list[str] = []
    for token, result in zip(tokens, response.responses):
        if result.success:
            continue
        exc = result.exception
        if exc is None:
            continue
        code = getattr(exc, "code", "") or ""
        cause: Optional[Any] = getattr(exc, "cause", None)
        code_str = str(code).upper()
        # firebase-admin surfaces dead tokens via these:
        # - UnregisteredError (code="registration-token-not-registered")
        # - InvalidArgumentError on token shape
        is_dead = (
            isinstance(exc, getattr(_fb_messaging, "UnregisteredError", tuple()))
            or "UNREGISTERED" in code_str
            or "REGISTRATION-TOKEN-NOT-REGISTERED" in code_str
            or "INVALID-ARGUMENT" in code_str
            or "INVALID_ARGUMENT" in code_str
        )
        if is_dead:
            invalid_ids.append(token.id)

    if invalid_ids:
        db.query(DeviceToken).filter(DeviceToken.id.in_(invalid_ids)).delete(
            synchronize_session=False
        )
        db.commit()
        logger.info("push: pruned %d dead token(s)", len(invalid_ids))
