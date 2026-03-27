/**
 * Claude Code adapter for OpenAgents workspace.
 *
 * Bridges Claude Code to an OpenAgents workspace via:
 * - Polling loop for incoming messages
 * - Claude CLI subprocess (stream-json) for task execution
 * - MCP server for workspace tool access
 *
 * Direct port of Python: src/openagents/adapters/claude.py
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildClaudeSystemPrompt } = require('./workspace-prompt');

const IS_WINDOWS = process.platform === 'win32';

class ClaudeAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    this.workingDir = opts.workingDir || undefined;
    this._channelSessions = {}; // channel → Claude CLI session_id
    this._channelProcesses = {}; // channel → child process
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}.json`
    );
    this._loadSessions();
  }

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} session(s)`);
        }
      }
    } catch {
      this._log('Could not load sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      const dir = path.dirname(this._sessionsFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  async _onControlAction(action, _payload) {
    if (action === 'stop') {
      await this._stopAllProcesses();
    }
  }

  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 }); } catch {}
      } else {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch {
          proc.kill('SIGTERM');
        }
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {
              proc.kill('SIGKILL');
            }
            resolve();
          }, 5000);
          proc.on('exit', () => { clearTimeout(timeout); resolve(); });
        });
      }
    } catch {}
  }

  async _stopAllProcesses() {
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running process(es)...`);
    for (const [channel, proc] of entries) {
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try {
        await this.sendStatus(channel, 'Execution stopped by user');
      } catch {}
    }
  }

  _findClaudeBinary() {
    const home = os.homedir();

    // Tier 0: Portable install at ~/.openagents/nodejs/node_modules/.bin/
    const portableBin = path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin');
    const ext = IS_WINDOWS ? '.cmd' : '';
    const portableCandidate = path.join(portableBin, `claude${ext}`);
    if (fs.existsSync(portableCandidate)) return portableCandidate;

    // Tier 1: PATH search
    try {
      if (IS_WINDOWS) {
        const r = execSync('where claude.cmd 2>nul || where claude.exe 2>nul || where claude 2>nul', {
          encoding: 'utf-8', timeout: 5000,
        });
        return r.split(/\r?\n/)[0].trim();
      } else {
        return execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
      }
    } catch {}

    // Tier 2: Next to current Node.js interpreter (npm global)
    const nodeBinDir = path.dirname(process.execPath);
    const nearNode = path.join(nodeBinDir, `claude${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: Common install locations
    const candidates = IS_WINDOWS ? [
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
    ] : [
      path.join(home, '.local', 'bin', 'claude'),
      path.join(home, '.npm-global', 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    return null;
  }

  _buildClaudeCmd(prompt, channelName) {
    const claudeBin = this._findClaudeBinary();
    if (!claudeBin) {
      throw new Error('claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash');
    }

    const systemPrompt = '\n' + buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      mode: this._mode,
    });

    const cmd = [claudeBin, '-p', prompt, '--output-format', 'stream-json', '--verbose'];

    // Mode-dependent permission and tool flags
    const pfx = 'mcp__openagents-workspace__';
    const mcpTools = [
      `${pfx}workspace_get_history`,
      `${pfx}workspace_get_agents`,
      `${pfx}workspace_status`,
    ];
    const mcpWriteTools = [];

    if (!this.disabledModules.has('files')) {
      mcpTools.push(`${pfx}workspace_list_files`, `${pfx}workspace_read_file`);
      mcpWriteTools.push(`${pfx}workspace_write_file`, `${pfx}workspace_delete_file`);
    }
    if (!this.disabledModules.has('browser')) {
      mcpTools.push(
        `${pfx}workspace_browser_list_tabs`,
        `${pfx}workspace_browser_snapshot`,
        `${pfx}workspace_browser_screenshot`
      );
      mcpWriteTools.push(
        `${pfx}workspace_browser_open`,
        `${pfx}workspace_browser_navigate`,
        `${pfx}workspace_browser_click`,
        `${pfx}workspace_browser_type`,
        `${pfx}workspace_browser_close`
      );
    }
    if (!this.disabledModules.has('tunnel')) {
      mcpTools.push(`${pfx}tunnel_list`);
      mcpWriteTools.push(`${pfx}tunnel_expose`, `${pfx}tunnel_close`);
    }

    let allowed;
    if (this._mode === 'plan') {
      cmd.push('--permission-mode', 'plan');
      allowed = [...mcpTools, 'Read', 'Glob', 'Grep'];
    } else {
      cmd.push('--dangerously-skip-permissions');
      allowed = [...mcpTools, ...mcpWriteTools, 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
    }

    cmd.push('--append-system-prompt', systemPrompt);
    cmd.push('--allowedTools', ...allowed);
    cmd.push('--disallowedTools', 'AskUserQuestion');

    // Resume existing conversation
    const sessionId = this._channelSessions[channelName];
    if (sessionId) {
      cmd.push('--resume', sessionId);
    }

    // MCP config for workspace tools
    const mcpArgs = [
      'mcp-server',
      '--workspace-id', this.workspaceId,
      '--channel-name', channelName,
      '--agent-name', this.agentName,
      '--endpoint', this.endpoint,
    ];
    if (this.disabledModules.has('files')) mcpArgs.push('--disable-files');
    if (this.disabledModules.has('browser')) mcpArgs.push('--disable-browser');

    // Find openagents binary (multi-tier)
    let oaBin = null;
    const home3 = os.homedir();
    // Tier 0: Portable install at ~/.openagents/nodejs/node_modules/.bin/
    const oaPortable = path.join(home3, '.openagents', 'nodejs', 'node_modules', '.bin', `openagents${IS_WINDOWS ? '.cmd' : ''}`);
    if (fs.existsSync(oaPortable)) oaBin = oaPortable;
    // Tier 1: PATH
    if (!oaBin) try {
      if (IS_WINDOWS) {
        oaBin = execSync('where openagents.cmd 2>nul || where openagents.exe 2>nul || where openagents 2>nul', {
          encoding: 'utf-8', timeout: 5000,
        }).split(/\r?\n/)[0].trim();
      } else {
        oaBin = execSync('which openagents', { encoding: 'utf-8', timeout: 5000 }).trim();
      }
    } catch {}
    // Tier 2: Next to Node.js
    if (!oaBin) {
      const nodeBinDir2 = path.dirname(process.execPath);
      const oaExt = IS_WINDOWS ? '.cmd' : '';
      const nearNode2 = path.join(nodeBinDir2, `openagents${oaExt}`);
      if (fs.existsSync(nearNode2)) oaBin = nearNode2;
    }
    // Tier 3: Common locations
    if (!oaBin) {
      const home2 = os.homedir();
      const oaCandidates = IS_WINDOWS ? [
        path.join(process.env.APPDATA || '', 'npm', 'openagents.cmd'),
      ] : [
        path.join(home2, '.openagents', 'npm-global', 'bin', 'openagents'),
        path.join(home2, '.local', 'bin', 'openagents'),
        path.join(home2, '.npm-global', 'bin', 'openagents'),
        '/opt/homebrew/bin/openagents',
        '/usr/local/bin/openagents',
      ];
      for (const c of oaCandidates) {
        if (fs.existsSync(c)) { oaBin = c; break; }
      }
    }
    if (!oaBin) {
      oaBin = 'openagents';
      this._log('Could not find openagents binary — MCP tools may not be available');
    }

    // On Windows, .cmd shims can't be used as MCP server commands —
    // resolve to node.exe + the actual JS entry point
    let mcpCommand = oaBin;
    let mcpFinalArgs = mcpArgs;
    if (IS_WINDOWS && oaBin.toLowerCase().endsWith('.cmd')) {
      const cmdContent = fs.readFileSync(oaBin, 'utf-8');
      const jsMatch = cmdContent.match(/%dp0%\\([^\s"*?]+\.js)/i);
      if (jsMatch) {
        const cmdDir = path.dirname(path.resolve(oaBin));
        const jsPath = path.resolve(cmdDir, jsMatch[1]);
        const nodeExe = path.join(os.homedir(), '.openagents', 'nodejs', 'node.exe');
        mcpCommand = fs.existsSync(nodeExe) ? nodeExe : 'node';
        mcpFinalArgs = [jsPath, ...mcpArgs];
      }
    }

    const mcpConfig = {
      mcpServers: {
        'openagents-workspace': {
          type: 'stdio',
          command: mcpCommand,
          args: mcpFinalArgs,
          env: { OA_WORKSPACE_TOKEN: this.token },
        },
      },
    };

    // Write MCP config to temp file (avoids cmd.exe JSON quoting issues)
    const mcpDir = path.join(os.homedir(), '.openagents', 'mcp-configs');
    fs.mkdirSync(mcpDir, { recursive: true });
    const mcpFile = path.join(mcpDir, `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(mcpFile, JSON.stringify(mcpConfig));
    cmd.push('--mcp-config', mcpFile);

    return { cmd, mcpConfigFile: mcpFile };
  }

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];

    const attText = formatAttachmentsForPrompt(attachments);
    if (attText) {
      content = content ? content + attText : attText.trim();
    }

    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

    // Auto-title + resume-from on first encounter
    if (!this._titledSessions.has(msgChannel)) {
      this._titledSessions.add(msgChannel);
      try {
        const info = await this.client.getSession(this.workspaceId, msgChannel, this.token);
        // Resume from a previous channel's Claude session if specified
        const resumeFrom = info.resumeFrom;
        if (resumeFrom && !this._channelSessions[msgChannel]) {
          const sourceSession = this._channelSessions[resumeFrom];
          if (sourceSession) {
            this._channelSessions[msgChannel] = sourceSession;
            this._saveSessions();
            this._log(`Resuming channel ${msgChannel} from ${resumeFrom}`);
          }
        }
        // Auto-title
        const title = generateSessionTitle(content);
        if (title && !info.titleManuallySet && SESSION_DEFAULT_RE.test(info.title || '')) {
          await this.client.updateSession(
            this.workspaceId, msgChannel, this.token,
            { title, autoTitle: true }
          );
        }
      } catch {}
    }

    await this.sendStatus(msgChannel, 'thinking...');

    let mcpConfigFile = null;
    let cmd;
    try {
      const result = this._buildClaudeCmd(content, msgChannel);
      cmd = result.cmd;
      mcpConfigFile = result.mcpConfigFile;
    } catch (e) {
      await this.sendError(msgChannel, e.message);
      return;
    }

    // Clean env
    const cleanEnv = { ...(this.agentEnv || process.env) };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_SESSION;

    try {
      // On Windows, spawn node.exe directly instead of .cmd shims to avoid
      // visible console windows and Unicode path issues
      if (IS_WINDOWS && cmd[0].toLowerCase().endsWith('.cmd')) {
        // Resolve .cmd shim → actual JS entry point
        // npm shims use %dp0% (directory of the .cmd file) as a relative base
        const cmdDir = path.dirname(path.resolve(cmd[0]));
        const cmdContent = fs.readFileSync(cmd[0], 'utf-8');
        const jsMatch = cmdContent.match(/"?%dp0%\\([^"*?]+\.js)"?/i);
        if (jsMatch) {
          const jsPath = path.resolve(cmdDir, jsMatch[1]);
          const nodeExe = path.join(os.homedir(), '.openagents', 'nodejs', 'node.exe');
          const nodeBin = fs.existsSync(nodeExe) ? nodeExe : 'node';
          cmd = [nodeBin, jsPath, ...cmd.slice(1)];
        } else {
          cmd = ['cmd.exe', '/c', ...cmd];
        }
      }

      const proc = spawn(cmd[0], cmd.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: cleanEnv,
        cwd: this.workingDir,
        detached: !IS_WINDOWS,
        windowsHide: true,
      });
      this._channelProcesses[msgChannel] = proc;

      const lastResponseText = [];
      let hasToolUseSinceLastText = false;
      let postedThinking = false;
      let stderrBuf = '';
      let lineBuffer = '';

      // Capture stderr for diagnostics
      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8'); });
      }

      await new Promise((resolve, reject) => {
        let consecutiveTimeouts = 0;
        let lastDataTime = Date.now();
        let timeoutTimer = null;

        const resetTimeout = () => {
          consecutiveTimeouts = 0;
          lastDataTime = Date.now();
        };

        // 15-second idle timeout monitoring
        const startTimeoutMonitor = () => {
          timeoutTimer = setInterval(async () => {
            const elapsed = Date.now() - lastDataTime;
            if (elapsed >= 15000) {
              consecutiveTimeouts++;
              lastDataTime = Date.now(); // reset for next interval
              if (consecutiveTimeouts === 2) {
                try { await this.sendStatus(msgChannel, 'Compacting conversation...'); } catch {}
              }
              // Kill after 20 consecutive timeouts (~5 minutes of no output)
              if (consecutiveTimeouts >= 20) {
                this._log(`Process idle for ${consecutiveTimeouts * 15}s, killing...`);
                await this._stopProcess(proc);
              }
            }
          }, 15000);
        };
        startTimeoutMonitor();

        const processLine = async (line) => {
          line = line.trim();
          if (!line) return;
          resetTimeout();

          let event;
          try { event = JSON.parse(line); } catch { return; }

          const eventType = event.type;

          if (eventType === 'assistant') {
            const blocks = (event.message || {}).content || [];
            for (const block of blocks) {
              if (block.type === 'text' && block.text && block.text.trim()) {
                if (hasToolUseSinceLastText) {
                  lastResponseText.length = 0;
                  hasToolUseSinceLastText = false;
                }
                lastResponseText.push(block.text.trim());
                postedThinking = true;
                // Only send status preview for longer responses (short ones arrive too quickly)
                if (block.text.trim().length > 80) {
                  const preview = block.text.trim().slice(0, 60) + '...';
                  await this.sendStatus(msgChannel, preview);
                }
              } else if (block.type === 'tool_use') {
                hasToolUseSinceLastText = true;
                postedThinking = false;
                lastResponseText.length = 0;
                const toolName = block.name || '';
                // Format tool input as readable text
                let inputPreview = '';
                if (block.input && typeof block.input === 'object') {
                  // Extract key fields for common tools
                  const inp = block.input;
                  if (inp.command) inputPreview = inp.command;
                  else if (inp.file_path || inp.path) inputPreview = inp.file_path || inp.path;
                  else if (inp.pattern) inputPreview = inp.pattern;
                  else if (inp.query) inputPreview = inp.query;
                  else if (inp.url) inputPreview = inp.url;
                  else if (inp.content) inputPreview = inp.content.slice(0, 100);
                  else inputPreview = JSON.stringify(inp).slice(0, 150);
                } else {
                  inputPreview = String(block.input || '').slice(0, 150);
                }
                await this.sendStatus(msgChannel, `${toolName} › ${inputPreview}`);
              }
            }
          } else if (eventType === 'result') {
            const sessionId = event.session_id;
            if (sessionId) {
              this._channelSessions[msgChannel] = sessionId;
              this._saveSessions();
            }
            if (event.is_error) {
              this._log(`Claude error: ${String(event.result || '').slice(0, 200)}`);
            }
          } else if (eventType === 'system') {
            const subtype = event.subtype || '';
            const message = event.message || '';
            if (subtype.includes('compact') || String(message).toLowerCase().includes('compact')) {
              await this.sendStatus(msgChannel, String(message) || 'Compacting conversation...');
            }
          } else if (eventType === 'rate_limit_event') {
            this._log(`Rate limited: ${JSON.stringify(event).slice(0, 200)}`);
          }
        };

        proc.on('exit', async (code) => {
          if (timeoutTimer) clearInterval(timeoutTimer);

          // Process remaining buffer
          const lines = lineBuffer.split('\n');
          for (const line of lines) {
            try { await processLine(line); } catch {}
          }

          delete this._channelProcesses[msgChannel];

          if (code !== 0) {
            this._log(`CLI exited with code ${code}`);
            if (stderrBuf.trim()) {
              this._log(`stderr: ${stderrBuf.trim().slice(0, 500)}`);
            }
          }

          if (lastResponseText.length > 0) {
            const fullResponse = lastResponseText.join('\n').trim();
            if (fullResponse) {
              try { await this.sendResponse(msgChannel, fullResponse); } catch {}
            }
          } else if (!postedThinking) {
            try { await this.sendResponse(msgChannel, 'No response generated. Please try again.'); } catch {}
          }
          resolve();
        });

        proc.on('error', (err) => {
          if (timeoutTimer) clearInterval(timeoutTimer);
          reject(err);
        });

        // Process lines as they arrive
        proc.stdout.on('data', (chunk) => {
          lineBuffer += chunk.toString('utf-8');
          resetTimeout();
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop(); // keep incomplete line
          for (const line of lines) {
            processLine(line).catch(() => {});
          }
        });
      });
    } catch (e) {
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
    } finally {
      if (mcpConfigFile) {
        try { fs.unlinkSync(mcpConfigFile); } catch {}
      }
      delete this._channelProcesses[msgChannel];
    }
  }
}

module.exports = ClaudeAdapter;
