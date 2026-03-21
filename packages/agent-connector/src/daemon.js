'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');
const os = require('os');
const { WorkspaceClient } = require('./workspace-client');

const IS_WINDOWS = process.platform === 'win32';

/**
 * Agent process lifecycle manager.
 *
 * Spawns agent subprocesses, monitors them with auto-restart + backoff,
 * writes status to disk, processes commands from daemon.cmd, and handles
 * graceful shutdown.
 *
 * Compatible with the Python SDK's daemon — reads the same config files,
 * writes the same status format, and supports the same command protocol.
 */
class Daemon {
  constructor(config, envManager, registry) {
    this.config = config;
    this.envManager = envManager;
    this.registry = registry;

    // State
    this._processes = {};     // agentName → { proc, state, restarts, startedAt, lastError }
    this._stoppedAgents = new Set();
    this._shuttingDown = false;
    this._statusInterval = null;
    this._cmdInterval = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start all configured agents and block until shutdown.
   * Call this from the foreground daemon process.
   */
  async start() {
    const agents = this.config.getAgents();
    for (const agent of agents) {
      this._launchAgent(agent);
    }

    // Install signal handlers
    const shutdown = () => this.stop();
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    if (!IS_WINDOWS && process.on) {
      try { process.on('SIGHUP', () => this._reload()); } catch {}
    }

    // Write PID file
    this._writePid();

    // Periodic status + command check
    this._statusInterval = setInterval(() => {
      this._writeStatus();
      this._processCommands();
    }, 5000);

    this._writeStatus();
    this._log(`Daemon started with ${agents.length} agent(s)`);

    // Block until shutdown
    await new Promise((resolve) => {
      this._shutdownResolve = resolve;
    });
  }

  /**
   * Gracefully stop all agents and exit.
   */
  async stop() {
    if (this._shuttingDown) return;
    this._shuttingDown = true;
    this._log('Shutting down...');

    if (this._statusInterval) clearInterval(this._statusInterval);
    if (this._cmdInterval) clearInterval(this._cmdInterval);

    // Kill all child processes
    const kills = Object.keys(this._processes).map((name) =>
      this._killAgent(name, 5000)
    );
    await Promise.all(kills);

    this._writeStatus();
    this._cleanupPid();
    this._log('Daemon stopped');

    if (this._shutdownResolve) this._shutdownResolve();
  }

  /**
   * Stop a single agent by name.
   */
  async stopAgent(agentName) {
    this._stoppedAgents.add(agentName);
    await this._killAgent(agentName, 5000);
    this._writeStatus();
  }

  /**
   * Restart a single agent by name.
   */
  async restartAgent(agentName) {
    await this.stopAgent(agentName);
    this._stoppedAgents.delete(agentName);

    const agent = this.config.getAgent(agentName);
    if (agent) {
      this._launchAgent(agent);
      this._writeStatus();
    }
  }

  /**
   * Get current status of all agents.
   */
  getStatus() {
    const result = {};
    for (const [name, info] of Object.entries(this._processes)) {
      result[name] = {
        state: info.state,
        type: info.type || 'unknown',
        network: info.network || '(local)',
        restarts: info.restarts,
        started_at: info.startedAt || null,
        last_error: info.lastError || null,
      };
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Daemonize — launch as background process
  // ---------------------------------------------------------------------------

  /**
   * Launch the daemon as a background process.
   * The parent process prints info and exits; the child runs `start()`.
   * @param {string[]} foregroundArgs - CLI args for the foreground child process
   */
  static daemonize(configDir, foregroundArgs, execPath) {
    const logFile = path.join(configDir, 'daemon.log');
    const pidFile = path.join(configDir, 'daemon.pid');
    const bin = execPath || process.execPath;

    fs.mkdirSync(configDir, { recursive: true });
    const logFd = fs.openSync(logFile, 'a');

    const opts = {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    };
    if (IS_WINDOWS) opts.windowsHide = true;

    const proc = spawn(bin, foregroundArgs, opts);
    proc.unref();
    fs.writeFileSync(pidFile, String(proc.pid), 'utf-8');
    fs.closeSync(logFd);
    console.log(`Daemon started (PID ${proc.pid})`);
    console.log(`Logs: ${logFile}`);
    console.log('Stop: agent-connector down');
  }

  /**
   * Stop a running daemon by reading PID file and sending signal.
   * @returns {boolean} true if stopped
   */
  static stopDaemon(configDir) {
    const pidFile = path.join(configDir, 'daemon.pid');
    const statusFile = path.join(configDir, 'daemon.status.json');

    const pid = Daemon._readPid(pidFile);
    if (!pid) return false;

    try {
      if (IS_WINDOWS) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {}

    // Wait for process to die
    for (let i = 0; i < 20; i++) {
      if (!Daemon._isAlive(pid)) {
        try { fs.unlinkSync(pidFile); } catch {}
        try { fs.unlinkSync(statusFile); } catch {}
        return true;
      }
      // Busy-wait 500ms (sync, used only in CLI stop command)
      execSync(IS_WINDOWS ? 'ping -n 2 127.0.0.1 >nul' : 'sleep 0.5', {
        stdio: 'ignore', timeout: 5000,
      });
    }

    // Force kill
    try {
      if (IS_WINDOWS) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {}

    try { fs.unlinkSync(pidFile); } catch {}
    try { fs.unlinkSync(statusFile); } catch {}
    return true;
  }

  /**
   * Read daemon PID, returning null if not running.
   */
  static readDaemonPid(configDir) {
    return Daemon._readPid(path.join(configDir, 'daemon.pid'));
  }

  // ---------------------------------------------------------------------------
  // Internal — agent launch
  // ---------------------------------------------------------------------------

  _launchAgent(agentCfg) {
    const name = agentCfg.name;
    const type = agentCfg.type || 'openclaw';

    this._stoppedAgents.delete(name);

    const info = {
      type,
      network: agentCfg.network || '(local)',
      state: 'starting',
      restarts: 0,
      startedAt: null,
      lastError: null,
      proc: null,
      _backoff: 2,
    };
    this._processes[name] = info;

    // Workspace-connected agents use the adapter loop (poll + CLI per message).
    // Local-only agents use the spawn loop (long-running child process).
    const network = agentCfg.network
      ? this.config.getNetworks().find(
          (n) => n.slug === agentCfg.network || n.id === agentCfg.network
        )
      : null;

    if (network) {
      this._adapterLoop(name, agentCfg, info, network);
    } else {
      this._spawnLoop(name, agentCfg, info);
    }
  }

  async _spawnLoop(name, agentCfg, info) {
    const cmd = this._getLaunchCommand(agentCfg);
    if (!cmd) {
      info.state = 'running';
      info.startedAt = new Date().toISOString();
      this._log(`${name} registered (no launch command for ${agentCfg.type})`);
      return;
    }

    const env = this._buildAgentEnv(agentCfg);
    const cwd = agentCfg.path || undefined;

    while (!this._shuttingDown && !this._stoppedAgents.has(name)) {
      try {
        info.state = 'starting';
        this._writeStatus();

        this._log(`${name} launching: ${cmd.join(' ')}`);
        const proc = this._spawnAgent(cmd, { env, cwd });
        info.proc = proc;
        info.state = 'running';
        info.startedAt = new Date().toISOString();
        this._writeStatus();
        this._log(`${name} running (PID ${proc.pid})`);

        // Stream output to log
        if (proc.stdout) {
          proc.stdout.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              this._log(`[${name}] ${line}`);
            }
          });
        }

        const exitCode = await new Promise((resolve) => {
          proc.on('exit', (code) => resolve(code));
          proc.on('error', (err) => {
            this._log(`${name} spawn error: ${err.message}`);
            resolve(1);
          });
        });

        info.proc = null;

        if (this._stoppedAgents.has(name)) {
          this._log(`${name} was stopped, not restarting`);
          break;
        }

        if (exitCode === 0) {
          this._log(`${name} exited cleanly`);
          break;
        }

        throw new Error(`Process exited with code ${exitCode}`);
      } catch (err) {
        if (this._stoppedAgents.has(name) || this._shuttingDown) break;

        info.restarts++;
        info.state = 'error';
        info.lastError = (err.message || String(err)).slice(0, 200);
        this._writeStatus();
        this._log(`${name} crashed: ${info.lastError}, restarting in ${info._backoff}s (attempt ${info.restarts})`);

        await this._sleep(info._backoff * 1000);
        info._backoff = Math.min(info._backoff * 2, 60);
      }
    }

    info.state = 'stopped';
    this._writeStatus();
  }

  // ---------------------------------------------------------------------------
  // Internal — adapter loop (workspace-connected agents)
  // ---------------------------------------------------------------------------

  async _adapterLoop(name, agentCfg, info, network) {
    const wsClient = new WorkspaceClient(network.endpoint || 'https://workspace-endpoint.openagents.org');
    const binary = this._resolveAgentBinary(agentCfg);
    const env = this._buildAgentEnv(agentCfg);
    let cursor = null;
    const processedIds = new Set();

    // Skip existing events on startup
    try {
      while (true) {
        const { cursor: newCursor } = await wsClient.pollPending(
          network.id, name, network.token, { after: cursor, limit: 200 }
        );
        if (!newCursor || newCursor === cursor) break;
        cursor = newCursor;
      }
      this._log(`${name} skipped existing events, cursor=${cursor}`);
    } catch (e) {
      this._log(`${name} skip-events failed: ${e.message}`);
    }

    // Heartbeat interval
    const heartbeatInterval = setInterval(async () => {
      if (this._stoppedAgents.has(name) || this._shuttingDown) return;
      try {
        await wsClient.heartbeat(network.id, name, network.token);
      } catch (e) {
        this._log(`${name} heartbeat failed: ${e.message}`);
      }
    }, 30000);

    // Send initial heartbeat
    try { await wsClient.heartbeat(network.id, name, network.token); } catch {}

    info.state = 'running';
    info.startedAt = new Date().toISOString();
    this._writeStatus();
    this._log(`${name} adapter online → ${network.slug}${binary ? ` (binary: ${binary})` : ''}`);

    let idleCount = 0;

    while (!this._shuttingDown && !this._stoppedAgents.has(name)) {
      try {
        const { messages, cursor: newCursor } = await wsClient.pollPending(
          network.id, name, network.token, { after: cursor }
        );
        if (newCursor) cursor = newCursor;

        // Filter already-processed messages
        const incoming = messages.filter((m) => {
          const id = m.messageId;
          if (!id || processedIds.has(id)) return false;
          if (m.messageType === 'status') return false;
          return true;
        });

        if (incoming.length > 0) {
          idleCount = 0;
          for (const msg of incoming) {
            if (msg.messageId) processedIds.add(msg.messageId);
            await this._handleAdapterMessage(name, agentCfg, msg, network, wsClient, binary, env);
          }
          // Cap dedup set
          if (processedIds.size > 2000) {
            const arr = [...processedIds];
            processedIds.clear();
            for (const id of arr.slice(-1000)) processedIds.add(id);
          }
        } else {
          idleCount++;
        }

        // Adaptive polling: 2s active, up to 15s idle
        const delay = incoming.length > 0 ? 2000 : Math.min(2000 + idleCount * 1000, 15000);
        await this._sleep(delay);
      } catch (e) {
        if (this._stoppedAgents.has(name) || this._shuttingDown) break;
        info.lastError = (e.message || String(e)).slice(0, 200);
        this._log(`${name} poll error: ${info.lastError}`);
        await this._sleep(5000);
      }
    }

    clearInterval(heartbeatInterval);

    // Disconnect from workspace
    try { await wsClient.disconnect(network.id, name, network.token); } catch {}

    info.state = 'stopped';
    this._writeStatus();
    this._log(`${name} adapter stopped`);
  }

  async _handleAdapterMessage(name, agentCfg, msg, network, wsClient, binary, env) {
    const content = (msg.content || '').trim();
    if (!content) return;

    const channel = msg.sessionId || 'general';
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`${name} message from ${sender} in ${channel}: ${content.slice(0, 80)}`);

    // Send "thinking..." status
    try {
      await wsClient.sendMessage(network.id, channel, network.token, 'thinking...', {
        senderType: 'agent', senderName: name, messageType: 'status',
      });
    } catch {}

    try {
      let response;
      if (binary) {
        response = await this._runCliAgent(binary, content, channel, agentCfg, network, env);
      } else {
        response = `Agent type '${agentCfg.type}' has no CLI binary — cannot process message.`;
      }

      if (response) {
        await wsClient.sendMessage(network.id, channel, network.token, response, {
          senderType: 'agent', senderName: name,
        });
        this._log(`${name} responded in ${channel}: ${response.slice(0, 80)}...`);
      }
    } catch (e) {
      const errMsg = `Error: ${(e.message || String(e)).slice(0, 200)}`;
      this._log(`${name} error handling message: ${errMsg}`);
      try {
        await wsClient.sendMessage(network.id, channel, network.token, errMsg, {
          senderType: 'agent', senderName: name,
        });
      } catch {}
    }
  }

  _runCliAgent(binary, message, channel, agentCfg, network, env) {
    return new Promise((resolve, reject) => {
      const sessionKey = `openagents-${network.id.slice(0, 8)}-${channel.slice(-8)}`;
      const agentId = agentCfg.openclaw_agent_id || 'main';

      const args = ['agent', '--local', '--agent', agentId,
        '--session-id', sessionKey, '--message', message, '--json'];

      this._log(`${agentCfg.name} CLI: ${binary} ${args.slice(0, 5).join(' ')} ...`);

      const spawnOpts = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        timeout: 600000,
      };
      if (IS_WINDOWS) {
        spawnOpts.shell = true;
        const npmBin = path.join(process.env.APPDATA || '', 'npm');
        if (npmBin && !(env.PATH || '').includes(npmBin)) {
          spawnOpts.env = { ...env, PATH: npmBin + ';' + (env.PATH || process.env.PATH || '') };
        }
      }

      const proc = spawn(binary, args, spawnOpts);
      let stdout = '';
      let stderr = '';

      if (proc.stdout) proc.stdout.on('data', (d) => { stdout += d; });
      if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d; });

      proc.on('error', (err) => reject(err));
      proc.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`CLI exited ${code}: ${stderr.slice(0, 300)}`));
          return;
        }

        stdout = stdout.trim();
        if (!stdout) { resolve(''); return; }

        // Parse JSON output — find first '{'
        const jsonStart = stdout.indexOf('{');
        if (jsonStart < 0) { resolve(stdout); return; }

        try {
          const data = JSON.parse(stdout.slice(jsonStart));
          const payloads = data.payloads || [];
          if (payloads.length > 0) {
            const texts = payloads.filter((p) => p.text).map((p) => p.text);
            resolve(texts.join('\n\n'));
          } else {
            resolve(stdout.slice(0, jsonStart).trim() || '');
          }
        } catch {
          resolve(stdout);
        }
      });
    });
  }

  _resolveAgentBinary(agentCfg) {
    const entry = this.registry.getEntry(agentCfg.type);
    let binary = (entry && entry.install && entry.install.binary);
    if (!binary) {
      const knownBinaries = {
        openclaw: 'openclaw', claude: 'claude', codex: 'codex',
        aider: 'aider', goose: 'goose', gemini: 'gemini',
      };
      binary = knownBinaries[agentCfg.type];
    }
    return binary || null;
  }

  // ---------------------------------------------------------------------------
  // Internal — spawn loop (local-only agents)
  // ---------------------------------------------------------------------------

  _spawnAgent(cmd, opts) {
    const [binary, ...args] = cmd;
    const spawnOpts = {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env,
      cwd: opts.cwd,
    };

    if (IS_WINDOWS) {
      // On Windows, always use shell so .cmd/.ps1 shims on PATH are found
      spawnOpts.shell = true;
      // Ensure npm global bin is on PATH
      const npmBin = path.join(process.env.APPDATA || '', 'npm');
      if (npmBin && !(process.env.PATH || '').includes(npmBin)) {
        spawnOpts.env = { ...spawnOpts.env, PATH: npmBin + ';' + (spawnOpts.env.PATH || process.env.PATH || '') };
      }
    }

    const proc = spawn(binary, args, spawnOpts);

    // Merge stderr into stdout handler
    if (proc.stderr) {
      proc.stderr.on('data', (chunk) => {
        if (proc.stdout) proc.stdout.emit('data', chunk);
      });
    }

    return proc;
  }

  _getLaunchCommand(agentCfg) {
    const binary = this._resolveAgentBinary(agentCfg);
    if (!binary) return null;

    const entry = this.registry.getEntry(agentCfg.type);
    const args = [];

    // Add launch args from registry
    if (entry && entry.launch && entry.launch.args) {
      for (const arg of entry.launch.args) {
        args.push(arg.replace(/\{agent_name\}/g, agentCfg.name));
      }
    }

    // Built-in launch profiles for local-only agents
    if (!args.length) {
      const type = agentCfg.type || '';
      if (type === 'claude') {
        args.push('--print');
      } else if (type === 'codex') {
        args.push('--quiet');
      }
    }

    return [binary, ...args];
  }

  _buildAgentEnv(agentCfg) {
    const type = agentCfg.type || 'openclaw';
    const saved = this.envManager.load(type);
    const resolved = this.envManager.resolve(type, saved, this.registry);
    const merged = { ...saved, ...resolved, ...(agentCfg.env || {}) };
    return { ...process.env, ...merged };
  }

  // ---------------------------------------------------------------------------
  // Internal — agent kill
  // ---------------------------------------------------------------------------

  async _killAgent(name, timeoutMs) {
    const info = this._processes[name];
    if (!info || !info.proc) {
      if (info) info.state = 'stopped';
      return;
    }

    const proc = info.proc;
    info.proc = null;

    // Try graceful termination
    try {
      if (IS_WINDOWS) {
        execSync(`taskkill /PID ${proc.pid}`, { stdio: 'ignore', timeout: 5000 });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {}

    // Wait for exit
    const died = await Promise.race([
      new Promise((resolve) => proc.on('exit', () => resolve(true))),
      this._sleep(timeoutMs).then(() => false),
    ]);

    if (!died) {
      try {
        if (IS_WINDOWS) {
          execSync(`taskkill /F /PID ${proc.pid}`, { stdio: 'ignore', timeout: 5000 });
        } else {
          proc.kill('SIGKILL');
        }
      } catch {}
    }

    info.state = 'stopped';
  }

  // ---------------------------------------------------------------------------
  // Internal — status, commands, PID
  // ---------------------------------------------------------------------------

  _writeStatus() {
    try {
      const status = { agents: this.getStatus(), pid: process.pid };
      fs.writeFileSync(this.config.statusFile, JSON.stringify(status, null, 2), 'utf-8');
    } catch {}
  }

  _processCommands() {
    const cmdFile = this.config.cmdFile;
    try {
      if (!fs.existsSync(cmdFile)) return;
      const raw = fs.readFileSync(cmdFile, 'utf-8').trim();
      fs.unlinkSync(cmdFile);
      if (!raw) return;

      for (const line of raw.split('\n')) {
        const cmd = line.trim();
        if (cmd.startsWith('stop:')) {
          const agentName = cmd.slice(5).trim();
          this.stopAgent(agentName);
        } else if (cmd.startsWith('restart:')) {
          const agentName = cmd.slice(8).trim();
          this.restartAgent(agentName);
        } else if (cmd === 'reload') {
          this._reload();
        }
      }
    } catch {}
  }

  _reload() {
    this._log('Reloading config...');
    const oldAgents = new Map(this.config.getAgents().map((a) => [a.name, a]));
    // Re-read config from disk (Config reads fresh on each call)
    const newAgents = new Map(this.config.getAgents().map((a) => [a.name, a]));

    // Stop removed agents
    for (const name of oldAgents.keys()) {
      if (!newAgents.has(name)) {
        this.stopAgent(name);
        this._log(`Reload: stopped removed agent '${name}'`);
      }
    }

    // Start new agents
    for (const [name, agent] of newAgents) {
      if (!oldAgents.has(name)) {
        this._launchAgent(agent);
        this._log(`Reload: started new agent '${name}'`);
      }
    }

    this._writeStatus();
  }

  _writePid() {
    try {
      fs.writeFileSync(this.config.pidFile, String(process.pid), 'utf-8');
    } catch {}
  }

  _cleanupPid() {
    try { fs.unlinkSync(this.config.pidFile); } catch {}
    try { fs.unlinkSync(this.config.statusFile); } catch {}
  }

  _log(msg) {
    const ts = new Date().toISOString();
    const line = `${ts} INFO daemon: ${msg}`;
    try {
      fs.appendFileSync(this.config.logFile, line + '\n', 'utf-8');
    } catch {}
    if (!this._shuttingDown) {
      // Also log to console when running in foreground
      console.log(line);
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  static _readPid(pidFile) {
    try {
      if (!fs.existsSync(pidFile)) return null;
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      if (isNaN(pid)) return null;
      if (Daemon._isAlive(pid)) return pid;
      // Stale
      try { fs.unlinkSync(pidFile); } catch {}
      return null;
    } catch {
      return null;
    }
  }

  static _isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { Daemon };
