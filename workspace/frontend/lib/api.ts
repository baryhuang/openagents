import type {
  ApiResponse,
  EventPollResponse,
  MessagePollResponse,
  NetworkDiscovery,
  NetworkProfile,
  ONMEvent,
  Workspace,
  WorkspaceAgent,
  WorkspaceInvitation,
  WorkspaceSession,
} from './types';
import { eventToMessage } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';

class WorkspaceApi {
  private token: string = '';
  private workspaceId: string = '';

  configure(workspaceId: string, token: string) {
    this.workspaceId = workspaceId;
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_URL}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Token': this.token,
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
      createdAt: new Date(event.timestamp * 1000).toISOString(),
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
    limit?: number;
  } = {}): Promise<EventPollResponse> {
    const params = new URLSearchParams({ network: this.workspaceId });
    if (opts.after) params.set('after', opts.after);
    if (opts.target) params.set('target', opts.target);
    if (opts.channel) params.set('channel', opts.channel);
    if (opts.type) params.set('type', opts.type);
    if (opts.limit) params.set('limit', String(opts.limit));
    return this.request<EventPollResponse>(`/v1/events?${params}`);
  }
}

export const workspaceApi = new WorkspaceApi();
