export type AgentState = 'online' | 'running' | 'idle' | 'starting' | 'reconnecting' | 'stopped' | 'error'

export interface HealthCheck {
  ready: boolean
  installed?: boolean
  binary?: string | null
  version?: string | null
  message?: string
  auth_mode?: string
  execution_mode?: string
}

export interface Agent {
  name: string
  type: string
  state: AgentState
  health: HealthCheck | null
  network?: string | null
  networkName?: string | null
  lastError?: string | null
  runtimeMismatch?: boolean
  restarts?: number
  env?: Record<string, string>
  path?: string
}

export interface EnvField {
  name: string
  description: string
  required?: boolean
  password?: boolean
  placeholder?: string
  default?: string
}

export interface CatalogEntry {
  name: string
  label?: string
  description?: string
  homepage?: string
  tags?: string[]
  featured?: boolean
  order?: number
  builtin?: boolean
  installed: boolean
  managed?: boolean
  location?: string
  support?: {
    install?: boolean
    workspace?: boolean
    collaboration?: boolean
  }
  requires?: string[]
  install?: {
    binary?: string
    requires?: (string | null)[]
    macos?: string
    linux?: string
    windows?: string
    api_only?: boolean
  }
  check_ready?: {
    login_command?: string
    not_ready_message?: string
    env_vars?: string[]
    saved_env_key?: string
  }
  env_config?: EnvField[]
  screenshots?: string[]
  demo?: string
  demo_url?: string
  long_description?: string
  // Stage.md §2.2 "使用入门指南" — optional structured getting-started hints.
  // Renderer falls back to deriving from install.binary + check_ready when
  // these aren't set, so older registry entries still get a useful section.
  quick_start?: string
  example_commands?: Array<{ cmd: string; description?: string }>
  docs?: string
  github?: string
}

export interface InstalledAgentRecord {
  name: string
  version: string | null
  installedAt: string
  previousVersion?: string | null
  history?: Array<{ version: string; installedAt: string }>
}

export interface AgentUpdateInfo {
  name: string
  current: string | null
  latest: string | null
  changelog?: Array<{ version: string; date?: string }>
}

export type InstallPhase = 'idle' | 'preparing' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error'

export interface InstallProgressEvent {
  agent: string
  verb: 'install' | 'update' | 'uninstall' | 'rollback'
  phase: InstallPhase
  detail?: string
  log?: string
  error?: string
}

export interface Workspace {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token?: string
}

export interface RuntimeInfo {
  nodeVersion: string | null
  npmVersion: string | null
  coreVersion: string | null
  latestVersion: string | null
}

// ── Chat ──

export interface Attachment {
  fileId?: string
  filename?: string
  contentType?: string
  size?: number
  url?: string
}

export interface ToolCall {
  id: string
  name: string
  category?: 'workspace' | 'files' | 'browser' | 'tunnel' | 'todos' | 'timers' | 'terminal' | 'other'
  status: 'pending' | 'success' | 'error'
  args?: unknown
  result?: unknown
  durationMs?: number
}

export interface ChatMessage {
  messageId: string
  sessionId: string
  senderType: 'human' | 'agent' | 'system'
  senderName: string
  content: string
  mentions?: string[]
  messageType?: string
  metadata?: Record<string, unknown>
  attachments?: Attachment[]
  createdAt?: string
  toolCalls?: ToolCall[]
}

export interface SendMessageInput {
  workspaceId: string
  channelName?: string
  agentId?: string
  content: string
  mentions?: string[]
  attachments?: Attachment[]
}

export interface SendMessageResult {
  success: boolean
  messageId: string
  error?: string
}

export interface ChatSessionMeta {
  id: string
  workspaceId: string
  workspaceSlug?: string
  workspaceName?: string
  channelName: string
  title: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  messageCount: number
  participants: string[]
  createdAt: string
}

export type ChatStreamEvent =
  | { type: 'message'; channel: string; workspaceId: string; message: ChatMessage }
  | { type: 'agent-status'; channel: string; workspaceId: string; agentName: string; status: 'thinking' | 'idle' | 'error'; detail?: string }
  | { type: 'error'; channel: string; workspaceId: string; error: string }

export interface WorkspaceParticipant {
  agentName: string
  role: string
  status: string
}

export interface FileListEntry {
  id: string
  filename: string
  content_type?: string
  size?: number
  created_at?: string
}

export interface PythonStatus {
  pythonPath: string | null
  pythonFound: boolean
  sdkInstalled: boolean
  sdkVersion: string
  launcherVersion: string
  runtime: string
}

declare global {
  interface Window {
    api: {
      pythonStatus(): Promise<PythonStatus>
      installSDK(): Promise<unknown>
      runtimeInfo(): Promise<RuntimeInfo>
      listAgents(): Promise<Agent[]>
      getSupportedAgentTypes(): Promise<string[]>
      getAgentCoreInfo(): Promise<unknown>
      addAgent(config: { name: string; type: string; path?: string }): Promise<unknown>
      removeAgent(name: string): Promise<unknown>
      updateAgent(name: string, config: unknown): Promise<unknown>
      startAgent(name: string): Promise<unknown>
      stopAgent(name: string): Promise<unknown>
      startAll(): Promise<unknown>
      stopAll(): Promise<unknown>
      agentStatus(): Promise<Record<string, { state: AgentState; last_error?: string; restarts?: number }>>
      agentLogs(name: string, lines: number): Promise<{ lines: string[] }>
      tailAgentLogs(name: string, lines: number, offset: number): Promise<{ lines: string[]; size?: number }>
      clearLogsInRange(start: string, end: string): Promise<{ removed: number; remaining: number }>
      installAgentType(type: string): Promise<unknown>
      installAgentTypeStreaming(type: string): Promise<unknown>
      onInstallOutput(callback: (data: string) => void): void
      removeInstallOutputListener(): void
      onInstallProgress(callback: (ev: InstallProgressEvent) => void): void
      removeInstallProgressListener(): void
      uninstallAgentType(type: string): Promise<unknown>
      uninstallAgentTypeStreaming(type: string): Promise<unknown>
      checkAgentType(type: string): Promise<{ installed: boolean; binary: string | null }>
      getCatalog(): Promise<CatalogEntry[]>
      getInstalledAgents(): Promise<InstalledAgentRecord[]>
      checkAgentUpdates(): Promise<AgentUpdateInfo[]>
      rollbackAgentType(type: string): Promise<{ success: boolean; version?: string | null; error?: string }>
      installAgentTypeAtVersionStreaming(
        type: string,
        target: string,
      ): Promise<{ success: boolean; version?: string | null; error?: string }>
      getAgentChangelog(type: string): Promise<{ versions: Array<{ version: string; date?: string }>; homepage?: string; latest?: string | null; error?: string }>
      getEnvFields(type: string): Promise<EnvField[]>
      getAgentEnv(type: string): Promise<Record<string, string>>
      saveAgentEnv(type: string, env: Record<string, string>): Promise<unknown>
      getAgentInstanceEnv(name: string): Promise<Record<string, string>>
      saveAgentInstanceEnv(name: string, env: Record<string, string>): Promise<unknown>
      testLLM(env: Record<string, string>): Promise<{ success: boolean; model?: string; response?: string; error?: string }>
      signalReload(): Promise<unknown>
      connectWorkspace(agentName: string, slug: string): Promise<unknown>
      disconnectWorkspace(agentName: string): Promise<unknown>
      removeWorkspace(slug: string): Promise<unknown>
      listWorkspaces(): Promise<Workspace[]>
      createWorkspace(name: string): Promise<{ token?: string; slug?: string }>
      getSetting(key: string): Promise<unknown>
      setSetting(key: string, value: unknown): Promise<unknown>
      healthCheck(type: string): Promise<HealthCheck>
      openExternal(url: string): Promise<void>
      shellExec(cmd: string): Promise<string>
      openTerminal(cmd: string): Promise<void>
      updateCore(): Promise<{ success: boolean; version?: string; error?: string }>
      onCoreUpdate(cb: (info: { current: string; latest: string }) => void): void
      onAgentUpdatesChanged(cb: (updates: AgentUpdateInfo[]) => void): void
      onNavigateToInstall(cb: (agentName: string) => void): void
      getIconPath(name: string): Promise<string | null>
      getIconsDir(): Promise<string | null>
      debugEnv(): Promise<Record<string, string>>

      // ── Chat ──
      chatSendMessage(input: SendMessageInput): Promise<SendMessageResult>
      chatGetMessages(workspaceId: string, channelName?: string, limit?: number): Promise<ChatMessage[]>
      chatStartPolling(workspaceId: string, channelName?: string): Promise<{ success: boolean; key?: string }>
      chatStopPolling(workspaceId: string, channelName?: string): Promise<{ success: boolean }>
      chatListParticipants(workspaceId: string): Promise<WorkspaceParticipant[]>
      onChatEvent(cb: (ev: ChatStreamEvent) => void): () => void

      // ── Files ──
      chatUploadFile(workspaceId: string, filename: string, contentBase64: string, opts?: { contentType?: string; channelName?: string }): Promise<{ success: boolean; fileId?: string; url?: string; filename?: string; error?: string }>
      chatListFiles(workspaceId: string, opts?: { limit?: number; offset?: number }): Promise<{ files?: FileListEntry[] } | unknown>
      chatReadFile(workspaceId: string, fileId: string): Promise<{ success: boolean; contentBase64?: string; error?: string }>
      chatDeleteFile(workspaceId: string, fileId: string): Promise<{ success: boolean; error?: string }>

      // ── Sessions ──
      sessionList(workspaceId?: string): Promise<ChatSessionMeta[]>
      sessionLoad(workspaceId: string, channelName: string): Promise<ChatSessionMeta | null>
      sessionDelete(workspaceId: string, channelName: string): Promise<boolean>
      sessionClear(workspaceId?: string): Promise<number>
    }
  }
}
