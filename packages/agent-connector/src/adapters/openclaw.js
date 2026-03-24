/**
 * OpenClaw adapter for OpenAgents workspace.
 *
 * Bridges OpenClaw to an OpenAgents workspace via:
 * - CLI mode: `openclaw agent --local --json` (preferred)
 * - Workspace context injected via SKILL.md auto-discovery
 *
 * Direct port of Python: src/openagents/adapters/openclaw.py
 * (CLI mode only — gateway WS and direct HTTP modes are not yet ported)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt } = require('./utils');
const { buildOpenclawSkillMd, buildOpenclawSystemPrompt } = require('./workspace-prompt');

const IS_WINDOWS = process.platform === 'win32';
const OPENCLAW_STATE_DIR = path.join(
  IS_WINDOWS ? (process.env.USERPROFILE || '') : (process.env.HOME || ''),
  '.openclaw'
);

class OpenClawAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {string} [opts.openclawAgentId='main']
   * @param {Set} [opts.disabledModules]
   */
  constructor(opts) {
    super(opts);
    this.openclawAgentId = opts.openclawAgentId || 'main';
    this.disabledModules = opts.disabledModules || new Set();

    // Find the openclaw binary — always use CLI/gateway mode for full tool support
    this._openclawBinary = this._findOpenclawBinary();

    if (this._openclawBinary) {
      this._log(`Using OpenClaw CLI mode (${this._openclawBinary})`);
    } else {
      this._log('OpenClaw binary not found — agent will not be able to process messages');
    }

    // Install workspace skill
    this._installWorkspaceSkill();
  }

  // ------------------------------------------------------------------
  // Binary resolution
  // ------------------------------------------------------------------

  _findOpenclawBinary() {
    try {
      const cmd = IS_WINDOWS ? 'where openclaw' : 'which openclaw';
      const { getEnhancedEnv } = require('../paths');
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000, env: getEnhancedEnv() })
        .split(/\r?\n/)[0].trim();
      if (result) return result;
    } catch {}

    // Check common npm global directories
    const dirs = [];
    if (IS_WINDOWS) {
      const appdata = process.env.APPDATA || '';
      if (appdata) dirs.push(path.join(appdata, 'npm'));
      // Portable Node.js installed by OpenAgents Launcher
      const home = process.env.USERPROFILE || process.env.HOME || '';
      if (home) dirs.push(path.join(home, '.openagents', 'nodejs'));
    } else {
      const home = process.env.HOME || '';
      dirs.push(path.join(home, '.npm-global', 'bin'), '/usr/local/bin');
    }
    for (const d of dirs) {
      for (const name of ['openclaw.cmd', 'openclaw']) {
        const candidate = path.join(d, name);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Workspace skill installation
  // ------------------------------------------------------------------

  _resolveOpenclawWorkspace() {
    const agentId = this.openclawAgentId;
    const wsDir = agentId && agentId !== 'main'
      ? path.join(OPENCLAW_STATE_DIR, `workspace-${agentId}`)
      : path.join(OPENCLAW_STATE_DIR, 'workspace');

    if (fs.existsSync(wsDir)) return wsDir;

    // Fall back to default workspace
    const fallback = path.join(OPENCLAW_STATE_DIR, 'workspace');
    if (fs.existsSync(fallback)) return fallback;

    return null;
  }

  _installWorkspaceSkill() {
    const wsDir = this._resolveOpenclawWorkspace();
    if (!wsDir) {
      this._log('OpenClaw workspace not found, skipping skill install');
      return;
    }

    const skillName = `openagents-workspace-${this.agentName}`;
    const skillDir = path.join(wsDir, 'skills', skillName);
    fs.mkdirSync(skillDir, { recursive: true });

    const content = buildOpenclawSkillMd({
      endpoint: this.endpoint,
      workspaceId: this.workspaceId,
      token: this.token,
      agentName: this.agentName,
      channelName: this.channelName,
      disabledModules: this.disabledModules,
    });

    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillPath, content, 'utf-8');
    this._log(`Installed workspace skill at ${skillPath}`);
  }

  // ------------------------------------------------------------------
  // Message handling
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];

    // Append attachment info
    const attText = formatAttachmentsForPrompt(attachments);
    if (attText) {
      content = content ? content + attText : attText.trim();
    }

    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      const responseText = await this._runCliAgent(content, msgChannel);

      if (responseText) {
        await this.sendResponse(msgChannel, responseText);
      } else {
        await this.sendResponse(msgChannel, 'No response generated. Please try again.');
      }
    } catch (e) {
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
    }
  }

  // ------------------------------------------------------------------
  // CLI mode (openclaw agent --local)
  // ------------------------------------------------------------------

  _runCliAgent(userMessage, channel) {
    return new Promise((resolve, reject) => {
      const binary = this._openclawBinary;
      if (!binary) {
        reject(new Error('OpenClaw binary not found'));
        return;
      }

      const sessionKey = `openagents-${this.workspaceId.slice(0, 8)}-${channel.slice(-8)}`;

      const args = [
        'agent', '--local',
        '--agent', this.openclawAgentId,
        '--session-id', sessionKey,
        '--message', userMessage,
        '--json',
      ];

      this._log(`CLI: ${binary} ${args.slice(0, 5).join(' ')} ...`);

      const spawnEnv = { ...(this.agentEnv || process.env) };
      if (IS_WINDOWS) {
        const nodeBinDir = path.dirname(process.execPath);
        const npmBin = path.join(process.env.APPDATA || '', 'npm');
        const portableDir = path.join(os.homedir(), '.openagents', 'nodejs');
        for (const p of [nodeBinDir, npmBin, portableDir]) {
          if (p && !(spawnEnv.PATH || '').includes(p)) {
            spawnEnv.PATH = p + path.delimiter + (spawnEnv.PATH || '');
          }
        }
      }

      // Tool name → human-readable status
      const toolLabels = {
        exec: 'Running command...',
        read: 'Reading file...',
        write: 'Writing file...',
        edit: 'Editing file...',
        browser: 'Using browser...',
        web_search: 'Searching the web...',
        web_fetch: 'Fetching webpage...',
        process: 'Running process...',
        image_generate: 'Generating image...',
        memory_search: 'Searching memory...',
      };

      let output = '';
      let lineBuffer = '';

      const processLine = (line) => {
        const toolStart = line.match(/embedded run tool start:.*tool=(\w+)/);
        if (toolStart) {
          const label = toolLabels[toolStart[1]] || `Using ${toolStart[1]}...`;
          this._log(`Tool: ${label}`);
          this.sendStatus(channel, label).catch(() => {});
        }
        if (line.match(/embedded run agent start/)) {
          this.sendStatus(channel, 'thinking...').catch(() => {});
        }
      };

      // Try node-pty for line-buffered output (real-time tool streaming)
      let pty;
      try { pty = require('node-pty'); } catch {}

      if (pty) {
        const shell = IS_WINDOWS ? binary : binary;
        this._log('Spawn: node-pty (line-buffered)');
        const proc = pty.spawn(binary, args, {
          name: 'xterm',
          cols: 200,
          rows: 50,
          cwd: process.cwd(),
          env: spawnEnv,
        });

        proc.onData((data) => {
          output += data;
          lineBuffer += data;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';
          for (const line of lines) processLine(line);
        });

        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error('CLI timed out after 600 seconds'));
        }, 600000);

        proc.onExit(({ exitCode }) => {
          clearTimeout(timeout);
          // Process remaining buffer
          if (lineBuffer) processLine(lineBuffer);

          if (exitCode !== 0) {
            reject(new Error(`CLI exited ${exitCode}: ${output.slice(-300)}`));
            return;
          }
          this._parseCliOutput(output, resolve);
        });
      } else {
        // Fallback: regular spawn (buffered on Windows)
        this._log('Spawn: fallback (no node-pty)');
        let spawnBin = binary;
        let spawnArgs = args;
        if (IS_WINDOWS) {
          spawnBin = process.env.COMSPEC || 'cmd.exe';
          spawnArgs = ['/C', binary, ...args.map(a => a.includes(' ') ? `"${a}"` : a)];
        }
        const proc = spawn(spawnBin, spawnArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: spawnEnv,
          timeout: 600000,
          windowsHide: true,
        });
        if (proc.stdout) proc.stdout.on('data', (d) => { output += d; });
        if (proc.stderr) proc.stderr.on('data', (d) => { output += d; });
        proc.on('error', (err) => reject(err));
        proc.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`CLI exited ${code}: ${output.slice(-300)}`));
            return;
          }
          this._parseCliOutput(output, resolve);
        });
      }
    });
  }

  _parseCliOutput(output, resolve) {
    const text = output.trim();
    if (!text) { resolve(''); return; }
    const jsonStart = text.indexOf('{');
    if (jsonStart < 0) { resolve(text); return; }
    try {
      const data = JSON.parse(text.slice(jsonStart));
      const payloads = data.payloads || [];
      if (payloads.length > 0) {
        resolve(payloads.filter(p => p.text).map(p => p.text).join('\n\n'));
      } else {
        resolve('');
      }
    } catch {
      resolve(text);
    }
  }
  // ------------------------------------------------------------------
  // Static: configure OpenClaw's native auth from LLM env vars
  // ------------------------------------------------------------------

  /**
   * Configure OpenClaw's native auth and model from user-provided
   * LLM_API_KEY / LLM_BASE_URL / LLM_MODEL values.
   * Called by the Launcher's saveAgentEnv when type === 'openclaw'.
   *
   * For standard providers (OpenAI, Anthropic), uses auth-profiles.json.
   * For custom endpoints, uses models.providers in openclaw.json which
   * gives full tool support via the CLI gateway mode.
   */
  static configureNativeAuth(env) {
    const apiKey = env.LLM_API_KEY;
    const baseUrl = env.LLM_BASE_URL || 'https://api.openai.com/v1';
    const model = env.LLM_MODEL || 'gpt-4o';
    if (!apiKey) return;

    const isOpenAI = baseUrl.includes('api.openai.com');
    const isAnthropic = baseUrl.includes('api.anthropic.com');
    const configFile = path.join(OPENCLAW_STATE_DIR, 'openclaw.json');

    if (isOpenAI || isAnthropic) {
      // Standard provider — use auth-profiles.json
      const provider = isAnthropic ? 'anthropic' : 'openai';
      const profileId = `${provider}:manual`;
      const agentDir = path.join(OPENCLAW_STATE_DIR, 'agents', 'main', 'agent');

      try {
        fs.mkdirSync(agentDir, { recursive: true });
        const authFile = path.join(agentDir, 'auth-profiles.json');
        let authData = { version: 1, profiles: {} };
        try { authData = JSON.parse(fs.readFileSync(authFile, 'utf-8')); } catch {}
        authData.profiles = authData.profiles || {};
        authData.profiles[profileId] = { type: 'token', provider, token: apiKey };
        authData.lastGood = authData.lastGood || {};
        authData.lastGood[provider] = profileId;
        fs.writeFileSync(authFile, JSON.stringify(authData, null, 2), 'utf-8');
      } catch {}

      // Set model
      try {
        let config = {};
        try { config = JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch {}
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = { primary: `${provider}/${model}` };
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
      } catch {}
    } else {
      // Custom endpoint — use models.providers for full gateway/tool support
      // This is the proper way to add custom LLM endpoints to OpenClaw.
      // See: https://docs.openclaw.ai/concepts/model-providers
      try {
        let config = {};
        try { config = JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch {}

        config.models = config.models || {};
        config.models.providers = config.models.providers || {};
        config.models.providers.custom = {
          baseUrl: baseUrl.replace(/\/+$/, ''),
          apiKey,
          api: 'openai-completions',
          models: [{ id: model, name: model }],
        };

        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = { primary: `custom/${model}` };

        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
      } catch {}
    }
  }
}

module.exports = OpenClawAdapter;
