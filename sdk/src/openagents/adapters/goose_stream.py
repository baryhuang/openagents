"""
Pure, line-oriented parser for Goose's ``goose run --output-format stream-json``
output, plus helpers for secret redaction and error classification.

This module is intentionally free of any I/O, asyncio, or subprocess code so it
can be unit-tested in isolation and kept behaviourally identical to the Node
port (``packages/agent-connector/src/adapters/goose-stream.js``).

Verified against block/goose v1.38.0. The CLI emits one JSON object per line
(NDJSON). The ``StreamEvent`` enum is ``#[serde(tag="type", rename_all="snake_case")]``:

    {"type":"message","message":{"role":"assistant"|"user","created":N,"content":[...]}}
    {"type":"notification","extension_id":"...","log":{"message":"..."}}     # or "progress"
    {"type":"error","error":"..."}
    {"type":"complete","total_tokens":N,"input_tokens":N,"output_tokens":N}

Message content items are ``#[serde(tag="type", rename_all="camelCase")]``:
``text`` {text}, ``thinking`` {thinking,signature}, ``redactedThinking`` {data},
``toolRequest`` {id, toolCall:{status:"success", value:{name, arguments}}|{status:"error", error}},
``toolResponse`` {id, toolResult:{status, ...}}, plus image / systemNotification / etc.

Important: an agent/provider error during a run is emitted as a ``error`` event
but ``goose run`` still exits 0. Callers MUST treat ``had_error`` (or any event
of kind ``error``) as a failure regardless of the process exit code.
"""

from __future__ import annotations

import json
import re
from typing import Optional

# Hard cap on a single un-terminated line we will buffer before giving up on it.
# Guards against a pathological/garbage stream pinning memory (req: bounded output).
_MAX_LINE_BYTES = 8 * 1024 * 1024
# Cap on how much of a tool-argument preview we surface as workspace status.
# Keeps large tool inputs from flooding the channel and avoids dumping full
# file bodies / arguments into chat.
_TOOL_PREVIEW_LIMIT = 160


def redact_secrets(text: Optional[str], secrets: Optional[list] = None) -> str:
    """Return ``text`` with credentials masked.

    - Masks explicit ``secrets`` values (e.g. the configured provider API key)
      by exact substring match — the most reliable redaction.
    - Masks common ``key=value`` / ``Bearer <token>`` / ``Authorization: ...``
      shapes heuristically so leaked credentials in arbitrary CLI output don't
      reach logs or the workspace.
    """
    if not text:
        return ""
    out = str(text)
    for secret in secrets or []:
        if secret and isinstance(secret, str) and len(secret) >= 4:
            out = out.replace(secret, "***")
    # api_key=..., token: ..., authorization ..., bearer ..., sk-...
    out = re.sub(
        r"(?i)\b(api[_-]?key|secret|token|authorization|auth|bearer)\b\s*[:=]?\s*"
        r"['\"]?([A-Za-z0-9._\-]{8,})['\"]?",
        lambda m: f"{m.group(1)}=***",
        out,
    )
    out = re.sub(r"\bsk-[A-Za-z0-9._\-]{6,}\b", "sk-***", out)
    return out


def classify_goose_error(text: Optional[str]) -> Optional[str]:
    """Map a raw Goose stderr/error string to a readable, actionable message.

    Returns ``None`` when ``text`` is empty. Never returns the raw secret —
    callers should still pass the result through :func:`redact_secrets`.
    """
    if not text or not str(text).strip():
        return None
    raw = str(text).strip()
    low = raw.lower()

    def has(*needles: str) -> bool:
        return any(n in low for n in needles)

    if has("401", "403", "unauthorized", "invalid api key", "invalid_api_key",
           "authentication", "incorrect api key", "no api key", "missing api key"):
        return ("Goose authentication failed. Check this agent's provider API key "
                "(GOOSE_PROVIDER__API_KEY) and host — the key may be missing, invalid, or expired.")
    if has("429", "rate limit", "rate_limit", "too many requests", "quota", "overloaded"):
        return ("Goose hit the provider's rate limit or quota. Wait and retry, or use a "
                "different key/provider.")
    if has("model", "no such model", "unknown model", "model not found", "does not exist"):
        if has("model"):
            return ("Goose could not use the configured model. Check GOOSE_MODEL is valid for "
                    "the selected GOOSE_PROVIDER.")
    if has("provider", "unknown provider", "no provider", "provider not", "configure"):
        return ("Goose has no usable provider configured. Set GOOSE_PROVIDER (and a key/host), "
                "or run `goose configure` once outside OpenAgents.")
    if has("permission denied", "not permitted", "tool execution denied", "denied by"):
        return ("A Goose tool call was denied. The workspace runs Goose headless with "
                "GOOSE_MODE=auto; check the project directory permissions.")
    if has("extension", "mcp", "failed to start", "failed to load"):
        return ("A Goose extension failed to start. The workspace only enables the built-in "
                "developer extension by default; check your Goose extension config.")
    if has("connection", "network", "timed out", "timeout", "dns", "could not resolve",
           "connection refused", "unreachable"):
        return ("Goose could not reach the provider endpoint. Check the network and the "
                "GOOSE_PROVIDER__HOST URL.")
    if has("no such file", "not a directory", "permission denied (os error 13)"):
        return ("Goose hit a filesystem error. Check the agent's project directory exists and "
                "is writable.")
    return None


class GooseStreamParser:
    """Incremental NDJSON parser that turns Goose stream-json into semantic events.

    Feed raw stdout chunks (``feed``) and flush at EOF (``finish``). Each call
    returns a list of event dicts with a ``kind`` field:

    - ``{"kind": "progress", "text": str}``   — intermediate assistant text (interim narration → status)
    - ``{"kind": "thinking", "text": str}``   — genuine model thinking content (ThinkingContent)
    - ``{"kind": "tool", "name": str, "summary": str}``  — a tool invocation (progress)
    - ``{"kind": "tool_result", "ok": bool}`` — a tool completed
    - ``{"kind": "notification", "text": str}`` — extension progress note
    - ``{"kind": "error", "message": str}``   — Goose reported an error (FAILURE)
    - ``{"kind": "final", "text": str}``      — the final answer (emitted at most once)
    - ``{"kind": "complete", "tokens": int|None}`` — run finished

    Final-answer semantics: the *last* assistant text message is the answer
    (emitted once on ``complete``/EOF). Any earlier assistant text is surfaced
    as ``thinking`` so nothing is sent to chat twice.
    """

    def __init__(self) -> None:
        self._buf = ""
        self._pending_final: Optional[str] = None
        self._final_text: Optional[str] = None
        self._final_emitted = False
        self.had_error = False
        self.error_message: Optional[str] = None

    # -- public API ----------------------------------------------------------

    def feed(self, chunk: str) -> list:
        events: list = []
        if not chunk:
            return events
        self._buf += chunk
        # Defensive: a single line that never terminates must not grow unbounded.
        if len(self._buf) > _MAX_LINE_BYTES and "\n" not in self._buf:
            self._buf = self._buf[-_MAX_LINE_BYTES:]
        while True:
            idx = self._buf.find("\n")
            if idx < 0:
                break
            line = self._buf[:idx]
            self._buf = self._buf[idx + 1:]
            self._handle_line(line, events)
        return events

    def finish(self) -> list:
        events: list = []
        leftover = self._buf
        self._buf = ""
        if leftover.strip():
            self._handle_line(leftover, events)
        # Promote any pending assistant text to the final answer if Goose ended
        # without an explicit `complete` line (e.g. it crashed mid-stream).
        if not self._final_emitted and not self.had_error:
            self._emit_final(events)
        return events

    @property
    def final_text(self) -> Optional[str]:
        return self._final_text

    # -- internals -----------------------------------------------------------

    def _emit_final(self, events: list) -> None:
        if self._pending_final:
            self._final_text = self._pending_final
            self._pending_final = None
        if not self._final_emitted and self._final_text:
            events.append({"kind": "final", "text": self._final_text})
            self._final_emitted = True

    def _handle_line(self, line: str, events: list) -> None:
        line = line.strip()
        if not line:
            return
        try:
            ev = json.loads(line)
        except Exception:
            # Half-lines / non-JSON noise: ignore defensively, never crash.
            return
        if not isinstance(ev, dict):
            return
        etype = ev.get("type")
        if etype == "message":
            msg = ev.get("message")
            if isinstance(msg, dict):
                self._handle_message(msg, events)
        elif etype == "error":
            msg = ev.get("error") or "Goose reported an error"
            self.had_error = True
            self.error_message = str(msg)
            events.append({"kind": "error", "message": str(msg)})
        elif etype == "complete":
            if not self.had_error:
                self._emit_final(events)
            events.append({"kind": "complete", "tokens": ev.get("total_tokens")})
        elif etype == "notification":
            text = self._notification_text(ev)
            if text:
                events.append({"kind": "notification", "text": text})
        # Unknown event types are ignored on purpose (forward-compatible).

    @staticmethod
    def _notification_text(ev: dict) -> Optional[str]:
        progress = ev.get("progress")
        if isinstance(progress, dict):
            msg = progress.get("message")
            if msg:
                return str(msg)
        log = ev.get("log")
        if isinstance(log, dict):
            msg = log.get("message")
            if msg:
                return str(msg)
        return None

    def _handle_message(self, message: dict, events: list) -> None:
        role = str(message.get("role") or "").lower()
        content = message.get("content")
        if not isinstance(content, list):
            return
        texts: list = []
        for item in content:
            if not isinstance(item, dict):
                continue
            itype = item.get("type")
            if itype == "text":
                txt = item.get("text")
                if txt:
                    texts.append(str(txt))
            elif itype == "thinking":
                th = item.get("thinking")
                if th:
                    events.append({"kind": "thinking", "text": str(th)})
            elif itype == "toolRequest":
                events.append(self._tool_event(item))
            elif itype == "toolResponse":
                events.append(self._tool_result_event(item))
            # image / redactedThinking / systemNotification / etc → ignore.
        if role == "assistant" and texts:
            joined = "\n".join(t for t in texts if t).strip()
            if joined:
                # The previous candidate is now known to be intermediate. It is
                # assistant *output* (interim narration), not model-internal
                # reasoning, so surface it as ``progress`` (→ workspace status),
                # NOT ``thinking`` — only genuine ``thinking`` content items above
                # are emitted as ``thinking``.
                if self._pending_final:
                    events.append({"kind": "progress", "text": self._pending_final})
                self._pending_final = joined

    @classmethod
    def _tool_event(cls, item: dict) -> dict:
        tool_call = item.get("toolCall")
        if not isinstance(tool_call, dict):
            return {"kind": "tool", "name": "tool", "summary": ""}
        status = tool_call.get("status")
        if status == "error":
            return {"kind": "tool", "name": "tool", "summary": "(tool call could not be parsed)"}
        value = tool_call.get("value")
        if not isinstance(value, dict):
            return {"kind": "tool", "name": "tool", "summary": ""}
        name = str(value.get("name") or "tool")
        summary = cls._summarize_args(name, value.get("arguments"))
        return {"kind": "tool", "name": name, "summary": summary}

    @staticmethod
    def _tool_result_event(item: dict) -> dict:
        tr = item.get("toolResult")
        ok = isinstance(tr, dict) and tr.get("status") == "success"
        return {"kind": "tool_result", "ok": bool(ok)}

    @staticmethod
    def _summarize_args(name: str, args) -> str:
        """Short, single-line preview of a tool's most salient argument.

        Never dumps the full argument object (it can contain large file bodies).
        """
        if not isinstance(args, dict):
            return ""
        for key in ("command", "path", "file_path", "file", "pattern", "query", "uri", "url"):
            val = args.get(key)
            if isinstance(val, str) and val:
                preview = " ".join(val.split())
                if len(preview) > _TOOL_PREVIEW_LIMIT:
                    preview = preview[:_TOOL_PREVIEW_LIMIT] + "…"
                return preview
        # Fall back to the list of argument keys (names only, no values).
        keys = [k for k in args.keys() if isinstance(k, str)]
        return ", ".join(keys[:6])
