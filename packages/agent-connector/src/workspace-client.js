'use strict';

const https = require('https');
const http = require('http');

const DEFAULT_ENDPOINT = 'https://workspace-endpoint.openagents.org';

/**
 * HTTP client for workspace API operations.
 *
 * Mirrors the Python SDK's WorkspaceClient — same endpoints, same
 * auth headers (X-Workspace-Token), same request/response shapes.
 */
class WorkspaceClient {
  constructor(endpoint) {
    this.endpoint = (endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
  }

  /**
   * Register an agent identity via POST /v1/agentid/register.
   */
  async registerAgent(agentName, { apiKey, origin = 'cli' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const data = await this._post('/v1/agentid/register', {
      agent_name: agentName,
      origin,
    }, headers);

    return data.data || data;
  }

  /**
   * Create a workspace via POST /v1/workspaces.
   * @returns {{ workspaceId, slug, name, token, url, channelName }}
   */
  async createWorkspace({ agentName, name, agentType } = {}) {
    const payload = {
      name: name || (agentName ? `${agentName}'s workspace` : 'My Workspace'),
    };
    if (agentName) payload.agent_name = agentName;
    if (agentType) payload.agent_type = agentType;

    const data = await this._post('/v1/workspaces', payload);
    const result = data.data || data;

    const frontendUrl = this.endpoint
      .replace('workspace-endpoint', 'workspace')
      .replace('/v1', '');

    return {
      workspaceId: result.workspaceId,
      slug: result.slug || result.workspaceId,
      name: result.name,
      token: result.token,
      url: `${frontendUrl}/${result.slug || result.workspaceId}?token=${result.token}`,
      channelName: (result.channel || {}).name || '',
    };
  }

  /**
   * Join a workspace via POST /v1/join.
   */
  async joinNetwork(agentName, token, { network, agentType, serverHost, workingDir } = {}) {
    const body = { agent_name: agentName, token };
    if (network) body.network = network;
    if (agentType) body.agent_type = agentType;
    if (serverHost) body.server_host = serverHost;
    if (workingDir) body.working_dir = workingDir;

    const data = await this._post('/v1/join', body);
    return data.data || data;
  }

  /**
   * Resolve a workspace token to workspace info via POST /v1/token/resolve.
   * @returns {{ workspace_id, slug, name }}
   */
  async resolveToken(token) {
    const data = await this._post('/v1/token/resolve', { token });
    return data.data || data;
  }

  /**
   * Send heartbeat via POST /v1/heartbeat.
   */
  async heartbeat(workspaceId, agentName, token) {
    const data = await this._post('/v1/heartbeat', {
      agent_name: agentName,
      network: workspaceId,
    }, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Disconnect agent via POST /v1/leave. Best-effort (ignores errors).
   */
  async disconnect(workspaceId, agentName, token) {
    try {
      await this._post('/v1/leave', {
        agent_name: agentName,
        network: workspaceId,
      }, this._wsHeaders(token));
    } catch {}
  }

  /**
   * Post a task result via POST /v1/events.
   */
  async sendEvent(workspaceId, event, token) {
    event.network = workspaceId;
    const data = await this._post('/v1/events', event, this._wsHeaders(token));
    return data.data || data;
  }

  /**
   * Send a chat message to a workspace channel.
   */
  async sendMessage(workspaceId, channelName, token, content, {
    senderType = 'agent', senderName, messageType = 'chat', metadata,
  } = {}) {
    const sourcePrefix = senderType === 'agent' ? 'openagents' : 'human';
    const source = senderName ? `${sourcePrefix}:${senderName}` : `${sourcePrefix}:unknown`;

    return this.sendEvent(workspaceId, {
      type: 'workspace.message.posted',
      source,
      target: `channel/${channelName}`,
      payload: { content, message_type: messageType },
      metadata: metadata || {},
    }, token);
  }

  /**
   * Poll for pending messages targeted at an agent via GET /v1/events.
   * Returns { messages, cursor } where cursor is the last event ID.
   */
  async pollPending(workspaceId, agentName, token, { after, limit = 50 } = {}) {
    const params = new URLSearchParams({
      network: workspaceId,
      type: 'workspace.message',
      limit: String(limit),
    });
    if (after) params.set('after', after);

    const data = await this._get(`/v1/events?${params}`, this._wsHeaders(token));
    const result = data.data || data;
    const events = (result && result.events) || [];

    let cursor = null;
    if (events.length > 0) {
      cursor = events[events.length - 1].id || null;
    }

    // Filter for messages targeted at this agent
    const messages = [];
    for (const e of events) {
      const source = e.source || '';
      const meta = e.metadata || {};
      const targetAgents = meta.target_agents || [];

      // Skip own messages
      if (source === `openagents:${agentName}`) continue;

      if (source.startsWith('human:')) {
        // Human messages: pick up if targeted at this agent or broadcast
        if (!targetAgents.length || targetAgents.includes(agentName)) {
          messages.push(this._eventToMessage(e));
        }
      } else if (source.startsWith('openagents:')) {
        // Agent messages: only pick up if explicitly mentioned
        if (targetAgents.includes(agentName)) {
          messages.push(this._eventToMessage(e));
        }
      }
    }

    return { messages, cursor };
  }

  /**
   * Get session/channel info via GET /v1/sessions/{channelName}.
   */
  async getSession(workspaceId, channelName, token) {
    try {
      const params = new URLSearchParams({ network: workspaceId });
      const data = await this._get(`/v1/sessions/${channelName}?${params}`, this._wsHeaders(token));
      return (data.data || data) || {};
    } catch {
      return {};
    }
  }

  /**
   * Update session/channel info via PUT /v1/sessions/{channelName}.
   */
  async updateSession(workspaceId, channelName, token, { title, autoTitle } = {}) {
    const body = { network: workspaceId };
    if (title !== undefined) body.title = title;
    if (autoTitle !== undefined) body.auto_title = autoTitle;
    try {
      await this._post(`/v1/sessions/${channelName}`, body, this._wsHeaders(token));
    } catch {}
  }

  /**
   * Poll for control events targeted at an agent via GET /v1/events.
   */
  async pollControl(workspaceId, agentName, token, { after } = {}) {
    try {
      const params = new URLSearchParams({
        network: workspaceId,
        type: 'workspace.control',
        limit: '10',
      });
      if (after) params.set('after', after);
      const data = await this._get(`/v1/events?${params}`, this._wsHeaders(token));
      const result = data.data || data;
      const events = (result && result.events) || [];
      return events.filter((e) => {
        const targets = (e.metadata || {}).target_agents || [];
        return !targets.length || targets.includes(agentName);
      });
    } catch {
      return [];
    }
  }

  /**
   * Convert an ONM event to a message-compatible object.
   */
  _eventToMessage(event) {
    const source = event.source || '';
    const isHuman = source.startsWith('human:');
    const senderName = source.replace('openagents:', '').replace('human:', '');
    const payload = event.payload || {};
    const target = event.target || '';
    const ts = event.timestamp;

    const msg = {
      messageId: event.id || '',
      sessionId: target.startsWith('channel/') ? target.replace('channel/', '') : target,
      senderType: isHuman ? 'human' : 'agent',
      senderName,
      content: (payload.content || ''),
      messageType: payload.message_type || 'chat',
      metadata: event.metadata || {},
    };
    if (ts) {
      msg.createdAt = new Date(ts).toISOString();
    }
    return msg;
  }

  // -- Internal --

  _wsHeaders(token) {
    return {
      'Content-Type': 'application/json',
      'X-Workspace-Token': token,
    };
  }

  _get(urlPath, headers = {}) {
    const fullUrl = this.endpoint + urlPath;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(fullUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(fullUrl, {
        method: 'GET',
        headers,
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.end();
    });
  }

  _post(urlPath, body, headers = {}) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const jsonBody = JSON.stringify(body);
    const fullUrl = this.endpoint + urlPath;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(fullUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const req = transport.request(fullUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(jsonBody) },
        timeout: 30000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const msg = parsed.message || `HTTP ${res.statusCode}`;
              reject(new Error(msg));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(jsonBody);
      req.end();
    });
  }
}

module.exports = { WorkspaceClient };
