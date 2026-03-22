'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const { whichBinary, getEnhancedEnv } = require('./paths');

/**
 * Manages installation and uninstallation of agent runtimes.
 *
 * Install markers are stored in two places for compatibility with the Python SDK:
 *   1. ~/.openagents/installed_agents.json  (JSON array of names)
 *   2. ~/.openagents/installed/<name>       (empty marker files)
 */
class Installer {
  constructor(registry, configDir) {
    this.registry = registry;
    this.configDir = configDir;
    this.markersFile = path.join(configDir, 'installed_agents.json');
    this.markersDir = path.join(configDir, 'installed');
  }

  /**
   * Get the current platform key: 'macos', 'linux', or 'windows'.
   */
  static platform() {
    const p = process.platform;
    if (p === 'darwin') return 'macos';
    if (p === 'win32') return 'windows';
    return 'linux';
  }

  /**
   * Check if an agent type is installed.
   * Checks binary on PATH first, then marker files.
   */
  isInstalled(agentType) {
    if (this._whichBinary(agentType)) return true;
    return this._hasMarker(agentType);
  }

  /**
   * Find the binary path for an agent type.
   */
  which(agentType) {
    return this._whichBinary(agentType);
  }

  /**
   * Health check — binary existence + version.
   * @returns {{ installed: boolean, binary: string|null, version: string|null }}
   */
  healthCheck(agentType) {
    const binary = this._whichBinary(agentType);
    if (!binary) return { installed: false, binary: null, version: null };

    const entry = this.registry.getEntry(agentType);
    const checkCmd = entry && entry.install ? entry.install.check_command : null;
    const versionCmd = checkCmd || `${entry && entry.install && entry.install.binary || agentType} --version`;

    let version = null;
    try {
      const raw = execSync(versionCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getEnhancedEnv(),
        timeout: 10000,
      }).trim();
      // Extract version number (e.g. "openclaw 2024.1.5" → "2024.1.5")
      const match = raw.match(/(\d+[\d.]+\d+)/);
      version = match ? match[1] : raw.split('\n')[0];
    } catch {}

    return { installed: true, binary, version };
  }

  /**
   * Install an agent runtime.
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async install(agentType) {
    const entry = this.registry.getEntry(agentType);
    if (!entry || !entry.install) {
      throw new Error(`No install definition for agent type: ${agentType}`);
    }

    const cmd = this._getInstallCommand(entry.install);
    if (!cmd) {
      throw new Error(`No install command for ${agentType} on ${Installer.platform()}`);
    }

    const output = await this._execShell(cmd);
    this._markInstalled(agentType);
    return { success: true, output };
  }

  /**
   * Install with streaming output via callback.
   * @param {string} agentType
   * @param {function(string)} onData - called with each chunk of output
   * @returns {Promise<{success: boolean, command: string}>}
   */
  async installStreaming(agentType, onData) {
    const { spawn } = require('child_process');
    const entry = this.registry.getEntry(agentType);
    if (!entry || !entry.install) {
      throw new Error(`No install definition for agent type: ${agentType}`);
    }

    const cmd = this._getInstallCommand(entry.install);
    if (!cmd) {
      throw new Error(`No install command for ${agentType} on ${Installer.platform()}`);
    }

    if (onData) onData(`$ ${cmd}\n`);

    const env = this._buildShellEnv();
    const shell = process.platform === 'win32'
      ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
      : true;

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, [], { shell, env, stdio: ['ignore', 'pipe', 'pipe'] });

      if (proc.stdout) proc.stdout.setEncoding('utf-8');
      if (proc.stderr) proc.stderr.setEncoding('utf-8');

      if (proc.stdout) proc.stdout.on('data', (d) => { if (onData) onData(d); });
      if (proc.stderr) proc.stderr.on('data', (d) => { if (onData) onData(d); });

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) {
          this._markInstalled(agentType);
          if (onData) onData(`\nDone! ${agentType} is now installed.\n`);
          resolve({ success: true, command: cmd });
        } else {
          const msg = `Install failed with exit code ${code}`;
          if (onData) onData(`\n${msg}\n`);
          reject(new Error(msg));
        }
      });
    });
  }

  /**
   * Uninstall an agent runtime.
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async uninstall(agentType) {
    const entry = this.registry.getEntry(agentType);
    if (!entry || !entry.install) {
      throw new Error(`No install definition for agent type: ${agentType}`);
    }

    const installCmd = this._getInstallCommand(entry.install);
    const uninstallCmd = this._deriveUninstallCommand(installCmd);
    if (!uninstallCmd) {
      throw new Error(`Cannot derive uninstall command for ${agentType}`);
    }

    const output = await this._execShell(uninstallCmd);
    this._markUninstalled(agentType);
    return { success: true, output };
  }

  /**
   * Uninstall with streaming output via callback.
   */
  async uninstallStreaming(agentType, onData) {
    const { spawn } = require('child_process');
    const entry = this.registry.getEntry(agentType);
    if (!entry || !entry.install) {
      throw new Error(`No install definition for agent type: ${agentType}`);
    }

    const installCmd = this._getInstallCommand(entry.install);
    const cmd = this._deriveUninstallCommand(installCmd);
    if (!cmd) {
      throw new Error(`Cannot derive uninstall command for ${agentType}`);
    }

    if (onData) onData(`$ ${cmd}\n`);

    const env = this._buildShellEnv();
    const shell = process.platform === 'win32'
      ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
      : true;

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, [], { shell, env, stdio: ['ignore', 'pipe', 'pipe'] });

      if (proc.stdout) proc.stdout.setEncoding('utf-8');
      if (proc.stderr) proc.stderr.setEncoding('utf-8');

      if (proc.stdout) proc.stdout.on('data', (d) => { if (onData) onData(d); });
      if (proc.stderr) proc.stderr.on('data', (d) => { if (onData) onData(d); });

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) {
          this._markUninstalled(agentType);
          if (onData) onData(`\nDone! ${agentType} has been uninstalled.\n`);
          resolve({ success: true, command: cmd });
        } else {
          const msg = `Uninstall failed with exit code ${code}`;
          if (onData) onData(`\n${msg}\n`);
          reject(new Error(msg));
        }
      });
    });
  }

  /**
   * Get install command for current platform.
   */
  _getInstallCommand(installCfg) {
    const plat = Installer.platform();
    return installCfg[plat] || installCfg.command || null;
  }

  /**
   * Derive uninstall command from install command.
   */
  _deriveUninstallCommand(installCmd) {
    if (!installCmd) return null;

    // npm install -g <pkg> → npm uninstall -g <pkg>
    if (installCmd.includes('npm install')) {
      return installCmd
        .replace('npm install -g', 'npm uninstall -g')
        .replace('npm install', 'npm uninstall')
        .replace(/@latest/g, '')
        .replace(/@[\d.]+/g, '');
    }

    // pip install <pkg> → pip uninstall -y <pkg>
    if (installCmd.includes('pip install') || installCmd.includes('pip3 install')) {
      return installCmd
        .replace('pip install', 'pip uninstall -y')
        .replace('pip3 install', 'pip3 uninstall -y');
    }

    // pipx install <pkg> → pipx uninstall <pkg>
    if (installCmd.includes('pipx install')) {
      return installCmd.replace('pipx install', 'pipx uninstall');
    }

    return null;
  }

  /**
   * Find a binary on PATH (delegates to paths.js for cross-platform detection).
   */
  _whichBinary(agentType) {
    const entry = this.registry.getEntry(agentType);
    const binary = entry && entry.install ? entry.install.binary : agentType;
    return whichBinary(binary);
  }

  // -- Markers --

  _hasMarker(agentType) {
    // Check per-agent marker file first (faster)
    try {
      if (fs.existsSync(path.join(this.markersDir, agentType))) return true;
    } catch {}

    // Check JSON markers file
    try {
      if (fs.existsSync(this.markersFile)) {
        const data = JSON.parse(fs.readFileSync(this.markersFile, 'utf-8'));
        if (Array.isArray(data) && data.includes(agentType)) return true;
      }
    } catch {}

    return false;
  }

  _markInstalled(agentType) {
    // JSON file
    try {
      fs.mkdirSync(this.configDir, { recursive: true });
      let markers = [];
      try {
        markers = JSON.parse(fs.readFileSync(this.markersFile, 'utf-8'));
        if (!Array.isArray(markers)) markers = [];
      } catch {}
      if (!markers.includes(agentType)) {
        markers.push(agentType);
        markers.sort();
      }
      fs.writeFileSync(this.markersFile, JSON.stringify(markers), 'utf-8');
    } catch {}

    // Per-agent marker file
    try {
      fs.mkdirSync(this.markersDir, { recursive: true });
      fs.writeFileSync(path.join(this.markersDir, agentType), '', 'utf-8');
    } catch {}
  }

  _markUninstalled(agentType) {
    // JSON file
    try {
      if (fs.existsSync(this.markersFile)) {
        let markers = JSON.parse(fs.readFileSync(this.markersFile, 'utf-8'));
        if (Array.isArray(markers)) {
          markers = markers.filter((m) => m !== agentType);
          fs.writeFileSync(this.markersFile, JSON.stringify(markers), 'utf-8');
        }
      }
    } catch {}

    // Per-agent marker file
    try {
      const markerFile = path.join(this.markersDir, agentType);
      if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);
    } catch {}
  }

  // -- Shell env + exec --

  _buildShellEnv() {
    const env = { ...process.env };
    const sep = process.platform === 'win32' ? ';' : ':';
    const extraDirs = [];
    try { extraDirs.push(path.dirname(process.execPath)); } catch {}
    if (process.platform === 'win32') {
      const appData = env.APPDATA || '';
      if (appData) extraDirs.push(path.join(appData, 'npm'));
      extraDirs.push(env.ProgramFiles ? path.join(env.ProgramFiles, 'nodejs') : 'C:\\Program Files\\nodejs');
      extraDirs.push(env.SystemRoot ? path.join(env.SystemRoot, 'System32') : 'C:\\Windows\\System32');
      extraDirs.push(env.ProgramFiles ? path.join(env.ProgramFiles, 'Git', 'cmd') : 'C:\\Program Files\\Git\\cmd');
    } else {
      extraDirs.push('/usr/local/bin', '/opt/homebrew/bin');
    }
    for (const d of extraDirs) {
      if (d && !(env.PATH || '').includes(d)) {
        env.PATH = d + sep + (env.PATH || '');
      }
    }
    return env;
  }

  _execShell(cmd, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const env = this._buildShellEnv();

      let shell = true;
      if (process.platform === 'win32') {
        shell = env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
      }

      exec(cmd, {
        encoding: 'utf-8',
        timeout: timeoutMs,
        shell,
        env,
      }, (error, stdout, stderr) => {
        const output = ((stdout || '') + '\n' + (stderr || '')).trim();
        if (error) {
          const err = new Error(output || error.message);
          err.exitCode = error.code;
          reject(err);
        } else {
          resolve(output);
        }
      });
    });
  }
}

module.exports = { Installer };
