/**
 * Pure, side-effect-free helpers for the Cline CLI adapter.
 *
 * Everything here is I/O-free and deterministic so it can be unit-tested
 * without spawning the `cline` binary or touching the network: the NDJSON
 * stream parser, the event interpreter, secret redaction, error/auth/version
 * classification, the (shell-safe) argument builder, and the session-id
 * correlation used for `--id` resume.
 *
 * Verified against Cline CLI v3.0.26 (`cline --json`). The `--json` stream is
 * NDJSON on stdout where each line is an envelope:
 *   {ts, type:"hook_event", hookEventName, agentId, taskId, parentAgentId}
 *   {ts, type:"run_start", providerId, modelId, catalog, thinking, mode}   (verbose)
 *   {ts, type:"agent_event", event:{...}}     <- the model's activity
 *   {ts, type:"team_event",  event:{...}}     <- only when teams/spawn enabled
 *   {ts, type:"run_result", finishReason, iterations, usage, durationMs, text, model}
 * and stderr carries {ts, type:"error", message} on fatal errors.
 *
 * The inner agent_event `event.type` is one of nine variants; text, reasoning
 * and tool activity are multiplexed through content_start/content_update/
 * content_end keyed by `contentType` ("text" | "reasoning" | "tool").
 */

'use strict';

// Minimum Cline CLI version whose headless `--json` / `-c` / `--id` interface
// matches what this adapter drives. Cline's CLI changed its surface across
// majors (v1 preview → v2 → v3); the v3 line is what we target.
//
// Policy is a HARD minimum: a CONFIRMED-older version (parseable, < 3.0.0) is
// incompatible and the agent must not start. Only an UNDETERMINED version
// (output unparseable, or `cline --version` failed) is treated leniently as
// "unknown" — we proceed rather than lock users out on a future `--version`
// format change — but it is never reported as compatible.
const MIN_CLINE_VERSION = '3.0.0';

// ---------------------------------------------------------------------------
// Version handling
// ---------------------------------------------------------------------------

/**
 * Pull a dotted version (e.g. "3.0.26") out of `cline --version` output.
 * Returns null when nothing version-like is present.
 */
function parseClineVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)(?:[-.][0-9A-Za-z.]+)?/);
  return m ? m[0] : null;
}

/** Compare two dotted versions. Returns -1, 0, or 1. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Classify an installed Cline version against MIN_CLINE_VERSION.
 * @returns {{version: string|null, supported: boolean|null}}
 *   supported === true  → meets the minimum (>= 3.0.0) → may start
 *   supported === false → CONFIRMED too old → incompatible, must NOT start
 *   supported === null  → version undetermined (unparseable) → unknown, proceed
 *                         leniently but never claim compatible
 */
function classifyClineVersion(rawVersion) {
  const version = parseClineVersion(rawVersion);
  if (!version) return { version: null, supported: null };
  return { version, supported: compareVersions(version, MIN_CLINE_VERSION) >= 0 };
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

// Redaction is applied to anything that could reach a log line: stderr text,
// error messages, and the spawn argv we echo for debugging. We never log the
// user's prompt or raw env, but defense-in-depth keeps key material out of the
// daemon log even if an upstream message echoes it back.
const SECRET_PATTERNS = [
  // Provider API keys: sk-..., sk-ant-..., sk-or-..., etc.
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  // OpenRouter / generic long opaque tokens prefixed with a vendor tag
  /\b(?:or|rk|gsk|ghp|gho|ghu|ghs|github_pat)[-_][A-Za-z0-9._-]{12,}\b/g,
  // Bearer / Authorization header values
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // AWS access key ids
  /\bAKIA[0-9A-Z]{16}\b/g,
];

// Sensitive keys we scrub when serializing an arbitrary object (e.g. a tool
// input) for a preview/log line.
const SENSITIVE_KEY_RE = /(api[_-]?key|secret|token|password|passwd|authorization|cookie|credential)/i;

/** Redact obvious secret material from a free-text string. */
function redactSecrets(text) {
  if (text == null) return text;
  let out = String(text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, '«redacted»');
  return out;
}

/**
 * Redact an arbitrary value for previews: any object key matching
 * SENSITIVE_KEY_RE has its value masked, and remaining strings are run through
 * redactSecrets. Returns a JSON-safe clone (never mutates the input).
 */
function redactValue(value, depth = 0) {
  if (depth > 6) return '…';
  if (value == null) return value;
  if (typeof value === 'string') return redactSecrets(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '«redacted»' : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Map a raw Cline error string to a coarse category plus a user-facing message.
 * Frontends should show `userMessage`; the raw (redacted) text goes to logs.
 *
 * @returns {{kind: string, userMessage: string}}
 *   kind ∈ auth | provider | model | rate_limit | network | config | timeout | unknown
 */
function classifyClineError(rawMessage) {
  const msg = redactSecrets(String(rawMessage || '').trim());
  const low = msg.toLowerCase();

  if (/unauthorized|authenticat|invalid.*(api[ _-]?key|token|credential)|\b401\b|\b403\b|re-authenticate|not signed in|no api key|api key (is )?(missing|required|not)/i.test(low)) {
    return {
      kind: 'auth',
      userMessage:
        'Cline is not authenticated. Configure an API key for this agent in the launcher, ' +
        'or run `cline auth` to sign in. (' + truncate(msg, 160) + ')',
    };
  }
  if (/rate.?limit|too many requests|\b429\b|quota|overloaded/i.test(low)) {
    return {
      kind: 'rate_limit',
      userMessage: 'The provider is rate-limiting or over quota. Please retry shortly. (' + truncate(msg, 160) + ')',
    };
  }
  if (/\bmodel\b.*(not found|unavailable|invalid|does not exist|unknown)|no such model|unsupported model/i.test(low)) {
    return {
      kind: 'model',
      userMessage: 'The configured model is unavailable. Pick a valid model for this provider. (' + truncate(msg, 160) + ')',
    };
  }
  if (/provider.*(not|un)(available|configured|supported|known)|unknown provider|no provider/i.test(low)) {
    return {
      kind: 'provider',
      userMessage: 'The selected provider is unavailable or unconfigured. Check the provider/model settings. (' + truncate(msg, 160) + ')',
    };
  }
  if (/timed?\s?out|timeout|deadline exceeded/i.test(low)) {
    return { kind: 'timeout', userMessage: 'The task timed out. (' + truncate(msg, 160) + ')' };
  }
  if (/econn|enotfound|etimedout|network|fetch failed|socket|dns|tls|certificate|getaddrinfo/i.test(low)) {
    return { kind: 'network', userMessage: 'A network error occurred reaching the provider. (' + truncate(msg, 160) + ')' };
  }
  if (/config|settings|providers\.json|parse|malformed|invalid json/i.test(low)) {
    return { kind: 'config', userMessage: 'Cline configuration looks invalid. (' + truncate(msg, 160) + ')' };
  }
  return { kind: 'unknown', userMessage: msg ? 'Cline error: ' + truncate(msg, 200) : 'Cline returned an error.' };
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// Auth / config classification (from a parsed providers.json object)
// ---------------------------------------------------------------------------

// Field names that, when present and non-empty inside a provider's `settings`,
// indicate a stored credential. We only ever test for PRESENCE — values are
// never read into the return value or logged.
const CREDENTIAL_FIELDS = ['apiKey', 'apikey', 'token', 'accessToken', 'access_token', 'refreshToken', 'sessionToken'];

// Env vars Cline reads natively (a key here means the run can authenticate even
// when providers.json has no stored credential).
const CLINE_AUTH_ENV_VARS = [
  'CLINE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'AI_GATEWAY_API_KEY',
  'V0_API_KEY',
];

// Providers that authenticate WITHOUT an apiKey in providers.json (account /
// OAuth — the credential lives elsewhere). For these, a missing apiKey is NOT
// evidence of "no credentials" — we must report unknown, not no_credentials.
const ACCOUNT_PROVIDERS = new Set(['cline']);

function hasCredential(settings) {
  if (!settings || typeof settings !== 'object') return false;
  return CREDENTIAL_FIELDS.some(
    (f) => typeof settings[f] === 'string' && settings[f].trim().length > 0,
  );
}

/**
 * Classify Cline auth/config from a parsed providers.json object and the agent
 * env. Pure: never reads files, never exposes secret values.
 *
 * providers.json is a Cline-version-specific internal file, so this is a
 * HEURISTIC, never an absolute auth verdict — the real authority is the run
 * result. The classification is deliberately conservative:
 *   - `ready`         only on a POSITIVE signal: a credential field is present,
 *                     or a native env key is set.
 *   - `no_credentials` only when we can CONFIRM a key-based provider is selected
 *                     with no credential anywhere (and it isn't an account/OAuth
 *                     provider). Used for a softer hint, never to block startup.
 *   - `unknown`       everything we cannot confirm: file missing, unparseable,
 *                     unrecognized shape, an account/OAuth provider without a
 *                     stored key, or no identifiable provider. Never reported as
 *                     ready, and never blocks startup.
 *
 * @param {object|null} providersJson  parsed providers.json, or null (missing),
 *                                      or a non-plain value (unparseable/changed)
 * @param {object} env                 the agent env (checked for native key vars)
 * @returns {{state: string, provider: string|null, model: string|null, detail: string}}
 *   state ∈ ready | no_credentials | unknown
 */
function classifyClineAuth(providersJson, env = {}) {
  const envKey = CLINE_AUTH_ENV_VARS.find((k) => (env[k] || '').trim());
  if (envKey) {
    return { state: 'ready', provider: null, model: null, detail: `API key via ${envKey}` };
  }

  // No config file → cannot confirm anything (could be env/OAuth/custom data-dir).
  if (providersJson === undefined || providersJson === null) {
    return { state: 'unknown', provider: null, model: null, detail: 'No providers.json; auth undetermined' };
  }
  // Unparseable / not a recognizable object → undetermined, NOT a hard "no creds".
  if (typeof providersJson !== 'object' || Array.isArray(providersJson) || providersJson.__parse_error) {
    return { state: 'unknown', provider: null, model: null, detail: 'providers.json unparseable or unrecognized' };
  }

  const providers = providersJson.providers && typeof providersJson.providers === 'object' && !Array.isArray(providersJson.providers)
    ? providersJson.providers
    : null;
  if (!providers) {
    return { state: 'unknown', provider: null, model: null, detail: 'providers.json shape unrecognized' };
  }
  const active = providersJson.lastUsedProvider || null;

  // Positive signal: any provider carries a stored credential.
  for (const id of Object.keys(providers)) {
    if (hasCredential((providers[id] || {}).settings)) {
      return { state: 'ready', provider: id, model: (providers[id].settings || {}).model || null, detail: 'Provider credential present' };
    }
  }

  // No credential anywhere. Decide between no_credentials (confident) vs unknown.
  const activeEntry = active && providers[active] ? providers[active] : null;
  if (activeEntry && activeEntry.settings && !ACCOUNT_PROVIDERS.has(active)) {
    // A key-based provider is selected with no stored credential → confident.
    return { state: 'no_credentials', provider: active, model: activeEntry.settings.model || null, detail: 'Key-based provider selected but no credential stored' };
  }
  // Account/OAuth provider without a stored key, empty providers, or no active
  // provider → cannot confirm; the credential may live outside providers.json.
  return { state: 'unknown', provider: active, model: (activeEntry && activeEntry.settings && activeEntry.settings.model) || null, detail: 'No stored credential found; auth undetermined' };
}

// ---------------------------------------------------------------------------
// Argument building (shell-safe — consumed as a spawn args array, never a string)
// ---------------------------------------------------------------------------

/**
 * Build the argv (after the binary) for a one-shot headless Cline run.
 * The prompt is always the LAST positional so any leading dashes in user text
 * cannot be parsed as flags. Returns a flat string array suitable for
 * child_process.spawn(bin, args) — there is NO shell, so quotes/newlines/$()
 * in the prompt are passed verbatim and safely.
 *
 * @param {object} o
 * @param {string} o.prompt        required — the task text (positional)
 * @param {string} [o.cwd]         working directory (-c)
 * @param {string} [o.sessionId]   resume an existing session (--id)
 * @param {boolean} [o.planMode]   plan mode (-p) vs default act+auto-approve
 * @param {string} [o.provider]    provider id (-P)
 * @param {string} [o.model]       model id (-m)
 * @param {string} [o.apiKey]      per-run API key (-k) — caller must keep out of logs
 * @param {string} [o.thinking]    reasoning level none|low|medium|high|xhigh (--thinking)
 * @param {number} [o.timeoutSec]  run timeout in seconds (-t); 0/undefined = no timeout
 */
function buildClineArgs(o) {
  if (!o || typeof o.prompt !== 'string') {
    throw new Error('buildClineArgs: prompt (string) is required');
  }
  const args = ['--json'];
  if (o.cwd) args.push('-c', o.cwd);
  if (o.sessionId) args.push('--id', o.sessionId);
  // Default (no -p) is "act mode with auto-approve enabled" per `cline --help`.
  // We make auto-approval explicit so a future change to Cline's default can't
  // silently start blocking on tool prompts in our non-interactive context.
  if (o.planMode) {
    args.push('-p');
  } else {
    args.push('--auto-approve', 'true');
  }
  if (o.provider) args.push('-P', o.provider);
  if (o.model) args.push('-m', o.model);
  if (o.apiKey) args.push('-k', o.apiKey);
  if (o.thinking) args.push('--thinking', o.thinking);
  if (o.timeoutSec && Number(o.timeoutSec) > 0) args.push('-t', String(Math.floor(Number(o.timeoutSec))));
  // Prompt LAST and positional so it is never mistaken for an option.
  args.push(o.prompt);
  return args;
}

/** Return a copy of an args array with the value after `-k` redacted, for logging. */
function redactArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    out.push(args[i]);
    if (args[i] === '-k' || args[i] === '--key') {
      out.push('«redacted»');
      i++; // skip the real key
    } else if (i === args.length - 1) {
      // last positional is the prompt — don't echo user content to logs
      out[out.length - 1] = '«prompt»';
    } else {
      out[out.length - 1] = redactSecrets(args[i]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// NDJSON stream parser
// ---------------------------------------------------------------------------

/**
 * Incremental NDJSON parser. Handles:
 *  - chunked input where one JSON object is split across many chunks
 *  - a single chunk that contains several complete lines
 *  - mixed "\n" and "\r\n" line endings and a trailing incomplete line
 *  - stray non-JSON lines (skipped, surfaced via `garbage` for optional logging)
 *
 * Usage:
 *   const p = new ClineStreamParser();
 *   for (const chunk of chunks) for (const env of p.push(chunk)) handle(env);
 *   for (const env of p.flush()) handle(env);   // trailing buffer at EOF
 */
class ClineStreamParser {
  constructor() {
    this._buf = '';
    this.garbage = []; // lines that failed JSON.parse (for debugging only)
  }

  push(chunk) {
    if (chunk == null) return [];
    this._buf += chunk.toString('utf-8');
    const out = [];
    let nl;
    while ((nl = this._buf.indexOf('\n')) !== -1) {
      const line = this._buf.slice(0, nl);
      this._buf = this._buf.slice(nl + 1);
      const env = this._parseLine(line);
      if (env !== undefined) out.push(env);
    }
    return out;
  }

  flush() {
    const out = [];
    if (this._buf.trim()) {
      const env = this._parseLine(this._buf);
      if (env !== undefined) out.push(env);
    }
    this._buf = '';
    return out;
  }

  _parseLine(line) {
    const trimmed = line.replace(/\r$/, '').trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      if (this.garbage.length < 50) this.garbage.push(trimmed.slice(0, 500));
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Envelope → normalized event interpretation
// ---------------------------------------------------------------------------

// Tools that represent a question for the human rather than an autonomous action.
const ASK_TOOLS = new Set(['ask_question', 'ask_followup_question']);

/** Human-friendly verb for a Cline tool name (best-effort; unknown → the name). */
function friendlyToolLabel(toolName) {
  switch (toolName) {
    case 'editor':
    case 'apply_patch':
      return 'Editing file';
    case 'read_files':
      return 'Reading files';
    case 'run_commands':
      return 'Running command';
    case 'search_codebase':
      return 'Searching codebase';
    case 'fetch_web_content':
      return 'Fetching web content';
    case 'skills':
      return 'Using skill';
    case 'spawn_agent':
      return 'Spawning subagent';
    default:
      return toolName || 'Tool';
  }
}

/** Best-effort one-line preview of a tool's input, with secrets scrubbed. */
function toolInputPreview(input) {
  if (input == null) return '';
  if (typeof input === 'string') return truncate(redactSecrets(input), 160);
  if (typeof input !== 'object') return truncate(String(input), 160);
  const i = input;
  let v =
    (Array.isArray(i.commands) && i.commands.join('; ')) ||
    i.command ||
    (Array.isArray(i.file_paths) && i.file_paths.join(', ')) ||
    i.file_path || i.path ||
    (Array.isArray(i.queries) && i.queries.join(', ')) ||
    i.query || i.pattern ||
    (Array.isArray(i.requests) && i.requests.map((r) => r && r.url).filter(Boolean).join(', ')) ||
    i.url || i.skill || i.question || '';
  if (!v) {
    try { v = JSON.stringify(redactValue(i)); } catch { v = ''; }
  }
  return truncate(redactSecrets(String(v)), 160);
}

/**
 * Interpret one stream envelope into zero or more normalized events the adapter
 * can act on. Stateless: relies on Cline emitting whole text/output in the
 * `content_end` events (so we never double-count streamed deltas).
 *
 * Normalized event kinds:
 *   {kind:'text', text}                 final assistant text block for a turn
 *   {kind:'reasoning', text}            a thinking/reasoning block
 *   {kind:'tool_start', toolName, toolCallId, label, preview, input}
 *   {kind:'tool_end', toolName, toolCallId, ok, error, durationMs}
 *   {kind:'ask', question, options, toolCallId}
 *   {kind:'notice', noticeType, reason, text}
 *   {kind:'error', message, recoverable}     (from agent_event error)
 *   {kind:'done', reason, text}              inner "done" event
 *   {kind:'result', finishReason, text, model, ok}   terminal run_result
 *   {kind:'aborted', reason, text}           run_aborted
 *   {kind:'session', taskId, agentId}        hook_event agent_start (informational)
 */
function interpretClineEnvelope(env) {
  if (!env || typeof env !== 'object') return [];
  const type = env.type;

  if (type === 'run_result') {
    const reason = env.finishReason || 'unknown';
    return [{
      kind: 'result',
      finishReason: reason,
      ok: reason === 'completed',
      text: typeof env.text === 'string' ? env.text : '',
      model: env.model && env.model.id ? env.model.id : null,
    }];
  }
  if (type === 'run_aborted') {
    return [{ kind: 'aborted', reason: env.reason || 'aborted', text: env.message || '' }];
  }
  if (type === 'hook_event') {
    if (env.hookEventName === 'agent_start') {
      return [{ kind: 'session', taskId: env.taskId || null, agentId: env.agentId || null }];
    }
    return [];
  }
  if (type !== 'agent_event') return []; // run_start/team_event/unknown → no UI action

  const ev = env.event;
  if (!ev || typeof ev !== 'object') return [];

  switch (ev.type) {
    case 'content_end': {
      // The whole, final content for a block. Deltas (content_start/_update)
      // are intentionally ignored to avoid duplicate output.
      if (ev.contentType === 'text') {
        const t = (ev.text || '').trim();
        return t ? [{ kind: 'text', text: t }] : [];
      }
      if (ev.contentType === 'reasoning') {
        const t = (ev.reasoning || '').trim();
        return t ? [{ kind: 'reasoning', text: t }] : [];
      }
      if (ev.contentType === 'tool') {
        return [{
          kind: 'tool_end',
          toolName: ev.toolName || '',
          toolCallId: ev.toolCallId || null,
          ok: !ev.error,
          error: ev.error ? redactSecrets(String(ev.error)) : null,
          durationMs: typeof ev.durationMs === 'number' ? ev.durationMs : null,
        }];
      }
      return [];
    }
    case 'content_start': {
      // We only surface tool *starts* (text/reasoning starts are deltas we skip).
      if (ev.contentType !== 'tool') return [];
      const toolName = ev.toolName || '';
      if (ASK_TOOLS.has(toolName)) {
        const input = ev.input || {};
        return [{
          kind: 'ask',
          toolCallId: ev.toolCallId || null,
          question: typeof input.question === 'string' ? input.question : '',
          options: Array.isArray(input.options) ? input.options.slice(0, 12) : [],
        }];
      }
      return [{
        kind: 'tool_start',
        toolName,
        toolCallId: ev.toolCallId || null,
        label: friendlyToolLabel(toolName),
        preview: toolInputPreview(ev.input),
        input: ev.input,
      }];
    }
    case 'error': {
      const e = ev.error;
      const message = e && typeof e === 'object' ? (e.message || '') : String(e || '');
      return [{ kind: 'error', message: redactSecrets(message), recoverable: ev.recoverable === true }];
    }
    case 'notice': {
      return [{
        kind: 'notice',
        noticeType: ev.noticeType || null,
        reason: ev.reason || null,
        text: redactSecrets(ev.message || ''),
      }];
    }
    case 'done': {
      return [{ kind: 'done', reason: ev.reason || 'completed', text: typeof ev.text === 'string' ? ev.text : '' }];
    }
    // content_update / iteration_start / iteration_end / usage → no UI action
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Session-id correlation (for --id resume)
// ---------------------------------------------------------------------------

/**
 * Cline does NOT emit a resumable session id in its `--json` stream — it only
 * records sessions in `cline history --json`. We correlate the new session with
 * a strict BEFORE/AFTER snapshot diff: the caller records the set of session ids
 * that existed before spawning; this picks the run's session ONLY from records
 * that are (a) new since then, (b) in the same working directory, and (c) within
 * the run's time window. It binds ONLY when exactly one candidate remains —
 * never guessing — so two concurrent runs in the same directory both decline
 * rather than risk binding the wrong session.
 *
 * @param {Array} historyAfter      parsed `cline history --json` taken AFTER the run
 * @param {object} o
 * @param {string} o.cwd            the run's working directory (required to match)
 * @param {Set|Array} [o.beforeIds] session ids that existed BEFORE the run (excluded)
 * @param {number} [o.sinceMs]      spawn timestamp (ms); only sessions started at/after count
 * @param {string} [o.promptNeedle] a slice of the prompt; further narrows candidates
 * @returns {string|null}  the session id when exactly one candidate matches, else null
 */
function pickClineSessionId(historyAfter, o) {
  if (!Array.isArray(historyAfter) || !o || !o.cwd) return null;
  const before = o.beforeIds instanceof Set
    ? o.beforeIds
    : new Set(Array.isArray(o.beforeIds) ? o.beforeIds : []);
  const since = typeof o.sinceMs === 'number' ? o.sinceMs - 2000 : null; // small clock-skew slack
  const candidates = historyAfter.filter((s) => {
    if (!s || s.cwd !== o.cwd || !s.sessionId) return false;
    if (before.has(s.sessionId)) return false; // only sessions NEW since the before-snapshot
    if (since != null) {
      const started = Date.parse(s.startedAt || s.updatedAt || '');
      if (Number.isFinite(started) && started < since) return false;
    }
    if (o.promptNeedle && typeof s.prompt === 'string' && !s.prompt.includes(o.promptNeedle)) return false;
    return true;
  });
  // Strict: bind only on a single unambiguous candidate; otherwise decline.
  return candidates.length === 1 ? candidates[0].sessionId : null;
}

module.exports = {
  MIN_CLINE_VERSION,
  parseClineVersion,
  compareVersions,
  classifyClineVersion,
  redactSecrets,
  redactValue,
  classifyClineError,
  classifyClineAuth,
  CLINE_AUTH_ENV_VARS,
  buildClineArgs,
  redactArgs,
  ClineStreamParser,
  interpretClineEnvelope,
  friendlyToolLabel,
  toolInputPreview,
  pickClineSessionId,
};
