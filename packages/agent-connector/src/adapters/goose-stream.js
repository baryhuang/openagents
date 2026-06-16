/**
 * Pure, line-oriented parser for Goose's `goose run --output-format stream-json`
 * output, plus helpers for secret redaction and error classification.
 *
 * No I/O / process code lives here so it can be unit-tested in isolation and
 * kept behaviourally identical to the Python port
 * (sdk/src/openagents/adapters/goose_stream.py).
 *
 * Verified against block/goose v1.38.0. The CLI emits one JSON object per line
 * (NDJSON). StreamEvent is `#[serde(tag="type", rename_all="snake_case")]`:
 *
 *   {"type":"message","message":{"role":"assistant"|"user","created":N,"content":[...]}}
 *   {"type":"notification","extension_id":"...","log":{"message":"..."}}   // or "progress"
 *   {"type":"error","error":"..."}
 *   {"type":"complete","total_tokens":N,"input_tokens":N,"output_tokens":N}
 *
 * Content items are `#[serde(tag="type", rename_all="camelCase")]`:
 *   text {text}, thinking {thinking,signature}, redactedThinking {data},
 *   toolRequest {id, toolCall:{status:"success", value:{name, arguments}}|{status:"error", error}},
 *   toolResponse {id, toolResult:{status, ...}}, image / systemNotification / ...
 *
 * Important: an agent/provider error during a run is emitted as an `error`
 * event but `goose run` still exits 0. Callers MUST treat `hadError` (or any
 * event of kind `error`) as a failure regardless of the process exit code.
 */

'use strict';

// Hard cap on a single un-terminated line we will buffer before giving up.
const MAX_LINE_BYTES = 8 * 1024 * 1024;
// Cap on how much of a tool-argument preview we surface as workspace status.
const TOOL_PREVIEW_LIMIT = 160;

/**
 * Mask credentials in arbitrary text.
 * @param {string} text
 * @param {string[]} [secrets] exact secret values to mask (e.g. the API key)
 * @returns {string}
 */
function redactSecrets(text, secrets) {
  if (!text) return '';
  let out = String(text);
  for (const secret of secrets || []) {
    if (secret && typeof secret === 'string' && secret.length >= 4) {
      out = out.split(secret).join('***');
    }
  }
  out = out.replace(
    /\b(api[_-]?key|secret|token|authorization|auth|bearer)\b\s*[:=]?\s*['"]?([A-Za-z0-9._-]{8,})['"]?/gi,
    (_m, label) => `${label}=***`,
  );
  out = out.replace(/\bsk-[A-Za-z0-9._-]{6,}\b/g, 'sk-***');
  return out;
}

/**
 * Map a raw Goose stderr/error string to a readable, actionable message, or
 * null when there's nothing useful. Callers should still pass the result
 * through redactSecrets.
 * @param {string} text
 * @returns {string|null}
 */
function classifyGooseError(text) {
  if (!text || !String(text).trim()) return null;
  const low = String(text).toLowerCase();
  const has = (...needles) => needles.some((n) => low.includes(n));

  if (has('401', '403', 'unauthorized', 'invalid api key', 'invalid_api_key',
    'authentication', 'incorrect api key', 'no api key', 'missing api key')) {
    return "Goose authentication failed. Check this agent's provider API key "
      + '(GOOSE_PROVIDER__API_KEY) and host — the key may be missing, invalid, or expired.';
  }
  if (has('429', 'rate limit', 'rate_limit', 'too many requests', 'quota', 'overloaded')) {
    return "Goose hit the provider's rate limit or quota. Wait and retry, or use a "
      + 'different key/provider.';
  }
  if (has('no such model', 'unknown model', 'model not found', 'does not exist') || has('model')) {
    if (has('model')) {
      return 'Goose could not use the configured model. Check GOOSE_MODEL is valid for '
        + 'the selected GOOSE_PROVIDER.';
    }
  }
  if (has('provider', 'unknown provider', 'no provider', 'provider not', 'configure')) {
    return 'Goose has no usable provider configured. Set GOOSE_PROVIDER (and a key/host), '
      + 'or run `goose configure` once outside OpenAgents.';
  }
  if (has('permission denied', 'not permitted', 'tool execution denied', 'denied by')) {
    return 'A Goose tool call was denied. The workspace runs Goose headless with '
      + 'GOOSE_MODE=auto; check the project directory permissions.';
  }
  if (has('extension', 'mcp', 'failed to start', 'failed to load')) {
    return 'A Goose extension failed to start. The workspace only enables the built-in '
      + 'developer extension by default; check your Goose extension config.';
  }
  if (has('connection', 'network', 'timed out', 'timeout', 'dns', 'could not resolve',
    'connection refused', 'unreachable')) {
    return 'Goose could not reach the provider endpoint. Check the network and the '
      + 'GOOSE_PROVIDER__HOST URL.';
  }
  if (has('no such file', 'not a directory', 'os error 13')) {
    return 'Goose hit a filesystem error. Check the agent\'s project directory exists and '
      + 'is writable.';
  }
  return null;
}

class GooseStreamParser {
  constructor() {
    this._buf = '';
    this._pendingFinal = null;
    this._finalText = null;
    this._finalEmitted = false;
    this.hadError = false;
    this.errorMessage = null;
  }

  get finalText() {
    return this._finalText;
  }

  /**
   * Feed a raw stdout chunk; returns semantic events parsed from completed lines.
   * @param {string} chunk
   * @returns {Array<object>}
   */
  feed(chunk) {
    const events = [];
    if (!chunk) return events;
    this._buf += chunk;
    if (this._buf.length > MAX_LINE_BYTES && !this._buf.includes('\n')) {
      this._buf = this._buf.slice(-MAX_LINE_BYTES);
    }
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      this._handleLine(line, events);
    }
    return events;
  }

  /** Flush at EOF; emits the final answer if the stream ended without `complete`. */
  finish() {
    const events = [];
    const leftover = this._buf;
    this._buf = '';
    if (leftover.trim()) this._handleLine(leftover, events);
    if (!this._finalEmitted && !this.hadError) this._emitFinal(events);
    return events;
  }

  _emitFinal(events) {
    if (this._pendingFinal) {
      this._finalText = this._pendingFinal;
      this._pendingFinal = null;
    }
    if (!this._finalEmitted && this._finalText) {
      events.push({ kind: 'final', text: this._finalText });
      this._finalEmitted = true;
    }
  }

  _handleLine(line, events) {
    line = line.trim();
    if (!line) return;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return; // half-line / non-JSON noise: ignore defensively
    }
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return;
    const etype = ev.type;
    if (etype === 'message') {
      if (ev.message && typeof ev.message === 'object') this._handleMessage(ev.message, events);
    } else if (etype === 'error') {
      const msg = ev.error || 'Goose reported an error';
      this.hadError = true;
      this.errorMessage = String(msg);
      events.push({ kind: 'error', message: String(msg) });
    } else if (etype === 'complete') {
      if (!this.hadError) this._emitFinal(events);
      events.push({ kind: 'complete', tokens: ev.total_tokens ?? null });
    } else if (etype === 'notification') {
      const text = GooseStreamParser._notificationText(ev);
      if (text) events.push({ kind: 'notification', text });
    }
    // Unknown event types are ignored on purpose (forward-compatible).
  }

  static _notificationText(ev) {
    if (ev.progress && typeof ev.progress === 'object' && ev.progress.message) {
      return String(ev.progress.message);
    }
    if (ev.log && typeof ev.log === 'object' && ev.log.message) {
      return String(ev.log.message);
    }
    return null;
  }

  _handleMessage(message, events) {
    const role = String(message.role || '').toLowerCase();
    const content = message.content;
    if (!Array.isArray(content)) return;
    const texts = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const itype = item.type;
      if (itype === 'text') {
        if (item.text) texts.push(String(item.text));
      } else if (itype === 'thinking') {
        if (item.thinking) events.push({ kind: 'thinking', text: String(item.thinking) });
      } else if (itype === 'toolRequest') {
        events.push(GooseStreamParser._toolEvent(item));
      } else if (itype === 'toolResponse') {
        events.push(GooseStreamParser._toolResultEvent(item));
      }
      // image / redactedThinking / systemNotification / etc → ignore
    }
    if (role === 'assistant' && texts.length) {
      const joined = texts.filter(Boolean).join('\n').trim();
      if (joined) {
        // Intermediate assistant text is interim narration (assistant output),
        // not model-internal reasoning — surface it as `progress` (→ status),
        // NOT `thinking`. Only genuine `thinking` content items emit `thinking`.
        if (this._pendingFinal) events.push({ kind: 'progress', text: this._pendingFinal });
        this._pendingFinal = joined;
      }
    }
  }

  static _toolEvent(item) {
    const toolCall = item.toolCall;
    if (!toolCall || typeof toolCall !== 'object') {
      return { kind: 'tool', name: 'tool', summary: '' };
    }
    if (toolCall.status === 'error') {
      return { kind: 'tool', name: 'tool', summary: '(tool call could not be parsed)' };
    }
    const value = toolCall.value;
    if (!value || typeof value !== 'object') {
      return { kind: 'tool', name: 'tool', summary: '' };
    }
    const name = String(value.name || 'tool');
    return { kind: 'tool', name, summary: GooseStreamParser._summarizeArgs(name, value.arguments) };
  }

  static _toolResultEvent(item) {
    const tr = item.toolResult;
    const ok = !!(tr && typeof tr === 'object' && tr.status === 'success');
    return { kind: 'tool_result', ok };
  }

  static _summarizeArgs(_name, args) {
    if (!args || typeof args !== 'object') return '';
    for (const key of ['command', 'path', 'file_path', 'file', 'pattern', 'query', 'uri', 'url']) {
      const val = args[key];
      if (typeof val === 'string' && val) {
        let preview = val.split(/\s+/).join(' ');
        if (preview.length > TOOL_PREVIEW_LIMIT) preview = preview.slice(0, TOOL_PREVIEW_LIMIT) + '…';
        return preview;
      }
    }
    return Object.keys(args).filter((k) => typeof k === 'string').slice(0, 6).join(', ');
  }
}

module.exports = { GooseStreamParser, redactSecrets, classifyGooseError };
