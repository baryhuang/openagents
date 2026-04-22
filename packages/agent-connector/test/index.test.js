'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { AgentConnector } = require('../src/index');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-index-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AgentConnector instance env', () => {
  it('merges type env with instance env without cross-agent overwrite', () => {
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.saveAgentEnv('opencode', {
      LLM_API_KEY: 'sk-test',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_MODEL: 'default-model',
    });

    connector.addAgent({ name: 'agent-a', type: 'opencode', role: 'worker' });
    connector.addAgent({ name: 'agent-b', type: 'opencode', role: 'worker' });

    connector.saveAgentInstanceEnv('agent-a', { LLM_MODEL: 'model-a' });
    connector.saveAgentInstanceEnv('agent-b', { LLM_MODEL: 'model-b' });

    const agents = connector.listAgents();
    const agentA = agents.find((agent) => agent.name === 'agent-a');
    const agentB = agents.find((agent) => agent.name === 'agent-b');

    assert.equal(agentA.env.LLM_MODEL, 'model-a');
    assert.equal(agentB.env.LLM_MODEL, 'model-b');
    assert.equal(agentA.env.LLM_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.equal(agentB.env.LLM_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.deepEqual(connector.getAgentInstanceEnv('agent-a'), { LLM_MODEL: 'model-a' });
    assert.deepEqual(connector.getAgentInstanceEnv('agent-b'), { LLM_MODEL: 'model-b' });
  });
});
