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

    // Direct API mode: call LLM via HTTP (no OpenClaw CLI needed).
    // Activated when LLM_API_KEY + LLM_BASE_URL are in agent env.
    const env = opts.agentEnv || {};
    this._directApiKey = env.OPENAI_API_KEY || env.LLM_API_KEY || '';
    this._directBaseUrl = (env.OPENAI_BASE_URL || env.LLM_BASE_URL || '').replace(/\/+$/, '');
    this._directModel = env.OPENCLAW_MODEL || env.LLM_MODEL || 'gpt-4o';
    const forceDirectApi = (env.OPENCLAW_DIRECT_API || '').trim();
    this._directMode = !!(this._directApiKey && this._directBaseUrl && (forceDirectApi === '1' || forceDirectApi === 'true'));

    // Find the openclaw binary
    this._openclawBinary = this._findOpenclawBinary();

    if (this._directMode) {
      this._log(`Using direct LLM API mode (${this._directBaseUrl}, model=${this._directModel})`);
    } else if (this._openclawBinary) {
      this._log(`Using OpenClaw CLI mode (${this._openclawBinary})`);
    } else {
      this._log('OpenClaw binary not found and no direct API config — agent will not be able to process messages');
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
      let responseText;
      if (this._directMode) {
        responseText = await this._runDirectApi(content, msgChannel);
      } else {
        responseText = await this._runCliAgent(content, msgChannel);
      }

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
        // Ensure node and npm global bin are on PATH
        const nodeBinDir = path.dirname(process.execPath);
        const npmBin = path.join(process.env.APPDATA || '', 'npm');
        const extraPaths = [nodeBinDir, npmBin].filter(Boolean);
        for (const p of extraPaths) {
          if (p && !(spawnEnv.PATH || '').includes(p)) {
            spawnEnv.PATH = p + ';' + (spawnEnv.PATH || '');
          }
        }
      }

      let spawnBinary = binary;
      let spawnArgs = args;
      const spawnOpts = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: spawnEnv,
        timeout: 600000,
      };

      if (IS_WINDOWS) {
        spawnBinary = process.env.COMSPEC || 'cmd.exe';
        const quotedArgs = args.map((a) => a.includes(' ') ? `"${a}"` : a);
        spawnArgs = ['/C', binary, ...quotedArgs];
      }

      const proc = spawn(spawnBinary, spawnArgs, spawnOpts);
      let stdout = '';
      let stderr = '';

      // OpenClaw writes --json output to stderr, so capture both
      if (proc.stdout) proc.stdout.on('data', (d) => { stdout += d; });
      if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d; stdout += d; });

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
          // Extract response text from JSON
          const payloads = data.payloads || [];
          if (payloads.length > 0) {
            const texts = payloads
              .filter((p) => p.text)
              .map((p) => p.text);
            resolve(texts.join('\n\n'));
          } else {
            resolve('');
          }
        } catch {
          // Failed to parse JSON — return raw output
          resolve(stdout);
        }
      });
    });
  }
  // ------------------------------------------------------------------
  // Direct API mode (bypass OpenClaw CLI, call LLM directly)
  // ------------------------------------------------------------------

  async _runDirectApi(userMessage, channel) {
    const https = require('https');
    const http = require('http');
    const url = new URL(this._directBaseUrl + '/chat/completions');
    const transport = url.protocol === 'https:' ? https : http;

    // Build system prompt
    let systemPrompt;
    try {
      const { buildOpenclawSystemPrompt } = require('./workspace-prompt');
      systemPrompt = buildOpenclawSystemPrompt({
        agentName: this.agentName,
        workspaceId: this.workspaceId,
        channelName: channel,
        endpoint: this.client?.endpoint || '',
        token: this.token || '',
      });
    } catch (e) {
      this._log(`System prompt build failed (using fallback): ${e.message}`);
    }
    if (!systemPrompt) {
      systemPrompt = `You are a helpful AI assistant named ${this.agentName}. You are connected to an OpenAgents workspace. Answer questions concisely and helpfully.`;
    }

    // Simple conversation (no history for now)
    const messages = [
      { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
      { role: 'user', content: userMessage },
    ];

    const body = JSON.stringify({
      model: this._directModel,
      messages,
      stream: false,
    });

    this._log(`Direct API: ${url.hostname} model=${this._directModel} msg=${userMessage.slice(0, 50)}...`);

    return new Promise((resolve, reject) => {
      const req = transport.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._directApiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`${res.statusCode} ${data.slice(0, 200)}`));
              return;
            }
            const result = JSON.parse(data);
            const text = result.choices?.[0]?.message?.content || '';
            this._log(`Direct API response: ${text.slice(0, 80)}...`);
            resolve(text);
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(body);
      req.end();
    });
  }

  // ------------------------------------------------------------------
  // Static: configure OpenClaw's native auth from LLM env vars
  // ------------------------------------------------------------------

  /**
   * Write OpenClaw's auth-profiles.json and openclaw.json from the
   * user-provided LLM_API_KEY / LLM_BASE_URL / LLM_MODEL values.
   * Called by the Launcher's saveAgentEnv when type === 'openclaw'.
   */
  static configureNativeAuth(env) {
    const apiKey = env.LLM_API_KEY;
    const baseUrl = env.LLM_BASE_URL || 'https://api.openai.com/v1';
    const model = env.LLM_MODEL || 'gpt-4o';
    if (!apiKey) return;

    // Determine provider: if baseUrl is openai.com, use 'openai'; otherwise 'openai-compatible'
    const isOpenAI = baseUrl.includes('api.openai.com');
    const isAnthropic = baseUrl.includes('api.anthropic.com');
    let provider = 'openai';
    if (isAnthropic) provider = 'anthropic';
    else if (!isOpenAI) provider = 'openai';  // custom endpoints use openai provider with baseUrl override

    const profileId = `${provider}:manual`;
    const agentDir = path.join(OPENCLAW_STATE_DIR, 'agents', 'main', 'agent');

    // Write auth-profiles.json
    try {
      fs.mkdirSync(agentDir, { recursive: true });
      const authFile = path.join(agentDir, 'auth-profiles.json');
      let authData = { version: 1, profiles: {} };
      try { authData = JSON.parse(fs.readFileSync(authFile, 'utf-8')); } catch {}
      authData.profiles = authData.profiles || {};
      const profile = { type: 'token', provider, token: apiKey };
      if (!isOpenAI && !isAnthropic) profile.baseUrl = baseUrl;
      authData.profiles[profileId] = profile;
      authData.lastGood = authData.lastGood || {};
      authData.lastGood[provider] = profileId;
      fs.writeFileSync(authFile, JSON.stringify(authData, null, 2), 'utf-8');
    } catch {}

    // Write model config in openclaw.json
    try {
      const configFile = path.join(OPENCLAW_STATE_DIR, 'openclaw.json');
      let config = {};
      try { config = JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch {}
      config.agents = config.agents || {};
      config.agents.defaults = config.agents.defaults || {};
      config.agents.defaults.model = config.agents.defaults.model || {};

      const modelId = isAnthropic ? `anthropic/${model}` : `openai/${model}`;
      config.agents.defaults.model.primary = modelId;
      config.agents.defaults.models = config.agents.defaults.models || {};
      config.agents.defaults.models[modelId] = {};
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
    } catch {}

    // For non-standard endpoints, enable direct API mode since OpenClaw's
    // CLI doesn't support custom base URLs. The adapter will call the LLM
    // API directly via HTTP instead of using `openclaw agent` CLI.
    if (!isOpenAI && !isAnthropic) {
      env.OPENAI_BASE_URL = baseUrl;
      env.OPENAI_API_KEY = apiKey;
      env.OPENCLAW_DIRECT_API = 'true';
    }
  }
}

module.exports = OpenClawAdapter;
