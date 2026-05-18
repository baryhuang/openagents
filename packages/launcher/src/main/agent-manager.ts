import path from 'path'
import fs from 'fs'
import os from 'os'
import https from 'https'
import { spawnSync } from 'child_process'

const CONFIG_DIR = path.join(os.homedir(), '.openagents')
const GLOBAL_CORE = path.join(CONFIG_DIR, 'nodejs', 'node_modules', '@openagents-org', 'agent-launcher')
const LOCAL_CORE = path.resolve(__dirname, '../../../agent-connector')
const INSTALLED_HISTORY_FILE = path.join(CONFIG_DIR, 'installed_agents_history.json')
const DAEMON_PID_FILE = path.join(CONFIG_DIR, 'daemon.pid')
const DAEMON_STATUS_FILE = path.join(CONFIG_DIR, 'daemon.status.json')
const DAEMON_CMD_FILE = path.join(CONFIG_DIR, 'daemon.cmd')
const DAEMON_LOG_FILE = path.join(CONFIG_DIR, 'daemon.log')

export interface InstalledAgentRecord {
  name: string
  version: string | null
  installedAt: string
  previousVersion?: string | null
  history?: Array<{ version: string; installedAt: string }>
}

interface NpmRegistryInfo {
  'dist-tags'?: { latest?: string }
  versions?: Record<string, unknown>
  time?: Record<string, string>
  homepage?: string
}

function loadCore(): Record<string, unknown> | null {
  if (fs.existsSync(path.join(LOCAL_CORE, 'package.json'))) {
    try { return require(LOCAL_CORE) } catch (e) {
      console.error('Failed to load local core:', e)
    }
  }
  if (fs.existsSync(path.join(GLOBAL_CORE, 'package.json'))) {
    try { return require(GLOBAL_CORE) } catch {}
  }
  try { return require('@openagents-org/agent-launcher') } catch {}
  return null
}

function appendDaemonLog(message: string): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.appendFileSync(DAEMON_LOG_FILE, `[${new Date().toISOString()}] launcher: ${message}\n`, 'utf-8')
  } catch {}
}

function isPidAlive(pid: number | null): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Smoke-test a node binary by running `--version`. Returns false if the
 * binary is missing, blocked by Defender/SmartScreen, has an arch mismatch,
 * or any other CreateProcess failure. Used to avoid spawning the daemon with
 * a bundled node.exe that Windows refuses to load — which would otherwise
 * leave the daemon perpetually offline.
 */
function canExecuteNode(binaryPath: string): boolean {
  try {
    const r = spawnSync(binaryPath, ['--version'], {
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return r.status === 0 && !r.error
  } catch {
    return false
  }
}

/**
 * Resolve a working node binary, preferring the bundled portable runtime
 * when it actually launches, otherwise falling back to a system `node` on
 * PATH. Returns null if nothing works.
 */
function resolveWorkingNode(portableNodeDir: string, enhancedPath: string): string | null {
  const candidates = [
    path.join(portableNodeDir, 'node' + (process.platform === 'win32' ? '.exe' : '')),
    path.join(portableNodeDir, 'bin', 'node'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c) && canExecuteNode(c)) return c
  }
  // Bundled node missing or won't run — try the system one.
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const out = require('child_process').execFileSync(which, ['node'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, PATH: enhancedPath },
    }) as string
    for (const line of out.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)) {
      if (canExecuteNode(line)) return line
    }
  } catch {}
  return null
}

let core: Record<string, unknown> | null = loadCore()

export class AgentManager {
  private _store: unknown
  private _healthByType = new Map<string, unknown>()
  private _healthRefreshInFlight = new Set<string>()
  private _lastHealthRefreshAt = 0
  private _healthQueue: string[] = []
  private _healthProcessing = false
  private _agentsCache: { value: unknown[]; at: number } = { value: [], at: 0 }
  private _catalogCache: { value: unknown[] | null; at: number; inFlight: Promise<unknown[]> | null } = {
    value: null,
    at: 0,
    inFlight: null,
  }
  private _updatesCache: {
    value: Array<{ name: string; current: string | null; latest: string | null }>
    at: number
    inFlight: Promise<Array<{ name: string; current: string | null; latest: string | null }>> | null
  } = {
    value: [],
    at: 0,
    inFlight: null,
  }
  private _statusCache: { value: unknown; at: number } = { value: {}, at: 0 }
  _connector: Record<string, unknown> | null = null

  constructor(store: unknown) {
    this._store = store
    if (!core) core = loadCore()
    if (core) {
      const AgentConnector = (core as Record<string, unknown>).AgentConnector as new (opts: unknown) => Record<string, unknown>
      this._connector = new AgentConnector({ configDir: CONFIG_DIR })
    }
  }

  getSupportedAgentTypes(): string[] {
    const supported = (core as Record<string, unknown> | null)?.adapters
      ? Object.keys(((core as Record<string, unknown>).adapters as Record<string, unknown>).ADAPTER_MAP as Record<string, unknown>)
      : []
    return (supported as string[]).sort()
  }

  getCoreInfo(): unknown {
    return {
      version: this.coreVersion,
      supportedTypes: this.getSupportedAgentTypes(),
      globalCorePath: GLOBAL_CORE,
      globalCorePresent: fs.existsSync(path.join(GLOBAL_CORE, 'package.json')),
    }
  }

  reloadCore(): boolean {
    const cacheKeys = Object.keys(require.cache).filter(k => k.includes('agent-launcher') || k.includes('agent-connector'))
    for (const k of cacheKeys) delete require.cache[k]
    core = loadCore()
    if (core) {
      const AgentConnector = (core as Record<string, unknown>).AgentConnector as new (opts: unknown) => Record<string, unknown>
      this._connector = new AgentConnector({ configDir: CONFIG_DIR })
    }
    this.clearCatalogCache()
    this._agentsCache = { value: [], at: 0 }
    this._healthByType.clear()
    return !!core
  }

  get coreVersion(): string | null {
    try {
      const pkg = path.join(LOCAL_CORE, 'package.json')
      if (fs.existsSync(pkg)) return JSON.parse(fs.readFileSync(pkg, 'utf-8')).version
    } catch {}
    try {
      const pkg = path.join(GLOBAL_CORE, 'package.json')
      if (fs.existsSync(pkg)) return JSON.parse(fs.readFileSync(pkg, 'utf-8')).version
    } catch {}
    try { return require('@openagents-org/agent-launcher/package.json').version } catch {}
    return null
  }

  private _ensureConnector(): void {
    if (!this._connector) {
      if (!this.reloadCore()) {
        throw new Error('Core library not installed. Install an agent first via the Install tab.')
      }
    }
  }

  getAgents(): unknown[] {
    const now = Date.now()
    if (this._agentsCache.value.length > 0 && now - this._agentsCache.at < 1500) {
      return this._agentsCache.value
    }
    if (!this._connector) return []
    const listAgents = this._connector.listAgents as () => unknown[]
    const agents = listAgents.call(this._connector)
    const status = this.getAllStatus() as Record<string, { state?: string; restarts?: number; last_error?: string }>
    this._scheduleHealthRefresh(agents as Array<{ type?: string; name: string }>)

    const supportedTypes = new Set(this.getSupportedAgentTypes())
    const value = (agents as Array<Record<string, unknown>>).map((a) => {
      const type = (a.type as string) || 'openclaw'
      const runtimeMismatch = !supportedTypes.has(type)
      const runtimeMessage = runtimeMismatch
        ? `Agent runtime '${type}' is not available in the currently loaded core. Update Launcher and restart it.`
        : null
      const statusEntry = status[a.name as string]
      const statusError = statusEntry?.last_error || null
      return {
        ...a,
        state: statusEntry?.state || 'stopped',
        restarts: statusEntry?.restarts || 0,
        lastError: statusError || runtimeMessage,
        health: this._healthByType.get(type) || null,
        runtimeMismatch,
      }
    })
    this._agentsCache = { value, at: now }
    return value
  }

  private _scheduleHealthRefresh(agents: Array<{ type?: string; name: string }>): void {
    const now = Date.now()
    if (now - this._lastHealthRefreshAt < 30_000) return
    this._lastHealthRefreshAt = now

    const types = [...new Set((agents || []).map(a => a.type || 'openclaw'))]
    for (const type of types) {
      if (this._healthRefreshInFlight.has(type)) continue
      if (this._healthQueue.includes(type)) continue
      this._healthRefreshInFlight.add(type)
      this._healthQueue.push(type)
    }
    this._processHealthQueue()
  }

  private _processHealthQueue(): void {
    if (this._healthProcessing) return
    this._healthProcessing = true
    const tick = (): void => {
      const type = this._healthQueue.shift()
      if (!type) { this._healthProcessing = false; return }
      setTimeout(() => {
        try {
          const healthCheck = this._connector?.healthCheck as ((type: string) => unknown) | undefined
          const health = healthCheck ? healthCheck.call(this._connector, type) : null
          this._healthByType.set(type, health)
        } catch {
          this._healthByType.set(type, null)
        } finally {
          this._healthRefreshInFlight.delete(type)
        }
        setTimeout(tick, 250)
      }, 0)
    }
    tick()
  }

  async addAgent(agentConfig: { name: string; type?: string; path?: string; env?: Record<string, string> }): Promise<unknown> {
    const name = agentConfig.name
    const type = agentConfig.type || 'openclaw'
    const supportedTypes = this.getSupportedAgentTypes()

    if (supportedTypes.length > 0 && !supportedTypes.includes(type)) {
      throw new Error(`Agent type '${type}' is not supported. Supported: ${supportedTypes.join(', ')}`)
    }

    const addAgent = this._connector!.addAgent as (opts: unknown) => void
    addAgent.call(this._connector, { name, type, role: 'worker', path: agentConfig.path, env: agentConfig.env })
    return { success: true, agent: agentConfig }
  }

  async removeAgent(name: string): Promise<unknown> {
    try { await this.stopAgent(name) } catch {}
    const removeAgent = this._connector!.removeAgent as (name: string) => void
    removeAgent.call(this._connector, name)
    return { success: true }
  }

  async updateAgent(name: string, updates: { env?: Record<string, string> }): Promise<unknown> {
    if (updates.env) {
      const saveEnv = this._connector!.saveAgentInstanceEnv as (name: string, env: unknown) => void
      saveEnv.call(this._connector, name, updates.env)
    }
    return { success: true }
  }

  clearCatalogCache(): void {
    this._catalogCache = { value: null, at: 0, inFlight: null }
    this._updatesCache = { value: [], at: 0, inFlight: null }
    try {
      const clearCache = this._connector?.clearCatalogCache as (() => void) | undefined
      clearCache?.call(this._connector)
    } catch {}
  }

  async getCatalog(force = false): Promise<unknown[]> {
    const now = Date.now()
    const ttl = process.platform === 'win32' ? 60_000 : 10_000
    if (!force && this._catalogCache.value && now - this._catalogCache.at < ttl) {
      return this._catalogCache.value
    }
    if (!force && this._catalogCache.inFlight) return this._catalogCache.inFlight

    const load = this._loadCatalog().then((catalog) => {
      this._catalogCache = { value: catalog, at: Date.now(), inFlight: null }
      return catalog
    }).catch((err) => {
      this._catalogCache.inFlight = null
      throw err
    })
    this._catalogCache.inFlight = load
    return load
  }

  private async _loadCatalog(): Promise<unknown[]> {
    let catalog: unknown[]
    try {
      const getCatalog = this._connector!.getCatalog as () => Promise<unknown[]>
      catalog = await getCatalog.call(this._connector)
    } catch {
      const registry = this._connector!.registry as Record<string, unknown>
      const getCatalogSync = registry.getCatalogSync as () => unknown[]
      catalog = getCatalogSync.call(registry).map((e) => {
        const entry = e as Record<string, unknown>
        const installer = this._connector!.installer as Record<string, unknown>
        const getInstallInfo = installer.getInstallInfo as (name: string) => { installed: boolean; managed?: boolean; location?: string }
        const info = getInstallInfo.call(installer, entry.name as string)
        return { ...entry, installed: info.installed, managed: info.managed, location: info.location }
      })
    }
    const registry = this._connector!.registry as Record<string, unknown>
    const loadBundled = registry._loadBundled as () => unknown[]
    const bundled = loadBundled.call(registry)
    for (const entry of catalog) {
      const e = entry as Record<string, unknown>
      const b = (bundled as Array<Record<string, unknown>>).find(x => x.name === e.name)
      if (b) {
        if (!e.check_ready && b.check_ready) e.check_ready = b.check_ready
        if ((!e.env_config || !(e.env_config as unknown[]).length) && (b.env_config as unknown[] | undefined)?.length) e.env_config = b.env_config
        if (!e.install && b.install) e.install = b.install
        if (!e.launch && b.launch) e.launch = b.launch
      }
    }
    return catalog
  }

  async getEnvFields(agentType: string): Promise<unknown[]> {
    this._ensureConnector()
    const getEnvFields = this._connector!.getEnvFields as (type: string) => unknown[]
    return getEnvFields.call(this._connector, agentType)
  }

  getAgentEnv(agentType: string): unknown {
    const getAgentEnv = this._connector!.getAgentEnv as (type: string) => unknown
    return getAgentEnv.call(this._connector, agentType)
  }

  getAgentInstanceEnv(agentName: string): unknown {
    const getInstanceEnv = this._connector!.getAgentInstanceEnv as (name: string) => unknown
    return getInstanceEnv.call(this._connector, agentName)
  }

  saveAgentEnv(agentType: string, env: Record<string, string>): unknown {
    const saveEnv = this._connector!.saveAgentEnv as (type: string, env: unknown) => void
    saveEnv.call(this._connector, agentType, env)

    try {
      if (agentType === 'openclaw') {
        const OpenClawAdapter = require('@openagents-org/agent-launcher/src/adapters/openclaw')
        OpenClawAdapter.configureNativeAuth(env)
      }
    } catch {}

    this.signalReload()
    return { success: true }
  }

  saveAgentInstanceEnv(agentName: string, env: Record<string, string>): unknown {
    const saveEnv = this._connector!.saveAgentInstanceEnv as (name: string, env: unknown) => void
    saveEnv.call(this._connector, agentName, env)
    this.signalReload()
    return { success: true }
  }

  async testLLM(env: Record<string, string>): Promise<unknown> {
    const testLLM = this._connector!.testLLM as (env: unknown) => Promise<unknown>
    return testLLM.call(this._connector, env)
  }

  signalReload(): void {
    const getDaemonPid = this._connector!.getDaemonPid as () => number | null
    const pid = getDaemonPid.call(this._connector)
    if (!pid) return

    if (process.platform === 'win32') {
      const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
      sendCmd.call(this._connector, 'reload')
    } else {
      try { process.kill(pid, 'SIGHUP') } catch {}
    }
  }

  getNetworks(): unknown[] {
    const listWorkspaces = this._connector!.listWorkspaces as () => unknown[]
    return listWorkspaces.call(this._connector)
  }

  async createWorkspace(name: string): Promise<unknown> {
    const createWorkspace = this._connector!.createWorkspace as (opts: unknown) => Promise<unknown>
    return createWorkspace.call(this._connector, { name: name || 'My Workspace' })
  }

  async connectWorkspace(agentName: string, tokenOrSlug: string): Promise<unknown> {
    try {
      const resolveToken = this._connector!.resolveToken as (token: string) => Promise<{ slug?: string; workspace_id?: string; name?: string; endpoint?: string }>
      const info = await resolveToken.call(this._connector, tokenOrSlug)
      const slug = info.slug || info.workspace_id
      const wsName = info.name || slug

      const addNetwork = (this._connector!.config as Record<string, unknown>).addNetwork as (opts: unknown) => void
      addNetwork.call((this._connector!.config as Record<string, unknown>), {
        id: info.workspace_id,
        slug,
        name: wsName,
        endpoint: info.endpoint,
        token: tokenOrSlug,
      })

      const connectWorkspace = this._connector!.connectWorkspace as (name: string, slug: string) => void
      connectWorkspace.call(this._connector, agentName, slug as string)
    } catch {
      const connectWorkspace = this._connector!.connectWorkspace as (name: string, slug: string) => void
      connectWorkspace.call(this._connector, agentName, tokenOrSlug)
    }
    this.signalReload()
    return { success: true }
  }

  async disconnectWorkspace(agentName: string): Promise<unknown> {
    const disconnectWorkspace = this._connector!.disconnectWorkspace as (name: string) => void
    disconnectWorkspace.call(this._connector, agentName)
    this.signalReload()
    return { success: true }
  }

  async removeWorkspace(slug: string): Promise<unknown> {
    const removeWorkspace = this._connector!.removeWorkspace as (slug: string) => Promise<unknown>
    const result = await removeWorkspace.call(this._connector, slug)
    this.signalReload()
    return result
  }

  async checkAgentType(agentType: string): Promise<unknown> {
    const isInstalled = this._connector!.isInstalled as (type: string) => boolean
    const installed = isInstalled.call(this._connector, agentType)
    const installer = this._connector!.installer as Record<string, unknown>
    const which = installer.which as (type: string) => string | null
    const binary = installed ? which.call(installer, agentType) : null
    return { installed, binary: binary || null }
  }

  async installAgentType(agentType: string): Promise<unknown> {
    const install = this._connector!.install as (type: string) => Promise<unknown>
    const result = await install.call(this._connector, agentType)
    this._recordInstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async installAgentTypeStreaming(agentType: string, onData: (data: string) => void): Promise<unknown> {
    const installer = this._connector!.installer as Record<string, unknown>
    const installStreaming = installer.installStreaming as (type: string, onData: (data: string) => void) => Promise<unknown>
    const result = await installStreaming.call(installer, agentType, onData)
    this._recordInstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async uninstallAgentType(agentType: string): Promise<unknown> {
    const uninstall = this._connector!.uninstall as (type: string) => Promise<unknown>
    const result = await uninstall.call(this._connector, agentType)
    this._recordUninstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async uninstallAgentTypeStreaming(agentType: string, onData: (data: string) => void): Promise<unknown> {
    const installer = this._connector!.installer as Record<string, unknown>
    const uninstallStreaming = installer.uninstallStreaming as (type: string, onData: (data: string) => void) => Promise<unknown>
    const result = await uninstallStreaming.call(installer, agentType, onData)
    this._recordUninstall(agentType)
    this.clearCatalogCache()
    return result
  }

  /** Read installed package version by inspecting runtime prefix package.json. */
  getInstalledVersion(agentType: string): string | null {
    try {
      const entry = this._getRegistryEntry(agentType)
      const npmPkg = this._resolveNpmPackage(entry)
      if (!npmPkg) return null
      const candidates = [
        path.join(CONFIG_DIR, 'runtimes', agentType, 'node_modules', npmPkg, 'package.json'),
        path.join(CONFIG_DIR, 'nodejs', 'node_modules', npmPkg, 'package.json'),
      ]
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) {
            const pkg = JSON.parse(fs.readFileSync(c, 'utf-8'))
            if (pkg?.version) return pkg.version
          }
        } catch {}
      }
    } catch {}
    return null
  }

  private _getRegistryEntry(agentType: string): Record<string, unknown> | null {
    try {
      const registry = this._connector?.registry as Record<string, unknown> | undefined
      if (!registry) return null
      const getEntry = registry.getEntry as ((t: string) => unknown) | undefined
      const entry = getEntry ? (getEntry.call(registry, agentType) as Record<string, unknown> | null) : null
      return entry || null
    } catch { return null }
  }

  private _resolveNpmPackage(entry: Record<string, unknown> | null): string | null {
    if (!entry) return null
    const install = entry.install as Record<string, unknown> | undefined
    if (!install) return null
    if (install.npm_package) return install.npm_package as string
    const cmd = (install[Installer.platformKey()] || install.command) as string | undefined
    if (!cmd) return install.binary as string | null
    const m = cmd.match(/npm install\s+(?:-g\s+)?(@?[\w-]+(?:\/[\w-]+)?)(?:@\S*)?$/)
    if (m) return m[1]
    return (install.binary as string | undefined) || null
  }

  getInstalledHistory(): Record<string, InstalledAgentRecord> {
    try {
      if (fs.existsSync(INSTALLED_HISTORY_FILE)) {
        const data = JSON.parse(fs.readFileSync(INSTALLED_HISTORY_FILE, 'utf-8'))
        if (data && typeof data === 'object') return data
      }
    } catch {}
    return {}
  }

  private _writeInstalledHistory(data: Record<string, InstalledAgentRecord>): void {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      fs.writeFileSync(INSTALLED_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8')
    } catch {}
  }

  private _recordInstall(agentType: string): void {
    try {
      const data = this.getInstalledHistory()
      const version = this.getInstalledVersion(agentType)
      const prev = data[agentType]
      const history = prev?.history ? [...prev.history] : []
      if (prev?.version && prev.version !== version) {
        history.unshift({ version: prev.version, installedAt: prev.installedAt })
      }
      data[agentType] = {
        name: agentType,
        version,
        installedAt: new Date().toISOString(),
        previousVersion: prev?.version || null,
        history: history.slice(0, 10),
      }
      this._writeInstalledHistory(data)
    } catch {}
  }

  private _recordUninstall(agentType: string): void {
    try {
      const data = this.getInstalledHistory()
      if (data[agentType]) {
        delete data[agentType]
        this._writeInstalledHistory(data)
      }
    } catch {}
  }

  listInstalledAgents(): InstalledAgentRecord[] {
    const data = this.getInstalledHistory()
    const out: InstalledAgentRecord[] = []
    for (const name of Object.keys(data)) {
      const r = data[name]
      out.push({ ...r, version: r.version || this.getInstalledVersion(name) })
    }
    return out
  }

  async rollbackAgentType(agentType: string, onData: (data: string) => void): Promise<{ success: boolean; version: string | null; error?: string }> {
    const data = this.getInstalledHistory()
    const record = data[agentType]
    const target = record?.history?.[0]?.version || record?.previousVersion
    if (!target) return { success: false, version: null, error: 'No previous version to roll back to' }

    const entry = this._getRegistryEntry(agentType)
    const npmPkg = this._resolveNpmPackage(entry)
    if (!npmPkg) return { success: false, version: null, error: 'Cannot determine npm package for rollback' }

    const { spawn } = require('child_process') as typeof import('child_process')
    const prefixDir = path.join(CONFIG_DIR, 'runtimes', agentType)
    fs.mkdirSync(prefixDir, { recursive: true })
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const args = ['install', '--save', '--prefix', prefixDir, `${npmPkg}@${target}`]

    if (onData) onData(`$ ${npmCmd} ${args.join(' ')}\n\n`)

    return new Promise((resolve) => {
      const proc = spawn(npmCmd, args, { shell: true, cwd: prefixDir, stdio: ['ignore', 'pipe', 'pipe'] })
      proc.stdout?.setEncoding('utf-8')
      proc.stderr?.setEncoding('utf-8')
      proc.stdout?.on('data', (d) => onData && onData(d))
      proc.stderr?.on('data', (d) => onData && onData(d))
      proc.on('error', (err) => resolve({ success: false, version: null, error: err.message }))
      proc.on('close', (code) => {
        if (code === 0) {
          this._recordInstall(agentType)
          this.clearCatalogCache()
          if (onData) onData(`\nRolled back to ${target}.\n`)
          resolve({ success: true, version: target })
        } else {
          resolve({ success: false, version: null, error: `Rollback failed with code ${code}` })
        }
      })
    })
  }

  async checkAgentUpdates(options: { force?: boolean } = {}): Promise<Array<{ name: string; current: string | null; latest: string | null }>> {
    const now = Date.now()
    const ttl = 60 * 60 * 1000
    if (!options.force) {
      return this._updatesCache.value
    }
    if (this._updatesCache.value.length > 0 && now - this._updatesCache.at < ttl) {
      return this._updatesCache.value
    }

    if (this._updatesCache.inFlight) return this._updatesCache.inFlight
    this._updatesCache.inFlight = this._loadAgentUpdates()
      .then((updates) => {
        this._updatesCache = { value: updates, at: Date.now(), inFlight: null }
        return updates
      })
      .catch((err) => {
        this._updatesCache.inFlight = null
        throw err
      })
    return this._updatesCache.inFlight
  }

  private async _loadAgentUpdates(): Promise<Array<{ name: string; current: string | null; latest: string | null }>> {
    // Use the full catalog (every entry with installed=true), not just the
    // history file — agents installed globally / pre-launcher won't be in
    // the history but are still installed and worth checking for updates.
    const catalog = (await this.getCatalog()) as Array<Record<string, unknown>>
    const installedEntries = catalog.filter((e) => e.installed === true)
    const historyByName = new Map(this.listInstalledAgents().map((r) => [r.name, r.version]))

    const results = await Promise.all(installedEntries.map(async (entry) => {
      const name = entry.name as string
      const npmPkg = this._resolveNpmPackage(entry)
      const current = historyByName.get(name) || this.getInstalledVersion(name)
      if (!npmPkg) return { name, current, latest: null }
      const info = await fetchNpmInfo(npmPkg).catch(() => null)
      return { name, current, latest: resolveLatestVersion(info) }
    }))
    return results
  }

  async getAgentChangelog(agentType: string): Promise<{ versions: Array<{ version: string; date?: string }>; homepage?: string; latest?: string | null; error?: string }> {
    const entry = this._getRegistryEntry(agentType)
    const homepage = (entry?.homepage as string | undefined) || undefined
    const npmPkg = this._resolveNpmPackage(entry)
    if (!npmPkg) return { versions: [], homepage, latest: null, error: 'No npm package' }
    try {
      const info = await fetchNpmInfo(npmPkg)
      const time = info.time || {}
      // Show pre-releases in the changelog list (useful for visibility), but
      // return `latest` as the stable dist-tag so the detail page's
      // "Update to vX" computation matches what `npm install` actually fetches.
      const versions = sortedPublishedVersions(info, { includePreRelease: true })
        .slice(0, 12)
        .map((v) => ({ version: v, date: time[v] }))
      return { versions, homepage, latest: resolveLatestVersion(info) }
    } catch (e: unknown) {
      return { versions: [], homepage, latest: null, error: (e as Error).message }
    }
  }

  async startAgent(name: string): Promise<unknown> {
    const ready = await this._ensureDaemon()
    if (!ready) throw new Error('Daemon failed to start. Check the Logs page for details.')
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, `start:${name}`)
    return { success: true, message: `Start command sent for ${name}` }
  }

  async stopAgent(name: string): Promise<unknown> {
    const pid = this._getLiveDaemonPid()
    if (!pid) return { success: true, message: 'Daemon not running' }
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, `stop:${name}`)
    return { success: true, message: `Stop command sent for ${name}` }
  }

  async startAll(): Promise<unknown> {
    const ready = await this._ensureDaemon()
    if (!ready) throw new Error('Daemon failed to start. Check the Logs page for details.')
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, 'reload')
    return { success: true, message: 'Start all command sent' }
  }

  async stopAll(): Promise<unknown> {
    const stopDaemon = this._connector!.stopDaemon as () => boolean
    const stopped = stopDaemon.call(this._connector)
    return { success: stopped, message: stopped ? 'Daemon stopped' : 'Daemon not running' }
  }

  async _ensureDaemon(): Promise<boolean> {
    const pid = this._getLiveDaemonPid()
    if (pid) return true

    const result = await this._startDaemon()
    if (!result.success) appendDaemonLog(result.message)
    return !!(result.success && result.pid)
  }

  getAllStatus(): unknown {
    const now = Date.now()
    if (this._statusCache.value && now - this._statusCache.at < 1000) {
      return this._statusCache.value
    }
    let value: unknown = {}
    if (this._getLiveDaemonPid()) {
      const getDaemonStatus = this._connector!.getDaemonStatus as () => unknown
      try { value = getDaemonStatus.call(this._connector) } catch { value = {} }
    }
    this._statusCache = { value, at: now }
    return value
  }

  getLogs(name: string, lines = 200): unknown {
    const getLogs = this._connector!.getLogs as (name: string, lines: number) => string[]
    const logLines = getLogs.call(this._connector, name, lines)
    return { lines: logLines }
  }

  tailLogs(name: string, lines = 200, offset = 0): unknown {
    const config = this._connector!.config as Record<string, unknown>
    const tailLogs = config.tailLogs as (opts: unknown) => unknown
    return tailLogs.call(config, { agent: name || undefined, lines, offset })
  }

  clearLogsInRange(start: string | number | Date, end: string | number | Date): unknown {
    const startTime = normalizeTimeValue(start)
    const endTime = normalizeTimeValue(end)

    if (!startTime || !endTime) {
      throw new Error('Start time and end time are required')
    }
    if (startTime.getTime() > endTime.getTime()) {
      throw new Error('Start time must be before end time')
    }

    const logFile = path.join(CONFIG_DIR, 'daemon.log')
    if (!fs.existsSync(logFile)) return { removed: 0, remaining: 0 }

    const content = fs.readFileSync(logFile, 'utf-8')
    const hasTrailingNewline = content.endsWith('\n')
    const allLines = content.split('\n')
    if (hasTrailingNewline) allLines.pop()

    const { keptLines, removed } = filterLogsByTimeRange(allLines, startTime, endTime)

    const nextContent = keptLines.join('\n') + (hasTrailingNewline && keptLines.length > 0 ? '\n' : '')
    const tempFile = `${logFile}.tmp`
    fs.writeFileSync(tempFile, nextContent, 'utf-8')
    fs.renameSync(tempFile, logFile)

    return { removed, remaining: keptLines.length }
  }

  healthCheck(type: string): unknown {
    const healthCheck = this._connector!.healthCheck as (type: string) => unknown
    return healthCheck.call(this._connector, type)
  }

  /**
   * Daemon liveness from the launcher's perspective, independent of whether
   * any agents are configured. Used by the sidebar status dot — relying on
   * agent state means "no agents" looks identical to "daemon dead", which
   * makes the launcher feel broken on first run / after every install
   * failure.
   */
  getDaemonState(): { state: 'online' | 'starting' | 'offline'; pid: number | null } {
    const pid = this._getLiveDaemonPid()
    if (pid) return { state: 'online', pid }

    // Pid file present but failing the freshness checks in _getLiveDaemonPid
    // (typically during the first few seconds after spawn) — surface as
    // "starting" so the dot doesn't flicker between offline and online.
    try {
      const raw = fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim()
      const candidatePid = parseInt(raw, 10)
      if (Number.isFinite(candidatePid) && isPidAlive(candidatePid)) {
        const age = Date.now() - fs.statSync(DAEMON_PID_FILE).mtimeMs
        if (age < 15_000) return { state: 'starting', pid: candidatePid }
      }
    } catch {}
    return { state: 'offline', pid: null }
  }

  private _getLiveDaemonPid(): number | null {
    try {
      const getDaemonPid = this._connector?.getDaemonPid as (() => number | null) | undefined
      const pid = getDaemonPid ? getDaemonPid.call(this._connector) : null
      if (!pid) return null

      const pidFileAge = (() => {
        try { return Date.now() - fs.statSync(DAEMON_PID_FILE).mtimeMs } catch { return Number.POSITIVE_INFINITY }
      })()
      const statusInfo = (() => {
        try {
          const stat = fs.statSync(DAEMON_STATUS_FILE)
          const raw = JSON.parse(fs.readFileSync(DAEMON_STATUS_FILE, 'utf-8')) as { pid?: number }
          return { pid: raw.pid || null, age: Date.now() - stat.mtimeMs }
        } catch { return { pid: null, age: Number.POSITIVE_INFINITY } }
      })()

      // A live PID alone is not enough on Windows because stale PIDs can be
      // reused by unrelated processes. The daemon writes status every 5s; once
      // the pid file is older than the startup grace period, require matching
      // fresh status as proof that this is really our daemon.
      const startupGraceMs = 15_000
      const statusFreshMs = 20_000
      const hasFreshMatchingStatus = statusInfo.pid === pid && statusInfo.age < statusFreshMs
      if (isPidAlive(pid) && (pidFileAge < startupGraceMs || hasFreshMatchingStatus)) return pid

      appendDaemonLog(`removing stale daemon pid ${pid}`)
      for (const file of [DAEMON_PID_FILE, DAEMON_STATUS_FILE, DAEMON_CMD_FILE]) {
        try { fs.unlinkSync(file) } catch {}
      }
      this._statusCache = { value: {}, at: 0 }
      return null
    } catch {
      return null
    }
  }

  private _startDaemon(): { success: boolean; pid?: number; message: string } {
    try {
      const stopDaemon = this._connector!.stopDaemon as () => void
      stopDaemon.call(this._connector)
    } catch {}

    const { spawn } = require('child_process')
    const portableNodeDir = path.join(os.homedir(), '.openagents', 'nodejs')
    const openagentsDir = path.join(os.homedir(), '.openagents')

    const extraDirs = [
      portableNodeDir,
      path.join(portableNodeDir, 'bin'),
    ]
    const runtimesDir = path.join(openagentsDir, 'runtimes')
    try {
      for (const d of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
        if (d.isDirectory()) extraDirs.push(path.join(runtimesDir, d.name, 'node_modules', '.bin'))
      }
    } catch {}
    extraDirs.push(path.join(openagentsDir, 'core', 'node_modules', '.bin'))
    extraDirs.push(path.join(portableNodeDir, 'node_modules', '.bin'))
    if (process.platform === 'win32') {
      extraDirs.push(path.join(process.env.APPDATA || '', 'npm'))
      try {
        const { execSync: _exec } = require('child_process')
        const npmPrefix = _exec('npm config get prefix', {
          encoding: 'utf-8', timeout: 5000, windowsHide: true,
        }).trim()
        if (npmPrefix && !extraDirs.includes(npmPrefix)) extraDirs.push(npmPrefix)
      } catch {}
    }
    const enhancedPath = [...extraDirs, process.env.PATH || ''].join(path.delimiter)

    let cliPath: string | null = null
    const cliCandidates = [
      path.join(LOCAL_CORE, 'bin', 'agent-connector.js'),
      path.join(portableNodeDir, 'node_modules', '@openagents-org', 'agent-launcher', 'bin', 'agent-connector.js'),
    ]
    for (const c of cliCandidates) {
      try { if (fs.existsSync(c)) { cliPath = c; break } } catch {}
    }
    if (!cliPath) {
      appendDaemonLog(`agent-launcher CLI not found; checked ${cliCandidates.join(', ')}`)
      return { success: false, message: 'agent-launcher CLI not found. Install an agent first via the Install tab.' }
    }

    // Pick a node binary that actually launches. The bundled portable
    // node.exe is preferred when usable, but on some Windows machines it's
    // blocked by Defender / SmartScreen and CreateProcess fails — in that
    // case fall back to system node so the daemon can still start.
    const nodeBin = resolveWorkingNode(portableNodeDir, enhancedPath)
    if (!nodeBin) {
      appendDaemonLog(`cannot start daemon: no usable node binary found (portable=${portableNodeDir})`)
      return { success: false, message: 'No usable node binary found. Reinstall Node.js or repair the bundled runtime in Settings.' }
    }

    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      const logFd = fs.openSync(DAEMON_LOG_FILE, 'a')
      appendDaemonLog(`starting daemon: node="${nodeBin}" cli="${cliPath}"`)

      const proc = spawn(nodeBin, [cliPath, 'up', '--foreground'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PATH: enhancedPath },
        windowsHide: true,
      })
      proc.once('error', (err: Error) => {
        appendDaemonLog(`daemon spawn error: ${err.message}`)
      })
      proc.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        appendDaemonLog(`daemon process exited early: code=${code ?? 'null'} signal=${signal ?? 'null'}`)
      })
      proc.unref()
      fs.writeFileSync(DAEMON_PID_FILE, String(proc.pid), 'utf-8')
      fs.closeSync(logFd)

      return { success: true, pid: proc.pid, message: `Daemon started (PID ${proc.pid})` }
    } catch (e: unknown) {
      return { success: false, message: `Failed to start daemon: ${(e as Error).message}` }
    }
  }
}

class Installer {
  static platformKey(): 'macos' | 'linux' | 'windows' {
    if (process.platform === 'darwin') return 'macos'
    if (process.platform === 'win32') return 'windows'
    return 'linux'
  }
}

function fetchNpmInfo(pkg: string): Promise<NpmRegistryInfo> {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(pkg).replace('%40', '@')}`
    const req = https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchNpmInfo(res.headers.location as string).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let data = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { resolve(JSON.parse(data) as NpmRegistryInfo) }
        catch (e) { reject(e as Error) }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => req.destroy(new Error('npm registry timeout')))
  })
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return y - x
  }
  return 0
}

// Semver pre-release identifier — anything after a hyphen (`-beta.1`, `-rc.2`,
// `-canary.123`). Plain releases match /^\d+\.\d+\.\d+$/ with no hyphen.
function isPreRelease(version: string): boolean {
  return version.includes('-')
}

// Versions published to npm, sorted highest-first. Stable-only by default —
// previously this returned every published version including betas, which
// made the marketplace surface a beta as "latest" even though `npm install
// <pkg>` only fetches dist-tags.latest. After installing the actual newest
// stable, the card would still claim an update was available because it was
// comparing against the beta. Pass includePreRelease for the changelog
// listing where surfacing betas is useful.
function sortedPublishedVersions(info: NpmRegistryInfo | null, opts: { includePreRelease?: boolean } = {}): string[] {
  return Object.keys(info?.versions || {})
    .filter((v) => /^\d/.test(v))
    .filter((v) => opts.includePreRelease ? true : !isPreRelease(v))
    .sort(compareVersionsDesc)
}

function resolveLatestVersion(info: NpmRegistryInfo | null): string | null {
  // dist-tags.latest is the source of truth for what `npm install <pkg>`
  // installs. Use it whenever it's published; only fall back to scanning the
  // versions map for packages that don't publish a `latest` tag.
  const tagged = info?.['dist-tags']?.latest
  if (tagged) return tagged
  return sortedPublishedVersions(info)[0] || null
}

function normalizeTimeValue(value: string | number | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function filterLogsByTimeRange(lines: string[], start: Date, end: Date): { keptLines: string[]; removed: number } {
  const headerTimes = resolveLogHeaderTimestamps(lines, end)
  let activeRemove = false
  let removed = 0
  const keptLines: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const headerTime = headerTimes[index]
    if (headerTime) {
      const time = headerTime.getTime()
      activeRemove = time >= start.getTime() && time <= end.getTime()
    }
    if (activeRemove) {
      removed++
    } else {
      keptLines.push(lines[index])
    }
  }

  return { keptLines, removed }
}

function resolveLogHeaderTimestamps(lines: string[], referenceTime: Date): (Date | null)[] {
  const resolved: (Date | null)[] = new Array(lines.length).fill(null)
  let currentDay = startOfLocalDay(referenceTime)
  let lastClockSeconds: number | null = null

  for (let index = lines.length - 1; index >= 0; index--) {
    const token = parseLogTimestampToken(lines[index])
    if (!token) continue

    if (token.kind === 'iso') {
      resolved[index] = token.date
      currentDay = startOfLocalDay(token.date)
      lastClockSeconds = (
        token.date.getHours() * 3600 +
        token.date.getMinutes() * 60 +
        token.date.getSeconds()
      )
      continue
    }

    if (lastClockSeconds !== null && token.seconds > lastClockSeconds) {
      currentDay = addLocalDays(currentDay, -1)
    }

    resolved[index] = withLocalClock(currentDay, token.seconds)
    lastClockSeconds = token.seconds
  }

  return resolved
}

function parseLogTimestampToken(line: string): { kind: 'iso'; date: Date } | { kind: 'clock'; seconds: number } | null {
  if (!line) return null

  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))/)
  if (isoMatch) {
    const date = new Date(isoMatch[1])
    if (!Number.isNaN(date.getTime())) return { kind: 'iso', date }
  }

  const clockMatch = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/)
  if (clockMatch) {
    return {
      kind: 'clock',
      seconds: Number(clockMatch[1]) * 3600 + Number(clockMatch[2]) * 60 + Number(clockMatch[3]),
    }
  }

  return null
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function withLocalClock(day: Date, seconds: number): Date {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, secs)
}
