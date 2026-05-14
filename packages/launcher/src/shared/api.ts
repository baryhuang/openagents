// The single source of truth for the renderer ↔ main IPC surface.
// Implemented in src/preload/preload.ts and consumed in src/renderer/* via window.api.

import type {
  AddAgentConfig,
  Agent,
  AgentEnv,
  AgentStatusEntry,
  AppSettings,
  CatalogEntry,
  CheckTypeResult,
  ClearLogsResult,
  CoreInfo,
  CoreUpdateInfo,
  DebugEnv,
  FieldSchema,
  HealthStatus,
  InstallOutput,
  LogsResult,
  OperationResult,
  PythonStatus,
  RuntimeInfo,
  TailLogsResult,
  UpdateAgentConfig,
  Workspace,
  WorkspaceCreateResult,
} from './models';

export interface IpcApi {
  // Python / runtime
  pythonStatus(): Promise<PythonStatus>;
  installSDK(): Promise<OperationResult>;
  runtimeInfo(): Promise<RuntimeInfo>;

  // Agents CRUD
  listAgents(): Promise<Agent[]>;
  getSupportedAgentTypes(): Promise<string[]>;
  getAgentCoreInfo(): Promise<CoreInfo>;
  addAgent(config: AddAgentConfig): Promise<OperationResult<AddAgentConfig>>;
  removeAgent(name: string): Promise<OperationResult>;
  updateAgent(name: string, config: UpdateAgentConfig): Promise<OperationResult>;

  // Agent lifecycle
  startAgent(name: string): Promise<OperationResult>;
  stopAgent(name: string): Promise<OperationResult>;
  startAll(): Promise<OperationResult>;
  stopAll(): Promise<OperationResult>;
  agentStatus(): Promise<Record<string, AgentStatusEntry>>;
  agentLogs(name?: string | null, lines?: number): Promise<LogsResult>;
  tailAgentLogs(
    name?: string | null,
    lines?: number,
    offset?: number,
  ): Promise<TailLogsResult>;
  clearLogsInRange(start: string | number, end: string | number): Promise<ClearLogsResult>;

  // Agent type install & catalog
  installAgentType(type: string): Promise<OperationResult>;
  installAgentTypeStreaming(type: string): Promise<OperationResult>;
  onInstallOutput(callback: (data: InstallOutput | string) => void): void;
  removeInstallOutputListener(): void;
  uninstallAgentType(type: string): Promise<OperationResult>;
  uninstallAgentTypeStreaming(type: string): Promise<OperationResult>;
  checkAgentType(type: string): Promise<CheckTypeResult>;
  getCatalog(): Promise<CatalogEntry[]>;

  // Agent configuration
  getEnvFields(type: string): Promise<FieldSchema[]>;
  getAgentEnv(type: string): Promise<AgentEnv>;
  saveAgentEnv(type: string, env: AgentEnv): Promise<OperationResult>;
  getAgentInstanceEnv(name: string): Promise<AgentEnv>;
  saveAgentInstanceEnv(name: string, env: AgentEnv): Promise<OperationResult>;
  testLLM(env: AgentEnv): Promise<{
    success: boolean;
    model?: string;
    response?: string;
    error?: string;
  }>;
  signalReload(): Promise<void>;

  // Workspace
  connectWorkspace(agentName: string, slug: string): Promise<OperationResult>;
  disconnectWorkspace(agentName: string): Promise<OperationResult>;
  removeWorkspace(slug: string): Promise<OperationResult>;
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(name?: string): Promise<WorkspaceCreateResult>;

  // Settings
  getSetting<K extends keyof AppSettings>(key?: K): Promise<AppSettings[K] | AppSettings>;
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;

  // Health
  healthCheck(type: string): Promise<HealthStatus | null>;

  // Shell
  openExternal(url: string): Promise<void>;
  shellExec(cmd: string): Promise<string>;
  openTerminal(cmd: string): Promise<void>;
  updateCore(): Promise<OperationResult>;
  onCoreUpdate(callback: (info: CoreUpdateInfo) => void): void;

  // Icons
  getIconPath(name: string): Promise<string | null>;
  getIconsDir(): Promise<string | null>;

  // Debug
  debugEnv(): Promise<DebugEnv>;
}

// Channel name constants — shared so the main process and preload bridge stay in sync.
export const IPC_CHANNELS = {
  pythonStatus: 'python:status',
  installSDK: 'python:install',
  runtimeInfo: 'runtime:info',
  listAgents: 'agents:list',
  supportedTypes: 'agents:supported-types',
  coreInfo: 'agents:core-info',
  addAgent: 'agents:add',
  removeAgent: 'agents:remove',
  updateAgent: 'agents:update',
  startAgent: 'agents:start',
  stopAgent: 'agents:stop',
  startAll: 'agents:start-all',
  stopAll: 'agents:stop-all',
  status: 'agents:status',
  logs: 'agents:logs',
  tailLogs: 'agents:tail-logs',
  clearLogsRange: 'agents:clear-logs-range',
  installType: 'agents:install-type',
  installTypeStreaming: 'agents:install-type-streaming',
  uninstallType: 'agents:uninstall-type',
  uninstallTypeStreaming: 'agents:uninstall-type-streaming',
  checkType: 'agents:check-type',
  catalog: 'agents:catalog',
  envFields: 'agents:env-fields',
  getEnv: 'agents:get-env',
  saveEnv: 'agents:save-env',
  getInstanceEnv: 'agents:get-instance-env',
  saveInstanceEnv: 'agents:save-instance-env',
  testLlm: 'agents:test-llm',
  signalReload: 'agents:signal-reload',
  workspaceConnect: 'workspace:connect',
  workspaceDisconnect: 'workspace:disconnect',
  workspaceRemove: 'workspace:remove',
  workspaceList: 'workspace:list',
  workspaceCreate: 'workspace:create',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  healthCheck: 'agents:health-check',
  coreUpdate: 'core:update',
  shellOpenExternal: 'shell:open-external',
  shellOpenTerminal: 'shell:open-terminal',
  shellExec: 'shell:exec',
  iconsGetDir: 'icons:get-dir',
  iconsGetPath: 'icons:get-path',
  debugEnv: 'debug:env',
} as const;

export const IPC_EVENTS = {
  installOutput: 'install:output',
  coreUpdateAvailable: 'core-update-available',
} as const;

declare global {
  interface Window {
    api: IpcApi;
  }
}
