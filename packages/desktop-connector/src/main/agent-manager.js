/**
 * Agent manager for the Electron desktop app.
 *
 * Thin adapter over @openagents-org/agent-connector — provides the same
 * IPC-facing API as the old Python-based agent-manager, but all operations
 * are now pure Node.js (no Python subprocess calls).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { AgentConnector, Daemon } = require('@openagents-org/agent-connector');

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

  async connectWorkspace(agentName, slug) {
    this._connector.connectWorkspace(agentName, slug);
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

  async uninstallAgentType(agentType) {
    return this._connector.uninstall(agentType);
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
    return this._connector.getDaemonStatus();
  }

  getLogs(name, lines = 200) {
    const logLines = this._connector.getLogs(name, lines);
    return { lines: logLines };
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  _startDaemon() {
    // Use the Node.js agent-connector CLI to start the daemon.
    // We must use the system 'node' binary, NOT process.execPath (which is
    // electron.exe inside a packaged app and would spawn another Electron).
    const cliPath = require.resolve('@openagents-org/agent-connector/bin/agent-connector.js');

    // Find system node binary
    const { execSync } = require('child_process');
    let nodeBin;
    try {
      nodeBin = execSync(process.platform === 'win32' ? 'where node' : 'which node',
        { encoding: 'utf-8', timeout: 5000 }).split(/\r?\n/)[0].trim();
    } catch {
      nodeBin = 'node'; // fallback — hope it's on PATH
    }

    const foregroundArgs = [cliPath, 'up', '--foreground'];

    try {
      Daemon.daemonize(CONFIG_DIR, foregroundArgs, nodeBin);
    } catch (err) {
      return { success: false, message: err.message };
    }

    // Give daemon a moment to write PID
    return new Promise((resolve) => {
      setTimeout(() => {
        const pid = this._connector.getDaemonPid();
        resolve({
          success: true,
          pid,
          message: pid ? `Daemon started (PID ${pid})` : 'Daemon starting...',
        });
      }, 1500);
    });
  }
}

module.exports = { AgentManager };
