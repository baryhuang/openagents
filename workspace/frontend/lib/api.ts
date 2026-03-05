import type {
  ApiResponse,
  BrowserTab,
  EventPollResponse,
  MessagePollResponse,
  NetworkDiscovery,
  NetworkProfile,
  ONMEvent,
  Workspace,
  WorkspaceAgent,
  WorkspaceFile,
  WorkspaceInvitation,
  WorkspaceSession,
} from './types';
import { eventToMessage } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';

class WorkspaceApi {
  private token: string = '';
  private bearerToken: string = '';
  private workspaceId: string = '';

  configure(workspaceId: string, token: string, bearerToken?: string) {
    this.workspaceId = workspaceId;
    this.token = token;
    if (bearerToken !== undefined) this.bearerToken = bearerToken;
  }

  setBearerToken(bearerToken: string) {
    this.bearerToken = bearerToken;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const authHeaders: Record<string, string> = {};
    if (this.token) {
      authHeaders['X-Workspace-Token'] = this.token;
    }
    if (this.bearerToken) {
      authHeaders['Authorization'] = `Bearer ${this.bearerToken}`;
    }

    const url = `${API_URL}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }

    const json: ApiResponse<T> = await res.json();
    return json.data;
  }

  // ---------------------------------------------------------------------------
  // Workspace CRUD (REST endpoints — not event-based)
  // ---------------------------------------------------------------------------

  async getWorkspace(): Promise<Workspace> {
    return this.request<Workspace>(`/v1/workspaces/${this.workspaceId}`);
  }

  async updateWorkspace(updates: { name?: string; settings?: Record<string, unknown> }): Promise<Workspace> {
    return this.request<Workspace>(`/v1/workspaces/${this.workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async claimWorkspace(): Promise<Workspace> {
    return this.request<Workspace>(`/v1/workspaces/${this.workspaceId}/claim`, {
      method: 'POST',
    });
  }

  async updateChannel(channelName: string, updates: { title?: string; status?: string }): Promise<unknown> {
    return this.request(`/v1/workspaces/${this.workspaceId}/channels/${channelName}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // ---------------------------------------------------------------------------
  // Network discovery
  // ---------------------------------------------------------------------------

  /** Discover agents, channels, and resources in the network. */
  async discover(): Promise<NetworkDiscovery> {
    return this.request<NetworkDiscovery>(`/v1/discover?network=${this.workspaceId}`);
  }

  /** Get network profile metadata. */
  async networkProfile(): Promise<NetworkProfile> {
    return this.request<NetworkProfile>(`/v1/profile?network=${this.workspaceId}`);
  }

  // ---------------------------------------------------------------------------
  // Channels (sessions) — via ONM events
  // ---------------------------------------------------------------------------

  /** Create a new channel (thread) by emitting a network.channel.create event. */
  async createChannel(opts: {
    title?: string;
    master?: string;
    participants?: string[];
  } = {}): Promise<WorkspaceSession> {
    const event = await this.sendEvent({
      type: 'network.channel.create',
      source: 'human:user',
      target: 'core',
      payload: {
        ...(opts.title && { title: opts.title }),
        ...(opts.master && { master: opts.master }),
        ...(opts.participants && { participants: opts.participants }),
      },
    });

    // Build a WorkspaceSession from the event response
    const channelName = (event.metadata?.channel_name as string) || '';
    return {
      sessionId: channelName,
      workspaceId: this.workspaceId,
      createdBy: 'human:user',
      title: opts.title || 'New Thread',
      status: 'active',
      participants: opts.participants || [],
      master: opts.master || null,
      createdAt: new Date(event.timestamp).toISOString(),
      lastEventAt: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Messages — via ONM events
  // ---------------------------------------------------------------------------

  /** Send a chat message by emitting a workspace.message.posted event. */
  async sendMessage(
    channelName: string,
    content: string,
    senderName = 'user',
    mentions?: string[],
  ): Promise<ONMEvent> {
    return this.sendEvent({
      type: 'workspace.message.posted',
      source: `human:${senderName}`,
      target: `channel/${channelName}`,
      payload: {
        content,
        sender_type: 'human',
        ...(mentions && mentions.length > 0 ? { mentions } : {}),
      },
      visibility: 'channel',
    });
  }

  /**
   * Poll messages for a channel (session) via the event API.
   * Returns WorkspaceMessage[] for component compatibility.
   */
  async pollMessages(channelName: string, after?: string): Promise<MessagePollResponse> {
    const result = await this.pollEvents({
      channel: channelName,
      type: 'workspace.message',
      after,
      limit: 50,
    });

    return {
      messages: result.events.map(eventToMessage),
      hasMore: result.has_more,
    };
  }

  // ---------------------------------------------------------------------------
  // Agent control — mode changes etc.
  // ---------------------------------------------------------------------------

  /** Send a control event to an agent (e.g. mode change). */
  async sendAgentControl(
    agentName: string,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<ONMEvent> {
    return this.sendEvent({
      type: 'workspace.agent.control',
      source: 'human:user',
      target: `openagents:${agentName}`,
      payload: { action, ...params },
      visibility: 'direct',
    });
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  /** Upload a file to workspace shared storage. */
  async uploadFile(file: File, channelName?: string): Promise<WorkspaceFile> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('network', this.workspaceId);
    if (channelName) formData.append('channel_name', channelName);

    const authHeaders: Record<string, string> = {};
    if (this.token) authHeaders['X-Workspace-Token'] = this.token;
    if (this.bearerToken) authHeaders['Authorization'] = `Bearer ${this.bearerToken}`;

    const url = `${API_URL}/v1/files`;
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Upload failed: ${body}`);
    }

    const json: ApiResponse<WorkspaceFile> = await res.json();
    return json.data;
  }

  /** List files in the workspace. */
  async listFiles(): Promise<{ files: WorkspaceFile[]; total: number }> {
    return this.request<{ files: WorkspaceFile[]; total: number }>(
      `/v1/files?network=${this.workspaceId}`
    );
  }

  /** Get the download URL for a file. */
  getFileUrl(fileId: string): string {
    const params = new URLSearchParams();
    if (this.token) params.set('token', this.token);
    return `${API_URL}/v1/files/${fileId}`;
  }

  /** Delete a file. */
  async deleteFile(fileId: string): Promise<void> {
    await this.request<unknown>(`/v1/files/${fileId}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Browser
  // ---------------------------------------------------------------------------

  /** List active browser tabs. */
  async listBrowserTabs(): Promise<{ tabs: BrowserTab[]; total: number }> {
    const result = await this.request<{ tabs: unknown[]; total: number }>(
      `/v1/browser/tabs?network=${this.workspaceId}`
    );
    return {
      tabs: (result.tabs as Record<string, unknown>[]).map((t) => ({
        id: t.id as string,
        url: t.url as string,
        title: (t.title as string) || null,
        status: t.status as string,
        createdBy: t.created_by as string,
        sharedWith: (t.shared_with as string[]) || [],
        liveUrl: (t.live_url as string) || null,
        sessionId: (t.session_id as string) || null,
        createdAt: (t.created_at as string) || null,
        lastActiveAt: (t.last_active_at as string) || null,
      })),
      total: result.total,
    };
  }

  /** Open a new browser tab. */
  async openBrowserTab(url = 'about:blank'): Promise<BrowserTab> {
    const result = await this.request<Record<string, unknown>>('/v1/browser/tabs', {
      method: 'POST',
      body: JSON.stringify({ url, network: this.workspaceId, source: 'human:user' }),
    });
    return {
      id: result.id as string,
      url: result.url as string,
      title: (result.title as string) || null,
      status: result.status as string,
      createdBy: result.created_by as string,
      sharedWith: (result.shared_with as string[]) || [],
      liveUrl: (result.live_url as string) || null,
      sessionId: (result.session_id as string) || null,
      createdAt: (result.created_at as string) || null,
      lastActiveAt: (result.last_active_at as string) || null,
    };
  }

  /** Close a browser tab. */
  async closeBrowserTab(tabId: string): Promise<void> {
    await this.request<unknown>(`/v1/browser/tabs/${tabId}`, { method: 'DELETE' });
  }

  /** Get screenshot URL for a browser tab. */
  getBrowserScreenshotUrl(tabId: string): string {
    return `${API_URL}/v1/browser/tabs/${tabId}/screenshot`;
  }

  // ---------------------------------------------------------------------------
  // Agent management (stubs — not yet event-native)
  // ---------------------------------------------------------------------------

  async listAgents(): Promise<WorkspaceAgent[]> {
    const discovery = await this.discover();
    return discovery.agents.map((a) => ({
      agentName: a.address.replace(/^openagents:/, ''),
      role: a.role,
      status: a.status,
      lastHeartbeatAt: null,
      joinedAt: null,
    }));
  }

  async updateAgentRole(_agentName: string, _role: string): Promise<WorkspaceAgent> {
    throw new Error('Agent role management is not yet available in event-native mode');
  }

  async removeAgent(_agentName: string): Promise<void> {
    throw new Error('Agent removal is not yet available in event-native mode');
  }

  // ---------------------------------------------------------------------------
  // Invitations (stubs — not yet event-native)
  // ---------------------------------------------------------------------------

  async createInvitation(_targetAgentName: string, _expiresInHours = 168): Promise<WorkspaceInvitation> {
    throw new Error('Invitations are not yet available in event-native mode');
  }

  async listInvitations(_status?: string): Promise<WorkspaceInvitation[]> {
    return []; // Return empty list — invitations not yet migrated
  }

  // ---------------------------------------------------------------------------
  // Low-level ONM event API
  // ---------------------------------------------------------------------------

  /** Send an event through the mod pipeline. */
  async sendEvent(event: {
    type: string;
    source: string;
    target: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    visibility?: string;
  }): Promise<ONMEvent> {
    return this.request<ONMEvent>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({ ...event, network: this.workspaceId }),
    });
  }

  /** Poll events from the network. */
  async pollEvents(opts: {
    after?: string;
    target?: string;
    channel?: string;
    type?: string;
    search?: string;
    limit?: number;
  } = {}): Promise<EventPollResponse> {
    const params = new URLSearchParams({ network: this.workspaceId });
    if (opts.after) params.set('after', opts.after);
    if (opts.target) params.set('target', opts.target);
    if (opts.channel) params.set('channel', opts.channel);
    if (opts.type) params.set('type', opts.type);
    if (opts.search) params.set('search', opts.search);
    if (opts.limit) params.set('limit', String(opts.limit));
    return this.request<EventPollResponse>(`/v1/events?${params}`);
  }

  /** Search messages across all channels. Returns events grouped by channel. */
  async searchMessages(query: string): Promise<{ channelName: string; snippet: string; messageId: string }[]> {
    const result = await this.pollEvents({
      type: 'workspace.message',
      search: query,
      limit: 50,
    });
    return result.events.map((e) => ({
      channelName: e.target.replace(/^channel\//, ''),
      snippet: (e.payload as Record<string, string>)?.content || '',
      messageId: e.id,
    }));
  }
}

export const workspaceApi = new WorkspaceApi();
