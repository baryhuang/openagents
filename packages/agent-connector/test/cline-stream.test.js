'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_CLINE_VERSION,
  parseClineVersion,
  compareVersions,
  classifyClineVersion,
  redactSecrets,
  redactValue,
  classifyClineError,
  classifyClineAuth,
  buildClineArgs,
  redactArgs,
  ClineStreamParser,
  interpretClineEnvelope,
  pickClineSessionId,
} = require('../src/adapters/cline-stream');

// Helper: drive a parser with a sequence of chunks and collect interpreted events.
function interpretChunks(chunks) {
  const p = new ClineStreamParser();
  const out = [];
  for (const c of chunks) for (const env of p.push(c)) out.push(...interpretClineEnvelope(env));
  for (const env of p.flush()) out.push(...interpretClineEnvelope(env));
  return out;
}

describe('cline version handling', () => {
  it('parses a dotted version from --version output', () => {
    assert.equal(parseClineVersion('3.0.26'), '3.0.26');
    assert.equal(parseClineVersion('cline version 3.0.26\n'), '3.0.26');
    assert.equal(parseClineVersion('v2.1.0-nightly'), '2.1.0-nightly');
    assert.equal(parseClineVersion('garbage'), null);
  });

  it('compares versions correctly', () => {
    assert.equal(compareVersions('3.0.26', '3.0.0'), 1);
    assert.equal(compareVersions('2.9.9', '3.0.0'), -1);
    assert.equal(compareVersions('3.0.0', '3.0.0'), 0);
  });

  it('classifies supported / too-old / undetermined', () => {
    assert.deepEqual(classifyClineVersion('3.0.26'), { version: '3.0.26', supported: true });
    assert.equal(classifyClineVersion(`${MIN_CLINE_VERSION}`).supported, true);
    assert.equal(classifyClineVersion('2.0.0').supported, false);   // too old → incompatible
    assert.deepEqual(classifyClineVersion('not-a-version'), { version: null, supported: null }); // lenient
  });
});

describe('secret redaction', () => {
  it('redacts API keys, bearer tokens and AWS keys from text', () => {
    const r = redactSecrets('key sk-ant-api03-ABCDEFGHIJKLMNOP and Authorization: Bearer abcdef123456 plus AKIAIOSFODNN7EXAMPLE');
    assert.ok(!r.includes('sk-ant-api03-ABCDEFGHIJKLMNOP'));
    assert.ok(!r.includes('abcdef123456'));
    assert.ok(!r.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(r.includes('«redacted»'));
  });

  it('redacts sensitive object keys without mutating the input', () => {
    const input = { apiKey: 'sk-secret-123456789', model: 'gpt', nested: { token: 'tkn-abcdefghij' } };
    const out = redactValue(input);
    assert.equal(out.apiKey, '«redacted»');
    assert.equal(out.nested.token, '«redacted»');
    assert.equal(out.model, 'gpt');
    // original untouched
    assert.equal(input.apiKey, 'sk-secret-123456789');
  });
});

describe('error classification', () => {
  it('maps the real Unauthorized message to auth', () => {
    const { kind } = classifyClineError(
      "Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account.");
    assert.equal(kind, 'auth');
  });
  it('classifies rate limit / model / provider / network / timeout / config', () => {
    assert.equal(classifyClineError('429 Too Many Requests').kind, 'rate_limit');
    assert.equal(classifyClineError('model claude-x does not exist').kind, 'model');
    assert.equal(classifyClineError('unknown provider foo').kind, 'provider');
    assert.equal(classifyClineError('getaddrinfo ENOTFOUND api.example.com').kind, 'network');
    assert.equal(classifyClineError('run timed out after 60s').kind, 'timeout');
    assert.equal(classifyClineError('failed to parse providers.json').kind, 'config');
    assert.equal(classifyClineError('something weird').kind, 'unknown');
  });
  it('redacts secrets that appear inside an error message', () => {
    const { userMessage } = classifyClineError('bad key sk-ant-SECRETKEY1234567 rejected');
    assert.ok(!userMessage.includes('sk-ant-SECRETKEY1234567'));
  });
});

describe('auth classification from providers.json (conservative heuristic)', () => {
  it('no config file + no env key → unknown (never asserts unauthenticated)', () => {
    assert.equal(classifyClineAuth(null, {}).state, 'unknown');
  });
  it('no config but a native env key → ready', () => {
    assert.equal(classifyClineAuth(null, { ANTHROPIC_API_KEY: 'sk-ant-xxxxxxxx' }).state, 'ready');
    assert.equal(classifyClineAuth(null, { CLINE_API_KEY: 'k' }).state, 'ready');
    assert.equal(classifyClineAuth(null, { OPENROUTER_API_KEY: 'k' }).state, 'ready');
  });
  it('empty providers.json (no providers) → unknown (cannot confirm)', () => {
    assert.equal(classifyClineAuth({ version: 1, providers: {} }, {}).state, 'unknown');
    assert.equal(classifyClineAuth({}, {}).state, 'unknown');
  });
  it('the real unauthenticated cline-account default (no apiKey) → unknown, NOT no_credentials', () => {
    // The `cline` provider authenticates via account/OAuth — a missing apiKey is
    // not evidence of "no credentials"; must not be misclassified.
    const parsed = {
      version: 1,
      lastUsedProvider: 'cline',
      providers: { cline: { settings: { provider: 'cline', model: 'z-ai/glm-5.2' }, tokenSource: 'manual' } },
    };
    const r = classifyClineAuth(parsed, {});
    assert.equal(r.state, 'unknown');
    assert.equal(r.provider, 'cline');
  });
  it('a key-based provider selected with no credential → no_credentials', () => {
    const parsed = { version: 1, lastUsedProvider: 'anthropic', providers: { anthropic: { settings: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } } };
    const r = classifyClineAuth(parsed, {});
    assert.equal(r.state, 'no_credentials');
    assert.equal(r.provider, 'anthropic');
  });
  it('a stored apiKey (nested) → ready, and never echoes the value', () => {
    const parsed = {
      version: 1,
      lastUsedProvider: 'anthropic',
      providers: { anthropic: { settings: { provider: 'anthropic', apiKey: 'sk-ant-REALKEY123456', model: 'claude-sonnet-4-6' } } },
    };
    const r = classifyClineAuth(parsed, {});
    assert.equal(r.state, 'ready');
    assert.equal(r.provider, 'anthropic');
    assert.ok(!JSON.stringify(r).includes('sk-ant-REALKEY123456'));
  });
  it('a provider that stores a non-apiKey credential (token) → ready', () => {
    const parsed = { version: 1, lastUsedProvider: 'acme', providers: { acme: { settings: { provider: 'acme', accessToken: 'tok-abcdef123456' } } } };
    assert.equal(classifyClineAuth(parsed, {}).state, 'ready');
  });
  it('malformed / structure-changed providers.json → unknown (not no_credentials)', () => {
    assert.equal(classifyClineAuth('not-an-object', {}).state, 'unknown');
    assert.equal(classifyClineAuth([1, 2, 3], {}).state, 'unknown');
    assert.equal(classifyClineAuth({ __parse_error: true }, {}).state, 'unknown');
    assert.equal(classifyClineAuth({ version: 2, accounts: {} }, {}).state, 'unknown'); // shape changed
  });
  it('unknown state is never reported as ready', () => {
    for (const j of [null, {}, { providers: {} }, 'x', { __parse_error: true }]) {
      assert.notEqual(classifyClineAuth(j, {}).state, 'ready');
    }
  });
});

describe('buildClineArgs', () => {
  it('always puts --json first and the prompt LAST (positional, never a flag)', () => {
    const args = buildClineArgs({ prompt: '--help me', cwd: '/tmp/x' });
    assert.equal(args[0], '--json');
    assert.equal(args[args.length - 1], '--help me'); // dash-leading prompt is safe as last positional
    assert.ok(args.includes('-c'));
    assert.equal(args[args.indexOf('-c') + 1], '/tmp/x');
  });

  it('defaults to act mode with explicit --auto-approve true', () => {
    const args = buildClineArgs({ prompt: 'hi' });
    assert.ok(args.includes('--auto-approve'));
    assert.equal(args[args.indexOf('--auto-approve') + 1], 'true');
    assert.ok(!args.includes('-p'));
  });

  it('uses -p for plan mode (no auto-approve)', () => {
    const args = buildClineArgs({ prompt: 'hi', planMode: true });
    assert.ok(args.includes('-p'));
    assert.ok(!args.includes('--auto-approve'));
  });

  it('maps resume / provider / model / key / thinking / timeout', () => {
    const args = buildClineArgs({
      prompt: 'go', cwd: '/w', sessionId: '123_abc', provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6', apiKey: 'sk-secret', thinking: 'high', timeoutSec: 90,
    });
    assert.equal(args[args.indexOf('--id') + 1], '123_abc');
    assert.equal(args[args.indexOf('-P') + 1], 'openrouter');
    assert.equal(args[args.indexOf('-m') + 1], 'anthropic/claude-sonnet-4.6');
    assert.equal(args[args.indexOf('-k') + 1], 'sk-secret');
    assert.equal(args[args.indexOf('--thinking') + 1], 'high');
    assert.equal(args[args.indexOf('-t') + 1], '90');
  });

  it('passes special characters in the prompt verbatim (no shell, no escaping)', () => {
    const weird = 'multi\nline "quoted" $VAR `cmd` 中文 && rm -rf /';
    const args = buildClineArgs({ prompt: weird });
    assert.equal(args[args.length - 1], weird);
  });

  it('throws without a prompt', () => {
    assert.throws(() => buildClineArgs({ cwd: '/x' }), /prompt/);
  });

  it('redactArgs hides the -k value and the prompt', () => {
    const args = buildClineArgs({ prompt: 'secret task text', apiKey: 'sk-ant-KEY123456' });
    const red = redactArgs(['cline', ...args]);
    assert.ok(!red.join(' ').includes('sk-ant-KEY123456'));
    assert.ok(!red.join(' ').includes('secret task text'));
    assert.ok(red.includes('«prompt»'));
  });
});

describe('ClineStreamParser — chunking and framing', () => {
  const line = (o) => JSON.stringify(o) + '\n';

  it('parses multiple complete lines in one chunk', () => {
    const p = new ClineStreamParser();
    const got = p.push(line({ type: 'run_start' }) + line({ type: 'agent_event', event: { type: 'iteration_start', iteration: 1 } }));
    assert.equal(got.length, 2);
  });

  it('reassembles a JSON object split across several chunks', () => {
    const p = new ClineStreamParser();
    const full = line({ type: 'agent_event', event: { type: 'content_end', contentType: 'text', text: 'hello world' } });
    const a = full.slice(0, 20);
    const b = full.slice(20, 45);
    const c = full.slice(45);
    assert.equal(p.push(a).length, 0);
    assert.equal(p.push(b).length, 0);
    const got = p.push(c);
    assert.equal(got.length, 1);
    assert.equal(got[0].event.text, 'hello world');
  });

  it('handles \\r\\n line endings and a trailing incomplete line (flush)', () => {
    const p = new ClineStreamParser();
    const got = p.push('{"type":"run_start"}\r\n{"type":"agent_event","event":{"type":"done","reason":"completed","text":"x"}}');
    assert.equal(got.length, 1); // only the first (terminated) line
    const tail = p.flush();
    assert.equal(tail.length, 1);
    assert.equal(tail[0].event.type, 'done');
  });

  it('skips non-JSON garbage lines without throwing', () => {
    const p = new ClineStreamParser();
    const got = p.push('not json here\n' + line({ type: 'run_result', finishReason: 'completed', text: 'ok' }));
    assert.equal(got.length, 1);
    assert.equal(p.garbage.length, 1);
  });
});

describe('interpretClineEnvelope — event mapping', () => {
  const agent = (event) => ({ type: 'agent_event', event });

  it('maps content_end text → a single text event (deltas ignored, no duplication)', () => {
    const evs = interpretChunks([
      JSON.stringify(agent({ type: 'content_start', contentType: 'text', text: 'hel', accumulated: 'hel' })) + '\n',
      JSON.stringify(agent({ type: 'content_start', contentType: 'text', text: 'lo', accumulated: 'hello' })) + '\n',
      JSON.stringify(agent({ type: 'content_end', contentType: 'text', text: 'hello' })) + '\n',
    ]);
    const texts = evs.filter((e) => e.kind === 'text');
    assert.equal(texts.length, 1);
    assert.equal(texts[0].text, 'hello');
  });

  it('maps reasoning content_end → reasoning', () => {
    const evs = interpretChunks([JSON.stringify(agent({ type: 'content_end', contentType: 'reasoning', reasoning: 'thinking…' })) + '\n']);
    assert.deepEqual(evs, [{ kind: 'reasoning', text: 'thinking…' }]);
  });

  it('maps tool_start with input preview and tool_end with error', () => {
    const start = interpretClineEnvelope(agent({ type: 'content_start', contentType: 'tool', toolName: 'run_commands', toolCallId: 't1', input: { commands: ['ls -la'] } }));
    assert.equal(start[0].kind, 'tool_start');
    assert.equal(start[0].toolName, 'run_commands');
    assert.ok(start[0].preview.includes('ls -la'));
    const end = interpretClineEnvelope(agent({ type: 'content_end', contentType: 'tool', toolName: 'run_commands', toolCallId: 't1', error: 'boom', durationMs: 12 }));
    assert.equal(end[0].kind, 'tool_end');
    assert.equal(end[0].ok, false);
    assert.equal(end[0].error, 'boom');
  });

  it('maps the ask tools to an ask event', () => {
    const evs = interpretClineEnvelope(agent({ type: 'content_start', contentType: 'tool', toolName: 'ask_followup_question', toolCallId: 'a1', input: { question: 'Which file?', options: ['a', 'b'] } }));
    assert.equal(evs[0].kind, 'ask');
    assert.equal(evs[0].question, 'Which file?');
    assert.deepEqual(evs[0].options, ['a', 'b']);
  });

  it('maps agent_event error (redacting secrets) and run_result', () => {
    const err = interpretClineEnvelope(agent({ type: 'error', error: { name: 'Error', message: 'bad key sk-ant-LEAKED1234567', stack: 'x' }, recoverable: false }));
    assert.equal(err[0].kind, 'error');
    assert.ok(!err[0].message.includes('sk-ant-LEAKED1234567'));
    const res = interpretClineEnvelope({ type: 'run_result', finishReason: 'completed', text: 'done', model: { id: 'm' } });
    assert.deepEqual(res, [{ kind: 'result', finishReason: 'completed', ok: true, text: 'done', model: 'm' }]);
    const fail = interpretClineEnvelope({ type: 'run_result', finishReason: 'error', text: 'nope' });
    assert.equal(fail[0].ok, false);
  });

  it('maps run_aborted and hook agent_start; ignores noise events', () => {
    assert.equal(interpretClineEnvelope({ type: 'run_aborted', reason: 'sigint', message: 'm' })[0].kind, 'aborted');
    assert.equal(interpretClineEnvelope({ type: 'hook_event', hookEventName: 'agent_start', taskId: 'c1', agentId: 'a1' })[0].kind, 'session');
    assert.deepEqual(interpretClineEnvelope({ type: 'hook_event', hookEventName: 'tool_call' }), []);
    assert.deepEqual(interpretClineEnvelope({ type: 'run_start', providerId: 'cline' }), []);
    assert.deepEqual(interpretClineEnvelope(agent({ type: 'iteration_end', iteration: 1 })), []);
    assert.deepEqual(interpretClineEnvelope(agent({ type: 'usage', inputTokens: 1 })), []);
    assert.deepEqual(interpretClineEnvelope(agent({ type: 'content_update', contentType: 'tool' })), []);
  });

  it('handles two events packed in one chunk and one event split across chunks', () => {
    const evs = interpretChunks([
      '{"type":"agent_event","event":{"type":"content_end","contentType":"text","text":"A"}}\n{"type":"agent_eve',
      'nt","event":{"type":"content_end","contentType":"text","text":"B"}}\n',
    ]);
    const texts = evs.filter((e) => e.kind === 'text').map((e) => e.text);
    assert.deepEqual(texts, ['A', 'B']);
  });
});

describe('pickClineSessionId — resume correlation (strict before/after snapshot)', () => {
  const T0 = Date.parse('2026-06-17T06:00:00.000Z');
  const base = (over) => ({ sessionId: 's', cwd: '/proj', startedAt: '2026-06-17T06:00:05.000Z', prompt: '<user_input mode="act">do a thing</user_input>', ...over });

  it('binds the single NEW session in the working dir', () => {
    const before = new Set(['old1', 'old2']);
    const after = [base({ sessionId: 'old1' }), base({ sessionId: 'new1' })];
    assert.equal(pickClineSessionId(after, { cwd: '/proj', sinceMs: T0, beforeIds: before }), 'new1');
  });

  it('declines when two NEW sessions appear in the same dir (concurrent runs)', () => {
    const before = new Set(['old1']);
    const after = [base({ sessionId: 'old1' }), base({ sessionId: 'newA' }), base({ sessionId: 'newB', startedAt: '2026-06-17T06:00:06.000Z' })];
    assert.equal(pickClineSessionId(after, { cwd: '/proj', sinceMs: T0, beforeIds: before }), null);
  });

  it('declines on ambiguity even when prompt prefixes are identical', () => {
    const before = new Set();
    const same = '<user_input mode="act">fix the bug in</user_input>';
    const after = [base({ sessionId: 'a', prompt: same }), base({ sessionId: 'b', prompt: same })];
    assert.equal(pickClineSessionId(after, { cwd: '/proj', sinceMs: T0, beforeIds: before, promptNeedle: 'fix the bug in' }), null);
  });

  it('a prompt needle can narrow to a unique candidate', () => {
    const before = new Set();
    const after = [
      base({ sessionId: 'a', prompt: '<user_input mode="act">unique-XYZ task</user_input>' }),
      base({ sessionId: 'b', prompt: '<user_input mode="act">something else</user_input>' }),
    ];
    assert.equal(pickClineSessionId(after, { cwd: '/proj', sinceMs: T0, beforeIds: before, promptNeedle: 'unique-XYZ' }), 'a');
  });

  it('never re-selects a pre-existing (old) session id', () => {
    const before = new Set(['pre']);
    const after = [base({ sessionId: 'pre', startedAt: '2026-06-17T06:00:05.000Z' })];
    assert.equal(pickClineSessionId(after, { cwd: '/proj', sinceMs: T0, beforeIds: before }), null);
  });

  it('does not cross working directories', () => {
    const before = new Set();
    const after = [base({ sessionId: 'mine' }), base({ sessionId: 'theirs', cwd: '/other-proj' })];
    assert.equal(pickClineSessionId(after, { cwd: '/proj', sinceMs: T0, beforeIds: before }), 'mine');
    assert.equal(pickClineSessionId(after, { cwd: '/other-proj', sinceMs: T0, beforeIds: before }), 'theirs');
  });

  it('ignores records started before the spawn window', () => {
    const before = new Set();
    const after = [base({ sessionId: 'old', startedAt: '2026-06-17T05:00:00.000Z' })];
    assert.equal(pickClineSessionId(after, { cwd: '/proj', sinceMs: T0, beforeIds: before }), null);
  });

  it('returns null when there are no new candidates', () => {
    assert.equal(pickClineSessionId([], { cwd: '/proj', sinceMs: T0, beforeIds: new Set() }), null);
    assert.equal(pickClineSessionId(null, { cwd: '/proj' }), null);
  });

  it('accepts beforeIds as an array too', () => {
    const after = [base({ sessionId: 'old' }), base({ sessionId: 'fresh' })];
    assert.equal(pickClineSessionId(after, { cwd: '/proj', sinceMs: T0, beforeIds: ['old'] }), 'fresh');
  });
});
