/**
 * Interactive TUI dashboard for OpenAgents — `openagents` or `openagents tui`
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
  return entries.map(e => {
    let installed = false;
    try {
      const { whichBinary } = require('./paths');
      installed = !!whichBinary(e.install?.binary || e.name);
    } catch {}
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

const STATE_STYLES = {
  online:   { sym: '●', color: 'green',  label: 'running' },
  running:  { sym: '●', color: 'green',  label: 'running' },
  starting: { sym: '◐', color: 'yellow', label: 'starting' },
  reconnecting: { sym: '◐', color: 'yellow', label: 'reconnecting' },
  stopped:  { sym: '○', color: 'gray',   label: 'stopped' },
  error:    { sym: '✗', color: 'red',    label: 'error' },
  'not configured': { sym: '○', color: 'gray', label: 'not configured' },
};

// ── Main TUI ─────────────────────────────────────────────────────────────

function createTUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'OpenAgents',
    fullUnicode: true,
  });

  const connector = getConnector();
  let pkg;
  try { pkg = require('../package.json'); } catch { pkg = { version: '?' }; }

  // ── Layout ──

  // Header bar
  const header = blessed.box({
    top: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: 'blue', fg: 'white', bold: true },
  });

  // Title area below header
  const titleBox = blessed.box({
    top: 1, left: 0, width: '100%', height: 3,
    tags: true,
    content: `\n  {bold}OpenAgents{/bold} {gray-fg}v${pkg.version}{/gray-fg}    {gray-fg}Local AI Agent Manager{/gray-fg}`,
  });

  // Column headers for agent table
  const colHeaders = blessed.box({
    top: 4, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: 'white', fg: 'black' },
    content: `  ${'NAME'.padEnd(22)} ${'TYPE'.padEnd(14)} ${'STATUS'.padEnd(14)} WORKSPACE`,
  });

  // Agent list
  const agentList = blessed.list({
    top: 5, left: 0, width: '100%', height: '50%-2',
    tags: true, keys: true, vi: true, mouse: true,
    border: { type: 'line', left: false, right: false, top: false },
    style: {
      selected: { bg: 'blue', fg: 'white', bold: true },
      item: { fg: 'white' },
      border: { fg: 'gray' },
    },
  });

  // Separator
  const separator = blessed.line({
    top: '50%+3', left: 0, width: '100%',
    orientation: 'horizontal',
    style: { fg: 'gray' },
  });

  // Activity log
  const logLabel = blessed.box({
    top: '50%+4', left: 0, width: '100%', height: 1,
    tags: true,
    content: '  {bold}Activity{/bold}',
    style: { fg: 'white' },
  });

  const logContent = blessed.log({
    top: '50%+5', left: 0, width: '100%', height: '50%-8',
    tags: true,
    scrollable: true,
    scrollOnInput: true,
    padding: { left: 2 },
    style: { fg: 'gray' },
  });

  // Footer
  const footer = blessed.box({
    bottom: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: 'blue', fg: 'white' },
  });

  screen.append(header);
  screen.append(titleBox);
  screen.append(colHeaders);
  screen.append(agentList);
  screen.append(separator);
  screen.append(logLabel);
  screen.append(logContent);
  screen.append(footer);

  // ── State ──

  let agentRows = [];
  let currentView = 'main';

  function log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logContent.log(`{gray-fg}${ts}{/gray-fg}  ${msg}`);
    screen.render();
  }

  // ── Refresh ──

  function refreshAgentTable() {
    try {
      agentRows = loadAgentRows(connector);
    } catch { agentRows = []; }

    const items = agentRows.length ? agentRows.map(r => {
      const st = STATE_STYLES[r.state] || STATE_STYLES.stopped;
      const ws = r.workspace || '{gray-fg}—{/gray-fg}';
      return `  {${st.color}-fg}${st.sym}{/${st.color}-fg} ${r.name.padEnd(20)} ${r.type.padEnd(14)} {${st.color}-fg}${st.label.padEnd(14)}{/${st.color}-fg} ${ws}`;
    }) : ['  {gray-fg}No agents configured. Press {bold}i{/bold} to install, {bold}n{/bold} to create.{/gray-fg}'];

    agentList.setItems(items);
    updateHeader();
    updateFooter();
    screen.render();
  }

  function updateHeader() {
    const pid = connector.getDaemonPid();
    const dot = pid ? '{green-fg}●{/green-fg}' : '{gray-fg}○{/gray-fg}';
    const state = pid ? 'Daemon running' : 'Daemon idle';
    const count = agentRows.length;
    header.setContent(`  ${dot} ${state}  │  ${count} agent${count !== 1 ? 's' : ''} configured`);
  }

  function updateFooter() {
    footer.setContent('  {bold}i{/bold} Install  {bold}n{/bold} New  {bold}s{/bold} Start  {bold}x{/bold} Stop  {bold}c{/bold} Connect  {bold}u{/bold} Daemon  {bold}r{/bold} Refresh  {bold}q{/bold} Quit');
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

    // Header
    const installHeader = blessed.box({
      parent: installBox,
      top: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: 'blue', fg: 'white', bold: true },
      content: '  Install Agent Runtimes',
    });

    // Subtitle
    blessed.box({
      parent: installBox,
      top: 1, left: 0, width: '100%', height: 2,
      tags: true,
      content: '\n  {gray-fg}Select a runtime and press Enter to install or update.{/gray-fg}',
    });

    // Column headers
    blessed.box({
      parent: installBox,
      top: 3, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: 'white', fg: 'black' },
      content: `  ${'AGENT'.padEnd(25)} ${'STATUS'.padEnd(16)} DESCRIPTION`,
    });

    // Install list
    const installList = blessed.list({
      parent: installBox,
      top: 4, left: 0, width: '100%', height: '100%-7',
      tags: true, keys: true, vi: true, mouse: true,
      style: {
        selected: { bg: 'blue', fg: 'white', bold: true },
        item: { fg: 'white' },
      },
    });

    // Status bar at bottom
    const statusBar = blessed.box({
      parent: installBox,
      bottom: 1, left: 0, width: '100%', height: 1,
      tags: true,
      content: '',
    });

    // Footer
    blessed.box({
      parent: installBox,
      bottom: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: 'blue', fg: 'white' },
      content: '  {bold}Enter{/bold} Install/Update  {bold}Esc{/bold} Back',
    });

    function renderCatalog() {
      const items = catalog.map(e => {
        const st = e.installed
          ? '{green-fg}● installed{/green-fg}   '
          : '{yellow-fg}○ available{/yellow-fg}   ';
        const desc = e.description ? `{gray-fg}${e.description.substring(0, 45)}{/gray-fg}` : '';
        return `  ${e.label.padEnd(25)} ${st} ${desc}`;
      });
      installList.setItems(items);
    }

    renderCatalog();
    installList.focus();

    installList.on('select', (_item, idx) => {
      const entry = catalog[idx];
      if (!entry) return;

      const verb = entry.installed ? 'Update' : 'Install';
      const confirm = blessed.question({
        parent: installBox,
        top: 'center', left: 'center',
        width: 55, height: 7,
        border: { type: 'line' },
        tags: true,
        label: ` ${verb} `,
        style: { bg: 'black', fg: 'white', border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true } },
      });

      confirm.ask(`${verb} ${entry.label}? (y/n)`, (_err, ok) => {
        confirm.destroy();
        if (!ok) { installList.focus(); screen.render(); return; }
        doInstall(entry, statusBar, installList, catalog, renderCatalog);
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

  function doInstall(entry, statusBar, installList, catalog, renderCatalog) {
    statusBar.setContent(`  {cyan-fg}Installing ${entry.name}...{/cyan-fg}`);
    screen.render();

    const installer = connector.getInstaller();
    const installCmd = installer._resolveInstallCommand(entry.name);
    if (!installCmd) {
      statusBar.setContent(`  {red-fg}✗ No install command for ${entry.name}{/red-fg}`);
      screen.render();
      installList.focus();
      return;
    }

    log(`{cyan-fg}$ ${installCmd}{/cyan-fg}`);
    statusBar.setContent(`  {gray-fg}$ ${installCmd.substring(0, 80)}{/gray-fg}`);
    screen.render();

    const env = { ...process.env };
    env.npm_config_yes = 'true';
    env.CI = '1';

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
    let lineCount = 0;
    const onData = (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        lastLine = line.trim().substring(0, 100);
        lineCount++;
        log(`  ${lastLine}`);
        statusBar.setContent(`  {gray-fg}[${lineCount} lines] ${lastLine.substring(0, 70)}{/gray-fg}`);
        screen.render();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('close', (code) => {
      if (code === 0) {
        statusBar.setContent(`  {green-fg}✓ ${entry.name} installed successfully{/green-fg}`);
        log(`{green-fg}✓ ${entry.name} installed successfully{/green-fg}`);
        // Mark installed
        try {
          const markerFile = path.join(connector.config?.configDir || '', 'installed_agents.json');
          let markers = {};
          try { markers = JSON.parse(fs.readFileSync(markerFile, 'utf-8')); } catch {}
          markers[entry.name] = { installed_at: new Date().toISOString() };
          fs.writeFileSync(markerFile, JSON.stringify(markers, null, 2));
        } catch {}
        // Refresh
        try {
          const newCatalog = loadCatalog(connector);
          for (let i = 0; i < catalog.length; i++) {
            const updated = newCatalog.find(c => c.name === catalog[i].name);
            if (updated) catalog[i] = updated;
          }
          // Also mark the just-installed one
          const idx = catalog.findIndex(c => c.name === entry.name);
          if (idx >= 0) catalog[idx].installed = true;
          renderCatalog();
        } catch {}
      } else {
        statusBar.setContent(`  {red-fg}✗ Failed (exit ${code}): ${lastLine.substring(0, 60)}{/red-fg}`);
        log(`{red-fg}✗ ${entry.name} install failed (exit ${code}){/red-fg}`);
      }
      installList.focus();
      screen.render();
    });
  }

  // ── New Agent Dialog ──

  function showNewAgentDialog() {
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 60, height: 16,
      border: { type: 'line' },
      tags: true, keys: true,
      label: ' {bold}Create Agent{/bold} ',
      style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
    });

    blessed.text({ parent: dialog, top: 1, left: 2, tags: true, content: '{bold}Name:{/bold}' });
    const nameInput = blessed.textbox({
      parent: dialog, top: 2, left: 2, width: 44, height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      style: { border: { fg: 'gray' }, focus: { border: { fg: 'cyan' } } },
    });

    blessed.text({ parent: dialog, top: 5, left: 2, tags: true, content: '{bold}Type:{/bold} {gray-fg}(openclaw, claude, codex, aider, goose){/gray-fg}' });
    const typeInput = blessed.textbox({
      parent: dialog, top: 6, left: 2, width: 44, height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      value: 'openclaw',
      style: { border: { fg: 'gray' }, focus: { border: { fg: 'cyan' } } },
    });

    const statusLabel = blessed.text({ parent: dialog, top: 10, left: 2, tags: true, content: '' });

    const createBtn = blessed.button({
      parent: dialog, top: 12, left: 2, width: 14, height: 1,
      content: '  Create  ', tags: true, mouse: true,
      style: { bg: 'blue', fg: 'white', focus: { bg: 'cyan' }, hover: { bg: 'cyan' } },
    });

    const cancelBtn = blessed.button({
      parent: dialog, top: 12, left: 18, width: 14, height: 1,
      content: '  Cancel  ', tags: true, mouse: true,
      style: { bg: 'gray', fg: 'white', focus: { bg: 'red' }, hover: { bg: 'red' } },
    });

    function doCreate() {
      const name = nameInput.getValue().trim();
      const type = typeInput.getValue().trim();
      if (!name) { statusLabel.setContent('{red-fg}Name is required{/red-fg}'); screen.render(); return; }
      if (!type) { statusLabel.setContent('{red-fg}Type is required{/red-fg}'); screen.render(); return; }
      try {
        connector.createAgent(name, type);
        log(`{green-fg}✓ Agent '${name}' (${type}) created{/green-fg}`);
        screen.remove(dialog);
        dialog.destroy();
        agentList.focus();
        refreshAgentTable();
      } catch (e) {
        statusLabel.setContent(`{red-fg}${e.message}{/red-fg}`);
        screen.render();
      }
    }

    createBtn.on('press', doCreate);
    cancelBtn.on('press', () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    });

    dialog.key('escape', () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    });

    screen.append(dialog);
    nameInput.focus();
    screen.render();
  }

  // ── Keybindings ──

  screen.key('q', () => { if (currentView === 'main') process.exit(0); });
  screen.key('C-c', () => process.exit(0));

  screen.key('i', () => { if (currentView === 'main') showInstallScreen(); });
  screen.key('n', () => { if (currentView === 'main') showNewAgentDialog(); });

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
    if (!agent) { log('{yellow-fg}No agent selected{/yellow-fg}'); return; }
    try {
      connector.startAgent(agent.name);
      log(`Starting ${agent.name}...`);
    } catch (e) { log(`{red-fg}Error: ${e.message}{/red-fg}`); }
    setTimeout(refreshAgentTable, 2000);
  });

  screen.key('x', () => {
    if (currentView !== 'main') return;
    const idx = agentList.selected;
    const agent = agentRows[idx];
    if (!agent) { log('{yellow-fg}No agent selected{/yellow-fg}'); return; }
    try {
      connector.stopAgent(agent.name);
      log(`Stopped ${agent.name}`);
    } catch (e) { log(`{red-fg}Error: ${e.message}{/red-fg}`); }
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
      log('Daemon starting...');
    }
    setTimeout(refreshAgentTable, 2000);
  });

  screen.key('c', () => {
    if (currentView !== 'main') return;
    const idx = agentList.selected;
    const agent = agentRows[idx];
    if (!agent) { log('{yellow-fg}No agent selected{/yellow-fg}'); return; }
    log(`{gray-fg}Use: openagents connect ${agent.name} <workspace-token>{/gray-fg}`);
  });

  screen.key('d', () => {
    if (currentView !== 'main') return;
    const idx = agentList.selected;
    const agent = agentRows[idx];
    if (!agent) { log('{yellow-fg}No agent selected{/yellow-fg}'); return; }
    try {
      connector.disconnectAgent(agent.name);
      log(`Disconnected ${agent.name}`);
    } catch (e) { log(`{red-fg}Error: ${e.message}{/red-fg}`); }
    refreshAgentTable();
  });

  // ── Init ──

  agentList.focus();
  refreshAgentTable();
  log('Welcome to {bold}OpenAgents{/bold}. Press {bold}i{/bold} to install agents, {bold}n{/bold} to create one.');

  setInterval(refreshAgentTable, 5000);
  screen.render();
  return screen;
}

// ── Entry point ──────────────────────────────────────────────────────────

function run() {
  createTUI();
}

module.exports = { run };
