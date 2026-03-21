'use strict';

const https = require('https');
const http = require('http');

const DEFAULT_ENDPOINT = 'https://endpoint.openagents.org';

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
   * Poll for pending tasks via POST /v1/poll_pending.
   */
  async pollPending(workspaceId, agentName, token) {
    const data = await this._post('/v1/poll_pending', {
      agent_name: agentName,
      network: workspaceId,
    }, this._wsHeaders(token));
    return data.data || data;
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

  // -- Internal --

  _wsHeaders(token) {
    return {
      'Content-Type': 'application/json',
      'X-Workspace-Token': token,
    };
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
