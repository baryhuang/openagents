/**
 * Interactive TUI dashboard for OpenAgents — `openagents` or `openagents tui`
 *
 * Mirrors the Python Textual TUI (cli_tui.py) with blessed.
 */

'use strict';

const blessed = require('blessed');
const { AgentConnector } = require('./index');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getExtraBinDirs } = require('./paths');

const IS_WINDOWS = process.platform === 'win32';

// ── Color palette ───────────────────────────────────────────────────────────

const COLORS = {
  primary: 'blue',
  accent: 'cyan',
  surface: 'black',
  headerBg: 'blue',
  headerFg: 'white',
  footerBg: 'blue',
  footerFg: 'white',
  panelBorder: 'cyan',
  logBorder: 'blue',
  colHeaderBg: 'grey',
  colHeaderFg: 'black',
  selected: { bg: 'blue', fg: 'white' },
  stateRunning: 'green',
  stateStopped: 'gray',
  stateError: 'red',
  stateStarting: 'yellow',
};

const STATE_DISPLAY = {
  online:        { sym: '\u25CF', color: COLORS.stateRunning },
  running:       { sym: '\u25CF', color: COLORS.stateRunning },
  starting:      { sym: '\u25D0', color: COLORS.stateStarting },
  reconnecting:  { sym: '\u25D0', color: COLORS.stateStarting },
  stopped:       { sym: '\u25CB', color: COLORS.stateStopped },
  'not configured': { sym: '\u25CB', color: COLORS.stateStopped },
  error:         { sym: '\u2717', color: COLORS.stateError },
};

function stateMarkup(state) {
  const d = STATE_DISPLAY[state] || { sym: '?', color: 'white' };
  return `{${d.color}-fg}${d.sym} ${state}{/${d.color}-fg}`;
}

// ── Data helpers ────────────────────────────────────────────────────────────

function getConnector() {
  const configDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.openagents');
  return new AgentConnector({ configDir });
}

function loadAgentRows(connector) {
  const config = connector.config.load();
  const agents = config.agents || [];
  const agentStatuses = connector.getDaemonStatus() || {};
  const pid = connector.getDaemonPid();
  const networks = config.networks || [];
  return agents.map(agent => {
    const info = agentStatuses[agent.name] || {};
    const state = pid ? (info.state || 'stopped') : 'stopped';
    let workspace = '';
    if (agent.network) {
      const net = networks.find(n => n.slug === agent.network || n.id === agent.network);
      if (net) {
        const slug = net.slug || net.id;
        const isLocal = (net.endpoint || '').includes('localhost') || (net.endpoint || '').includes('127.0.0.1');
        if (isLocal) workspace = `${net.endpoint}/${slug}`;
        else workspace = `workspace.openagents.org/${slug}`;
      } else {
        workspace = agent.network;
      }
    }
    return {
      name: agent.name,
      type: agent.type || 'openclaw',
      state,
      workspace,
      path: agent.path || '',
      network: agent.network || '',
      lastError: info.last_error || '',
      configured: true,
    };
  });
}

function loadCatalog(connector) {
  const entries = connector.registry.getCatalogSync();
  return entries.map(e => {
    let installed = false;
    try { const { whichBinary } = require('./paths'); installed = !!whichBinary((e.install && e.install.binary) || e.name); } catch {}
    if (!installed) {
      try {
        const f = path.join(connector._configDir, 'installed_agents.json');
        if (fs.existsSync(f)) installed = !!JSON.parse(fs.readFileSync(f, 'utf-8'))[e.name];
      } catch {}
    }
    return {
      name: e.name,
      label: e.label || e.name,
      description: e.description || '',
      installed,
      envConfig: e.env_config || [],
      checkReady: e.check_ready || null,
      loginCommand: (e.check_ready && e.check_ready.login_command) || null,
    };
  });
}

function generateAgentName(type) {
  const adj = ['swift', 'bright', 'calm', 'keen', 'bold'];
  const noun = ['wolf', 'hawk', 'fox', 'bear', 'lynx'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${type}-${a}-${n}-${num}`;
}

// ── Main TUI ────────────────────────────────────────────────────────────────

function createTUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'OpenAgents',
    fullUnicode: true,
    tags: true,
  });
  const connector = getConnector();
  let pkg;
  try { pkg = require('../package.json'); } catch { pkg = { version: '?' }; }

  let agentRows = [];
  let currentView = 'main';

  // ── Header ──
  const header = blessed.box({
    top: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: COLORS.headerBg, fg: COLORS.headerFg, bold: true },
  });

  // ── Title ──
  const titleBox = blessed.box({
    top: 1, left: 0, width: '100%', height: 1,
    tags: true,
    content: `  {bold}OpenAgents{/bold} {gray-fg}v${pkg.version}{/gray-fg}`,
    style: { fg: 'white' },
  });

  // ── Agent Panel (bordered) ──
  const agentPanel = blessed.box({
    top: 2, left: 0, width: '100%', height: '60%-1',
    border: { type: 'line' },
    label: ' {bold}Agents{/bold} ',
    tags: true,
    style: { border: { fg: COLORS.panelBorder }, label: { fg: COLORS.accent } },
  });

  // ── Column Headers ──
  const colHeaders = blessed.box({
    parent: agentPanel,
    top: 0, left: 0, width: '100%-2', height: 1,
    tags: true,
    style: { bg: COLORS.colHeaderBg, fg: COLORS.colHeaderFg },
    content: `  ${'NAME'.padEnd(22)} ${'TYPE'.padEnd(14)} ${'STATUS'.padEnd(18)} WORKSPACE`,
  });

  // ── Agent List ──
  const agentList = blessed.list({
    parent: agentPanel,
    top: 1, left: 0, width: '100%-2', height: '100%-3',
    keys: true, vi: true, mouse: true,
    tags: true,
    style: {
      selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
      item: { fg: 'white' },
    },
  });

  // ── Log Panel (bordered) ──
  const logPanel = blessed.box({
    top: '60%+1', left: 0, width: '100%', height: '40%-3',
    border: { type: 'line' },
    label: ' {bold}Activity Log{/bold} ',
    tags: true,
    style: { border: { fg: COLORS.logBorder }, label: { fg: COLORS.primary } },
  });

  const logContent = blessed.log({
    parent: logPanel,
    top: 0, left: 0, width: '100%-2', height: '100%-2',
    scrollable: true, scrollOnInput: true,
    tags: true,
    style: { fg: 'white' },
  });

  // ── Footer ──
  const footer = blessed.box({
    bottom: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: COLORS.footerBg, fg: COLORS.footerFg },
  });

  screen.append(header);
  screen.append(titleBox);
  screen.append(agentPanel);
  screen.append(logPanel);
  screen.append(footer);

  // ── Log helper ──
  function log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logContent.log(`{gray-fg}${ts}{/gray-fg}  ${msg}`);
    screen.render();
  }

  // ── Footer rendering (context-aware) ──
  function updateFooter() {
    const agent = agentRows[agentList.selected];
    const parts = [];

    parts.push('{cyan-fg}i{/cyan-fg} Install');
    parts.push('{cyan-fg}n{/cyan-fg} New');

    if (agent && agent.configured) {
      const isRunning = ['running', 'online', 'starting', 'reconnecting'].includes(agent.state);
      const isStopped = ['stopped', 'error'].includes(agent.state);

      if (isStopped) parts.push('{cyan-fg}s{/cyan-fg} Start');
      if (isRunning) parts.push('{cyan-fg}x{/cyan-fg} Stop');

      const envFields = connector.registry.getEnvFields(agent.type);
      if (envFields && envFields.length > 0) parts.push('{cyan-fg}e{/cyan-fg} Configure');

      if (!agent.workspace) parts.push('{cyan-fg}c{/cyan-fg} Connect');
      if (agent.workspace) parts.push('{cyan-fg}d{/cyan-fg} Disconnect');
      if (agent.workspace) parts.push('{cyan-fg}w{/cyan-fg} Workspace');

      parts.push('{cyan-fg}Del{/cyan-fg} Remove');
    }

    parts.push('{cyan-fg}u{/cyan-fg} Daemon');
    parts.push('{cyan-fg}r{/cyan-fg} Refresh');
    parts.push('{cyan-fg}q{/cyan-fg} Quit');

    footer.setContent(' ' + parts.join('  '));
    screen.render();
  }

  // ── Agent table refresh ──
  function refreshAgentTable() {
    const savedIdx = agentList.selected || 0;
    try { agentRows = loadAgentRows(connector); } catch { agentRows = []; }

    if (agentRows.length === 0) {
      agentList.setItems(['  {gray-fg}No agents configured. Press {bold}i{/bold} to install, {bold}n{/bold} to create.{/gray-fg}']);
    } else {
      const items = agentRows.map(r => {
        const state = stateMarkup(r.state);
        const ws = r.workspace || '{gray-fg}-{/gray-fg}';
        const pathInfo = r.path ? `{gray-fg} ${r.path}{/gray-fg}` : '';
        return `  ${r.name.padEnd(22)} ${r.type.padEnd(14)} ${state.padEnd(30)} ${ws}${pathInfo}`;
      });
      agentList.setItems(items);
    }

    // Restore cursor position
    if (agentRows.length > 0) {
      agentList.select(Math.min(savedIdx, agentRows.length - 1));
    }

    updateHeader();
    updateFooter();
    screen.render();
  }

  function updateHeader() {
    const pid = connector.getDaemonPid();
    const dot = pid ? `{green-fg}\u25CF{/green-fg}` : `{gray-fg}\u25CB{/gray-fg}`;
    const state = pid ? 'Daemon running' : 'Daemon idle';
    const count = agentRows.length;
    header.setContent(`  ${dot} ${state}  {gray-fg}|{/gray-fg}  ${count} agent${count !== 1 ? 's' : ''} configured`);
  }

  // Update footer when selection changes
  agentList.on('select item', () => updateFooter());

  // ── Enter key → Context menu ──
  agentList.on('select', (_item, idx) => {
    if (currentView !== 'main') return;
    const agent = agentRows[idx];
    if (!agent || !agent.configured) return;
    showAgentActionMenu(agent);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Agent Action Menu (context menu on Enter)
  // ────────────────────────────────────────────────────────────────────────

  function showAgentActionMenu(agent) {
    const actions = [];
    const isRunning = ['running', 'online', 'starting', 'reconnecting'].includes(agent.state);
    const isStopped = ['stopped', 'error'].includes(agent.state);

    const envFields = connector.registry.getEnvFields(agent.type);
    if (envFields && envFields.length > 0) actions.push({ label: 'Configure', key: 'configure' });

    const catalog = connector.registry.getCatalogSync();
    const entry = catalog.find(e => e.name === agent.type);
    if (entry && entry.check_ready && entry.check_ready.login_command) {
      actions.push({ label: 'Login', key: 'login' });
    }

    if (isStopped) actions.push({ label: 'Start', key: 'start' });
    if (isRunning) actions.push({ label: 'Stop', key: 'stop' });
    if (agent.workspace) actions.push({ label: 'Open Workspace', key: 'open_workspace' });
    if (!agent.workspace) actions.push({ label: 'Connect to Workspace', key: 'connect' });
    if (agent.workspace) actions.push({ label: 'Disconnect from Workspace', key: 'disconnect' });
    actions.push({ label: 'Remove', key: 'remove' });

    if (actions.length === 0) return;

    const listHeight = Math.min(actions.length + 2, 14);
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 40, height: listHeight + 2,
      border: { type: 'line' },
      tags: true,
      label: ` {bold}${agent.name}{/bold} `,
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
    });

    const actionList = blessed.list({
      parent: dialog,
      top: 0, left: 1, width: '100%-4', height: listHeight,
      keys: true, vi: true, mouse: true,
      tags: true,
      style: {
        selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
        item: { fg: 'white' },
      },
      items: actions.map(a => `  ${a.label}`),
    });

    screen.append(dialog);
    actionList.focus();
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };

    actionList.on('select', (_item, idx) => {
      const action = actions[idx];
      close();
      if (!action) return;
      switch (action.key) {
        case 'configure': showConfigureScreen(agent); break;
        case 'login': doLogin(agent); break;
        case 'start': doStart(agent.name); break;
        case 'stop': doStop(agent.name); break;
        case 'open_workspace': doOpenWorkspace(agent); break;
        case 'connect': showConnectWorkspaceScreen(agent.name); break;
        case 'disconnect': doDisconnect(agent.name); break;
        case 'remove': doRemove(agent.name); break;
      }
    });

    actionList.key('escape', close);
    dialog.key('escape', close);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Install Screen
  // ────────────────────────────────────────────────────────────────────────

  function showInstallScreen() {
    currentView = 'install';
    let catalog;
    try { catalog = loadCatalog(connector); } catch (e) { log(`{red-fg}Error:{/red-fg} ${e.message}`); return; }

    const box = blessed.box({ top: 0, left: 0, width: '100%', height: '100%', style: { bg: COLORS.surface } });

    blessed.box({
      parent: box, top: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.headerBg, fg: COLORS.headerFg, bold: true },
      content: '  {bold}Install Agent Runtimes{/bold}  {gray-fg}\u2014  Enter to install, Esc to go back{/gray-fg}',
    });

    blessed.box({
      parent: box, top: 1, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.colHeaderBg, fg: COLORS.colHeaderFg },
      content: `  ${'AGENT'.padEnd(25)} ${'STATUS'.padEnd(18)} DESCRIPTION`,
    });

    const list = blessed.list({
      parent: box, top: 2, left: 0, width: '100%', height: '50%-1',
      keys: true, vi: true, mouse: true,
      tags: true,
      style: {
        selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
        item: { fg: 'white' },
      },
    });

    // Install log panel — shows full streaming output
    const logPanel = blessed.box({
      parent: box, top: '50%+1', left: 0, width: '100%', height: '50%-2',
      border: { type: 'line' },
      label: ' {bold}Install Log{/bold} ',
      tags: true,
      style: { border: { fg: COLORS.panelBorder }, label: { fg: COLORS.accent } },
    });

    const installLog = blessed.log({
      parent: logPanel,
      top: 0, left: 0, width: '100%-2', height: '100%-2',
      scrollable: true, scrollOnInput: true,
      tags: true,
      padding: { left: 1 },
      style: { fg: 'grey' },
    });

    blessed.box({
      parent: box, bottom: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.footerBg, fg: COLORS.footerFg },
      content: ' {cyan-fg}Enter{/cyan-fg} Install/Update  {cyan-fg}Esc{/cyan-fg} Back',
    });

    function renderList() {
      list.setItems(catalog.map(e => {
        const st = e.installed
          ? `{green-fg}\u25CF installed{/green-fg}`
          : `{yellow-fg}\u25CB available{/yellow-fg}`;
        const desc = e.description ? e.description.substring(0, 40) : '';
        return `  ${e.label.padEnd(25)} ${st.padEnd(30)} {gray-fg}${desc}{/gray-fg}`;
      }));
    }
    renderList();
    list.focus();

    let installing = false;

    list.on('select', (_item, idx) => {
      if (installing) return;
      const entry = catalog[idx];
      if (!entry) return;
      const verb = entry.installed ? 'Update' : 'Install';

      showConfirmDialog(`${verb} ${entry.label}?`, (yes) => {
        if (yes) {
          installing = true;
          doInstall(entry, logPanel, installLog, list, catalog, renderList, () => { installing = false; });
        }
        list.focus();
        screen.render();
      });
    });

    list.key('escape', () => {
      screen.remove(box);
      box.destroy();
      currentView = 'main';
      agentList.focus();
      refreshAgentTable();
    });

    screen.append(box);
    list.focus();
    screen.render();
  }

  function doInstall(entry, logPanel, installLog, list, catalog, renderList, onDone) {
    logPanel.setLabel(` {bold}Installing ${entry.name}...{/bold} `);
    installLog.setContent('');
    installLog.log(`{cyan-fg}>>> Installing ${entry.name}...{/cyan-fg}`);
    screen.render();
    log(`Installing {cyan-fg}${entry.name}{/cyan-fg}...`);

    connector.installer.installStreaming(entry.name, (chunk) => {
      const lines = chunk.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const clean = line.trim().substring(0, 120);
        installLog.log(clean);
        screen.render();
      }
    }).then(() => {
      installLog.log('');
      installLog.log(`{green-fg}\u2713 ${entry.name} installed successfully!{/green-fg}`);
      logPanel.setLabel(` {bold}{green-fg}Install Complete{/green-fg}{/bold} `);
      log(`{green-fg}\u2713{/green-fg} ${entry.name} installed`);
      const idx = catalog.findIndex(c => c.name === entry.name);
      if (idx >= 0) catalog[idx].installed = true;
      renderList();
      onDone();
      list.focus();
      screen.render();
    }).catch((e) => {
      installLog.log('');
      installLog.log(`{red-fg}\u2717 Failed: ${e.message}{/red-fg}`);
      logPanel.setLabel(` {bold}{red-fg}Install Failed{/red-fg}{/bold} `);
      log(`{red-fg}\u2717 Install failed:{/red-fg} ${e.message}`);
      onDone();
      list.focus();
      screen.render();
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Select Agent Type Screen
  // ────────────────────────────────────────────────────────────────────────

  function showSelectAgentTypeScreen(callback) {
    const catalog = loadCatalog(connector);
    const installed = catalog.filter(e => e.installed);

    if (installed.length === 0) {
      log('{yellow-fg}No agent runtimes installed. Press i to install one first.{/yellow-fg}');
      return;
    }

    const dialogHeight = Math.min(installed.length + 4, 16);
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 50, height: dialogHeight,
      border: { type: 'line' },
      tags: true,
      label: ' {bold}Select Agent Type{/bold} ',
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
    });

    const typeList = blessed.list({
      parent: dialog,
      top: 1, left: 1, width: '100%-4', height: dialogHeight - 4,
      keys: true, vi: true, mouse: true,
      tags: true,
      style: {
        selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
        item: { fg: 'white' },
      },
      items: installed.map(e => `  {green-fg}\u2713{/green-fg} ${e.label} {gray-fg}(${e.name}){/gray-fg}`),
    });

    blessed.box({
      parent: dialog,
      bottom: 0, left: 0, width: '100%-2', height: 1,
      tags: true,
      content: ' {gray-fg}Enter to select, Esc to cancel{/gray-fg}',
    });

    screen.append(dialog);
    typeList.focus();
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };

    typeList.on('select', (_item, idx) => {
      const selected = installed[idx];
      close();
      if (selected) callback(selected.name);
    });

    typeList.key('escape', close);
    dialog.key('escape', close);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Start Agent Screen (name + working dir)
  // ────────────────────────────────────────────────────────────────────────

  function showStartAgentScreen(agentType, callback) {
    const defaultName = generateAgentName(agentType);
    const defaultPath = process.cwd();

    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 60, height: 15,
      border: { type: 'line' },
      tags: true,
      label: ` {bold}Start ${agentType} Agent{/bold} `,
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
    });

    blessed.text({ parent: dialog, top: 1, left: 2, tags: true, content: `{bold}Agent name:{/bold} {gray-fg}(default: ${defaultName}){/gray-fg}` });
    const nameInput = blessed.textbox({
      parent: dialog, top: 2, left: 2, width: 50, height: 3,
      border: { type: 'line' }, inputOnFocus: true,
      style: { focus: { border: { fg: COLORS.accent } }, border: { fg: 'grey' } },
    });

    blessed.text({ parent: dialog, top: 5, left: 2, tags: true, content: `{bold}Working directory:{/bold} {gray-fg}(default: cwd){/gray-fg}` });
    const pathInput = blessed.textbox({
      parent: dialog, top: 6, left: 2, width: 50, height: 3,
      border: { type: 'line' }, inputOnFocus: true,
      style: { focus: { border: { fg: COLORS.accent } }, border: { fg: 'grey' } },
    });

    blessed.text({
      parent: dialog, top: 10, left: 2,
      tags: true,
      content: '{gray-fg}Enter to confirm, Escape to cancel{/gray-fg}',
    });

    const msg = blessed.text({ parent: dialog, top: 11, left: 2, tags: true, content: '' });

    screen.append(dialog);
    nameInput.focus();
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };

    nameInput.key('enter', () => pathInput.focus());
    pathInput.key('enter', () => {
      const name = nameInput.getValue().trim() || defaultName;
      const agentPath = pathInput.getValue().trim() || defaultPath;
      close();
      callback({ name, type: agentType, path: agentPath });
    });

    dialog.key('escape', close);
    nameInput.key('escape', close);
    pathInput.key('escape', close);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Configure Agent Screen (env vars + LLM test)
  // ────────────────────────────────────────────────────────────────────────

  function showConfigureScreen(agent) {
    currentView = 'configure';
    const envFields = connector.registry.getEnvFields(agent.type);
    if (!envFields || envFields.length === 0) {
      log('{gray-fg}No configuration required for this agent type.{/gray-fg}');
      return;
    }

    const saved = connector.getAgentEnv(agent.type);

    const box = blessed.box({ top: 0, left: 0, width: '100%', height: '100%', style: { bg: COLORS.surface } });

    blessed.box({
      parent: box, top: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.headerBg, fg: COLORS.headerFg, bold: true },
      content: `  {bold}Configure ${agent.type}{/bold}  {gray-fg}\u2014  Saved to ~/.openagents/env/{/gray-fg}`,
    });

    const inputs = [];
    let yPos = 2;

    for (const field of envFields) {
      const current = saved[field.name] || field.default || '';
      const req = field.required ? ' {red-fg}*{/red-fg}' : '';
      const placeholder = field.placeholder || `Enter ${field.name}...`;

      blessed.text({
        parent: box, top: yPos, left: 2,
        tags: true,
        content: `{bold}${field.description || field.name}{/bold}${req}`,
      });
      yPos++;

      const input = blessed.textbox({
        parent: box, top: yPos, left: 2, width: '80%', height: 3,
        border: { type: 'line' }, inputOnFocus: true,
        value: current,
        censor: field.password || false,
        style: { focus: { border: { fg: COLORS.accent } }, border: { fg: 'grey' } },
      });
      input._fieldName = field.name;
      inputs.push(input);
      yPos += 3;
    }

    // Buttons row
    const btnSave = blessed.button({
      parent: box, top: yPos + 1, left: 2,
      width: 12, height: 3,
      border: { type: 'line' },
      tags: true,
      content: '  {bold}Save{/bold}',
      style: { bg: COLORS.primary, fg: 'white', border: { fg: COLORS.accent }, focus: { bg: 'blue' } },
      mouse: true, keys: true,
    });

    const btnTest = blessed.button({
      parent: box, top: yPos + 1, left: 16,
      width: 12, height: 3,
      border: { type: 'line' },
      tags: true,
      content: '  {bold}Test{/bold}',
      style: { fg: 'white', border: { fg: 'grey' }, focus: { bg: 'blue' } },
      mouse: true, keys: true,
    });

    const testResult = blessed.text({
      parent: box, top: yPos + 4, left: 2,
      tags: true,
      content: '',
    });

    blessed.box({
      parent: box, bottom: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.footerBg, fg: COLORS.footerFg },
      content: ' {cyan-fg}Enter{/cyan-fg} Next field  {cyan-fg}Ctrl+S{/cyan-fg} Save  {cyan-fg}Ctrl+T{/cyan-fg} Test  {cyan-fg}Esc{/cyan-fg} Back',
    });

    screen.append(box);
    if (inputs.length > 0) inputs[0].focus();
    screen.render();

    // Enter moves to next field, last field triggers save
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].key('enter', () => {
        if (i < inputs.length - 1) {
          inputs[i + 1].focus();
        } else {
          doSave();
        }
      });
    }

    function gatherEnv() {
      const env = {};
      for (const input of inputs) {
        const val = input.getValue().trim();
        if (val) env[input._fieldName] = val;
      }
      return env;
    }

    function doSave() {
      const env = gatherEnv();
      connector.saveAgentEnv(agent.type, env);
      log(`{green-fg}\u2713{/green-fg} Configuration saved for ${agent.type}`);
      closeConfig();
    }

    function doTest() {
      const env = gatherEnv();
      const resolved = connector.resolveAgentEnv(agent.type, env);
      const effective = { ...env, ...resolved };

      if (!effective.LLM_API_KEY && !effective.OPENAI_API_KEY && !effective.ANTHROPIC_API_KEY) {
        testResult.setContent('{red-fg}No API key entered{/red-fg}');
        screen.render();
        return;
      }

      testResult.setContent('{gray-fg}Testing...{/gray-fg}');
      screen.render();

      connector.testLLM(effective).then(result => {
        if (result.success) {
          testResult.setContent(`{green-fg}\u2713 OK{/green-fg} \u2014 model: ${result.model}, response: ${(result.response || '').substring(0, 50)}`);
        } else {
          testResult.setContent(`{red-fg}\u2717 ${result.error || 'Unknown error'}{/red-fg}`);
        }
        screen.render();
      }).catch(err => {
        testResult.setContent(`{red-fg}\u2717 ${err.message}{/red-fg}`);
        screen.render();
      });
    }

    function closeConfig() {
      screen.remove(box);
      box.destroy();
      currentView = 'main';
      agentList.focus();
      refreshAgentTable();
    }

    btnSave.on('press', doSave);
    btnTest.on('press', doTest);

    box.key('escape', closeConfig);
    box.key('C-s', doSave);
    box.key('C-t', doTest);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Connect Workspace Screen
  // ────────────────────────────────────────────────────────────────────────

  function showConnectWorkspaceScreen(agentName) {
    currentView = 'connect';
    const config = connector.config.load();
    const networks = config.networks || [];

    const box = blessed.box({ top: 0, left: 0, width: '100%', height: '100%', style: { bg: COLORS.surface } });

    blessed.box({
      parent: box, top: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.headerBg, fg: COLORS.headerFg, bold: true },
      content: `  {bold}Connect '${agentName}' to Workspace{/bold}  {gray-fg}\u2014  Select a workspace and press Enter{/gray-fg}`,
    });

    blessed.box({
      parent: box, top: 1, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.colHeaderBg, fg: COLORS.colHeaderFg },
      content: `  ${'WORKSPACE'.padEnd(30)} URL`,
    });

    const rowActions = [];
    const items = [];

    for (const net of networks) {
      const name = net.name || net.slug || net.id;
      const slug = net.slug || net.id;
      const isLocal = (net.endpoint || '').includes('localhost') || (net.endpoint || '').includes('127.0.0.1');
      const url = isLocal ? `${net.endpoint}/${slug}` : `https://workspace.openagents.org/${slug}`;
      items.push(`  ${name.padEnd(30)} {gray-fg}${url}{/gray-fg}`);
      rowActions.push(`existing:${slug}`);
    }

    items.push(`  {bold}{green-fg}\u271A Create new workspace{/green-fg}{/bold}`);
    rowActions.push('__create__');
    items.push(`  {bold}{yellow-fg}\u{1F511} Join with token{/yellow-fg}{/bold}`);
    rowActions.push('__token__');

    const list = blessed.list({
      parent: box, top: 2, left: 0, width: '100%', height: '100%-4',
      keys: true, vi: true, mouse: true,
      tags: true,
      style: {
        selected: { bg: COLORS.selected.bg, fg: COLORS.selected.fg, bold: true },
        item: { fg: 'white' },
      },
      items,
    });

    blessed.box({
      parent: box, bottom: 0, left: 0, width: '100%', height: 1,
      tags: true,
      style: { bg: COLORS.footerBg, fg: COLORS.footerFg },
      content: ' {cyan-fg}Enter{/cyan-fg} Select  {cyan-fg}Esc{/cyan-fg} Back',
    });

    screen.append(box);
    list.focus();
    screen.render();

    const closeScreen = () => {
      screen.remove(box);
      box.destroy();
      currentView = 'main';
      agentList.focus();
      refreshAgentTable();
    };

    list.on('select', (_item, idx) => {
      const action = rowActions[idx];
      closeScreen();

      if (action && action.startsWith('existing:')) {
        const slug = action.split(':')[1];
        try {
          connector.connectWorkspace(agentName, slug);
          signalDaemonReload();
          log(`{green-fg}\u2713{/green-fg} Connected {cyan-fg}${agentName}{/cyan-fg} \u2192 ${slug}`);
        } catch (e) {
          log(`{red-fg}\u2717 ${e.message}{/red-fg}`);
        }
        refreshAgentTable();
      } else if (action === '__create__') {
        showTextInputDialog('Workspace name', `${agentName}'s workspace`, (name) => {
          if (!name) return;
          doCreateWorkspace(agentName, name);
        });
      } else if (action === '__token__') {
        showTextInputDialog('Paste workspace token', '', (token) => {
          if (!token) return;
          doJoinToken(agentName, token);
        });
      }
    });

    list.key('escape', closeScreen);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Shared dialogs
  // ────────────────────────────────────────────────────────────────────────

  function showConfirmDialog(message, callback) {
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 50, height: 5,
      border: { type: 'line' },
      tags: true,
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
      content: `\n  ${message}\n  {gray-fg}y = yes, n = no{/gray-fg}`,
    });
    screen.append(dialog);
    screen.render();

    const onKey = (ch) => {
      screen.unkey(['y', 'n', 'escape'], onKey);
      dialog.destroy();
      screen.render();
      callback(ch === 'y');
    };
    screen.key(['y', 'n', 'escape'], onKey);
  }

  function showTextInputDialog(title, defaultValue, callback) {
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 60, height: 8,
      border: { type: 'line' },
      tags: true,
      label: ` {bold}${title}{/bold} `,
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
    });

    const input = blessed.textbox({
      parent: dialog,
      top: 1, left: 2, width: '100%-6', height: 3,
      border: { type: 'line' }, inputOnFocus: true,
      value: defaultValue || '',
      style: { focus: { border: { fg: COLORS.accent } }, border: { fg: 'grey' } },
    });

    blessed.text({
      parent: dialog, top: 4, left: 2,
      tags: true,
      content: '{gray-fg}Enter to confirm, Escape to cancel{/gray-fg}',
    });

    screen.append(dialog);
    input.focus();
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };

    input.key('enter', () => {
      const val = input.getValue().trim();
      close();
      callback(val || null);
    });

    input.key('escape', () => {
      close();
      callback(null);
    });

    dialog.key('escape', () => {
      close();
      callback(null);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Actions
  // ────────────────────────────────────────────────────────────────────────

  function signalDaemonReload() {
    try { connector.sendDaemonCommand('reload'); } catch {}
  }

  function doStart(agentName) {
    log(`Starting {cyan-fg}${agentName}{/cyan-fg}...`);
    const pid = connector.getDaemonPid();
    if (!pid) {
      try {
        connector.startDaemon();
        log(`{green-fg}\u2713{/green-fg} Starting daemon (will launch {cyan-fg}${agentName}{/cyan-fg})`);
      } catch (e) {
        log(`{red-fg}\u2717 Failed to start daemon:{/red-fg} ${e.message}`);
        return;
      }
    } else {
      try {
        connector.sendDaemonCommand(`restart:${agentName}`);
        log(`{green-fg}\u2713{/green-fg} Restarting {cyan-fg}${agentName}{/cyan-fg} via daemon`);
      } catch (e) {
        log(`{red-fg}\u2717 Failed:{/red-fg} ${e.message}`);
        return;
      }
    }
    setTimeout(refreshAgentTable, 3000);
  }

  function doStop(agentName) {
    log(`Stopping {cyan-fg}${agentName}{/cyan-fg}...`);
    try {
      connector.sendDaemonCommand(`stop:${agentName}`);
      log(`{green-fg}\u2713{/green-fg} Stopped {cyan-fg}${agentName}{/cyan-fg}`);
    } catch (e) {
      log(`{red-fg}\u2717{/red-fg} ${e.message}`);
    }
    setTimeout(refreshAgentTable, 1000);
  }

  function doRemove(agentName) {
    showConfirmDialog(`Remove ${agentName}?`, (yes) => {
      if (!yes) return;
      // Disconnect first if connected
      const agent = agentRows.find(a => a.name === agentName);
      if (agent && agent.workspace) {
        try {
          connector.disconnectWorkspace(agentName);
          signalDaemonReload();
          log(`Disconnected {cyan-fg}${agentName}{/cyan-fg}`);
        } catch {}
      }
      // Stop if daemon running
      const pid = connector.getDaemonPid();
      if (pid) {
        try { connector.sendDaemonCommand(`stop:${agentName}`); } catch {}
      }
      // Remove from config
      try {
        connector.removeAgent(agentName);
        log(`{green-fg}\u2713{/green-fg} Removed {cyan-fg}${agentName}{/cyan-fg}`);
      } catch (e) {
        log(`{red-fg}\u2717{/red-fg} ${e.message}`);
      }
      refreshAgentTable();
    });
  }

  function doDisconnect(agentName) {
    try {
      connector.disconnectWorkspace(agentName);
      signalDaemonReload();
      log(`{green-fg}\u2713{/green-fg} Disconnected {cyan-fg}${agentName}{/cyan-fg}`);
    } catch (e) {
      log(`{red-fg}\u2717{/red-fg} ${e.message}`);
    }
    refreshAgentTable();
  }

  function doOpenWorkspace(agent) {
    const config = connector.config.load();
    const networks = config.networks || [];
    const net = networks.find(n => n.slug === agent.network || n.id === agent.network);
    if (!net) {
      log('{yellow-fg}No workspace config found{/yellow-fg}');
      return;
    }
    const slug = net.slug || net.id;
    const isLocal = (net.endpoint || '').includes('localhost') || (net.endpoint || '').includes('127.0.0.1');
    let url;
    if (isLocal) {
      url = `${net.endpoint}/${slug}`;
    } else {
      url = `https://workspace.openagents.org/${slug}`;
    }
    if (net.token) url += `?token=${net.token}`;

    // Try opening in browser
    let opened = false;
    try {
      const { exec } = require('child_process');
      const cmd = IS_WINDOWS ? `start "${url}"` :
                  process.platform === 'darwin' ? `open "${url}"` :
                  `xdg-open "${url}"`;
      exec(cmd);
      opened = true;
    } catch {}

    // Show URL in a dialog
    const dialog = blessed.box({
      top: 'center', left: 'center',
      width: 70, height: 7,
      border: { type: 'line' },
      tags: true,
      label: ' {bold}Workspace URL{/bold} ',
      style: { border: { fg: COLORS.accent }, bg: COLORS.surface },
      content: `\n  ${url}\n\n  {gray-fg}${opened ? 'Opened in browser.' : 'Copy the URL above.'} Press Esc to close.{/gray-fg}`,
    });

    screen.append(dialog);
    screen.render();

    const close = () => {
      screen.remove(dialog);
      dialog.destroy();
      agentList.focus();
      screen.render();
    };
    screen.key(['escape', 'enter'], function handler() {
      screen.unkey(['escape', 'enter'], handler);
      close();
    });

    if (opened) log(`{green-fg}\u2713{/green-fg} Opened workspace in browser`);
  }

  function doLogin(agent) {
    const catalog = connector.registry.getCatalogSync();
    const entry = catalog.find(e => e.name === agent.type);
    if (!entry || !entry.check_ready || !entry.check_ready.login_command) {
      log('{yellow-fg}No login command for this agent type{/yellow-fg}');
      return;
    }
    const cmd = entry.check_ready.login_command;
    log(`Running {bold}${cmd}{/bold}...`);

    // Suspend TUI and run login command interactively
    screen.exec(cmd, {}, (err, ok) => {
      if (err) {
        log(`{red-fg}\u2717 Login error:{/red-fg} ${err.message}`);
      } else {
        log(`{green-fg}\u2713{/green-fg} Login completed`);
      }
      refreshAgentTable();
    });
  }

  function doCreateWorkspace(agentName, wsName) {
    log(`Creating workspace {bold}${wsName}{/bold}...`);
    connector.createWorkspace({ agentName, name: wsName }).then(result => {
      const slug = result.slug || result.workspaceId;
      // Save to config
      connector.config.addNetwork({
        id: result.workspaceId,
        slug,
        name: wsName,
        endpoint: connector.workspace.endpoint,
        token: result.token,
      });
      connector.connectWorkspace(agentName, slug);
      signalDaemonReload();
      log(`{green-fg}\u2713{/green-fg} Created & connected \u2192 ${result.url || slug}`);
      refreshAgentTable();
    }).catch(e => {
      log(`{red-fg}\u2717 Create failed:{/red-fg} ${e.message}`);
    });
  }

  function doJoinToken(agentName, token) {
    log('Joining workspace with token...');
    connector.resolveToken(token).then(info => {
      const slug = info.slug || info.workspace_id;
      connector.config.addNetwork({
        id: info.workspace_id,
        slug,
        name: info.name || slug,
        endpoint: connector.workspace.endpoint,
        token,
      });
      connector.connectWorkspace(agentName, slug);
      signalDaemonReload();
      log(`{green-fg}\u2713{/green-fg} Joined & connected {cyan-fg}${agentName}{/cyan-fg} \u2192 ${slug}`);
      refreshAgentTable();
    }).catch(e => {
      log(`{red-fg}\u2717 Join failed:{/red-fg} ${e.message}`);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Key bindings
  // ────────────────────────────────────────────────────────────────────────

  screen.key('q', () => { if (currentView === 'main') process.exit(0); });
  screen.key('C-c', () => process.exit(0));

  screen.key('i', () => { if (currentView === 'main') showInstallScreen(); });

  screen.key('n', () => {
    if (currentView !== 'main') return;
    showSelectAgentTypeScreen((type) => {
      showStartAgentScreen(type, (result) => {
        try {
          connector.addAgent({ name: result.name, type: result.type, path: result.path });
          log(`{green-fg}\u2713{/green-fg} Created agent {cyan-fg}${result.name}{/cyan-fg} (${result.type})`);

          // Start daemon if not running
          const pid = connector.getDaemonPid();
          if (!pid) {
            connector.startDaemon();
            log('{green-fg}\u2713{/green-fg} Daemon starting...');
          } else {
            signalDaemonReload();
          }
        } catch (e) {
          log(`{red-fg}\u2717{/red-fg} ${e.message}`);
        }
        setTimeout(refreshAgentTable, 3000);
      });
    });
  });

  screen.key('r', () => {
    if (currentView === 'main') {
      refreshAgentTable();
      log('{green-fg}\u2713{/green-fg} Refreshed');
    }
  });

  screen.key('s', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    if (!a.configured) return;
    doStart(a.name);
  });

  screen.key('x', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    if (!a.configured) return;
    doStop(a.name);
  });

  screen.key('u', () => {
    if (currentView !== 'main') return;
    const pid = connector.getDaemonPid();
    if (pid) {
      showConfirmDialog('Stop daemon? This will disconnect ALL agents.', (yes) => {
        if (!yes) { log('{gray-fg}Cancelled{/gray-fg}'); return; }
        try {
          connector.stopDaemon();
          log('{green-fg}\u2713{/green-fg} Daemon stopped');
        } catch (e) {
          log(`{red-fg}\u2717{/red-fg} ${e.message}`);
        }
        setTimeout(refreshAgentTable, 1000);
      });
    } else {
      try {
        connector.startDaemon();
        log('{green-fg}\u2713{/green-fg} Daemon starting...');
      } catch (e) {
        log(`{red-fg}\u2717{/red-fg} ${e.message}`);
      }
      setTimeout(refreshAgentTable, 3000);
    }
  });

  screen.key('c', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    if (!a.configured || a.workspace) return;
    showConnectWorkspaceScreen(a.name);
  });

  screen.key('d', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    if (!a.configured || !a.workspace) return;
    doDisconnect(a.name);
  });

  screen.key('w', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    if (!a.configured || !a.workspace) return;
    doOpenWorkspace(a);
  });

  screen.key('e', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    if (!a.configured) return;
    showConfigureScreen(a);
  });

  screen.key('delete', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    if (!a.configured) return;
    doRemove(a.name);
  });

  // ── Init ──
  agentList.focus();
  refreshAgentTable();
  log('Welcome to {bold}OpenAgents{/bold}. Press {cyan-fg}i{/cyan-fg} to install agents, {cyan-fg}n{/cyan-fg} to create one.');
  setInterval(refreshAgentTable, 5000);
  screen.render();
}

function run() { createTUI(); }
module.exports = { run };
