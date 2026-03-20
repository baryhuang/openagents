/**
 * Manages agent lifecycle: add/remove/configure agents, start/stop daemon,
 * install agent types (openclaw), connect to workspaces.
 *
 * Reads the SDK's daemon.yaml config and env files directly, and calls
 * `python -m openagents <command>` for operations that modify state.
 */

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Config directory: ~/.openagents/ (matches SDK's daemon_config.py)
const CONFIG_DIR = path.join(os.homedir(), '.openagents');
const CONFIG_FILE = path.join(CONFIG_DIR, 'daemon.yaml');
const LOG_FILE = path.join(CONFIG_DIR, 'daemon.log');
const STATUS_FILE = path.join(CONFIG_DIR, 'daemon.status.json');
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');
const CMD_FILE = path.join(CONFIG_DIR, 'daemon.cmd');
const ENV_DIR = path.join(CONFIG_DIR, 'env');

/**
 * Minimal YAML parser for daemon.yaml.
 * Handles the simple structure used by the SDK config (no anchors, no complex types).
 */
function parseSimpleYaml(text) {
  const lines = text.split('\n');
  const result = { version: 2, agents: [], networks: [] };
  let currentList = null; // 'agents' or 'networks'
  let currentItem = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const stripped = line.trimStart();

    // Skip empty lines and comments
    if (!stripped || stripped.startsWith('#')) continue;

    const indent = line.length - stripped.length;

    // List item start (- key: value) — check BEFORE top-level keys
    // PyYAML outputs list items at indent 0: "- name: test"
    if (stripped.startsWith('- ') && currentList) {
      if (currentItem) {
        result[currentList].push(currentItem);
      }
      currentItem = {};
      const rest = stripped.slice(2).trim();
      if (rest.includes(':')) {
        const [key, ...valParts] = rest.split(':');
        const val = valParts.join(':').trim();
        currentItem[key.trim()] = parseYamlValue(val);
      }
      continue;
    }

    // Top-level keys (not list items)
    if (indent === 0 && stripped.includes(':') && !stripped.startsWith('- ')) {
      // Push last item from previous list
      if (currentItem && currentList) {
        result[currentList].push(currentItem);
        currentItem = null;
      }
      const [key, ...rest] = stripped.split(':');
      const val = rest.join(':').trim();
      if (key === 'version') {
        result.version = parseInt(val, 10) || 2;
        currentList = null;
      } else if (key === 'agents') {
        currentList = 'agents';
      } else if (key === 'networks') {
        currentList = 'networks';
      } else {
        currentList = null;
      }
      continue;
    }

    // Continuation of current item (  key: value)
    if (currentItem && indent >= 2 && stripped.includes(':')) {
      const [key, ...valParts] = stripped.split(':');
      const val = valParts.join(':').trim();
      currentItem[key.trim()] = parseYamlValue(val);
      continue;
    }
  }

  // Push last item
  if (currentItem && currentList) {
    result[currentList].push(currentItem);
  }

  return result;
}

function parseYamlValue(val) {
  if (val === '' || val === 'null' || val === '~') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  // Strip surrounding quotes
  if ((val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))) {
    return val.slice(1, -1);
  }
  // Handle inline dict/list (options, env) — treat as string for now
  if (val.startsWith('{') || val.startsWith('[')) {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}


class AgentManager {
  constructor(store, pythonManager) {
    this._store = store;
    this._python = pythonManager;
    this._daemonProc = null;
  }

  // ------------------------------------------------------------------
  // Config reading (daemon.yaml + env files)
  // ------------------------------------------------------------------

  _loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const text = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return parseSimpleYaml(text);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
    return { version: 2, agents: [], networks: [] };
  }

  _loadAgentEnv(agentType) {
    const envFile = path.join(ENV_DIR, `${agentType}.env`);
    const env = {};
    try {
      if (fs.existsSync(envFile)) {
        const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const idx = trimmed.indexOf('=');
          env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
        }
      }
    } catch {}
    return env;
  }

  // ------------------------------------------------------------------
  // Agent listing (merges config + status + env)
  // ------------------------------------------------------------------

  getAgents() {
    const config = this._loadConfig();
    const status = this.getAllStatus();

    return (config.agents || []).map((a) => {
      const agentEnv = this._loadAgentEnv(a.type);
      // Find network info
      const network = (config.networks || []).find(
        (n) => n.slug === a.network || n.id === a.network
      );
      return {
        name: a.name,
        type: a.type || 'openclaw',
        role: a.role || 'worker',
        network: a.network || null,
        networkName: network ? (network.name || network.slug) : null,
        path: a.path || null,
        env: { ...agentEnv, ...(a.env || {}) },
        state: status[a.name]?.state || 'stopped',
        restarts: status[a.name]?.restarts || 0,
        lastError: status[a.name]?.last_error || null,
      };
    });
  }

  // ------------------------------------------------------------------
  // Agent CRUD (via openagents CLI)
  // ------------------------------------------------------------------

  async addAgent(agentConfig) {
    const name = agentConfig.name;
    const type = agentConfig.type || 'openclaw';

    // Write directly to config via Python SDK (CLI 'create' has interactive prompts)
    const code = [
      'from openagents.client.daemon_config import add_agent_to_config, AgentEntry',
      `a = AgentEntry(name="${name}", type="${type}", role="worker")`,
      'add_agent_to_config(a)',
      `print("added:${name}")`,
    ].join('; ');
    await this._execPythonCode(code);

    // Save env vars for the agent type
    if (agentConfig.env && Object.keys(agentConfig.env).length > 0) {
      this._saveAgentEnv(type, agentConfig.env);
    }

    return { success: true, agent: agentConfig };
  }

  async removeAgent(name) {
    // Stop the agent first
    try { await this.stopAgent(name); } catch {}
    // Remove directly via Python one-liner (CLI 'remove' requires interactive confirm)
    return this._execPythonCode(
      `from openagents.client.daemon_config import remove_agent_from_config; ` +
      `r = remove_agent_from_config("${name}"); print("removed" if r else "not_found")`
    );
  }

  async updateAgent(name, updates) {
    // For env updates, save to env file
    if (updates.env) {
      const agents = this.getAgents();
      const agent = agents.find((a) => a.name === name);
      const type = agent ? agent.type : 'openclaw';
      this._saveAgentEnv(type, updates.env);
    }
    return { success: true };
  }

  _saveAgentEnv(agentType, env) {
    try {
      fs.mkdirSync(ENV_DIR, { recursive: true });
      const envFile = path.join(ENV_DIR, `${agentType}.env`);
      // Merge with existing
      const existing = this._loadAgentEnv(agentType);
      const merged = { ...existing, ...env };
      const lines = Object.entries(merged)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`);
      fs.writeFileSync(envFile, lines.join('\n') + '\n', 'utf-8');
    } catch (err) {
      console.error('Failed to save env:', err);
    }
  }

  // ------------------------------------------------------------------
  // Agent catalog & env config
  // ------------------------------------------------------------------

  async getCatalog() {
    const code =
      'import json; from openagents.client.plugin_registry import registry; ' +
      'scan = {a["name"]: a for a in registry.scan_agents()}; catalog = registry.get_catalog(); ' +
      'print(json.dumps([{"name": i.name, "label": i.label, "description": i.description, ' +
      '"install_command": i.install_command, "installed": scan.get(n, {}).get("installed", False), ' +
      '"requires": [str(r) for r in i.requires]} for n, i in catalog.items()]))';
    try {
      const result = await this._execPythonCode(code);
      return JSON.parse(result.output);
    } catch (err) {
      console.error('getCatalog error:', err);
      return [];
    }
  }

  async getEnvFields(agentType) {
    const code =
      'import json; from openagents.client.plugin_registry import registry; ' +
      `plugin = registry.get("${agentType}"); ` +
      'fields = plugin.required_env_vars() if plugin else []; ' +
      'print(json.dumps(fields))';
    try {
      const result = await this._execPythonCode(code);
      return JSON.parse(result.output);
    } catch {
      return [];
    }
  }

  getAgentEnv(agentType) {
    return this._loadAgentEnv(agentType);
  }

  saveAgentEnv(agentType, env) {
    this._saveAgentEnv(agentType, env);
    this.signalReload();
    return { success: true };
  }

  async testLLM(env) {
    const https = require('https');
    const http = require('http');

    const apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || '';
    if (!apiKey) return { success: false, error: 'No API key provided' };

    let baseUrl = (env.LLM_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = env.LLM_MODEL || env.OPENCLAW_MODEL || '';
    const isAnthropic = baseUrl.includes('anthropic');
    // Ensure base URL includes /v1 path for OpenAI-compatible APIs
    if (!isAnthropic && !baseUrl.endsWith('/v1')) {
      baseUrl += '/v1';
    }

    return new Promise((resolve) => {
      let url, headers, body;

      if (isAnthropic) {
        url = 'https://api.anthropic.com/v1/messages';
        headers = {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        };
        body = JSON.stringify({
          model: model || 'claude-sonnet-4-20250514',
          max_tokens: 32,
          messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
        });
      } else {
        url = baseUrl + '/chat/completions';
        headers = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        };
        body = JSON.stringify({
          model: model || 'gpt-4o-mini',
          max_tokens: 32,
          messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
        });
      }

      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            let text, usedModel;
            if (isAnthropic) {
              text = (parsed.content || [{}])[0].text || '';
              usedModel = parsed.model || model || '?';
            } else {
              text = (parsed.choices || [{}])[0]?.message?.content || '';
              usedModel = parsed.model || model || '?';
            }
            if (res.statusCode >= 400) {
              resolve({ success: false, error: `HTTP ${res.statusCode}: ${data.slice(0, 200)}` });
            } else {
              resolve({ success: true, model: usedModel, response: text.slice(0, 80) });
            }
          } catch {
            resolve({ success: false, error: `Invalid response: ${data.slice(0, 200)}` });
          }
        });
      });

      req.on('error', (e) => resolve({ success: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Request timed out' }); });
      req.write(body);
      req.end();
    });
  }

  signalReload() {
    try {
      const pid = this._readDaemonPid();
      if (!pid) return;

      if (process.platform === 'win32') {
        // On Windows, write reload command to daemon.cmd
        fs.writeFileSync(CMD_FILE, 'reload\n', 'utf-8');
      } else {
        // On Unix, send SIGHUP
        try { process.kill(pid, 'SIGHUP'); } catch {}
      }
    } catch {}
  }

  getNetworks() {
    const config = this._loadConfig();
    return (config.networks || []).map((n) => ({
      id: n.id,
      slug: n.slug,
      name: n.name || n.slug,
      endpoint: n.endpoint || '',
    }));
  }

  async createWorkspace(name) {
    return this._runOpenAgents(['workspace', 'create', '--name', name]);
  }

  // ------------------------------------------------------------------
  // Agent type install (openclaw, etc.)
  // ------------------------------------------------------------------

  async checkAgentType(agentType) {
    // Check if agent runtime binary exists
    const { execSync } = require('child_process');
    const names = agentType === 'openclaw'
      ? ['openclaw', 'openclaw.cmd']
      : [agentType];

    for (const name of names) {
      try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        execSync(`${whichCmd} ${name}`, { stdio: 'pipe', timeout: 5000 });
        return { installed: true, binary: name };
      } catch {}
    }
    return { installed: false };
  }

  async installAgentType(agentType) {
    return this._runOpenAgents(['install', agentType, '--yes']);
  }

  async uninstallAgentType(agentType) {
    // Derive uninstall command from the install command
    const code =
      'import json; from openagents.client.plugin_registry import registry; ' +
      `cat = registry.get_catalog(); item = cat.get("${agentType}"); ` +
      'print(json.dumps({"install_command": item.install_command if item else ""}))';
    let installCmd = '';
    try {
      const result = await this._execPythonCode(code);
      const info = JSON.parse(result.output);
      installCmd = info.install_command || '';
    } catch {}

    // Build uninstall command based on install pattern
    let uninstallCmd = '';
    if (installCmd.includes('npm install -g ')) {
      const pkg = installCmd.split('npm install -g ')[1].split(/\s/)[0].replace(/@latest$/, '');
      uninstallCmd = `npm uninstall -g ${pkg}`;
    } else if (installCmd.includes('pip install ')) {
      const pkg = installCmd.split('pip install ')[1].split(/\s/)[0];
      uninstallCmd = `pip uninstall -y ${pkg}`;
    } else {
      return { success: false, output: `No automatic uninstall for ${agentType}. Install command: ${installCmd}` };
    }

    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(uninstallCmd, { encoding: 'utf-8', timeout: 60000, shell: true }, async (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
          return;
        }
        // Remove install marker so is_installed() returns false
        try {
          await this._execPythonCode(
            `import json; from pathlib import Path; ` +
            `p = Path.home() / ".openagents" / "installed_agents.json"; ` +
            `d = json.loads(p.read_text()) if p.exists() else []; ` +
            `d = [x for x in d if x != "${agentType}"]; ` +
            `p.write_text(json.dumps(d)); ` +
            `m = Path.home() / ".openagents" / "installed" / "${agentType}"; ` +
            `m.unlink(missing_ok=True); ` +
            `print("marker_cleared")`
          );
        } catch {}
        resolve({ success: true, output: (stdout || '').trim() + '\n' + (stderr || '').trim() });
      });
    });
  }

  // ------------------------------------------------------------------
  // Workspace connection
  // ------------------------------------------------------------------

  async connectWorkspace(agentName, slug) {
    // `openagents connect <agent_name> <network_slug>`
    return this._runOpenAgents(['connect', agentName, slug]);
  }

  async disconnectWorkspace(agentName) {
    return this._runOpenAgents(['disconnect', agentName]);
  }

  // ------------------------------------------------------------------
  // Daemon lifecycle
  // ------------------------------------------------------------------

  async startAgent(name) {
    const daemonPid = this._readDaemonPid();
    if (!daemonPid) {
      // Start daemon (which starts all agents)
      return this._startDaemon();
    }
    // Send restart command to running daemon
    fs.writeFileSync(CMD_FILE, `restart:${name}\n`, 'utf-8');
    return { success: true, message: `Restart command sent for ${name}` };
  }

  async stopAgent(name) {
    const daemonPid = this._readDaemonPid();
    if (!daemonPid) {
      return { success: true, message: 'Daemon not running' };
    }
    fs.writeFileSync(CMD_FILE, `stop:${name}\n`, 'utf-8');
    return { success: true, message: `Stop command sent for ${name}` };
  }

  async startAll() {
    const daemonPid = this._readDaemonPid();
    if (daemonPid) {
      return { success: true, message: `Daemon already running (PID ${daemonPid})` };
    }
    return this._startDaemon();
  }

  async stopAll() {
    return this._runOpenAgents(['down']);
  }

  getAllStatus() {
    try {
      if (fs.existsSync(STATUS_FILE)) {
        const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
        return data.agents || {};
      }
    } catch {}
    return {};
  }

  getLogs(name, lines = 200) {
    try {
      if (!fs.existsSync(LOG_FILE)) return { lines: [] };

      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      let allLines = content.split('\n');

      // Filter by agent name if provided
      if (name) {
        allLines = allLines.filter(
          (l) => l.includes(name) || l.includes('daemon') || l.includes('Daemon')
        );
      }

      return { lines: allLines.slice(-lines) };
    } catch {
      return { lines: [] };
    }
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  _readDaemonPid() {
    try {
      if (!fs.existsSync(PID_FILE)) return null;
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (isNaN(pid)) return null;

      // Check if process is alive
      try {
        process.kill(pid, 0);
        return pid;
      } catch {
        // Process not running — clean up stale PID file
        try { fs.unlinkSync(PID_FILE); } catch {}
        return null;
      }
    } catch {
      return null;
    }
  }

  _startDaemon() {
    const pythonPath = this._python.getPythonPath();
    if (!pythonPath) {
      return Promise.reject(new Error('Python not found. Install Python 3.10+ first.'));
    }

    return new Promise((resolve, reject) => {
      // `openagents up` handles daemonization internally
      // On Windows, use spawn with shell to handle paths with spaces
      const args = ['-m', 'openagents', 'up'];
      const { execFile: ef } = require('child_process');

      this._execPython(args, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error && !(stdout || '').includes('Daemon started')) {
          reject(new Error(stderr || error.message));
          return;
        }
        // Give daemon a moment to write PID
        setTimeout(() => {
          const pid = this._readDaemonPid();
          resolve({
            success: true,
            pid,
            message: (stdout || '').trim() || 'Daemon started',
          });
        }, 1000);
      });
    });
  }

  _runOpenAgents(args) {
    const pythonPath = this._python.getPythonPath();
    if (!pythonPath) {
      return Promise.reject(new Error('Python not found'));
    }

    return new Promise((resolve, reject) => {
      this._execPython(['-m', 'openagents', ...args], { timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
          return;
        }
        resolve({ success: true, output: (stdout || '').trim() });
      });
    });
  }

  /**
   * Execute a Python one-liner for operations that bypass the CLI.
   */
  _execPythonCode(code) {
    const pythonPath = this._python.getPythonPath();
    if (!pythonPath) return Promise.reject(new Error('Python not found'));

    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      if (isWin) {
        const { exec } = require('child_process');
        exec(`"${pythonPath}" -c "${code.replace(/"/g, '\\"')}"`, {
          encoding: 'utf-8',
          timeout: 15000,
          shell: true,
        }, (error, stdout, stderr) => {
          if (error) { reject(new Error(stderr || error.message)); return; }
          resolve({ success: true, output: stdout.trim() });
        });
      } else {
        execFile(pythonPath, ['-c', code], {
          encoding: 'utf-8',
          timeout: 15000,
        }, (error, stdout, stderr) => {
          if (error) { reject(new Error(stderr || error.message)); return; }
          resolve({ success: true, output: stdout.trim() });
        });
      }
    });
  }

  /**
   * Execute Python with proper quoting on Windows.
   * On Windows, paths like "C:\Program Files\Python312\python.exe" need quoting.
   * We use child_process.exec (not execFile) with shell:true on Windows so that
   * cmd.exe handles the quoting naturally.
   */
  _execPython(args, opts, callback) {
    const pythonPath = this._python.getPythonPath();
    const isWin = process.platform === 'win32';

    if (isWin) {
      const { exec } = require('child_process');
      // Build command line with proper Windows quoting
      const allArgs = args.map(a => {
        if (a.includes(' ') || a.includes('&') || a.includes('|')) return `"${a}"`;
        return a;
      });
      const cmdLine = `"${pythonPath}" ${allArgs.join(' ')}`;
      exec(cmdLine, {
        encoding: 'utf-8',
        env: { ...process.env },
        shell: true,
        ...opts,
      }, callback);
    } else {
      execFile(pythonPath, args, {
        encoding: 'utf-8',
        env: { ...process.env },
        ...opts,
      }, callback);
    }
  }
}

module.exports = { AgentManager };
