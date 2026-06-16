"""Unit tests for the Goose stream-json parser, redaction, and error
classification (``openagents.adapters.goose_stream``).

These are pure-function tests — no subprocess, no network. They pin the event
schema verified against block/goose v1.38.0 and must stay behaviourally
identical to the Node port (packages/agent-connector/test/goose.test.js).

Run:
    pytest tests/agents/test_goose_stream.py -v
"""

import json

import pytest

from openagents.adapters.goose_stream import (
    GooseStreamParser,
    classify_goose_error,
    redact_secrets,
)


def _msg(role, content):
    return json.dumps({"type": "message", "message": {"role": role, "created": 1, "content": content}})


def _feed_all(parser, *lines):
    events = []
    for line in lines:
        events.extend(parser.feed(line + "\n"))
    events.extend(parser.finish())
    return events


def _kinds(events):
    return [e["kind"] for e in events]


class TestNormalStream:
    def test_simple_assistant_final(self):
        p = GooseStreamParser()
        events = _feed_all(p, _msg("assistant", [{"type": "text", "text": "Hello world"}]),
                           json.dumps({"type": "complete", "total_tokens": 10}))
        assert {"kind": "final", "text": "Hello world"} in events
        assert p.final_text == "Hello world"
        assert not p.had_error
        # final emitted exactly once
        assert _kinds(events).count("final") == 1

    def test_tool_call_and_result(self):
        p = GooseStreamParser()
        tool_req = {"type": "toolRequest", "id": "t1", "toolCall": {
            "status": "success", "value": {"name": "developer__shell",
                                           "arguments": {"command": "ls -la"}}}}
        tool_resp = {"type": "toolResponse", "id": "t1",
                     "toolResult": {"status": "success", "value": []}}
        events = _feed_all(
            p,
            _msg("assistant", [tool_req]),
            _msg("user", [tool_resp]),
            _msg("assistant", [{"type": "text", "text": "done"}]),
            json.dumps({"type": "complete", "total_tokens": 5}),
        )
        tool_events = [e for e in events if e["kind"] == "tool"]
        assert tool_events and tool_events[0]["name"] == "developer__shell"
        assert tool_events[0]["summary"] == "ls -la"
        assert any(e["kind"] == "tool_result" and e["ok"] for e in events)
        assert p.final_text == "done"

    def test_thinking_event(self):
        p = GooseStreamParser()
        events = _feed_all(p, _msg("assistant", [
            {"type": "thinking", "thinking": "reasoning...", "signature": "x"},
            {"type": "text", "text": "answer"},
        ]), json.dumps({"type": "complete"}))
        assert any(e["kind"] == "thinking" and e["text"] == "reasoning..." for e in events)
        assert p.final_text == "answer"

    def test_intermediate_assistant_text_is_progress_not_thinking(self):
        # Two assistant text messages: the earlier one is intermediate. It is
        # assistant *output*, so it must be surfaced as ``progress`` (→ status),
        # NOT fabricated as model-internal ``thinking``. The last is the final
        # answer (sent once).
        p = GooseStreamParser()
        events = _feed_all(
            p,
            _msg("assistant", [{"type": "text", "text": "step 1 reasoning"}]),
            _msg("assistant", [{"type": "text", "text": "final answer"}]),
            json.dumps({"type": "complete"}),
        )
        progress = [e["text"] for e in events if e["kind"] == "progress"]
        assert "step 1 reasoning" in progress
        assert not any(e["kind"] == "thinking" for e in events)  # never mislabeled
        assert p.final_text == "final answer"
        assert _kinds(events).count("final") == 1

    def test_genuine_thinking_vs_intermediate_progress(self):
        # A real `thinking` content item is `thinking`; interim assistant text is
        # `progress`. The two are kept distinct.
        p = GooseStreamParser()
        events = _feed_all(
            p,
            _msg("assistant", [{"type": "text", "text": "interim narration"}]),
            _msg("assistant", [
                {"type": "thinking", "thinking": "real chain of thought", "signature": "s"},
                {"type": "text", "text": "answer"},
            ]),
            json.dumps({"type": "complete"}),
        )
        assert any(e["kind"] == "progress" and "interim" in e["text"] for e in events)
        assert any(e["kind"] == "thinking" and "real chain" in e["text"] for e in events)
        assert p.final_text == "answer"


class TestChunkingAndRobustness:
    def test_split_json_across_chunks(self):
        p = GooseStreamParser()
        line = _msg("assistant", [{"type": "text", "text": "chunked"}])
        events = []
        events += p.feed(line[:15])
        events += p.feed(line[15:] + "\n")
        events += p.feed(json.dumps({"type": "complete"}) + "\n")
        events += p.finish()
        assert p.final_text == "chunked"

    def test_multiple_events_one_chunk(self):
        p = GooseStreamParser()
        blob = (_msg("assistant", [{"type": "text", "text": "a"}]) + "\n"
                + _msg("assistant", [{"type": "text", "text": "b"}]) + "\n"
                + json.dumps({"type": "complete"}) + "\n")
        events = p.feed(blob) + p.finish()
        assert p.final_text == "b"

    def test_blank_and_invalid_lines_ignored(self):
        p = GooseStreamParser()
        events = []
        events += p.feed("\n")
        events += p.feed("not json at all\n")
        events += p.feed("{ broken json\n")
        events += p.feed(_msg("assistant", [{"type": "text", "text": "ok"}]) + "\n")
        events += p.finish()
        assert p.final_text == "ok"
        assert not p.had_error  # invalid lines must never set the error flag

    def test_unknown_event_type_ignored(self):
        p = GooseStreamParser()
        events = []
        events += p.feed(json.dumps({"type": "brand_new_future_event", "x": 1}) + "\n")
        events += p.feed(_msg("assistant", [{"type": "text", "text": "ok"}]) + "\n")
        events += p.finish()
        assert p.final_text == "ok"
        assert not p.had_error

    def test_unknown_content_item_ignored(self):
        p = GooseStreamParser()
        events = _feed_all(p, _msg("assistant", [
            {"type": "image", "data": "..."},
            {"type": "redactedThinking", "data": "..."},
            {"type": "text", "text": "kept"},
        ]), json.dumps({"type": "complete"}))
        assert p.final_text == "kept"

    def test_finish_without_complete_emits_final(self):
        # Goose crashed mid-stream (no `complete`): still surface the last answer.
        p = GooseStreamParser()
        events = _feed_all(p, _msg("assistant", [{"type": "text", "text": "partial"}]))
        assert {"kind": "final", "text": "partial"} in events

    def test_large_output_does_not_blow_up(self):
        p = GooseStreamParser()
        big = "x" * 200000
        events = _feed_all(p, _msg("assistant", [{"type": "text", "text": big}]),
                           json.dumps({"type": "complete"}))
        assert p.final_text == big


class TestErrorEvents:
    def test_error_event_sets_failure(self):
        p = GooseStreamParser()
        events = []
        events += p.feed(json.dumps({"type": "error", "error": "boom"}) + "\n")
        events += p.feed(json.dumps({"type": "complete"}) + "\n")
        events += p.finish()
        assert p.had_error
        assert p.error_message == "boom"
        assert any(e["kind"] == "error" for e in events)

    def test_error_suppresses_final(self):
        # Even if some assistant text arrived, an error must not be reported as
        # a successful final answer.
        p = GooseStreamParser()
        events = []
        events += p.feed(_msg("assistant", [{"type": "text", "text": "partial"}]) + "\n")
        events += p.feed(json.dumps({"type": "error", "error": "401 Unauthorized"}) + "\n")
        events += p.feed(json.dumps({"type": "complete"}) + "\n")
        events += p.finish()
        assert p.had_error
        assert _kinds(events).count("final") == 0

    def test_notification_progress_surfaced(self):
        p = GooseStreamParser()
        events = _feed_all(p, json.dumps({
            "type": "notification", "extension_id": "developer",
            "progress": {"progress": 0.5, "total": 1.0, "message": "halfway"}}))
        assert any(e["kind"] == "notification" and e["text"] == "halfway" for e in events)


# Canonical v1.37.0 stream-json sequence. Each line is exactly what
# `goose run --output-format stream-json` emits, derived from the verified serde
# definitions in block/goose v1.37.0:
#   - StreamEvent: crates/goose-cli/src/session/mod.rs  (#[serde(tag="type", rename_all="snake_case")])
#   - MessageContent: crates/goose/src/conversation/message.rs (#[serde(tag="type", rename_all="camelCase")])
#   - ToolRequest.toolCall / ToolResponse.toolResult: crates/goose/src/conversation/tool_result_serde.rs
#     ({"status":"success","value":…} | {"status":"error","error":…})
STABLE_V137_STREAM = [
    '{"type":"message","message":{"role":"assistant","created":1718000000,"content":'
    '[{"type":"text","text":"I\'ll check the files."},'
    '{"type":"toolRequest","id":"req_1","toolCall":{"status":"success","value":'
    '{"name":"developer__shell","arguments":{"command":"ls"}}}}]}}',
    '{"type":"message","message":{"role":"user","created":1718000001,"content":'
    '[{"type":"toolResponse","id":"req_1","toolResult":{"status":"success","value":'
    '[{"type":"text","text":"README.md\\nsrc"}]}}]}}',
    '{"type":"message","message":{"role":"assistant","created":1718000002,"content":'
    '[{"type":"text","text":"There are 2 entries: README.md and src."}]}}',
    '{"type":"complete","total_tokens":1234,"input_tokens":1000,"output_tokens":234}',
]


class TestStableV137Fixture:
    def test_full_sequence(self):
        p = GooseStreamParser()
        events = _feed_all(p, *STABLE_V137_STREAM)
        # interim narration → progress (not thinking)
        assert any(e["kind"] == "progress" and "check the files" in e["text"] for e in events)
        assert not any(e["kind"] == "thinking" for e in events)
        # tool call mapped with a concise preview
        tool = next(e for e in events if e["kind"] == "tool")
        assert tool["name"] == "developer__shell" and tool["summary"] == "ls"
        assert any(e["kind"] == "tool_result" and e["ok"] for e in events)
        # final answer once, complete with tokens
        assert p.final_text == "There are 2 entries: README.md and src."
        assert _kinds(events).count("final") == 1
        assert any(e["kind"] == "complete" and e["tokens"] == 1234 for e in events)
        assert not p.had_error


class TestClassifyError:
    @pytest.mark.parametrize("text,needle", [
        ("Error: 401 Unauthorized invalid api key", "authentication"),
        ("request error: 429 too many requests", "rate limit"),
        ("model gpt-x does not exist", "model"),
        ("no provider configured, run goose configure", "provider"),
        ("tool execution denied: permission denied", "denied"),
        ("extension failed to start: mcp server crashed", "extension"),
        ("connection refused while reaching host", "reach the provider"),
        ("rate_limit exceeded", "rate limit"),
    ])
    def test_classification(self, text, needle):
        msg = classify_goose_error(text)
        assert msg is not None
        assert needle.lower() in msg.lower()

    def test_empty_returns_none(self):
        assert classify_goose_error("") is None
        assert classify_goose_error(None) is None


class TestRedaction:
    def test_explicit_secret_masked(self):
        out = redact_secrets("the key is supersecretvalue123 ok", ["supersecretvalue123"])
        assert "supersecretvalue123" not in out
        assert "***" in out

    def test_bearer_and_apikey_masked(self):
        out = redact_secrets("Authorization: Bearer sk-abc123def456ghi api_key=zzzttoppp999")
        assert "sk-abc123def456ghi" not in out
        assert "zzzttoppp999" not in out

    def test_short_strings_not_masked(self):
        # Don't mask trivially short values to avoid garbling normal text.
        out = redact_secrets("hello world", ["ab"])
        assert out == "hello world"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
