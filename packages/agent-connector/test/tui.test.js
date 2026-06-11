'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Config } = require('../src/config');
const { loadAgentRows, connectAvailable } = require('../src/agent-rows');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-tui-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Minimal connector stub exposing exactly what loadAgentRows() consumes:
// a real Config (so network writes are exercised), plus daemon/health hooks.
function makeConnector(statuses = {}, { pid = 4321 } = {}) {
  const config = new Config(tmpDir);
  return {
    config,
    getDaemonStatus: () => statuses,
    getDaemonPid: () => pid,
    healthCheck: () => ({ ready: true, auth_mode: 'api_key' }),
    // mirrors AgentConnector.connectWorkspace
    connectWorkspace(name, slug) { config.setAgentNetwork(name, slug); },
  };
}

function rowFor(rows, name) {
  return rows.find((r) => r.name === name);
}

describe('TUI agent list — local-only display', () => {
  it('shows "(local)" for an agent with no workspace', () => {
    const connector = makeConnector({ 'my-agent0602001': { state: 'running' } });
    connector.config.addAgent({ name: 'my-agent0602001', type: 'openclaw' });

    const row = rowFor(loadAgentRows(connector), 'my-agent0602001');
    assert.equal(row.workspace, '', 'no real workspace URL');
    assert.equal(row.workspaceLabel, '(local)');
    assert.equal(row.state, 'running');
  });

  it('shows "my-agent0602001 kimi running (local)" for a local-only kimi agent', () => {
    const connector = makeConnector({ 'my-agent0602001': { state: 'running' } });
    connector.config.addAgent({ name: 'my-agent0602001', type: 'kimi' });

    const row = rowFor(loadAgentRows(connector), 'my-agent0602001');
    assert.equal(row.name, 'my-agent0602001');
    assert.equal(row.type, 'kimi');
    assert.equal(row.state, 'running');
    assert.equal(row.workspaceLabel, '(local)');
    // Composed row matches the requested format.
    assert.equal(
      [row.name, row.type, row.state, row.workspaceLabel].join(' '),
      'my-agent0602001 kimi running (local)',
    );
  });

  it('marks a local-only agent as Connect-available', () => {
    const connector = makeConnector({ 'lonely': { state: 'stopped' } });
    connector.config.addAgent({ name: 'lonely', type: 'kimi' });

    const row = rowFor(loadAgentRows(connector), 'lonely');
    assert.equal(connectAvailable(row), true);
  });
});

describe('TUI agent list — connecting refreshes the workspace label', () => {
  it('updates the row from "(local)" to the workspace URL after create/join', () => {
    const connector = makeConnector({ 'my-agent0602001': { state: 'running' } });
    connector.config.addAgent({ name: 'my-agent0602001', type: 'kimi' });

    // Before connecting: local-only.
    let row = rowFor(loadAgentRows(connector), 'my-agent0602001');
    assert.equal(row.workspaceLabel, '(local)');
    assert.equal(connectAvailable(row), true);

    // Simulate the create-workspace / join-token success path: persist the
    // network, then bind the agent to it (what doCreateWorkspace/doJoinToken do).
    connector.config.addNetwork({
      id: 'ws-abc123',
      slug: 'team-x',
      name: "my-agent0602001's workspace",
      endpoint: 'https://workspace.openagents.org',
      token: 'tok-123',
    });
    connector.connectWorkspace('my-agent0602001', 'team-x');

    // After refresh (re-running loadAgentRows): hosted URL, no longer local.
    row = rowFor(loadAgentRows(connector), 'my-agent0602001');
    assert.equal(row.workspace, 'workspace.openagents.org/team-x');
    assert.equal(row.workspaceLabel, 'workspace.openagents.org/team-x');
    assert.equal(connectAvailable(row), false);
  });

  it('keeps showing a localhost workspace endpoint normally (not "(local)")', () => {
    const connector = makeConnector({ 'dev': { state: 'running' } });
    connector.config.addNetwork({
      id: 'ws-local',
      slug: 'devspace',
      name: 'Dev',
      endpoint: 'http://localhost:8000',
      token: 'tok',
    });
    connector.config.addAgent({ name: 'dev', type: 'openclaw' });
    connector.connectWorkspace('dev', 'devspace');

    const row = rowFor(loadAgentRows(connector), 'dev');
    assert.equal(row.workspace, 'http://localhost:8000/devspace');
    assert.equal(row.workspaceLabel, 'http://localhost:8000/devspace');
    assert.equal(connectAvailable(row), false);
  });
});

describe('TUI agent list — connected agents unchanged', () => {
  it('renders a pre-connected hosted agent with its workspace URL', () => {
    const connector = makeConnector({ 'worker': { state: 'running' } });
    connector.config.addNetwork({
      id: 'ws-1',
      slug: 'prod',
      name: 'Prod',
      endpoint: 'https://workspace.openagents.org',
      token: 'tok',
    });
    connector.config.addAgent({ name: 'worker', type: 'claude' });
    connector.config.setAgentNetwork('worker', 'prod');

    const row = rowFor(loadAgentRows(connector), 'worker');
    assert.equal(row.workspace, 'workspace.openagents.org/prod');
    assert.equal(row.workspaceLabel, 'workspace.openagents.org/prod');
    assert.equal(connectAvailable(row), false);
  });
});
