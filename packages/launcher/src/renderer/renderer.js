// ---- Tab navigation ----

function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach((el) => {
    el.classList.toggle('active', el.id === `tab-${tabName}`);
  });

  if (tabName === 'dashboard') refreshDashboard();
  if (tabName === 'agents') refreshAgentList();
  if (tabName === 'install') refreshInstallStatus();
  if (tabName === 'logs') refreshLogs();
}

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => switchTab(el.dataset.tab));
});

// Keyboard shortcuts: Ctrl+1..5 for tabs
const tabShortcuts = ['dashboard', 'agents', 'install', 'logs', 'settings'];
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key >= '1' && e.key <= '5') {
    e.preventDefault();
    switchTab(tabShortcuts[parseInt(e.key) - 1]);
  }
});

// ---- Toast notifications ----

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const colors = { info: 'var(--accent)', success: 'var(--success)', error: 'var(--danger)', warning: 'var(--warning)' };
  toast.style.cssText = `background:var(--bg-card);border:1px solid ${colors[type] || colors.info};border-radius:var(--radius);padding:12px 18px;font-size:13px;color:var(--text-primary);box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:350px;animation:fadeIn 0.2s;`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ---- Modal system ----

// ---- Agent icon helper ----

const AGENT_ICON_MAP = {
  openclaw: 'icons/openclaw.svg',
  claude: 'icons/claude.svg',
  codex: 'icons/codex.svg',
  aider: 'icons/aider.svg',
  goose: 'icons/goose.svg',
  gemini: 'icons/gemini.svg',
  openai: 'icons/openai.svg',
  amp: 'icons/amp.svg',
  cline: 'icons/cline.svg',
  copilot: 'icons/copilot.svg',
};

function agentIconHtml(type, size = 24) {
  const src = AGENT_ICON_MAP[type] || 'icons/default.svg';
  return `<img class="agent-icon" src="${src}" width="${size}" height="${size}" alt="${esc(type)}" onerror="this.src='icons/default.svg'">`;
}

function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal-content').innerHTML = '';
}

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ---- Agent Icon Helper ----

function agentIcon(type, size = 24) {
  const slug = (type || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `<img class="agent-icon" src="icons/${slug}.svg" width="${size}" height="${size}" alt="${esc(type)}" onerror="this.src='icons/default.svg'">`;
}

// ---- Dashboard ----

async function refreshDashboard() {
  let agents = [];
  try {
    agents = await window.api.listAgents() || [];
    const cardsEl = document.getElementById('agent-cards');

    if (agents.length === 0) {
      cardsEl.innerHTML = `
        <div class="card empty-state">
          <p>No agents configured yet.</p>
          <button class="btn" data-action="switch-tab" data-action-tab="agents">Add Agent</button>
        </div>`;
    } else {
      cardsEl.innerHTML = agents.map((a) => {
        const slug = a.network || '';
        const wsLabel = slug ? (a.networkName && a.networkName !== slug ? `${slug} (${a.networkName})` : slug) : '';
        return `
        <div class="agent-card">
          <div class="agent-card-header">
            ${agentIcon(a.type)}
            <span class="agent-card-name">${esc(a.name)}</span>
            <span class="agent-card-type">${esc(a.type)}</span>
          </div>
          <div class="agent-card-status">
            <span class="status-dot ${statusClass(a.state)}"></span>
            ${esc(a.state)}
            ${wsLabel ? ` &middot; ${esc(wsLabel)}` : ''}
          </div>
          ${a.lastError ? `<div class="agent-card-error">${esc(a.lastError)}</div>` : ''}
          <div class="agent-card-actions">
            <button class="btn btn-sm" data-action="toggle-agent" data-name="${esc(a.name)}" data-state="${esc(a.state)}">
              ${a.state === 'online' || a.state === 'running' ? 'Stop' : 'Start'}
            </button>
            <button class="btn btn-sm" data-action="show-agent-actions" data-name="${esc(a.name)}" data-type="${esc(a.type)}" data-state="${esc(a.state)}" data-network="${esc(a.network || '')}">Actions</button>
          </div>
        </div>`;
      }).join('');
    }
  } catch (err) {
    console.error('Dashboard refresh error:', err);
  }

  // Update daemon status bar using the same agents data (no extra IPC call)
  updateDaemonStatusFromAgents(agents);

  try {
    const status = await window.api.pythonStatus();
    const banner = document.getElementById('setup-banner');
    const versionEl = document.getElementById('sdk-version');
    // Node.js native — always ready
    banner.style.display = 'none';
    const launcherEl = document.getElementById('launcher-version');
    if (launcherEl && status.launcherVersion) launcherEl.textContent = `v${status.launcherVersion}`;
    versionEl.textContent = `core v${status.sdkVersion}`;
  } catch {}
}

function updateDaemonStatusFromAgents(agents) {
  const el = document.getElementById('daemon-status');
  const hasOnline = agents.some((a) => a.state === 'online' || a.state === 'running');
  const hasStarting = agents.some((a) => a.state === 'starting' || a.state === 'reconnecting');

  if (hasOnline) {
    el.innerHTML = '<span class="status-dot online"></span><span>Daemon: running</span>';
  } else if (hasStarting) {
    el.innerHTML = '<span class="status-dot starting"></span><span>Daemon: starting</span>';
  } else if (agents.length > 0) {
    el.innerHTML = '<span class="status-dot starting"></span><span>Daemon: idle</span>';
  } else {
    el.innerHTML = '<span class="status-dot offline"></span><span>Daemon: offline</span>';
  }
}

async function updateDaemonStatus() {
  try {
    const agents = await window.api.listAgents() || [];
    updateDaemonStatusFromAgents(agents);
  } catch {
    document.getElementById('daemon-status').innerHTML =
      '<span class="status-dot offline"></span><span>Daemon: offline</span>';
  }
}

async function toggleAgent(name, currentState) {
  try {
    if (currentState === 'online' || currentState === 'running') {
      await window.api.stopAgent(name);
      showToast(`Stopping ${name}...`, 'info');
      // Poll until stopped (up to 10s)
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 2000));
        await refreshDashboard();
      }
    } else {
      await window.api.startAgent(name);
      showToast(`Starting ${name}...`, 'info');
      // Poll until running (up to 30s — daemon needs time to connect)
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        await refreshDashboard();
        const status = await window.api.agentStatus();
        const agent = status[name];
        if (agent && (agent.state === 'running' || agent.state === 'online')) {
          showToast(`${name} is now running`, 'success');
          break;
        }
      }
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

document.getElementById('btn-start-all').addEventListener('click', async () => {
  const btn = document.getElementById('btn-start-all');
  btn.classList.add('btn-loading');
  try {
    const result = await window.api.startAll();
    showToast(result.message || 'Starting all agents...', 'success');
    setTimeout(() => refreshDashboard(), 2000);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('btn-loading');
  }
});

document.getElementById('btn-stop-all').addEventListener('click', async () => {
  try {
    await window.api.stopAll();
    showToast('Stopping all agents...', 'info');
    setTimeout(() => refreshDashboard(), 2000);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
});

// ---- Agent Actions (context menu) ----

function showAgentActions(name, type, state, network) {
  const isRunning = state === 'online' || state === 'running';
  const actions = [];

  if (isRunning) {
    actions.push(`<button class="btn modal-action-btn" data-action="toggle-agent" data-name="${esc(name)}" data-state="${esc(state)}">Stop</button>`);
  } else {
    actions.push(`<button class="btn modal-action-btn" data-action="toggle-agent" data-name="${esc(name)}" data-state="${esc(state)}">Start</button>`);
  }

  actions.push(`<button class="btn modal-action-btn" data-action="configure" data-type="${esc(type)}">Configure</button>`);
  actions.push(`<button class="btn modal-action-btn" data-action="agent-login" data-type="${esc(type)}">Login</button>`);

  if (network) {
    actions.push(`<button class="btn modal-action-btn" data-action="disconnect" data-name="${esc(name)}">Disconnect from Workspace</button>`);
    actions.push(`<button class="btn modal-action-btn" data-action="open-ws" data-name="${esc(name)}">Open Workspace in Browser</button>`);
  } else {
    actions.push(`<button class="btn modal-action-btn" data-action="connect-workspace" data-name="${esc(name)}">Connect to Workspace</button>`);
  }

  actions.push(`<button class="btn modal-action-btn btn-danger" data-action="remove-agent" data-name="${esc(name)}">Remove Agent</button>`);

  showModal(`
    <h3>Agent: ${esc(name)}</h3>
    <div class="modal-actions-list">
      ${actions.join('')}
    </div>
    <button class="btn modal-close-btn" data-action="close-modal">Cancel</button>
  `);
}

async function disconnectAgent(name) {
  try {
    await window.api.disconnectWorkspace(name);
    showToast(`Disconnected ${name} from workspace`, 'success');
    window.api.signalReload();
    refreshDashboard();
    refreshAgentList();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function openWorkspaceInBrowser(name) {
  try {
    const agents = await window.api.listAgents();
    const agent = agents.find((a) => a.name === name);
    if (!agent || !agent.network) {
      showToast('No workspace connected', 'warning');
      return;
    }
    // Look up workspace details (slug + token)
    const workspaces = await window.api.listWorkspaces();
    const ws = workspaces.find((w) => w.slug === agent.network || w.id === agent.network);
    const slug = (ws && ws.slug) || agent.network;
    let url = `https://workspace.openagents.org/${slug}`;
    if (ws && ws.token) url += `?token=${encodeURIComponent(ws.token)}`;
    window.api.openExternal(url);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ---- Configure Agent Screen ----

async function openConfigureScreen(agentType) {
  showModal(`<div class="loading-text">Loading configuration...</div>`);

  try {
    const [fields, saved] = await Promise.all([
      window.api.getEnvFields(agentType),
      window.api.getAgentEnv(agentType),
    ]);

    if (!fields || fields.length === 0) {
      showModal(`
        <h3>Configure ${esc(agentType)}</h3>
        <p class="hint">No configuration required for this agent type.</p>
        <button class="btn" data-action="close-modal">Close</button>
      `);
      return;
    }

    const fieldsHtml = fields.map((f) => {
      const current = saved[f.name] || f.default || '';
      const required = f.required ? ' <span class="required">*</span>' : '';
      const inputType = f.password ? 'password' : 'text';
      return `
        <div class="form-group">
          <label>${esc(f.description)}${required}</label>
          <input type="${inputType}" id="cfg-${f.name}" value="${esc(current)}"
                 placeholder="${esc(f.placeholder || `Enter ${f.name}...`)}">
        </div>`;
    }).join('');

    showModal(`
      <h3>Configure ${esc(agentType)}</h3>
      <p class="hint">Settings saved to ~/.openagents/env/</p>
      <div class="configure-form">
        ${fieldsHtml}
      </div>
      <div id="test-result"></div>
      <div class="modal-button-row">
        <button class="btn btn-primary" data-action="save-config" data-type="${esc(agentType)}">Save</button>
        <button class="btn" data-action="test-llm" data-type="${esc(agentType)}">Test Connection</button>
        <button class="btn" data-action="close-modal">Cancel</button>
      </div>
    `);
  } catch (err) {
    showModal(`
      <h3>Error</h3>
      <p>${esc(err.message)}</p>
      <button class="btn" data-action="close-modal">Close</button>
    `);
  }
}

async function saveConfig(agentType) {
  const fields = document.querySelectorAll('.configure-form input');
  const env = {};
  fields.forEach((input) => {
    const name = input.id.replace('cfg-', '');
    const val = input.value.trim();
    if (val) env[name] = val;
  });

  try {
    await window.api.saveAgentEnv(agentType, env);
    showToast('Configuration saved', 'success');
    closeModal();
    refreshDashboard();
    refreshAgentList();
  } catch (err) {
    showToast(`Error saving: ${err.message}`, 'error');
  }
}

async function testLLMConfig(agentType) {
  const fields = document.querySelectorAll('.configure-form input');
  const env = {};
  fields.forEach((input) => {
    const name = input.id.replace('cfg-', '');
    const val = input.value.trim();
    if (val) env[name] = val;
  });

  const resultEl = document.getElementById('test-result');
  if (!resultEl) return;

  resultEl.innerHTML = '<span class="test-loading">Testing...</span>';

  try {
    const result = await window.api.testLLM(env);
    if (result.success) {
      resultEl.innerHTML = `<span class="test-success">OK — model: ${esc(result.model)}, response: "${esc(result.response)}"</span>`;
    } else {
      resultEl.innerHTML = `<span class="test-error">${esc(result.error)}</span>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<span class="test-error">${esc(err.message)}</span>`;
  }
}

// ---- Connect Workspace Screen ----

async function showConnectWorkspace(agentName) {
  showModal(`<div class="loading-text">Loading workspaces...</div>`);

  try {
    const networks = await window.api.listWorkspaces();

    let rows = '';
    if (networks && networks.length > 0) {
      rows = networks.map((n) => {
        const display = n.name || n.slug || n.id;
        const url = n.endpoint && (n.endpoint.includes('localhost') || n.endpoint.includes('127.0.0.1'))
          ? `${n.endpoint}/${n.slug || n.id}`
          : `workspace.openagents.org/${n.slug || n.id}`;
        return `<button class="btn modal-action-btn" data-action="do-connect-workspace" data-name="${esc(agentName)}" data-slug="${esc(n.slug || n.id)}">${esc(display)} — ${esc(url)}</button>`;
      }).join('');
    }

    showModal(`
      <h3>Connect '${esc(agentName)}' to Workspace</h3>
      <div class="modal-actions-list">
        ${rows}
        <button class="btn modal-action-btn" data-action="show-create-workspace" data-name="${esc(agentName)}">+ Create New Workspace</button>
        <button class="btn modal-action-btn" data-action="show-join-token" data-name="${esc(agentName)}">Join with Token</button>
      </div>
      <button class="btn modal-close-btn" data-action="close-modal">Cancel</button>
    `);
  } catch (err) {
    showModal(`
      <h3>Error</h3>
      <p>${esc(err.message)}</p>
      <button class="btn" data-action="close-modal">Close</button>
    `);
  }
}

async function doConnectWorkspace(agentName, slug) {
  try {
    showToast(`Connecting ${agentName} to workspace...`, 'info');
    await window.api.connectWorkspace(agentName, slug);
    window.api.signalReload();
    showToast(`Connected to ${slug}`, 'success');
    refreshDashboard();
    refreshAgentList();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function showCreateWorkspace(agentName) {
  showModal(`
    <h3>Create New Workspace</h3>
    <div class="form-group">
      <label>Workspace name</label>
      <input type="text" id="new-workspace-name" placeholder="my-workspace">
    </div>
    <div class="modal-button-row">
      <button class="btn btn-primary" data-action="do-create-workspace" data-name="${esc(agentName)}">Create</button>
      <button class="btn" data-action="close-modal">Cancel</button>
    </div>
  `);
  setTimeout(() => { const el = document.getElementById('new-workspace-name'); if (el) el.focus(); }, 100);
}

async function doCreateWorkspace(agentName) {
  const name = document.getElementById('new-workspace-name')?.value?.trim();
  if (!name) { showToast('Workspace name is required', 'warning'); return; }

  closeModal();
  try {
    showToast(`Creating workspace '${name}'...`, 'info');
    await window.api.createWorkspace(name);
    showToast(`Workspace '${name}' created`, 'success');
    // Auto-connect the agent
    const networks = await window.api.listWorkspaces();
    const newNet = networks.find((n) => n.name === name || n.slug === name);
    if (newNet && agentName) {
      await window.api.connectWorkspace(agentName, newNet.slug || newNet.id);
      window.api.signalReload();
      showToast(`Connected ${agentName} to ${name}`, 'success');
    }
    refreshDashboard();
    refreshAgentList();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function showJoinWithToken(agentName) {
  showModal(`
    <h3>Join Workspace with Token</h3>
    <div class="form-group">
      <label>Paste workspace token</label>
      <input type="text" id="workspace-token" placeholder="Paste token here...">
    </div>
    <div class="modal-button-row">
      <button class="btn btn-primary" data-action="do-join-token" data-name="${esc(agentName)}">Join</button>
      <button class="btn" data-action="close-modal">Cancel</button>
    </div>
  `);
  setTimeout(() => { const el = document.getElementById('workspace-token'); if (el) el.focus(); }, 100);
}

async function doJoinWithToken(agentName) {
  const token = document.getElementById('workspace-token')?.value?.trim();
  if (!token) { showToast('Token is required', 'warning'); return; }

  closeModal();
  try {
    showToast('Joining workspace...', 'info');
    await window.api.connectWorkspace(agentName, token);
    window.api.signalReload();
    showToast('Joined workspace', 'success');
    refreshDashboard();
    refreshAgentList();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ---- Agents tab ----

document.getElementById('btn-add-agent').addEventListener('click', () => showNewAgentDialog());

async function showNewAgentDialog() {
  // First check which agent types are installed
  showModal(`<div class="loading-text">Loading installed types...</div>`);

  try {
    const catalog = await window.api.getCatalog();
    const installed = catalog.filter((c) => c.installed);

    if (installed.length === 0) {
      showModal(`
        <h3>New Agent</h3>
        <p class="hint">No agent runtimes installed. Install one first.</p>
        <div class="modal-button-row">
          <button class="btn btn-primary" data-action="switch-tab" data-action-tab="install">Go to Install</button>
          <button class="btn" data-action="close-modal">Cancel</button>
        </div>
      `);
      return;
    }

    const typeOptions = installed.map((c) =>
      `<option value="${esc(c.name)}">${esc(c.label || c.name)}</option>`
    ).join('');

    showModal(`
      <h3>New Agent</h3>
      <div class="form-group">
        <label>Agent type</label>
        <select id="new-agent-type">${typeOptions}</select>
      </div>
      <div class="form-group">
        <label>Agent name</label>
        <input type="text" id="new-agent-name" placeholder="my-agent">
      </div>
      <div class="form-group">
        <label>Working directory (optional)</label>
        <input type="text" id="new-agent-path" placeholder="/path/to/project">
      </div>
      <div class="modal-button-row">
        <button class="btn btn-primary" data-action="do-add-agent">Create</button>
        <button class="btn" data-action="close-modal">Cancel</button>
      </div>
    `);

    // Auto-generate name
    const nameInput = document.getElementById('new-agent-name');
    const typeSelect = document.getElementById('new-agent-type');
    const generateName = () => {
      const type = typeSelect.value;
      const suffix = Math.random().toString(36).slice(2, 6);
      nameInput.placeholder = `${type}-${suffix}`;
    };
    typeSelect.addEventListener('change', generateName);
    generateName();
    setTimeout(() => nameInput.focus(), 100);
  } catch (err) {
    showModal(`
      <h3>Error</h3>
      <p>${esc(err.message)}</p>
      <button class="btn" data-action="close-modal">Close</button>
    `);
  }
}

async function doAddAgent() {
  const type = document.getElementById('new-agent-type')?.value;
  let name = document.getElementById('new-agent-name')?.value?.trim();
  const agentPath = document.getElementById('new-agent-path')?.value?.trim();

  if (!name) {
    name = document.getElementById('new-agent-name')?.placeholder || `${type}-${Math.random().toString(36).slice(2, 6)}`;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    showToast('Agent name can only contain letters, numbers, hyphens, and underscores', 'warning');
    return;
  }

  closeModal();

  try {
    await window.api.addAgent({ name, type, path: agentPath || undefined });
    showToast(`Agent '${name}' created`, 'success');
    // Open configure screen for the new agent
    openConfigureScreen(type);
    refreshAgentList();
    refreshDashboard();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function refreshAgentList() {
  try {
    const agents = await window.api.listAgents();
    const listEl = document.getElementById('agent-list');

    if (!agents || agents.length === 0) {
      listEl.innerHTML = '<p class="hint" style="padding:20px 0;">No agents configured. Click "+ New Agent" to get started.</p>';
      return;
    }

    listEl.innerHTML = agents.map((a) => {
      const slug = a.network || '';
      const wsDisplay = slug ? (a.networkName && a.networkName !== slug ? `${slug} (${a.networkName})` : slug) : 'local only';
      const envDisplay = [];
      if (a.env?.LLM_BASE_URL || a.env?.OPENAI_BASE_URL) envDisplay.push(`API: ${a.env.LLM_BASE_URL || a.env.OPENAI_BASE_URL}`);
      if (a.env?.LLM_MODEL || a.env?.OPENCLAW_MODEL) envDisplay.push(`Model: ${a.env.LLM_MODEL || a.env.OPENCLAW_MODEL}`);
      const hasKey = a.env?.LLM_API_KEY || a.env?.OPENAI_API_KEY || a.env?.ANTHROPIC_API_KEY;

      return `
        <div class="agent-list-item">
          <div class="agent-list-info">
            <h4>${esc(a.name)}</h4>
            <span>
              ${esc(a.type)} &middot;
              <span class="status-dot ${statusClass(a.state)}"></span> ${esc(a.state)}
              &middot; ${esc(wsDisplay)}
              ${a.restarts > 0 ? ` &middot; restarts: ${a.restarts}` : ''}
            </span>
            <span class="agent-config-hint">
              ${hasKey ? '&#128273; API key set' : '<span class="text-warning">&#9888; No API key</span>'}
              ${envDisplay.length ? ' &middot; ' + envDisplay.map(esc).join(' &middot; ') : ''}
            </span>
            ${a.lastError ? `<span class="agent-error">${esc(a.lastError)}</span>` : ''}
          </div>
          <div class="agent-list-actions">
            <button class="btn btn-sm" data-action="toggle-agent" data-name="${esc(a.name)}" data-state="${esc(a.state)}">
              ${a.state === 'online' || a.state === 'running' ? 'Stop' : 'Start'}
            </button>
            <button class="btn btn-sm" data-action="configure" data-type="${esc(a.type)}">Configure</button>
            ${a.network
              ? `<button class="btn btn-sm" data-action="disconnect" data-name="${esc(a.name)}">Disconnect</button>
                 <button class="btn btn-sm" data-action="open-ws" data-name="${esc(a.name)}">Open WS</button>`
              : `<button class="btn btn-sm" data-action="connect-workspace" data-name="${esc(a.name)}">Connect</button>`
            }
            <button class="btn btn-sm btn-danger" data-action="remove-agent" data-name="${esc(a.name)}">Remove</button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Agent list error:', err);
    showToast('Failed to load agents', 'error');
  }
}

async function removeAgent(name) {
  if (!confirm(`Remove agent '${name}'? This will stop it if running.`)) return;
  try {
    await window.api.removeAgent(name);
    showToast(`Agent '${name}' removed`, 'success');
    refreshAgentList();
    refreshDashboard();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ---- Install tab ----

async function refreshInstallStatus() {
  // Runtime status
  try {
    const status = await window.api.pythonStatus();

    const pyEl = document.getElementById('python-status');
    if (status.runtime === 'node') {
      pyEl.textContent = 'Node.js (native)';
    } else if (status.pythonPath) {
      pyEl.textContent = status.pythonPath;
    } else {
      pyEl.textContent = 'Not found';
    }
    pyEl.style.color = 'var(--success)';

    const sdkEl = document.getElementById('sdk-status');
    sdkEl.textContent = `v${status.sdkVersion}`;
    sdkEl.style.color = 'var(--success)';

    const sdkBtn = document.getElementById('btn-install-sdk');
    if (sdkBtn) sdkBtn.disabled = true;
  } catch {}

  // Catalog
  refreshCatalog();
}

async function refreshCatalog() {
  const container = document.getElementById('catalog-table-container');

  try {
    const catalog = await window.api.getCatalog();

    if (!catalog || catalog.length === 0) {
      container.innerHTML = '<p class="hint">No agent runtimes available. Install the SDK first.</p>';
      return;
    }

    const rows = catalog.map((c) => `
      <div class="catalog-row ${c.installed ? 'installed' : ''}" data-name="${esc(c.name)}">
        <div class="catalog-info">
          ${agentIcon(c.name, 28)}
          <div class="catalog-text">
            <span class="catalog-name">${esc(c.label || c.name)}</span>
            <span class="catalog-desc">${esc(c.description || '')}</span>
          </div>
        </div>
        <div class="catalog-status">
          ${c.installed
            ? '<span class="badge badge-success">installed</span>'
            : '<span class="badge badge-warning">not installed</span>'}
        </div>
        <div class="catalog-actions">
          <button class="btn btn-sm" data-action="install-catalog" data-name="${esc(c.name)}" data-installed="${c.installed}">
            ${c.installed ? 'Update' : 'Install'}
          </button>
          ${c.installed ? `<button class="btn btn-sm btn-danger" data-action="uninstall-catalog" data-name="${esc(c.name)}">Uninstall</button>` : ''}
        </div>
      </div>
    `).join('');

    container.innerHTML = `<div class="catalog-list">${rows}</div>`;
    // Apply any existing search filter
    const searchInput = document.getElementById('catalog-search-input');
    if (searchInput && searchInput.value) filterCatalog(searchInput.value);
  } catch (err) {
    container.innerHTML = `<p class="hint">Failed to load catalog: ${esc(err.message)}</p>`;
  }
}

function filterCatalog(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.catalog-row').forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(q) ? '' : 'none';
  });
}

async function installCatalogItem(name, isInstalled) {
  const verb = isInstalled ? 'Update' : 'Install';

  // Confirmation modal
  const confirmed = await new Promise((resolve) => {
    showModal(`
      <div style="text-align:center;padding:8px 0;">
        ${agentIcon(name, 40)}
        <h3 style="margin-top:12px;">${verb} ${esc(name)}?</h3>
        <p class="hint" style="margin:12px 0 20px;">This will run <code>npm install -g ${esc(name)}@latest</code> on your system.</p>
        <div class="modal-button-row" style="justify-content:center;">
          <button class="btn btn-primary" id="confirm-install-yes">${verb}</button>
          <button class="btn" id="confirm-install-no">Cancel</button>
        </div>
      </div>
    `);
    document.getElementById('confirm-install-yes').addEventListener('click', () => { closeModal(); resolve(true); });
    document.getElementById('confirm-install-no').addEventListener('click', () => { closeModal(); resolve(false); });
  });
  if (!confirmed) return;

  // Switch to dedicated install view — hide tabs, show progress overlay
  const content = document.getElementById('content');
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  // Remove any previous progress view
  const oldProgress = document.getElementById('install-progress-overlay');
  if (oldProgress) oldProgress.remove();

  const progressView = document.createElement('div');
  progressView.id = 'install-progress-overlay';
  progressView.className = 'install-progress-view';
  progressView.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        ${agentIcon(name, 32)}
        <div>
          <h1 style="margin-bottom:2px;">${verb} ${esc(name)}</h1>
          <p class="hint" style="margin:0;">Full installation log is shown below.</p>
        </div>
      </div>
      <pre class="log-viewer install-log" id="install-live-log" style="min-height:300px;max-height:calc(100vh - 200px);"></pre>
      <div id="install-done-bar" style="display:none;margin-top:16px;">
        <button class="btn btn-primary" id="install-back-btn">Back to Install</button>
      </div>`;
  content.appendChild(progressView);

  const logEl = document.getElementById('install-live-log');
  const doneBar = document.getElementById('install-done-bar');

  // D22: Check dependencies
  try {
    const catalog = await window.api.getCatalog();
    const entry = catalog.find(c => c.name === name);
    if (entry && entry.requires) {
      for (const dep of entry.requires) {
        const depName = dep === 'nodejs' ? 'node' : dep;
        logEl.textContent += `Checking dependency: ${dep}... `;
        try {
          const check = await window.api.healthCheck(depName);
          if (check && check.installed) {
            logEl.textContent += `OK (${check.version || 'found'})\n`;
          } else {
            logEl.textContent += `NOT FOUND\n\n⚠ Please install ${dep} first.\n`;
            doneBar.style.display = 'block';
            document.getElementById('install-back-btn').addEventListener('click', () => {
              const overlay = document.getElementById('install-progress-overlay');
              if (overlay) overlay.remove();
              // switchTab will re-add .active to the correct tab
              switchTab('install');
            });
            return;
          }
        } catch {
          logEl.textContent += `OK (assumed)\n`;
        }
      }
    }
  } catch {}

  logEl.textContent += `\n`;

  // Listen for streaming output
  let lastOutputTime = Date.now();
  window.api.onInstallOutput((data) => {
    // Remove progress spinner before appending real output
    if (progressLine && logEl.textContent.endsWith(progressLine)) {
      logEl.textContent = logEl.textContent.slice(0, -progressLine.length);
    }
    logEl.textContent += data;
    logEl.scrollTop = logEl.scrollHeight;
    lastOutputTime = Date.now();
  });

  // Show progress inside the log panel while npm is silent
  const spinChars = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let spinIdx = 0;
  let progressLine = '';
  const startTime = Date.now();
  const timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const silentFor = Math.floor((Date.now() - lastOutputTime) / 1000);
    if (silentFor > 2) {
      // Remove previous progress line if present
      if (progressLine && logEl.textContent.endsWith(progressLine)) {
        logEl.textContent = logEl.textContent.slice(0, -progressLine.length);
      }
      spinIdx = (spinIdx + 1) % spinChars.length;
      progressLine = `${spinChars[spinIdx]} Downloading and installing packages... (${elapsed}s elapsed)`;
      logEl.textContent += progressLine;
      logEl.scrollTop = logEl.scrollHeight;
    }
  }, 200);

  try {
    await window.api.installAgentTypeStreaming(name);
    logEl.textContent += `\n✓ ${name} installed successfully.\n`;
  } catch (err) {
    logEl.textContent += `\n✗ Error: ${err.message}\n`;
  }

  clearInterval(timerInterval);
  if (progressLine && logEl.textContent.endsWith(progressLine)) {
    logEl.textContent = logEl.textContent.slice(0, -progressLine.length);
  }

  window.api.removeInstallOutputListener();
  doneBar.style.display = 'block';
  document.getElementById('install-back-btn').addEventListener('click', () => {
    // Remove progress overlay and restore tabs
    const overlay = document.getElementById('install-progress-overlay');
    if (overlay) overlay.remove();
    // switchTab will re-add .active to the correct tab
    switchTab('install');
  });
}

async function uninstallCatalogItem(name) {
  // Confirmation modal
  const confirmed = await new Promise((resolve) => {
    showModal(`
      <div style="text-align:center;padding:8px 0;">
        ${agentIcon(name, 40)}
        <h3 style="margin-top:12px;">Uninstall ${esc(name)}?</h3>
        <p class="hint" style="margin:12px 0 20px;">This will remove ${esc(name)} from your system.</p>
        <div class="modal-button-row" style="justify-content:center;">
          <button class="btn btn-danger" id="confirm-install-yes">Uninstall</button>
          <button class="btn" id="confirm-install-no">Cancel</button>
        </div>
      </div>
    `);
    document.getElementById('confirm-install-yes').addEventListener('click', () => { closeModal(); resolve(true); });
    document.getElementById('confirm-install-no').addEventListener('click', () => { closeModal(); resolve(false); });
  });
  if (!confirmed) return;

  const content = document.getElementById('content');
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  const oldProgress = document.getElementById('install-progress-overlay');
  if (oldProgress) oldProgress.remove();

  const progressView = document.createElement('div');
  progressView.id = 'install-progress-overlay';
  progressView.className = 'install-progress-view';
  progressView.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        ${agentIcon(name, 32)}
        <div>
          <h1 style="margin-bottom:2px;">Uninstalling ${esc(name)}</h1>
          <p class="hint" style="margin:0;">Full uninstallation log is shown below.</p>
        </div>
      </div>
      <pre class="log-viewer install-log" id="install-live-log" style="min-height:300px;max-height:calc(100vh - 200px);"></pre>
      <div id="install-done-bar" style="display:none;margin-top:16px;">
        <button class="btn btn-primary" id="install-back-btn">Back to Install</button>
      </div>`;
  content.appendChild(progressView);

  const logEl = document.getElementById('install-live-log');
  const doneBar = document.getElementById('install-done-bar');

  let lastOutputTime = Date.now();
  window.api.onInstallOutput((data) => {
    // Remove progress line before appending real output
    if (progressLine && logEl.textContent.endsWith(progressLine)) {
      logEl.textContent = logEl.textContent.slice(0, -progressLine.length);
    }
    logEl.textContent += data;
    logEl.scrollTop = logEl.scrollHeight;
    lastOutputTime = Date.now();
  });

  const spinChars = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let spinIdx = 0;
  let progressLine = '';
  const startTime = Date.now();
  const timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const silentFor = Math.floor((Date.now() - lastOutputTime) / 1000);
    if (silentFor > 2) {
      if (progressLine && logEl.textContent.endsWith(progressLine)) {
        logEl.textContent = logEl.textContent.slice(0, -progressLine.length);
      }
      spinIdx = (spinIdx + 1) % spinChars.length;
      progressLine = `${spinChars[spinIdx]} Removing packages... (${elapsed}s elapsed)`;
      logEl.textContent += progressLine;
      logEl.scrollTop = logEl.scrollHeight;
    }
  }, 200);

  try {
    await window.api.uninstallAgentTypeStreaming(name);
    logEl.textContent += `\n✓ ${name} uninstalled successfully.\n`;
  } catch (err) {
    logEl.textContent += `\n✗ Error: ${err.message}\n`;
  }

  clearInterval(timerInterval);
  if (progressLine && logEl.textContent.endsWith(progressLine)) {
    logEl.textContent = logEl.textContent.slice(0, -progressLine.length);
  }
  window.api.removeInstallOutputListener();
  doneBar.style.display = 'block';
  document.getElementById('install-back-btn').addEventListener('click', () => {
    // Remove progress overlay and restore tabs
    const overlay = document.getElementById('install-progress-overlay');
    if (overlay) overlay.remove();
    // switchTab will re-add .active to the correct tab
    switchTab('install');
  });
}

// SDK install button removed — agent-connector is bundled with the app

// ---- Logs tab ----

async function refreshLogs() {
  try {
    const filter = document.getElementById('log-agent-filter').value;
    const result = await window.api.agentLogs(filter, 500);
    const viewer = document.getElementById('log-viewer');
    if (result.lines && result.lines.length > 0) {
      viewer.textContent = result.lines.join('\n');
      viewer.scrollTop = viewer.scrollHeight;
    } else {
      viewer.textContent = 'No logs available.\n\nLogs appear here after the daemon starts.';
    }
  } catch (err) {
    document.getElementById('log-viewer').textContent = 'Error loading logs: ' + err.message;
  }

  // Populate agent filter dropdown
  try {
    const agents = await window.api.listAgents();
    const select = document.getElementById('log-agent-filter');
    const current = select.value;
    const existingOptions = new Set();
    select.querySelectorAll('option').forEach((o) => existingOptions.add(o.value));

    (agents || []).forEach((a) => {
      if (!existingOptions.has(a.name)) {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        if (a.name === current) opt.selected = true;
        select.appendChild(opt);
      }
    });
  } catch {}
}

document.getElementById('btn-refresh-logs').addEventListener('click', refreshLogs);
document.getElementById('log-agent-filter').addEventListener('change', refreshLogs);
document.getElementById('catalog-search-input').addEventListener('input', (e) => filterCatalog(e.target.value));

// ---- Settings tab ----

document.getElementById('link-docs').addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openExternal('https://docs.openagents.com');
});

(async () => {
  try {
    const startOnBoot = await window.api.getSetting('startOnBoot');
    const minimizeToTray = await window.api.getSetting('minimizeToTray');
    if (startOnBoot !== undefined) document.getElementById('setting-start-on-boot').checked = !!startOnBoot;
    if (minimizeToTray !== undefined) document.getElementById('setting-minimize-to-tray').checked = !!minimizeToTray;
  } catch {}
})();

document.getElementById('setting-start-on-boot').addEventListener('change', (e) => {
  window.api.setSetting('startOnBoot', e.target.checked);
});
document.getElementById('setting-minimize-to-tray').addEventListener('change', (e) => {
  window.api.setSetting('minimizeToTray', e.target.checked);
});

// ---- Utilities ----

function esc(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function statusClass(state) {
  if (state === 'online' || state === 'running') return 'online';
  if (state === 'starting' || state === 'reconnecting') return 'starting';
  return 'offline';
}

// ---- D25: Activity log ----

const activityEntries = [];
const MAX_ACTIVITY = 50;

function addActivity(msg) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  activityEntries.unshift({ time, msg });
  if (activityEntries.length > MAX_ACTIVITY) activityEntries.length = MAX_ACTIVITY;
  renderActivity();
}

function renderActivity() {
  const el = document.getElementById('activity-log');
  if (!el) return;
  if (activityEntries.length === 0) {
    el.innerHTML = '<span class="hint">No activity yet. Start an agent to see events.</span>';
    return;
  }
  el.innerHTML = activityEntries.map(e =>
    `<div class="activity-log-entry"><span class="activity-log-time">${esc(e.time)}</span><span class="activity-log-msg">${esc(e.msg)}</span></div>`
  ).join('');
}

// Override showToast to also add to activity log
const _origShowToast = showToast;
showToast = function(message, type) {
  _origShowToast(message, type);
  addActivity(message);
};

// ---- D28: Auto-refresh logs ----

let logAutoRefreshInterval = null;

function startLogAutoRefresh() {
  stopLogAutoRefresh();
  logAutoRefreshInterval = setInterval(() => {
    const autoEl = document.getElementById('log-auto-refresh');
    const activeTab = document.querySelector('.nav-item.active');
    if (autoEl && autoEl.checked && activeTab && activeTab.dataset.tab === 'logs') {
      refreshLogs();
    }
  }, 3000);
}

function stopLogAutoRefresh() {
  if (logAutoRefreshInterval) { clearInterval(logAutoRefreshInterval); logAutoRefreshInterval = null; }
}

startLogAutoRefresh();

// ---- D29: Workspace URL display in Settings ----

async function refreshSettingsWorkspaces() {
  const el = document.getElementById('settings-workspaces');
  if (!el) return;
  try {
    const workspaces = await window.api.listWorkspaces();
    if (!workspaces || workspaces.length === 0) {
      el.innerHTML = '<span class="hint">No workspaces configured.</span>';
      return;
    }
    el.innerHTML = `<ul class="workspace-url-list">${workspaces.map(w => {
      const slug = w.slug || w.id;
      const name = w.name || slug;
      const url = `https://workspace.openagents.org/${slug}`;
      return `<li class="workspace-url-item">
        <span class="workspace-url-name">${esc(name)}</span>
        <span class="workspace-url-link" data-action="open-external" data-url="${esc(url)}${w.token ? '?token=' + encodeURIComponent(w.token) : ''}">${esc(url)}</span>
      </li>`;
    }).join('')}</ul>`;
  } catch {
    el.innerHTML = '<span class="hint">Failed to load workspaces.</span>';
  }
}

// ---- Update About version ----

(async () => {
  try {
    const status = await window.api.pythonStatus();
    const aboutEl = document.getElementById('about-version');
    if (aboutEl) aboutEl.textContent = `v${status.sdkVersion}`;
  } catch {}
})();

// ---- Periodic refresh ----

setInterval(() => {
  const activeTab = document.querySelector('.nav-item.active');
  if (activeTab) {
    const tab = activeTab.dataset.tab;
    if (tab === 'dashboard') refreshDashboard();
    if (tab === 'settings') refreshSettingsWorkspaces();
  }
  updateDaemonStatus();
}, 5000);

// ---- Delegated click handler ----
// CSP blocks inline onclick; use data-action attributes + delegation instead.

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const name = btn.dataset.name || '';
  const type = btn.dataset.type || '';
  const state = btn.dataset.state || '';
  const network = btn.dataset.network || '';
  const slug = btn.dataset.slug || '';
  const tab = btn.dataset.actionTab || '';

  // Close modal for actions triggered from inside a modal
  const inModal = !!btn.closest('.modal');
  const autoClose = ['switch-tab', 'toggle-agent', 'configure', 'disconnect',
    'open-ws', 'remove-agent', 'connect-workspace', 'do-connect-workspace',
    'show-create-workspace', 'show-join-token'];
  if (inModal && autoClose.includes(action)) closeModal();

  switch (action) {
    case 'switch-tab': switchTab(tab); break;
    case 'toggle-agent': toggleAgent(name, state); break;
    case 'show-agent-actions': showAgentActions(name, type, state, network); break;
    case 'configure': openConfigureScreen(type); break;
    case 'disconnect': disconnectAgent(name); break;
    case 'open-ws': openWorkspaceInBrowser(name); break;
    case 'remove-agent': removeAgent(name); break;
    case 'connect-workspace': showConnectWorkspace(name); break;
    case 'do-connect-workspace': doConnectWorkspace(name, slug); break;
    case 'show-create-workspace': showCreateWorkspace(name); break;
    case 'show-join-token': showJoinWithToken(name); break;
    case 'do-create-workspace': doCreateWorkspace(name); break;
    case 'do-join-token': doJoinWithToken(name); break;
    case 'do-add-agent': doAddAgent(); break;
    case 'save-config': saveConfig(type); break;
    case 'test-llm': testLLMConfig(type); break;
    case 'close-modal': closeModal(); break;
    case 'install-catalog': installCatalogItem(name, btn.dataset.installed === 'true'); break;
    case 'uninstall-catalog': uninstallCatalogItem(name); break;
    case 'open-external': window.api.openExternal(btn.dataset.url); break;
    // D23: Login flow
    case 'agent-login': agentLogin(type); break;
    // D24: Daemon toggle
    case 'toggle-daemon': toggleDaemon(); break;
  }
});

// ---- D23: Agent login flow ----

async function agentLogin(agentType) {
  const loginCommands = {
    claude: 'claude login',
    openclaw: 'openclaw login',
    codex: 'codex login',
    copilot: 'github-copilot login',
  };
  const cmd = loginCommands[agentType];
  if (!cmd) {
    showToast(`No login command for ${agentType}. Configure API key instead.`, 'info');
    openConfigureScreen(agentType);
    return;
  }
  showToast(`Opening ${agentType} login...`, 'info');
  try {
    await window.api.shellExec(cmd);
    showToast(`${agentType} login complete`, 'success');
  } catch (err) {
    showToast(`Login failed: ${err.message}`, 'error');
  }
}

// ---- D24: Daemon toggle ----

async function toggleDaemon() {
  const el = document.getElementById('daemon-status');
  const isRunning = el && el.textContent.includes('running');
  try {
    if (isRunning) {
      await window.api.stopAll();
      showToast('Daemon stopped', 'info');
    } else {
      await window.api.startAll();
      showToast('Daemon starting...', 'info');
    }
    setTimeout(() => refreshDashboard(), 2000);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ---- Initial load ----

refreshDashboard();
renderActivity();
