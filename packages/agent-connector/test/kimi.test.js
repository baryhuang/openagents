'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const KimiAdapter = require('../src/adapters/kimi');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');
const { testLLMConnection } = require('../src/utils');

function makeAdapter(env) {
  return new KimiAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'kimi-bot',
    agentEnv: env,
  });
}

describe('KimiAdapter', () => {
  it('is registered under the kimi agent type', () => {
    assert.equal(ADAPTER_MAP.kimi, KimiAdapter);
    const inst = createAdapter('kimi', {
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'kimi-bot',
      agentEnv: {},
    });
    assert.ok(inst instanceof KimiAdapter);
  });

  it('applies Moonshot defaults when only an API key is configured', () => {
    const adapter = makeAdapter({ KIMI_API_KEY: 'sk-test' });
    assert.equal(adapter._apiKey, 'sk-test');
    assert.equal(adapter._baseUrl, 'https://api.moonshot.ai/v1');
    assert.equal(adapter._model, 'kimi-k2.6');
    assert.equal(adapter._directMode, true);
  });

  it('honors MOONSHOT_API_KEY and KIMI_API_KEY aliases', () => {
    const a = makeAdapter({ MOONSHOT_API_KEY: 'sk-moon' });
    assert.equal(a._apiKey, 'sk-moon');
    assert.equal(a._directMode, true);

    // KIMI_API_KEY wins over MOONSHOT_API_KEY (UI > env alias)
    const b = makeAdapter({ MOONSHOT_API_KEY: 'sk-moon', KIMI_API_KEY: 'sk-ui' });
    assert.equal(b._apiKey, 'sk-ui');
  });

  it('lets users override base URL and model', () => {
    const adapter = makeAdapter({
      KIMI_API_KEY: 'sk-test',
      KIMI_BASE_URL: 'https://example.test/v1/',
      KIMI_MODEL: 'kimi-k2.6-preview',
    });
    assert.equal(adapter._baseUrl, 'https://example.test/v1');
    assert.equal(adapter._model, 'kimi-k2.6-preview');
  });

  it('reports not-direct mode when no API key is set', () => {
    const adapter = makeAdapter({});
    assert.equal(adapter._apiKey, '');
    assert.equal(adapter._directMode, false);
    // Defaults still applied so the user can ship a key later without restart logic
    assert.equal(adapter._baseUrl, 'https://api.moonshot.ai/v1');
    assert.equal(adapter._model, 'kimi-k2.6');
  });

  it('constructs an OpenAI-compatible streaming chat completion request', async () => {
    let seenRequest = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seenRequest = {
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: JSON.parse(body),
        };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end([
          'data: {"choices":[{"delta":{"content":"hello"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":" kimi"}}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'));
      });
    });

    await listen(server);
    try {
      const { port } = server.address();
      const adapter = makeAdapter({
        KIMI_API_KEY: 'sk-test',
        KIMI_BASE_URL: `http://127.0.0.1:${port}/v1`,
        KIMI_MODEL: 'kimi-k2.6',
      });

      const text = await adapter._callCompletionApi('ping', 'thread');

      assert.equal(text, 'hello kimi');
      assert.equal(seenRequest.method, 'POST');
      assert.equal(seenRequest.url, '/v1/chat/completions');
      assert.equal(seenRequest.authorization, 'Bearer sk-test');
      assert.equal(seenRequest.body.model, 'kimi-k2.6');
      assert.equal(seenRequest.body.stream, true);
      assert.ok(seenRequest.body.messages.some((m) => m.role === 'user' && m.content === 'ping'));
    } finally {
      await close(server);
    }
  });

  it('aborts an in-flight completion request on stop', async () => {
    let releaseRequest;
    const requestStarted = new Promise((resolve) => { releaseRequest = resolve; });
    const server = http.createServer((req, res) => {
      releaseRequest();
      req.resume();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    });

    await listen(server);
    try {
      const { port } = server.address();
      const adapter = makeAdapter({
        KIMI_API_KEY: 'sk-test',
        KIMI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      });

      const pending = adapter._callCompletionApi('please wait', 'thread');
      await requestStarted;
      adapter.stop();

      await assert.rejects(pending, /stopped|socket hang up|aborted/i);
    } finally {
      await close(server);
    }
  });

  it('tests Kimi connection using KIMI_* env fields', async () => {
    let seenRequest = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seenRequest = {
          url: req.url,
          authorization: req.headers.authorization,
          body: JSON.parse(body),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          model: 'kimi-k2.6',
          choices: [{ message: { content: 'hi there' } }],
        }));
      });
    });

    await listen(server);
    try {
      const { port } = server.address();
      const result = await testLLMConnection({
        KIMI_API_KEY: 'sk-test',
        KIMI_BASE_URL: `http://127.0.0.1:${port}/v1`,
        KIMI_MODEL: 'kimi-k2.6',
      });

      assert.equal(result.success, true);
      assert.equal(result.model, 'kimi-k2.6');
      assert.equal(result.response, 'hi there');
      assert.equal(seenRequest.url, '/v1/chat/completions');
      assert.equal(seenRequest.authorization, 'Bearer sk-test');
      assert.equal(seenRequest.body.model, 'kimi-k2.6');
      assert.equal(seenRequest.body.max_tokens, 32);
    } finally {
      await close(server);
    }
  });
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
