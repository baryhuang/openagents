export type AgentState = 'online' | 'running' | 'idle' | 'starting' | 'reconnecting' | 'stopped' | 'error'

export interface HealthCheck {
  ready: boolean
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
  installed: boolean
  managed?: boolean
  location?: string
  support?: {
    install?: boolean
    workspace?: boolean
    collaboration?: boolean
  }
  requires?: string[]
  check_ready?: {
    login_command?: string
    not_ready_message?: string
  }
  env_config?: EnvField[]
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
      uninstallAgentType(type: string): Promise<unknown>
      uninstallAgentTypeStreaming(type: string): Promise<unknown>
      checkAgentType(type: string): Promise<{ installed: boolean; binary: string | null }>
      getCatalog(): Promise<CatalogEntry[]>
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
      getIconPath(name: string): Promise<string | null>
      getIconsDir(): Promise<string | null>
      debugEnv(): Promise<Record<string, string>>
    }
  }
}
