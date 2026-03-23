/**
 * Interactive TUI dashboard for OpenAgents — `agent-connector` or `agent-connector tui`
 *
 * Ported from Python Textual TUI (cli_tui.py). Uses blessed for terminal UI.
 */

'use strict';

const blessed = require('blessed');
const { AgentConnector } = require('./index');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getExtraBinDirs } = require('./paths');

// ── Helpers ──────────────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === 'win32';

function getConnector() {
  const configDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.openagents');
  return new AgentConnector(configDir);
}

function loadAgentRows(connector) {
  const config = connector.getConfig();
  const agents = config.agents || [];
  const status = connector.getDaemonStatus() || {};
  const agentStatuses = status.agents || {};
  const pid = connector.getDaemonPid();

  return agents.map(agent => {
    const info = agentStatuses[agent.name] || {};
    const state = pid ? (info.state || 'stopped') : 'stopped';
    let workspace = '';
    if (agent.network) {
      const nets = config.networks || [];
      const net = nets.find(n => n.slug === agent.network || n.id === agent.network);
      if (net) {
        workspace = `${net.slug || net.id} (${net.name || ''})`;
      } else {
        workspace = agent.network;
      }
    }
    return { name: agent.name, type: agent.type, state, workspace, role: agent.role || 'worker' };
  });
}

function loadCatalog(connector) {
  const registry = connector.getRegistry();
  const entries = registry.list();
  // Check installed status
  return entries.map(e => {
    let installed = false;
    try {
      const { whichBinary } = require('./paths');
      installed = !!whichBinary(e.install?.binary || e.name);
    } catch {}
    // Also check installed_agents.json marker
    if (!installed) {
      try {
        const markerFile = path.join(connector.config?.configDir || '', 'installed_agents.json');
        if (fs.existsSync(markerFile)) {
          const markers = JSON.parse(fs.readFileSync(markerFile, 'utf-8'));
          installed = !!markers[e.name];
        }
      } catch {}
    }
    return {
      name: e.name,
      label: e.label || e.name,
      description: e.description || '',
      installed,
    };
  });
}

const STATE_COLORS = {
  online: 'green', running: 'green',
  starting: 'yellow', reconnecting: 'yellow',
  stopped: 'white', error: 'red',
  'not configured': 'white',
};

const STATE_SYMBOLS = {
  online: '●', running: '●',
  starting: '◐', reconnecting: '◐',
  stopped: '○', error: '✗',
  'not configured': '○',
};

// ── Main TUI ─────────────────────────────────────────────────────────────

function createTUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'OpenAgents',
    fullUnicode: true,
  });

  const connector = getConnector();

  // ── Layout ──

  // Header
  const header = blessed.box({
    top: 0, left: 0, width: '100%', height: 3,
    content: '{bold}  OpenAgents{/bold}  {gray-fg}Interactive Setup{/gray-fg}',
    tags: true,
    style: { bg: 'blue', fg: 'white' },
  });

  // Agent table
  const agentBox = blessed.box({
    top: 3, left: 0, width: '100%', height: '60%',
    border: { type: 'line' },
    label: ' Agents ',
    tags: true,
    scrollable: true,
    keys: true,
    vi: true,
  });

  const agentList = blessed.list({
    parent: agentBox,
    top: 0, left: 0, width: '100%-2', height: '100%-2',
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    style: {
      selected: { bg: 'blue', fg: 'white' },
      item: { fg: 'white' },
    },
  });

  // Activity log
  const logBox = blessed.box({
    top: '60%+3', left: 0, width: '100%', height: '40%-6',
    border: { type: 'line' },
    label: ' Activity Log ',
    tags: true,
    scrollable: true,
  });

  const logContent = blessed.log({
    parent: logBox,
    top: 0, left: 0, width: '100%-2', height: '100%-2',
    tags: true,
    scrollable: true,
    scrollOnInput: true,
  });

  // Footer with keybindings
  const footer = blessed.box({
    bottom: 0, left: 0, width: '100%', height: 3,
    tags: true,
    style: { bg: 'blue', fg: 'white' },
  });

  screen.append(header);
  screen.append(agentBox);
  screen.append(logBox);
  screen.append(footer);

  // ── State ──

  let agentRows = [];
  let currentView = 'main'; // main | install | configure

  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    logContent.log(`{gray-fg}${ts}{/gray-fg} ${msg}`);
    screen.render();
  }

  // ── Refresh ──

  function refreshAgentTable() {
    try {
      agentRows = loadAgentRows(connector);
    } catch { agentRows = []; }

    const items = agentRows.length ? agentRows.map(r => {
      const sym = STATE_SYMBOLS[r.state] || '?';
      const color = STATE_COLORS[r.state] || 'white';
      const ws = r.workspace ? `  ${r.workspace}` : '';
      return `  {${color}-fg}${sym}{/${color}-fg} ${r.name.padEnd(20)} ${r.type.padEnd(12)} {${color}-fg}${r.state.padEnd(12)}{/${color}-fg}${ws}`;
    }) : ['  {gray-fg}No agents configured — press {bold}i{/bold} to install one{/gray-fg}'];

    agentList.setItems(items);
    updateFooter();
    screen.render();
  }

  function updateFooter() {
    const pid = connector.getDaemonPid();
    const daemonState = pid ? '{green-fg}● running{/green-fg}' : '{yellow-fg}○ idle{/yellow-fg}';

    const keys = [
      '{bold}i{/bold}:Install', '{bold}n{/bold}:New', '{bold}s{/bold}:Start', '{bold}x{/bold}:Stop',
      '{bold}c{/bold}:Connect', '{bold}d{/bold}:Disconnect', '{bold}u{/bold}:Daemon',
      '{bold}r{/bold}:Refresh', '{bold}q{/bold}:Quit',
    ];
    footer.setContent(`  Daemon: ${daemonState}  │  ${keys.join('  ')}`);
  }

  // ── Install Screen ──

  function showInstallScreen() {
    currentView = 'install';
    let catalog;
    try {
      catalog = loadCatalog(connector);
    } catch (e) {
      log(`{red-fg}Error loading catalog: ${e.message}{/red-fg}`);
      return;
    }

    const installBox = blessed.box({
      top: 0, left: 0, width: '100%', height: '100%',
      tags: true,
    });

    const installHeader = blessed.box({
      parent: installBox,
      top: 0, left: 0, width: '100%', height: 3,
      content: '{bold}  Install Agent Runtime{/bold}  {gray-fg}Enter to install, Escape to go back{/gray-fg}',
      tags: true,
      style: { bg: 'blue', fg: 'white' },
    });

    const installList = blessed.list({
      parent: installBox,
      top: 3, left: 0, width: '100%', height: '100%-6',
      border: { type: 'line' },
      tags: true, keys: true, vi: true, mouse: true,
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' },
      },
    });

    const installFooter = blessed.box({
      parent: installBox,
      bottom: 0, left: 0, width: '100%', height: 3,
      tags: true,
      style: { bg: 'blue', fg: 'white' },
      content: '  {bold}Enter{/bold}:Install/Update  {bold}Escape{/bold}:Back',
    });

    const items = catalog.map(e => {
      const status = e.installed ? '{green-fg}installed{/green-fg}' : '{yellow-fg}not installed{/yellow-fg}';
      const desc = e.description ? `  {gray-fg}${e.description.substring(0, 40)}{/gray-fg}` : '';
      return `  ${e.label.padEnd(25)} ${status}${desc}`;
    });

    installList.setItems(items);
    installList.focus();

    installList.on('select', (item, idx) => {
      const entry = catalog[idx];
      if (!entry) return;

      const verb = entry.installed ? 'Update' : 'Install';
      // Show confirm dialog
      const confirm = blessed.question({
        parent: installBox,
        top: 'center', left: 'center',
        width: 50, height: 7,
        border: { type: 'line' },
        tags: true,
        style: { bg: 'black', fg: 'white', border: { fg: 'blue' } },
      });

      confirm.ask(`${verb} ${entry.label}?`, (err, ok) => {
        confirm.destroy();
        if (!ok) { installList.focus(); screen.render(); return; }
        doInstall(entry, installBox, installList);
      });
    });

    installList.key('escape', () => {
      screen.remove(installBox);
      installBox.destroy();
      currentView = 'main';
      agentList.focus();
      refreshAgentTable();
    });

    screen.append(installBox);
    installList.focus();
    screen.render();
  }

  function doInstall(entry, installBox, installList) {
    const statusLine = blessed.box({
      parent: installBox,
      bottom: 3, left: 0, width: '100%', height: 1,
      tags: true,
      content: `  Installing ${entry.name}...`,
    });
    screen.render();

    const installer = connector.getInstaller();
    const installCmd = installer._resolveInstallCommand(entry.name);
    if (!installCmd) {
      statusLine.setContent(`  {red-fg}✗ No install command for ${entry.name}{/red-fg}`);
      screen.render();
      return;
    }

    log(`Installing ${entry.name}: ${installCmd}`);
    statusLine.setContent(`  {cyan-fg}$ ${installCmd}{/cyan-fg}`);
    screen.render();

    const env = { ...process.env };
    env.npm_config_yes = 'true';
    env.CI = '1';

    // Enhance PATH
    const extraDirs = getExtraBinDirs();
    if (extraDirs.length) {
      const sep = IS_WINDOWS ? ';' : ':';
      env.PATH = extraDirs.join(sep) + sep + (env.PATH || '');
    }

    const proc = spawn(installCmd, [], {
      shell: true, env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastLine = '';
    const onData = (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        lastLine = line.trim().substring(0, 100);
        log(`  ${lastLine}`);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('close', (code) => {
      if (code === 0) {
        statusLine.setContent(`  {green-fg}✓ ${entry.name} installed successfully{/green-fg}`);
        log(`{green-fg}✓ ${entry.name} installed{/green-fg}`);
        // Mark as installed
        try {
          const markerFile = path.join(connector.config?.configDir || '', 'installed_agents.json');
          let markers = {};
          try { markers = JSON.parse(fs.readFileSync(markerFile, 'utf-8')); } catch {}
          markers[entry.name] = { installed_at: new Date().toISOString() };
          fs.writeFileSync(markerFile, JSON.stringify(markers, null, 2));
        } catch {}
        // Refresh catalog
        try {
          const newCatalog = loadCatalog(connector);
          const newItems = newCatalog.map(e => {
            const st = e.installed ? '{green-fg}installed{/green-fg}' : '{yellow-fg}not installed{/yellow-fg}';
            const desc = e.description ? `  {gray-fg}${e.description.substring(0, 40)}{/gray-fg}` : '';
            return `  ${e.label.padEnd(25)} ${st}${desc}`;
          });
          installList.setItems(newItems);
        } catch {}
      } else {
        statusLine.setContent(`  {red-fg}✗ Install failed (exit ${code}): ${lastLine}{/red-fg}`);
        log(`{red-fg}✗ ${entry.name} install failed (exit ${code}){/red-fg}`);
      }
      installList.focus();
      screen.render();
    });
  }

  // ── New Agent ──

  function showNewAgentDialog() {
    const form = blessed.form({
      top: 'center', left: 'center',
      width: 60, height: 14,
      border: { type: 'line' },
      tags: true, keys: true,
      label: ' New Agent ',
      style: { border: { fg: 'blue' } },
    });

    blessed.text({ parent: form, top: 1, left: 2, content: 'Agent name:', tags: true });
    const nameInput = blessed.textbox({
      parent: form, top: 2, left: 2, width: 40, height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      style: { focus: { border: { fg: 'blue' } } },
    });

    blessed.text({ parent: form, top: 5, left: 2, content: 'Type (openclaw/claude/codex/aider/goose):', tags: true });
    const typeInput = blessed.textbox({
      parent: form, top: 6, left: 2, width: 40, height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      value: 'openclaw',
      style: { focus: { border: { fg: 'blue' } } },
    });

    blessed.button({
      parent: form, top: 10, left: 2, width: 12, height: 1,
      content: ' Create ', tags: true,
      style: { bg: 'blue', fg: 'white', focus: { bg: 'cyan' } },
      mouse: true,
    }).on('press', () => {
      const name = nameInput.getValue().trim();
      const type = typeInput.getValue().trim();
      if (!name || !type) return;
      try {
        connector.createAgent(name, type);
        log(`{green-fg}✓ Agent '${name}' (${type}) created{/green-fg}`);
      } catch (e) {
        log(`{red-fg}✗ Error: ${e.message}{/red-fg}`);
      }
      screen.remove(form);
      form.destroy();
      agentList.focus();
      refreshAgentTable();
    });

    form.key('escape', () => {
      screen.remove(form);
      form.destroy();
      agentList.focus();
      screen.render();
    });

    screen.append(form);
    nameInput.focus();
    screen.render();
  }

  // ── Keybindings ──

  screen.key('q', () => process.exit(0));
  screen.key('C-c', () => process.exit(0));

  screen.key('i', () => {
    if (currentView === 'main') showInstallScreen();
  });

  screen.key('n', () => {
    if (currentView === 'main') showNewAgentDialog();
  });

  screen.key('r', () => {
    if (currentView === 'main') {
      refreshAgentTable();
      log('Refreshed');
    }
  });

  screen.key('s', () => {
    if (currentView !== 'main') return;
    const idx = agentList.selected;
    const agent = agentRows[idx];
    if (!agent) return;
    try {
      connector.startAgent(agent.name);
      log(`Starting ${agent.name}...`);
    } catch (e) {
      log(`{red-fg}Error: ${e.message}{/red-fg}`);
    }
    setTimeout(refreshAgentTable, 2000);
  });

  screen.key('x', () => {
    if (currentView !== 'main') return;
    const idx = agentList.selected;
    const agent = agentRows[idx];
    if (!agent) return;
    try {
      connector.stopAgent(agent.name);
      log(`Stopped ${agent.name}`);
    } catch (e) {
      log(`{red-fg}Error: ${e.message}{/red-fg}`);
    }
    setTimeout(refreshAgentTable, 1000);
  });

  screen.key('u', () => {
    if (currentView !== 'main') return;
    const pid = connector.getDaemonPid();
    if (pid) {
      connector.stopDaemon();
      log('Daemon stopped');
    } else {
      connector.startDaemon();
      log('Daemon started');
    }
    setTimeout(refreshAgentTable, 2000);
  });

  screen.key('c', () => {
    if (currentView !== 'main') return;
    const idx = agentList.selected;
    const agent = agentRows[idx];
    if (!agent) return;
    // TODO: show workspace picker
    log(`Connect: use 'agent-connector connect ${agent.name} <workspace-slug>' from terminal`);
  });

  screen.key('d', () => {
    if (currentView !== 'main') return;
    const idx = agentList.selected;
    const agent = agentRows[idx];
    if (!agent) return;
    try {
      connector.disconnectAgent(agent.name);
      log(`Disconnected ${agent.name}`);
    } catch (e) {
      log(`{red-fg}Error: ${e.message}{/red-fg}`);
    }
    refreshAgentTable();
  });

  // ── Init ──

  agentList.focus();
  refreshAgentTable();
  log('Ready. Press {bold}i{/bold} to install agents, {bold}n{/bold} to create one.');

  // Auto-refresh every 5 seconds
  setInterval(refreshAgentTable, 5000);

  screen.render();
  return screen;
}

// ── Entry point ──────────────────────────────────────────────────────────

function run() {
  createTUI();
}

module.exports = { run };
