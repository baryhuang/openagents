/**
 * Interactive TUI dashboard for OpenAgents — `openagents` or `openagents tui`
 */

'use strict';

const blessed = require('blessed');
const { AgentConnector } = require('./index');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getExtraBinDirs } = require('./paths');

const IS_WINDOWS = process.platform === 'win32';

function getConnector() {
  const configDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.openagents');
  return new AgentConnector(configDir);
}

function loadAgentRows(connector) {
  const config = connector.config.load();
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
      workspace = net ? `${net.slug || net.id} (${net.name || ''})` : agent.network;
    }
    return { name: agent.name, type: agent.type, state, workspace };
  });
}

function loadCatalog(connector) {
  const entries = connector.registry.getCatalogSync();
  return entries.map(e => {
    let installed = false;
    try { const { whichBinary } = require('./paths'); installed = !!whichBinary(e.install?.binary || e.name); } catch {}
    if (!installed) {
      try {
        const f = path.join(connector._configDir, 'installed_agents.json');
        if (fs.existsSync(f)) installed = !!JSON.parse(fs.readFileSync(f, 'utf-8'))[e.name];
      } catch {}
    }
    return { name: e.name, label: e.label || e.name, description: e.description || '', installed };
  });
}

// ── Main TUI ─────────────────────────────────────────────────────────────

function createTUI() {
  const screen = blessed.screen({ smartCSR: true, title: 'OpenAgents', fullUnicode: true });
  const connector = getConnector();
  let pkg;
  try { pkg = require('../package.json'); } catch { pkg = { version: '?' }; }

  // ── Header ──
  const header = blessed.box({
    top: 0, left: 0, width: '100%', height: 1,
    style: { bg: 'blue', fg: 'white', bold: true },
  });

  // ── Title ──
  const titleBox = blessed.box({
    top: 1, left: 0, width: '100%', height: 2,
    content: `  OpenAgents v${pkg.version}`,
    style: { bold: true },
  });

  // ── Column Headers ──
  const colHeaders = blessed.box({
    top: 3, left: 0, width: '100%', height: 1,
    style: { bg: 'white', fg: 'black' },
    content: `  ${'NAME'.padEnd(22)} ${'TYPE'.padEnd(14)} ${'STATUS'.padEnd(14)} WORKSPACE`,
  });

  // ── Agent List ──
  const agentList = blessed.list({
    top: 4, left: 0, width: '100%', height: '50%-1',
    keys: true, vi: true, mouse: true,
    style: {
      selected: { bg: 'blue', fg: 'white' },
      item: { fg: 'white' },
    },
  });

  // ── Activity Section ──
  const logLabel = blessed.box({
    top: '50%+3', left: 0, width: '100%', height: 1,
    content: '  ACTIVITY',
    style: { bg: 'white', fg: 'black' },
  });

  const logContent = blessed.log({
    top: '50%+4', left: 0, width: '100%', height: '50%-7',
    scrollable: true, scrollOnInput: true,
    padding: { left: 2 },
    style: { fg: 'white' },
  });

  // ── Footer ──
  const footer = blessed.box({
    bottom: 0, left: 0, width: '100%', height: 1,
    style: { bg: 'blue', fg: 'white' },
    content: ' i Install  n New  s Start  x Stop  c Connect  u Daemon  r Refresh  q Quit',
  });

  screen.append(header);
  screen.append(titleBox);
  screen.append(colHeaders);
  screen.append(agentList);
  screen.append(logLabel);
  screen.append(logContent);
  screen.append(footer);

  let agentRows = [];
  let currentView = 'main';

  function log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logContent.log(`${ts}  ${msg}`);
    screen.render();
  }

  function refreshAgentTable() {
    try { agentRows = loadAgentRows(connector); } catch { agentRows = []; }

    const items = agentRows.length ? agentRows.map(r => {
      const sym = r.state === 'running' || r.state === 'online' ? '\u25CF' :
                  r.state === 'error' ? '\u2717' : '\u25CB';
      const ws = r.workspace || '-';
      return `  ${sym} ${r.name.padEnd(20)} ${r.type.padEnd(14)} ${r.state.padEnd(14)} ${ws}`;
    }) : ['  No agents configured. Press i to install, n to create.'];

    agentList.setItems(items);
    updateHeader();
    screen.render();
  }

  function updateHeader() {
    const pid = connector.getDaemonPid();
    const dot = pid ? '\u25CF' : '\u25CB';
    const state = pid ? 'Daemon running' : 'Daemon idle';
    const count = agentRows.length;
    header.setContent(`  ${dot} ${state}  |  ${count} agent${count !== 1 ? 's' : ''} configured`);
  }

  // ── Install Screen ──

  function showInstallScreen() {
    currentView = 'install';
    let catalog;
    try { catalog = loadCatalog(connector); } catch (e) { log('Error: ' + e.message); return; }

    const box = blessed.box({ top: 0, left: 0, width: '100%', height: '100%' });

    blessed.box({
      parent: box, top: 0, left: 0, width: '100%', height: 1,
      style: { bg: 'blue', fg: 'white', bold: true },
      content: '  Install Agent Runtimes    (Enter = install, Esc = back)',
    });

    blessed.box({
      parent: box, top: 1, left: 0, width: '100%', height: 1,
      style: { bg: 'white', fg: 'black' },
      content: `  ${'AGENT'.padEnd(25)} ${'STATUS'.padEnd(16)} DESCRIPTION`,
    });

    const list = blessed.list({
      parent: box, top: 2, left: 0, width: '100%', height: '100%-4',
      keys: true, vi: true, mouse: true,
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' },
      },
    });

    const statusBar = blessed.box({
      parent: box, bottom: 1, left: 0, width: '100%', height: 1,
    });

    blessed.box({
      parent: box, bottom: 0, left: 0, width: '100%', height: 1,
      style: { bg: 'blue', fg: 'white' },
      content: ' Enter Install/Update  Esc Back',
    });

    function renderList() {
      list.setItems(catalog.map(e => {
        const st = e.installed ? '\u25CF installed' : '\u25CB available';
        const desc = e.description ? e.description.substring(0, 40) : '';
        return `  ${e.label.padEnd(25)} ${st.padEnd(16)} ${desc}`;
      }));
    }
    renderList();
    list.focus();

    list.on('select', (_item, idx) => {
      const entry = catalog[idx];
      if (!entry) return;
      const verb = entry.installed ? 'Update' : 'Install';

      const dialog = blessed.box({
        parent: box, top: 'center', left: 'center',
        width: 50, height: 5,
        border: { type: 'line' },
        style: { border: { fg: 'cyan' } },
        content: `\n  ${verb} ${entry.label}?  (y = yes, n = no)`,
      });
      screen.render();

      const onKey = (ch) => {
        screen.unkey(['y', 'n', 'escape'], onKey);
        dialog.destroy();
        if (ch === 'y') {
          doInstall(entry, statusBar, list, catalog, renderList);
        } else {
          list.focus();
        }
        screen.render();
      };
      screen.key(['y', 'n', 'escape'], onKey);
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

  function doInstall(entry, statusBar, list, catalog, renderList) {
    statusBar.setContent(`  Installing ${entry.name}...`);
    screen.render();
    log('Installing ' + entry.name + '...');

    connector.installer.installStreaming(entry.name, (chunk) => {
      const lines = chunk.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const clean = line.trim().substring(0, 90);
        log('  ' + clean);
        statusBar.setContent('  ' + clean.substring(0, 70));
        screen.render();
      }
    }).then(() => {
      statusBar.setContent(`  Done! ${entry.name} installed successfully.`);
      statusBar.style.fg = 'green';
      log(entry.name + ' installed successfully');
      const idx = catalog.findIndex(c => c.name === entry.name);
      if (idx >= 0) catalog[idx].installed = true;
      renderList();
      setTimeout(() => { statusBar.style.fg = 'white'; }, 5000);
      list.focus();
      screen.render();
    }).catch((e) => {
      statusBar.setContent(`  Failed: ${e.message.substring(0, 60)}`);
      statusBar.style.fg = 'red';
      log('Install failed: ' + e.message);
      setTimeout(() => { statusBar.style.fg = 'white'; }, 5000);
      list.focus();
      screen.render();
    });
  }

  // ── New Agent ──

  function showNewAgentDialog() {
    const dialog = blessed.box({
      top: 'center', left: 'center', width: 56, height: 13,
      border: { type: 'line' },
      style: { border: { fg: 'cyan' } },
      label: ' Create Agent ',
    });

    blessed.text({ parent: dialog, top: 1, left: 2, content: 'Name:' });
    const nameInput = blessed.textbox({
      parent: dialog, top: 2, left: 2, width: 40, height: 3,
      border: { type: 'line' }, inputOnFocus: true,
      style: { focus: { border: { fg: 'cyan' } } },
    });

    blessed.text({ parent: dialog, top: 5, left: 2, content: 'Type: (openclaw, claude, codex, aider, goose)' });
    const typeInput = blessed.textbox({
      parent: dialog, top: 6, left: 2, width: 40, height: 3,
      border: { type: 'line' }, inputOnFocus: true, value: 'openclaw',
      style: { focus: { border: { fg: 'cyan' } } },
    });

    const msg = blessed.text({ parent: dialog, top: 10, left: 2, content: '' });

    const doCreate = () => {
      const name = nameInput.getValue().trim();
      const type = typeInput.getValue().trim();
      if (!name) { msg.setContent('Name is required'); screen.render(); return; }
      if (!type) { msg.setContent('Type is required'); screen.render(); return; }
      try {
        connector.addAgent({ name, type });
        log('Agent ' + name + ' (' + type + ') created');
      } catch (e) { msg.setContent(e.message); screen.render(); return; }
      screen.remove(dialog); dialog.destroy();
      agentList.focus(); refreshAgentTable();
    };

    nameInput.key('enter', () => typeInput.focus());
    typeInput.key('enter', doCreate);

    dialog.key('escape', () => {
      screen.remove(dialog); dialog.destroy();
      agentList.focus(); screen.render();
    });

    screen.append(dialog);
    nameInput.focus();
    screen.render();
  }

  // ── Keys ──

  screen.key('q', () => { if (currentView === 'main') process.exit(0); });
  screen.key('C-c', () => process.exit(0));
  screen.key('i', () => { if (currentView === 'main') showInstallScreen(); });
  screen.key('n', () => { if (currentView === 'main') showNewAgentDialog(); });
  screen.key('r', () => { if (currentView === 'main') { refreshAgentTable(); log('Refreshed'); } });

  screen.key('s', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    try { connector.sendDaemonCommand('start:' + a.name); log('Starting ' + a.name + '...'); } catch (e) { log('Error: ' + e.message); }
    setTimeout(refreshAgentTable, 2000);
  });

  screen.key('x', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    try { connector.sendDaemonCommand('stop:' + a.name); log('Stopped ' + a.name); } catch (e) { log('Error: ' + e.message); }
    setTimeout(refreshAgentTable, 1000);
  });

  screen.key('u', () => {
    if (currentView !== 'main') return;
    if (connector.getDaemonPid()) { connector.stopDaemon(); log('Daemon stopped'); }
    else { connector.startDaemon(); log('Daemon starting...'); }
    setTimeout(refreshAgentTable, 2000);
  });

  screen.key('c', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    log('Use: openagents connect ' + agentRows[agentList.selected].name + ' <token>');
  });

  screen.key('d', () => {
    if (currentView !== 'main' || !agentRows[agentList.selected]) return;
    const a = agentRows[agentList.selected];
    try { connector.disconnectWorkspace(a.name); log('Disconnected ' + a.name); } catch (e) { log('Error: ' + e.message); }
    refreshAgentTable();
  });

  // ── Init ──
  agentList.focus();
  refreshAgentTable();
  log('Welcome to OpenAgents. Press i to install agents, n to create one.');
  setInterval(refreshAgentTable, 5000);
  screen.render();
}

function run() { createTUI(); }
module.exports = { run };
