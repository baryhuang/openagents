// Thin adapter over @openagents-org/agent-launcher.
//
// The connector module is loaded from disk at runtime (it can live in the
// portable Node install or be developed locally) so we declare its shape
// rather than importing it statically.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  AddAgentConfig,
  Agent,
  AgentEnv,
  AgentRecord,
  AgentState,
  AgentStatusEntry,
  CatalogEntry,
  CheckTypeResult,
  ClearLogsResult,
  CoreInfo,
  FieldSchema,
  HealthStatus,
  LogsResult,
  OperationResult,
  TailLogsResult,
  UpdateAgentConfig,
  Workspace,
  WorkspaceCreateResult,
} from '../shared/models';
import type { Store } from './store';

const CONFIG_DIR = path.join(os.homedir(), '.openagents');
const GLOBAL_CORE = path.join(CONFIG_DIR, 'nodejs', 'node_modules', '@openagents-org', 'agent-launcher');
const LOCAL_CORE = path.resolve(__dirname, '..', '..', '..', '..', 'agent-connector');

// ── Runtime shape of the agent-launcher connector ──────────────────────────
interface InstallStreamCallback {
  (data: { text: string; stream?: 'stdout' | 'stderr' } | string): void;
}

interface Installer {
  installStreaming(type: string, cb?: InstallStreamCallback): Promise<OperationResult>;
  uninstallStreaming(type: string, cb?: InstallStreamCallback): Promise<OperationResult>;
  getInstallInfo(name: string): { installed: boolean; managed?: boolean | null; location?: string };
  which(type: string): string | null;
}

interface Registry {
  getCatalogSync(): CatalogEntry[];
  _loadBundled(): CatalogEntry[];
  _catalog: CatalogEntry[] | null;
}

interface ConnectorWorkspaceConfig {
  endpoint?: string;
}

interface ConnectorConfig {
  addNetwork(network: {
    id: string;
    slug: string;
    name: string;
    endpoint?: string;
    token: string;
  }): void;
  tailLogs(opts: { agent?: string; lines?: number; offset?: number }): TailLogsResult;
}

interface AgentConnector {
  listAgents(): AgentRecord[];
  addAgent(opts: { name: string; type: string; role: string; path?: string; env?: AgentEnv }): void;
  removeAgent(name: string): void;
  saveAgentInstanceEnv(name: string, env: AgentEnv): void;
  saveAgentEnv(type: string, env: AgentEnv): void;
  getEnvFields(type: string): FieldSchema[];
  getAgentEnv(type: string): AgentEnv;
  getAgentInstanceEnv(name: string): AgentEnv;
  testLLM(env: AgentEnv): Promise<{ success: boolean; model?: string; response?: string; error?: string }>;
  getDaemonPid(): number | null;
  sendDaemonCommand(cmd: string): void;
  stopDaemon(): boolean;
  getDaemonStatus(): Record<string, AgentStatusEntry>;
  getLogs(name: string | null | undefined, lines: number): string[];
  healthCheck(type: string): HealthStatus | null;
  isInstalled(type: string): boolean;
  install(type: string): Promise<OperationResult>;
  uninstall(type: string): Promise<OperationResult>;
  getCatalog(): Promise<CatalogEntry[]>;
  clearCatalogCache(): void;
  listWorkspaces(): Workspace[];
  createWorkspace(opts: { name: string }): Promise<WorkspaceCreateResult>;
  resolveToken(token: string): Promise<{
    slug?: string;
    workspace_id: string;
    name?: string;
    endpoint?: string;
  }>;
  connectWorkspace(agentName: string, slug: string): void;
  disconnectWorkspace(agentName: string): void;
  removeWorkspace(slug: string): Promise<OperationResult>;

  installer: Installer;
  registry: Registry;
  config: ConnectorConfig;
  workspace?: ConnectorWorkspaceConfig;
}

interface CoreModule {
  AgentConnector: new (opts: { configDir: string }) => AgentConnector;
  adapters?: { ADAPTER_MAP?: Record<string, unknown> };
}

function loadCore(): CoreModule | null {
  if (fs.existsSync(path.join(LOCAL_CORE, 'package.json'))) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(LOCAL_CORE) as CoreModule;
    } catch (err) {
      console.error('Failed to load local core:', err);
    }
  }
  if (fs.existsSync(path.join(GLOBAL_CORE, 'package.json'))) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(GLOBAL_CORE) as CoreModule;
    } catch {
      /* ignore */
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@openagents-org/agent-launcher') as CoreModule;
  } catch {
    return null;
  }
}

let core: CoreModule | null = loadCore();

export class AgentManager {
  private readonly _store: Store;
  private _connector: AgentConnector | null = null;
  private readonly _healthByType = new Map<string, HealthStatus | null>();
  private readonly _healthRefreshInFlight = new Set<string>();
  private _lastHealthRefreshAt = 0;

  constructor(store: Store) {
    this._store = store;
    if (!core) core = loadCore();
    if (core) {
      this._connector = new core.AgentConnector({ configDir: CONFIG_DIR });
    }
  }

  getSupportedAgentTypes(): string[] {
    const map = core?.adapters?.ADAPTER_MAP;
    return map ? Object.keys(map).sort() : [];
  }

  getCoreInfo(): CoreInfo {
    return {
      version: this.coreVersion,
      supportedTypes: this.getSupportedAgentTypes(),
      globalCorePath: GLOBAL_CORE,
      globalCorePresent: fs.existsSync(path.join(GLOBAL_CORE, 'package.json')),
    };
  }

  reloadCore(): boolean {
    const keys = Object.keys(require.cache).filter(
      (k) => k.includes('agent-launcher') || k.includes('agent-connector'),
    );
    for (const k of keys) delete require.cache[k];
    core = loadCore();
    if (core) {
      this._connector = new core.AgentConnector({ configDir: CONFIG_DIR });
    }
    return !!core;
  }

  get coreVersion(): string | null {
    for (const pkg of [path.join(LOCAL_CORE, 'package.json'), path.join(GLOBAL_CORE, 'package.json')]) {
      try {
        if (fs.existsSync(pkg)) {
          return JSON.parse(fs.readFileSync(pkg, 'utf-8')).version as string;
        }
      } catch {
        /* ignore */
      }
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require('@openagents-org/agent-launcher/package.json') as { version: string }).version;
    } catch {
      return null;
    }
  }

  private _ensureConnector(): AgentConnector {
    if (!this._connector) {
      if (!this.reloadCore() || !this._connector) {
        throw new Error('Core library not installed. Install an agent first via the Install tab.');
      }
    }
    return this._connector;
  }

  // ── Agent listing ────────────────────────────────────────────────────────
  getAgents(): Agent[] {
    if (!this._connector) return [];
    const records = this._connector.listAgents();
    const status = this.getAllStatus();
    this._scheduleHealthRefresh(records);

    const supported = new Set(this.getSupportedAgentTypes());
    return records.map((a): Agent => {
      const type = a.type || 'openclaw';
      const runtimeMismatch = !supported.has(type);
      const runtimeMessage = runtimeMismatch
        ? `Agent runtime '${type}' is not available in the currently loaded core. ` +
          `This usually means the Launcher core is outdated or did not reload correctly. ` +
          `Update Launcher and restart it.`
        : null;
      const statusError = status[a.name]?.last_error ?? null;
      return {
        ...a,
        type,
        state: (status[a.name]?.state as AgentState | undefined) ?? 'stopped',
        restarts: status[a.name]?.restarts ?? 0,
        lastError: statusError || runtimeMessage,
        health: this._healthByType.get(type) ?? null,
        runtimeMismatch,
      };
    });
  }

  private _scheduleHealthRefresh(records: AgentRecord[]): void {
    const now = Date.now();
    if (now - this._lastHealthRefreshAt < 3000) return;
    this._lastHealthRefreshAt = now;

    const types = Array.from(new Set(records.map((a) => a.type || 'openclaw')));
    for (const type of types) {
      if (this._healthRefreshInFlight.has(type)) continue;
      this._healthRefreshInFlight.add(type);
      setTimeout(() => {
        try {
          const health = this._connector ? this._connector.healthCheck(type) : null;
          this._healthByType.set(type, health);
        } catch {
          this._healthByType.set(type, null);
        } finally {
          this._healthRefreshInFlight.delete(type);
        }
      }, 0);
    }
  }

  // ── Agent CRUD ───────────────────────────────────────────────────────────
  async addAgent(config: AddAgentConfig): Promise<OperationResult<AddAgentConfig>> {
    const connector = this._ensureConnector();
    const type = config.type || 'openclaw';
    const supported = this.getSupportedAgentTypes();
    if (supported.length > 0 && !supported.includes(type)) {
      throw new Error(`Agent type '${type}' is not supported in Launcher yet. Supported: ${supported.join(', ')}`);
    }
    connector.addAgent({
      name: config.name,
      type,
      role: 'worker',
      path: config.path,
      env: config.env,
    });
    return { success: true, agent: config };
  }

  async removeAgent(name: string): Promise<OperationResult> {
    try { await this.stopAgent(name); } catch { /* ignore */ }
    const connector = this._ensureConnector();
    connector.removeAgent(name);
    return { success: true };
  }

  async updateAgent(name: string, updates: UpdateAgentConfig): Promise<OperationResult> {
    if (updates.env) {
      this._ensureConnector().saveAgentInstanceEnv(name, updates.env);
    }
    return { success: true };
  }

  // ── Catalog & env config ─────────────────────────────────────────────────
  async getCatalog(): Promise<CatalogEntry[]> {
    const connector = this._ensureConnector();
    let catalog: CatalogEntry[];
    try {
      catalog = await connector.getCatalog();
    } catch {
      catalog = connector.registry.getCatalogSync().map((entry) => {
        const info = connector.installer.getInstallInfo(entry.name);
        return { ...entry, installed: info.installed, managed: info.managed, location: info.location };
      });
    }
    const bundled = connector.registry._loadBundled();
    for (const entry of catalog) {
      const b = bundled.find((x) => x.name === entry.name);
      if (!b) continue;
      if (!entry.check_ready && b.check_ready) entry.check_ready = b.check_ready;
      if ((!entry.env_config || entry.env_config.length === 0) && b.env_config?.length) {
        entry.env_config = b.env_config;
      }
      if (!entry.install && b.install) entry.install = b.install;
      if (!entry.launch && b.launch) entry.launch = b.launch;
    }
    return catalog;
  }

  async getEnvFields(type: string): Promise<FieldSchema[]> {
    return this._ensureConnector().getEnvFields(type);
  }

  getAgentEnv(type: string): AgentEnv {
    return this._ensureConnector().getAgentEnv(type);
  }

  getAgentInstanceEnv(name: string): AgentEnv {
    return this._ensureConnector().getAgentInstanceEnv(name);
  }

  saveAgentEnv(type: string, env: AgentEnv): OperationResult {
    const connector = this._ensureConnector();
    connector.saveAgentEnv(type, env);

    // OpenClaw uses native auth profiles — keep them in sync with the env.
    if (type === 'openclaw') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const OpenClawAdapter = require('@openagents-org/agent-launcher/src/adapters/openclaw') as {
          configureNativeAuth?(env: AgentEnv): void;
        };
        OpenClawAdapter.configureNativeAuth?.(env);
      } catch { /* optional */ }
    }
    this.signalReload();
    return { success: true };
  }

  saveAgentInstanceEnv(name: string, env: AgentEnv): OperationResult {
    this._ensureConnector().saveAgentInstanceEnv(name, env);
    this.signalReload();
    return { success: true };
  }

  async testLLM(env: AgentEnv): Promise<{
    success: boolean;
    model?: string;
    response?: string;
    error?: string;
  }> {
    return this._ensureConnector().testLLM(env);
  }

  signalReload(): void {
    const connector = this._connector;
    if (!connector) return;
    const pid = connector.getDaemonPid();
    if (!pid) return;
    if (process.platform === 'win32') {
      connector.sendDaemonCommand('reload');
    } else {
      try { process.kill(pid, 'SIGHUP'); } catch { /* ignore */ }
    }
  }

  // ── Workspaces ───────────────────────────────────────────────────────────
  getNetworks(): Workspace[] {
    return this._connector ? this._connector.listWorkspaces() : [];
  }

  async createWorkspace(name?: string): Promise<WorkspaceCreateResult> {
    return this._ensureConnector().createWorkspace({ name: name || 'My Workspace' });
  }

  async connectWorkspace(agentName: string, tokenOrSlug: string): Promise<OperationResult> {
    const connector = this._ensureConnector();
    try {
      const info = await connector.resolveToken(tokenOrSlug);
      const slug = info.slug ?? info.workspace_id;
      const wsName = info.name ?? slug;
      connector.config.addNetwork({
        id: info.workspace_id,
        slug,
        name: wsName,
        endpoint: info.endpoint ?? connector.workspace?.endpoint,
        token: tokenOrSlug,
      });
      connector.connectWorkspace(agentName, slug);
    } catch {
      connector.connectWorkspace(agentName, tokenOrSlug);
    }
    this.signalReload();
    return { success: true };
  }

  async disconnectWorkspace(agentName: string): Promise<OperationResult> {
    this._ensureConnector().disconnectWorkspace(agentName);
    this.signalReload();
    return { success: true };
  }

  async removeWorkspace(slug: string): Promise<OperationResult> {
    const result = await this._ensureConnector().removeWorkspace(slug);
    this.signalReload();
    return result;
  }

  // ── Agent type install / uninstall ───────────────────────────────────────
  async checkAgentType(type: string): Promise<CheckTypeResult> {
    const connector = this._ensureConnector();
    const installed = connector.isInstalled(type);
    const binary = installed ? connector.installer.which(type) : null;
    return { installed, binary: binary || null };
  }

  async installAgentType(type: string): Promise<OperationResult> {
    return this._ensureConnector().install(type);
  }

  async installAgentTypeStreaming(type: string, onData?: InstallStreamCallback): Promise<OperationResult> {
    const connector = this._ensureConnector();
    const result = await connector.installer.installStreaming(type, onData);
    connector.clearCatalogCache();
    return result;
  }

  async uninstallAgentType(type: string): Promise<OperationResult> {
    const connector = this._ensureConnector();
    const result = await connector.uninstall(type);
    connector.clearCatalogCache();
    return result;
  }

  async uninstallAgentTypeStreaming(type: string, onData?: InstallStreamCallback): Promise<OperationResult> {
    const connector = this._ensureConnector();
    const result = await connector.installer.uninstallStreaming(type, onData);
    connector.clearCatalogCache();
    return result;
  }

  // ── Daemon lifecycle ─────────────────────────────────────────────────────
  async startAgent(name: string): Promise<OperationResult> {
    await this._ensureDaemon();
    this._ensureConnector().sendDaemonCommand(`start:${name}`);
    return { success: true, message: `Start command sent for ${name}` };
  }

  async stopAgent(name: string): Promise<OperationResult> {
    const connector = this._ensureConnector();
    const pid = connector.getDaemonPid();
    if (!pid) return { success: true, message: 'Daemon not running' };
    connector.sendDaemonCommand(`stop:${name}`);
    return { success: true, message: `Stop command sent for ${name}` };
  }

  async startAll(): Promise<OperationResult> {
    await this._ensureDaemon();
    this._ensureConnector().sendDaemonCommand('reload');
    return { success: true, message: 'Start all command sent' };
  }

  async stopAll(): Promise<OperationResult> {
    if (!this._connector) return { success: false, message: 'Daemon not running' };
    const stopped = this._connector.stopDaemon();
    return { success: stopped, message: stopped ? 'Daemon stopped' : 'Daemon not running' };
  }

  async _ensureDaemon(): Promise<OperationResult | void> {
    const connector = this._ensureConnector();
    if (connector.getDaemonPid()) return;

    const portableNodeDir = path.join(os.homedir(), '.openagents', 'nodejs');
    const nodeBin = path.join(portableNodeDir, 'node' + (process.platform === 'win32' ? '.exe' : ''));
    const nodeBinLegacy = path.join(portableNodeDir, 'bin', 'node');
    if (!fs.existsSync(nodeBin) && !fs.existsSync(nodeBinLegacy)) return;

    return this._startDaemon();
  }

  getAllStatus(): Record<string, AgentStatusEntry> {
    return this._connector ? this._connector.getDaemonStatus() : {};
  }

  getLogs(name?: string | null, lines = 200): LogsResult {
    if (!this._connector) return { lines: [] };
    return { lines: this._connector.getLogs(name, lines) };
  }

  tailLogs(name?: string | null, lines = 200, offset = 0): TailLogsResult {
    if (!this._connector) return { lines: [], size: 0 };
    return this._connector.config.tailLogs({ agent: name || undefined, lines, offset });
  }

  clearLogsInRange(start: string | number | Date, end: string | number | Date): ClearLogsResult {
    const startTime = normalizeTimeValue(start);
    const endTime = normalizeTimeValue(end);
    if (!startTime || !endTime) throw new Error('Start time and end time are required');
    if (startTime.getTime() > endTime.getTime()) throw new Error('Start time must be before end time');

    const logFile = path.join(CONFIG_DIR, 'daemon.log');
    if (!fs.existsSync(logFile)) return { removed: 0, remaining: 0 };

    const content = fs.readFileSync(logFile, 'utf-8');
    const hasTrailingNewline = content.endsWith('\n');
    const allLines = content.split('\n');
    if (hasTrailingNewline) allLines.pop();
    const { keptLines, removed } = filterLogsByTimeRange(allLines, startTime, endTime);
    const nextContent = keptLines.join('\n') + (hasTrailingNewline && keptLines.length > 0 ? '\n' : '');
    const tempFile = `${logFile}.tmp`;
    fs.writeFileSync(tempFile, nextContent, 'utf-8');
    fs.renameSync(tempFile, logFile);
    return { removed, remaining: keptLines.length };
  }

  healthCheck(type: string): HealthStatus | null {
    return this._connector ? this._connector.healthCheck(type) : null;
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private _startDaemon(): OperationResult {
    const connector = this._connector;
    if (!connector) return { success: false, message: 'Core library not loaded' };
    try { connector.stopDaemon(); } catch { /* ignore */ }

    const portableNodeDir = path.join(os.homedir(), '.openagents', 'nodejs');
    const openagentsDir = path.join(os.homedir(), '.openagents');
    const extraDirs: string[] = [portableNodeDir, path.join(portableNodeDir, 'bin')];

    const runtimesDir = path.join(openagentsDir, 'runtimes');
    try {
      for (const d of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
        if (d.isDirectory()) extraDirs.push(path.join(runtimesDir, d.name, 'node_modules', '.bin'));
      }
    } catch { /* directory may not exist */ }

    extraDirs.push(path.join(openagentsDir, 'core', 'node_modules', '.bin'));
    extraDirs.push(path.join(portableNodeDir, 'node_modules', '.bin'));

    if (process.platform === 'win32') {
      extraDirs.push(path.join(process.env.APPDATA || '', 'npm'));
      try {
        const npmPrefix = execSync('npm config get prefix', {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }).trim();
        if (npmPrefix && !extraDirs.includes(npmPrefix)) extraDirs.push(npmPrefix);
      } catch { /* npm may not be on PATH */ }
    }

    const enhancedPath = [...extraDirs, process.env.PATH || ''].join(path.delimiter);

    const cliCandidates = [
      path.join(LOCAL_CORE, 'bin', 'agent-connector.js'),
      path.join(portableNodeDir, 'node_modules', '@openagents-org', 'agent-launcher', 'bin', 'agent-connector.js'),
    ];
    const cliPath = cliCandidates.find((c) => {
      try { return fs.existsSync(c); } catch { return false; }
    });
    if (!cliPath) {
      return { success: false, message: 'agent-launcher CLI not found. Install an agent first via the Install tab.' };
    }

    let nodeBin = path.join(portableNodeDir, 'node' + (process.platform === 'win32' ? '.exe' : ''));
    if (!fs.existsSync(nodeBin)) {
      try {
        nodeBin = execSync(process.platform === 'win32' ? 'where node' : 'which node', {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath },
        }).split(/\r?\n/)[0].trim();
      } catch {
        nodeBin = 'node';
      }
    }

    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const logFile = path.join(CONFIG_DIR, 'daemon.log');
      const pidFile = path.join(CONFIG_DIR, 'daemon.pid');
      const logFd = fs.openSync(logFile, 'a');

      const proc = spawn(nodeBin, [cliPath, 'up', '--foreground'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PATH: enhancedPath },
        windowsHide: true,
      });
      proc.unref();
      if (proc.pid) fs.writeFileSync(pidFile, String(proc.pid), 'utf-8');
      fs.closeSync(logFd);

      return { success: true, message: `Daemon started (PID ${proc.pid})` };
    } catch (e) {
      return { success: false, message: `Failed to start daemon: ${(e as Error).message}` };
    }
  }
}

// ── Log time-range filtering helpers ──────────────────────────────────────
function normalizeTimeValue(value: string | number | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function filterLogsByTimeRange(
  lines: string[],
  start: Date,
  end: Date,
): { keptLines: string[]; removed: number } {
  const headerTimes = resolveLogHeaderTimestamps(lines, end);
  let activeRemove = false;
  let removed = 0;
  const keptLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const headerTime = headerTimes[index];
    if (headerTime) {
      const time = headerTime.getTime();
      activeRemove = time >= start.getTime() && time <= end.getTime();
    }
    if (activeRemove) removed += 1;
    else keptLines.push(lines[index]);
  }
  return { keptLines, removed };
}

interface IsoToken {
  kind: 'iso';
  date: Date;
}
interface ClockToken {
  kind: 'clock';
  seconds: number;
}
type LogTimestampToken = IsoToken | ClockToken;

function resolveLogHeaderTimestamps(lines: string[], referenceTime: Date): Array<Date | null> {
  const resolved: Array<Date | null> = new Array(lines.length).fill(null);
  let currentDay = startOfLocalDay(referenceTime);
  let lastClockSeconds: number | null = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const token = parseLogTimestampToken(lines[index]);
    if (!token) continue;

    if (token.kind === 'iso') {
      resolved[index] = token.date;
      currentDay = startOfLocalDay(token.date);
      lastClockSeconds =
        token.date.getHours() * 3600 + token.date.getMinutes() * 60 + token.date.getSeconds();
      continue;
    }
    if (lastClockSeconds !== null && token.seconds > lastClockSeconds) {
      currentDay = addLocalDays(currentDay, -1);
    }
    resolved[index] = withLocalClock(currentDay, token.seconds);
    lastClockSeconds = token.seconds;
  }
  return resolved;
}

function parseLogTimestampToken(line: string): LogTimestampToken | null {
  if (!line) return null;
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))/);
  if (isoMatch) {
    const date = new Date(isoMatch[1]);
    if (!Number.isNaN(date.getTime())) return { kind: 'iso', date };
  }
  const clockMatch = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
  if (clockMatch) {
    return {
      kind: 'clock',
      seconds: Number(clockMatch[1]) * 3600 + Number(clockMatch[2]) * 60 + Number(clockMatch[3]),
    };
  }
  return null;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function withLocalClock(day: Date, seconds: number): Date {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, secs);
}
