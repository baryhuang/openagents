import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

import { IPC_CHANNELS, IPC_EVENTS, IpcApi } from '../shared/api';
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
} from '../shared/models';

const api: IpcApi = {
  // Python / runtime
  pythonStatus: () => ipcRenderer.invoke(IPC_CHANNELS.pythonStatus) as Promise<PythonStatus>,
  installSDK: () => ipcRenderer.invoke(IPC_CHANNELS.installSDK) as Promise<OperationResult>,
  runtimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeInfo) as Promise<RuntimeInfo>,

  // Agents CRUD
  listAgents: () => ipcRenderer.invoke(IPC_CHANNELS.listAgents) as Promise<Agent[]>,
  getSupportedAgentTypes: () =>
    ipcRenderer.invoke(IPC_CHANNELS.supportedTypes) as Promise<string[]>,
  getAgentCoreInfo: () => ipcRenderer.invoke(IPC_CHANNELS.coreInfo) as Promise<CoreInfo>,
  addAgent: (config: AddAgentConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.addAgent, config) as Promise<OperationResult<AddAgentConfig>>,
  removeAgent: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeAgent, name) as Promise<OperationResult>,
  updateAgent: (name: string, config: UpdateAgentConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateAgent, name, config) as Promise<OperationResult>,

  // Agent lifecycle
  startAgent: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.startAgent, name) as Promise<OperationResult>,
  stopAgent: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.stopAgent, name) as Promise<OperationResult>,
  startAll: () => ipcRenderer.invoke(IPC_CHANNELS.startAll) as Promise<OperationResult>,
  stopAll: () => ipcRenderer.invoke(IPC_CHANNELS.stopAll) as Promise<OperationResult>,
  agentStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.status) as Promise<Record<string, AgentStatusEntry>>,
  agentLogs: (name?: string | null, lines?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.logs, name, lines) as Promise<LogsResult>,
  tailAgentLogs: (name?: string | null, lines?: number, offset?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.tailLogs, name, lines, offset) as Promise<TailLogsResult>,
  clearLogsInRange: (start: string | number, end: string | number) =>
    ipcRenderer.invoke(IPC_CHANNELS.clearLogsRange, start, end) as Promise<ClearLogsResult>,

  // Install
  installAgentType: (type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.installType, type) as Promise<OperationResult>,
  installAgentTypeStreaming: (type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.installTypeStreaming, type) as Promise<OperationResult>,
  uninstallAgentType: (type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.uninstallType, type) as Promise<OperationResult>,
  uninstallAgentTypeStreaming: (type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.uninstallTypeStreaming, type) as Promise<OperationResult>,
  checkAgentType: (type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkType, type) as Promise<CheckTypeResult>,
  getCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.catalog) as Promise<CatalogEntry[]>,

  onInstallOutput: (callback: (data: InstallOutput | string) => void) => {
    ipcRenderer.on(IPC_EVENTS.installOutput, (_e: IpcRendererEvent, data: InstallOutput | string) =>
      callback(data),
    );
  },
  removeInstallOutputListener: () => {
    ipcRenderer.removeAllListeners(IPC_EVENTS.installOutput);
  },

  // Agent configuration
  getEnvFields: (type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.envFields, type) as Promise<FieldSchema[]>,
  getAgentEnv: (type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getEnv, type) as Promise<AgentEnv>,
  saveAgentEnv: (type: string, env: AgentEnv) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveEnv, type, env) as Promise<OperationResult>,
  getAgentInstanceEnv: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getInstanceEnv, name) as Promise<AgentEnv>,
  saveAgentInstanceEnv: (name: string, env: AgentEnv) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveInstanceEnv, name, env) as Promise<OperationResult>,
  testLLM: (env: AgentEnv) =>
    ipcRenderer.invoke(IPC_CHANNELS.testLlm, env) as Promise<{
      success: boolean;
      model?: string;
      response?: string;
      error?: string;
    }>,
  signalReload: () => ipcRenderer.invoke(IPC_CHANNELS.signalReload) as Promise<void>,

  // Workspace
  connectWorkspace: (agentName: string, slug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceConnect, agentName, slug) as Promise<OperationResult>,
  disconnectWorkspace: (agentName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceDisconnect, agentName) as Promise<OperationResult>,
  removeWorkspace: (slug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceRemove, slug) as Promise<OperationResult>,
  listWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceList) as Promise<Workspace[]>,
  createWorkspace: (name?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceCreate, name) as Promise<WorkspaceCreateResult>,

  // Settings
  getSetting: <K extends keyof AppSettings>(key?: K) =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsGet, key) as Promise<AppSettings[K] | AppSettings>,
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsSet, key, value) as Promise<void>,

  // Health
  healthCheck: (type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.healthCheck, type) as Promise<HealthStatus | null>,

  // Shell
  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.shellOpenExternal, url) as Promise<void>,
  shellExec: (cmd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.shellExec, cmd) as Promise<string>,
  openTerminal: (cmd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.shellOpenTerminal, cmd) as Promise<void>,
  updateCore: () => ipcRenderer.invoke(IPC_CHANNELS.coreUpdate) as Promise<OperationResult>,
  onCoreUpdate: (callback: (info: CoreUpdateInfo) => void) => {
    ipcRenderer.on(IPC_EVENTS.coreUpdateAvailable, (_e: IpcRendererEvent, info: CoreUpdateInfo) =>
      callback(info),
    );
  },

  // Icons
  getIconPath: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.iconsGetPath, name) as Promise<string | null>,
  getIconsDir: () => ipcRenderer.invoke(IPC_CHANNELS.iconsGetDir) as Promise<string | null>,

  // Debug
  debugEnv: () => ipcRenderer.invoke(IPC_CHANNELS.debugEnv) as Promise<DebugEnv>,
};

contextBridge.exposeInMainWorld('api', api);
