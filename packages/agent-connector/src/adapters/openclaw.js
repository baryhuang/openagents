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

    // Conversation history for multi-turn context
    this._conversationHistory = [];
    this._maxHistory = 50;

    // Find the openclaw binary
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
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 })
        .split(/\r?\n/)[0].trim();
      if (result) return result;
    } catch {}

    // Check common npm global directories
    const dirs = [];
    if (IS_WINDOWS) {
      const appdata = process.env.APPDATA || '';
      if (appdata) dirs.push(path.join(appdata, 'npm'));
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
        this._conversationHistory.push({ role: 'user', content });
        this._conversationHistory.push({ role: 'assistant', content: responseText });
        if (this._conversationHistory.length > this._maxHistory * 2) {
          this._conversationHistory = this._conversationHistory.slice(-this._maxHistory * 2);
        }
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
}

module.exports = OpenClawAdapter;
