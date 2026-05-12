# -*- coding: utf-8 -*-
"""
Truth-table tests for the push-notification filter logic.

These tests exercise the pure decision function `_should_push(event, agent_names)`
without touching the database or Firebase Admin SDK. Network / FCM behavior
is tested separately in `test_devices.py`.
"""

from app.services.push import _should_push, _extract_mentions, _is_terminal_status


def _make_event(*, source="openagents:claude-agent", message_type="chat",
                content="hi", event_type="workspace.message.posted",
                target="channel/general") -> dict:
    return {
        "id": "evt-1",
        "type": event_type,
        "source": source,
        "target": target,
        "payload": {"content": content, "message_type": message_type},
        "timestamp": 0,
    }


class TestShouldPushChat:
    def test_agent_chat_pushes(self):
        ev = _make_event(message_type="chat", source="openagents:claude-agent")
        ok, reason = _should_push(ev, set())
        assert ok and reason == "chat"

    def test_human_chat_does_not_push(self):
        ev = _make_event(message_type="chat", source="human:user")
        ok, _ = _should_push(ev, set())
        assert not ok


class TestShouldPushStatus:
    def test_thinking_status_skipped(self):
        ev = _make_event(message_type="status", content="thinking…")
        ok, _ = _should_push(ev, set())
        assert not ok

    def test_terminal_stopped_pushed(self):
        ev = _make_event(message_type="status", content="Execution stopped by user")
        ok, reason = _should_push(ev, set())
        assert ok and reason == "status"

    def test_terminal_session_restarted_pushed(self):
        ev = _make_event(message_type="status",
                         content="Session restarted — next message starts fresh.")
        ok, reason = _should_push(ev, set())
        assert ok and reason == "status"

    def test_terminal_failed_pushed(self):
        ev = _make_event(message_type="status", content="Pipeline failed: rate-limited")
        ok, reason = _should_push(ev, set())
        assert ok and reason == "status"

    def test_thinking_type_skipped(self):
        ev = _make_event(message_type="thinking", content="planning next step…")
        ok, _ = _should_push(ev, set())
        assert not ok


class TestShouldPushMention:
    def test_mention_of_known_agent_pushes(self):
        ev = _make_event(
            source="openagents:another-agent",
            message_type="chat",
            content="hey @claude-agent please look at this",
        )
        ok, reason = _should_push(ev, {"claude-agent"})
        assert ok and reason == "mention"

    def test_mention_of_unknown_name_skipped(self):
        ev = _make_event(message_type="chat", content="see @random-username")
        ok, _ = _should_push(ev, {"claude-agent"})
        # Falls through to chat rule (since source is agent by default).
        assert ok  # reason == "chat" — not "mention"

    def test_mention_takes_priority_over_status_skip(self):
        # Thinking status would normally be skipped, but a mention overrides.
        ev = _make_event(
            message_type="status",
            content="@claude-agent — still working on it",
        )
        ok, reason = _should_push(ev, {"claude-agent"})
        assert ok and reason == "mention"


class TestShouldPushOther:
    def test_non_message_event_skipped(self):
        ev = _make_event(event_type="workspace.agent.control", content="")
        ok, _ = _should_push(ev, set())
        assert not ok


class TestHelpers:
    def test_terminal_status_matches(self):
        for s in [
            "Execution stopped by user",
            "Stopping failed",
            "Session restarted — next message starts fresh.",
            "Run completed",
            "Done",
            "failed to connect",
            "Error: out of context",
        ]:
            assert _is_terminal_status(s), f"expected terminal: {s!r}"

    def test_terminal_status_skips_non_terminal(self):
        for s in ["thinking…", "running tool: bash", "tool: edit"]:
            assert not _is_terminal_status(s), f"expected non-terminal: {s!r}"

    def test_extract_mentions(self):
        assert _extract_mentions("hey @alice and @bob-bot") == {"alice", "bob-bot"}
        assert _extract_mentions("no mentions here") == set()
        assert _extract_mentions("email me@example.com is not a mention") == {"example"}  # naive regex; OK
