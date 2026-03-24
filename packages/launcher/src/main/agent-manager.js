/**
 * Agent manager for the OpenAgents Launcher.
 *
 * Thin adapter over @openagents-org/agent-launcher — provides the same
 * IPC-facing API as the old Python-based agent-manager, but all operations
 * are now pure Node.js (no Python subprocess calls).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { AgentConnector, Daemon } = require('@openagents-org/agent-launcher');

const CONFIG_DIR = path.join(os.homedir(), '.openagents');

class AgentManager {
  constructor(store) {
    this._store = store;
    this._connector = new AgentConnector({ configDir: CONFIG_DIR });
  }

  // ------------------------------------------------------------------
  // Agent listing (merges config + status + env)
  // ------------------------------------------------------------------

  getAgents() {
    const agents = this._connector.listAgents();
    const status = this.getAllStatus();

    return agents.map((a) => ({
      ...a,
      state: status[a.name]?.state || 'stopped',
      restarts: status[a.name]?.restarts || 0,
      lastError: status[a.name]?.last_error || null,
    }));
  }

  // ------------------------------------------------------------------
  // Agent CRUD
  // ------------------------------------------------------------------

  async addAgent(agentConfig) {
    const name = agentConfig.name;
    const type = agentConfig.type || 'openclaw';

    this._connector.addAgent({ name, type, role: 'worker' });

    // Save env vars for the agent type
    if (agentConfig.env && Object.keys(agentConfig.env).length > 0) {
      this._connector.saveAgentEnv(type, agentConfig.env);
    }

    return { success: true, agent: agentConfig };
  }

  async removeAgent(name) {
    try { await this.stopAgent(name); } catch {}
    this._connector.removeAgent(name);
    return { success: true };
  }

  async updateAgent(name, updates) {
    if (updates.env) {
      const agents = this._connector.listAgents();
      const agent = agents.find((a) => a.name === name);
      const type = agent ? agent.type : 'openclaw';
      this._connector.saveAgentEnv(type, updates.env);
    }
    return { success: true };
  }

  // ------------------------------------------------------------------
  // Agent catalog & env config
  // ------------------------------------------------------------------

  async getCatalog() {
    try {
      return await this._connector.getCatalog();
    } catch {
      return this._connector.registry.getCatalogSync().map((e) => ({
        ...e,
        installed: this._connector.isInstalled(e.name),
      }));
    }
  }

  async getEnvFields(agentType) {
    return this._connector.getEnvFields(agentType);
  }

  getAgentEnv(agentType) {
    return this._connector.getAgentEnv(agentType);
  }

  saveAgentEnv(agentType, env) {
    this._connector.saveAgentEnv(agentType, env);

    // Configure agent-specific native auth (e.g., OpenClaw's auth-profiles.json)
    try {
      if (agentType === 'openclaw') {
        const OpenClawAdapter = require('@openagents-org/agent-launcher/src/adapters/openclaw');
        OpenClawAdapter.configureNativeAuth(env);
      }
    } catch {}

    this.signalReload();
    return { success: true };
  }

  async testLLM(env) {
    return this._connector.testLLM(env);
  }

  signalReload() {
    const pid = this._connector.getDaemonPid();
    if (!pid) return;

    if (process.platform === 'win32') {
      this._connector.sendDaemonCommand('reload');
    } else {
      try { process.kill(pid, 'SIGHUP'); } catch {}
    }
  }

  // ------------------------------------------------------------------
  // Workspace
  // ------------------------------------------------------------------

  getNetworks() {
    return this._connector.listWorkspaces();
  }

  async createWorkspace(name) {
    return this._connector.createWorkspace({ name: name || 'My Workspace' });
  }

  async connectWorkspace(agentName, tokenOrSlug) {
    // Resolve the token to get workspace info (slug, name, id)
    try {
      const info = await this._connector.resolveToken(tokenOrSlug);
      const slug = info.slug || info.workspace_id;
      const wsName = info.name || slug;

      // Save network to config
      this._connector.config.addNetwork({
        id: info.workspace_id,
        slug,
        name: wsName,
        endpoint: info.endpoint || this._connector.workspace?.endpoint,
        token: tokenOrSlug,
      });

      // Connect agent to the resolved slug
      this._connector.connectWorkspace(agentName, slug);
    } catch {
      // Fallback: treat as slug directly
      this._connector.connectWorkspace(agentName, tokenOrSlug);
    }
    this.signalReload();
    return { success: true };
  }

  async disconnectWorkspace(agentName) {
    this._connector.disconnectWorkspace(agentName);
    this.signalReload();
    return { success: true };
  }

  // ------------------------------------------------------------------
  // Agent type install / uninstall
  // ------------------------------------------------------------------

  async checkAgentType(agentType) {
    const installed = this._connector.isInstalled(agentType);
    const binary = installed ? this._connector.installer.which(agentType) : null;
    return { installed, binary: binary || null };
  }

  async installAgentType(agentType) {
    return this._connector.install(agentType);
  }

  async installAgentTypeStreaming(agentType, onData) {
    return this._connector.installer.installStreaming(agentType, onData);
  }

  async uninstallAgentType(agentType) {
    return this._connector.uninstall(agentType);
  }

  async uninstallAgentTypeStreaming(agentType, onData) {
    return this._connector.installer.uninstallStreaming(agentType, onData);
  }

  // ------------------------------------------------------------------
  // Daemon lifecycle
  // ------------------------------------------------------------------

  async startAgent(name) {
    const pid = this._connector.getDaemonPid();
    if (!pid) {
      return this._startDaemon();
    }
    this._connector.sendDaemonCommand(`restart:${name}`);
    return { success: true, message: `Restart command sent for ${name}` };
  }

  async stopAgent(name) {
    // For single-agent setups, just stop the daemon entirely
    // (the command file approach is unreliable on Windows)
    const agents = this._connector.config.getAgents();
    const runningAgents = agents.filter(a => {
      const status = this._connector.getDaemonStatus();
      const s = status[a.name];
      return s && (s.state === 'running' || s.state === 'online');
    });

    if (runningAgents.length <= 1) {
      // Only one agent — stop the whole daemon
      this._connector.stopDaemon();
      return { success: true, message: 'Daemon stopped' };
    }

    // Multiple agents — try command file, fall back to daemon kill
    const pid = this._connector.getDaemonPid();
    if (!pid) {
      return { success: true, message: 'Daemon not running' };
    }
    this._connector.sendDaemonCommand(`stop:${name}`);
    return { success: true, message: `Stop command sent for ${name}` };
  }

  async startAll() {
    const pid = this._connector.getDaemonPid();
    if (pid) {
      return { success: true, message: `Daemon already running (PID ${pid})` };
    }
    return this._startDaemon();
  }

  async stopAll() {
    const stopped = this._connector.stopDaemon();
    return { success: stopped, message: stopped ? 'Daemon stopped' : 'Daemon not running' };
  }

  getAllStatus() {
    // Read status file directly — PID validation is unreliable in Electron
    // on Windows (cross-session process.kill, fs.existsSync races).
    // The daemon cleans up its own status file on exit.
    return this._connector.getDaemonStatus();
  }

  getLogs(name, lines = 200) {
    const logLines = this._connector.getLogs(name, lines);
    return { lines: logLines };
  }

  healthCheck(type) {
    return this._connector.healthCheck(type);
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  _startDaemon() {
    try { this._connector.stopDaemon(); } catch {}

    const { spawn } = require('child_process');
    const portableNodeDir = path.join(os.homedir(), '.openagents', 'nodejs');

    // Build enhanced PATH with portable Node.js
    const extraDirs = [portableNodeDir];
    if (process.platform === 'win32') {
      extraDirs.push(path.join(process.env.APPDATA || '', 'npm'));
    }
    const enhancedPath = [...extraDirs, process.env.PATH || ''].join(path.delimiter);

    // Find CLI entry point on disk (NOT in asar)
    let cliPath = null;
    const cliCandidates = [
      path.join(portableNodeDir, 'node_modules', '@openagents-org', 'agent-launcher', 'bin', 'agent-connector.js'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openagents-org', 'agent-launcher', 'bin', 'agent-connector.js'),
      '/usr/local/lib/node_modules/@openagents-org/agent-launcher/bin/agent-connector.js',
    ];
    for (const c of cliCandidates) {
      try { if (fs.existsSync(c)) { cliPath = c; break; } } catch {}
    }
    if (!cliPath) {
      return { success: false, message: 'agent-launcher CLI not found. Install an agent first via the Install tab.' };
    }

    // Find node binary
    let nodeBin = path.join(portableNodeDir, 'node' + (process.platform === 'win32' ? '.exe' : ''));
    if (!fs.existsSync(nodeBin)) {
      try {
        const { execSync } = require('child_process');
        nodeBin = execSync(process.platform === 'win32' ? 'where node' : 'which node',
          { encoding: 'utf-8', timeout: 5000, env: { ...process.env, PATH: enhancedPath } }).split(/\r?\n/)[0].trim();
      } catch { nodeBin = 'node'; }
    }

    // Spawn daemon as detached background process
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const logFile = path.join(CONFIG_DIR, 'daemon.log');
      const pidFile = path.join(CONFIG_DIR, 'daemon.pid');
      const logFd = fs.openSync(logFile, 'a');

      const proc = spawn(nodeBin, [cliPath, 'up', '--foreground'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PATH: enhancedPath },
        windowsHide: true,
      });
      proc.unref();
      fs.writeFileSync(pidFile, String(proc.pid), 'utf-8');
      fs.closeSync(logFd);

      return { success: true, pid: proc.pid, message: `Daemon started (PID ${proc.pid})` };
    } catch (e) {
      return { success: false, message: `Failed to start daemon: ${e.message}` };
    }
  }
}

module.exports = { AgentManager };
