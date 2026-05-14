// Domain types shared by main, preload, and renderer.

export type AgentState =
  | 'online'
  | 'running'
  | 'idle'
  | 'starting'
  | 'reconnecting'
  | 'stopped'
  | 'error'
  | 'unknown';

export interface AgentEnv {
  [key: string]: string | number | boolean | null | undefined;
}

export interface AgentRecord {
  name: string;
  type: string;
  role?: string;
  path?: string | null;
  env?: AgentEnv;
  network?: string;
  networkName?: string;
}

export interface AgentStatusEntry {
  state: AgentState;
  restarts: number;
  last_error?: string | null;
  pid?: number | null;
}

export interface Agent extends AgentRecord {
  state: AgentState;
  restarts: number;
  lastError: string | null;
  health: HealthStatus | null;
  runtimeMismatch: boolean;
}

export interface HealthStatus {
  ready: boolean;
  message?: string;
  auth_mode?: 'api_key' | 'cli_login' | string;
  execution_mode?: string;
  version?: string;
  installed?: boolean;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  endpoint?: string;
  token?: string;
}

export interface WorkspaceCreateResult {
  id: string;
  slug: string;
  name: string;
  token?: string;
  endpoint?: string;
}

export interface FieldSchema {
  name: string;
  label?: string;
  description?: string;
  type?: 'string' | 'password' | 'boolean' | 'number' | 'select' | 'textarea';
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  group?: string;
}

export interface CatalogSupport {
  install?: boolean;
  workspace?: boolean;
  collaboration?: boolean;
}

export interface CatalogEntry {
  name: string;
  label?: string;
  description?: string;
  installed: boolean;
  managed?: boolean | null;
  location?: string;
  check_ready?: {
    login_command?: string;
    not_ready_message?: string;
  };
  env_config?: FieldSchema[];
  launch?: Record<string, unknown>;
  install?: Record<string, unknown>;
  requires?: string[];
  support?: CatalogSupport;
}

export interface RuntimeInfo {
  nodeVersion: string | null;
  npmVersion: string | null;
  coreVersion: string | null;
  latestVersion: string | null;
}

export interface PythonStatus {
  pythonPath: string | null;
  pythonFound: boolean;
  sdkInstalled: boolean;
  sdkVersion: string | null;
  launcherVersion: string;
  runtime: 'node' | 'python';
}

export interface CoreInfo {
  version: string | null;
  supportedTypes: string[];
  globalCorePath: string;
  globalCorePresent: boolean;
}

export interface OperationResult<T = unknown> {
  success: boolean;
  message?: string;
  error?: string;
  agent?: T;
  version?: string | null;
}

export interface LogsResult {
  lines: string[];
}

export interface TailLogsResult {
  lines: string[];
  size: number;
}

export interface ClearLogsResult {
  removed: number;
  remaining: number;
}

export interface CheckTypeResult {
  installed: boolean;
  binary: string | null;
}

export interface CoreUpdateInfo {
  current: string | null;
  latest: string;
}

export interface DebugEnv {
  ComSpec?: string;
  SystemRoot?: string;
  PATH: string;
  platform: NodeJS.Platform | string;
}

export interface InstallOutput {
  /** Raw stdout/stderr chunk. */
  text: string;
  /** Stream type: 'stdout' or 'stderr'. */
  stream?: 'stdout' | 'stderr';
}

export interface AddAgentConfig {
  name: string;
  type?: string;
  path?: string;
  env?: AgentEnv;
}

export interface UpdateAgentConfig {
  env?: AgentEnv;
}

export interface AppSettings {
  startOnBoot?: boolean;
  minimizeToTray?: boolean;
  [key: string]: unknown;
}

export type TabName = 'dashboard' | 'agents' | 'install' | 'logs' | 'settings';
