import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execSync, execFile } from 'child_process'
import { Store } from './store'
import { AgentManager } from './agent-manager'

function execFileAsync(file: string, args: string[], opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: opts.timeout || 10000, env: opts.env, encoding: 'utf-8' }, (err, stdout) => {
      if (err) reject(err)
      else resolve((stdout || '').toString().trim())
    })
  })
}

app.setName('OpenAgents Launcher')

const isHeadless = process.argv.includes('--headless')
if (process.argv.includes('--disable-gpu') || isHeadless) {
  app.disableHardwareAcceleration()
}

const PORTABLE_NODE_DIR = path.join(os.homedir(), '.openagents', 'nodejs')
const GLOBAL_MODULES = path.join(PORTABLE_NODE_DIR, 'node_modules')
const CORE_PKG = '@openagents-org/agent-launcher'

if (fs.existsSync(GLOBAL_MODULES) && !require('module').globalPaths.includes(GLOBAL_MODULES)) {
  require('module').globalPaths.push(GLOBAL_MODULES)
}

const store = new Store()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let agentManager: AgentManager | null = null
let coreVersion: string | null = null

let _launcherVersionCache: string | null = null
function getLauncherVersion(): string {
  if (_launcherVersionCache) return _launcherVersionCache
  try { _launcherVersionCache = require('../../package.json').version as string } catch { _launcherVersionCache = '0.0.0' }
  return _launcherVersionCache!
}

interface RuntimeInfo { nodeVersion: string | null; npmVersion: string | null; coreVersion: string | null; latestVersion: string | null }
const _runtimeCache: { value: RuntimeInfo; stableAt: number; latestAt: number; refreshing: boolean } = {
  value: { nodeVersion: null, npmVersion: null, coreVersion: null, latestVersion: null },
  stableAt: 0,
  latestAt: 0,
  refreshing: false,
}
const RUNTIME_STABLE_TTL = 60_000 * 30
const RUNTIME_LATEST_TTL = 60_000 * 10

const STARTUP_LOG = path.join(os.homedir(), '.openagents', 'startup.log')
function slog(msg: string): void {
  try {
    fs.mkdirSync(path.dirname(STARTUP_LOG), { recursive: true })
    fs.appendFileSync(STARTUP_LOG, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
  console.log('[startup]', msg)
}

function downloadFile(https: typeof import('https'), url: string, destPath: string, onProgress: ((pct: number, detail: string) => void) | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string): void => {
      https.get(u, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          doGet(res.headers.location as string)
          return
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
        const total = parseInt(res.headers['content-length'] || '0')
        let downloaded = 0
        const file = fs.createWriteStream(destPath)
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          file.write(chunk)
          if (total && onProgress) onProgress(Math.round(downloaded / total * 100), `${(downloaded / 1e6).toFixed(1)} MB`)
        })
        res.on('end', () => { file.end(resolve) })
        res.on('error', reject)
      }).on('error', reject)
    }
    doGet(url)
  })
}

async function downloadNodejs(nodejsDir: string, onProgress: (pct: number, detail: string) => void): Promise<void> {
  const https = require('https')
  const nodeVersion = 'v22.14.0'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

  try { fs.rmSync(nodejsDir, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(nodejsDir, { recursive: true })
  slog(`downloadNodejs: platform=${process.platform} arch=${arch} dir=${nodejsDir}`)

  if (process.platform === 'win32') {
    const nodeExeUrl = `https://nodejs.org/dist/${nodeVersion}/win-${arch}/node.exe`
    const nodeExeDest = path.join(nodejsDir, 'node.exe')
    await downloadFile(https, nodeExeUrl, nodeExeDest, onProgress)

    const npmVersion = '10.9.2'
    const npmUrl = `https://registry.npmjs.org/npm/-/npm-${npmVersion}.tgz`
    const npmTgz = path.join(os.tmpdir(), `npm-${npmVersion}.tgz`)
    const npmModDir = path.join(nodejsDir, 'node_modules', 'npm')
    if (onProgress) onProgress(85, 'Installing npm...')
    await downloadFile(https, npmUrl, npmTgz, null)

    fs.mkdirSync(npmModDir, { recursive: true })
    try {
      execSync(`tar -xzf "${npmTgz}" -C "${npmModDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' })
    } catch (e: unknown) {
      slog(`npm extraction failed: ${(e as Error).message}`)
    }
    try { fs.unlinkSync(npmTgz) } catch {}

    const npmCliPath = path.join(npmModDir, 'bin', 'npm-cli.js')
    if (fs.existsSync(npmCliPath)) {
      fs.writeFileSync(path.join(nodejsDir, 'npm.cmd'), `@echo off\r\n"${nodeExeDest}" "${npmCliPath}" %*\r\n`)
      fs.writeFileSync(path.join(nodejsDir, 'npx.cmd'), `@echo off\r\n"${nodeExeDest}" "${path.join(npmModDir, 'bin', 'npx-cli.js')}" %*\r\n`)
    }
  } else {
    const platName = process.platform === 'darwin' ? 'darwin' : 'linux'
    const ext = process.platform === 'darwin' ? 'tar.gz' : 'tar.xz'
    const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-${platName}-${arch}.${ext}`
    const tarPath = path.join(os.tmpdir(), `node-${nodeVersion}.${ext}`)

    await downloadFile(https, url, tarPath, onProgress)
    if (onProgress) onProgress(90, 'Extracting...')
    const flag = ext === 'tar.gz' ? '-xzf' : '-xJf'
    execSync(`tar ${flag} "${tarPath}" -C "${nodejsDir}" --strip-components=1`, { timeout: 120000 })
    try { fs.unlinkSync(tarPath) } catch {}

    const binDir = path.join(nodejsDir, 'bin')
    for (const name of ['node', 'npm', 'npx']) {
      const src = path.join(binDir, name)
      const dest = path.join(nodejsDir, name)
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try { fs.symlinkSync(src, dest) } catch {}
      }
    }
  }
  if (onProgress) onProgress(100, 'Done')
}

function findNpmCommand(): string | null {
  const nodeUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node')
  const nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'node')
  if (!fs.existsSync(nodeBin)) return null
  const candidates = [
    path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(PORTABLE_NODE_DIR, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  const npmCli = candidates.find(p => fs.existsSync(p))
  if (npmCli) return `"${nodeBin}" "${npmCli}"`
  if (process.platform !== 'win32') {
    const npmBin = path.join(PORTABLE_NODE_DIR, 'bin', 'npm')
    if (fs.existsSync(npmBin)) return `"${npmBin}"`
  }
  return null
}

function _addToPrefixPackageJson(pkg: string, version: string): void {
  const pkgJsonPath = path.join(PORTABLE_NODE_DIR, 'package.json')
  let data: { dependencies?: Record<string, string> } = {}
  try { data = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) } catch {}
  if (!data.dependencies) data.dependencies = {}
  data.dependencies[pkg] = version
  try { fs.writeFileSync(pkgJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8') } catch {}
}

let _updateSplash: ((msg: string, pct: number, detail?: string) => void) | null = null

async function ensureCoreLibrary(): Promise<void> {
  const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, 'package.json')
  let installedVersion: string | null = null

  if (fs.existsSync(corePkgPath)) {
    try { installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version } catch {}
  }

  const https = require('https')
  try {
    const latestVersion: string = await new Promise((res, rej) => {
      https.get(`https://registry.npmjs.org/${CORE_PKG}/latest`, (r: import('http').IncomingMessage) => {
        let d = ''
        r.on('data', (c: Buffer) => d += c)
        r.on('end', () => { try { res(JSON.parse(d).version) } catch { rej(new Error('parse error')) } })
      }).on('error', rej)
    })

    if (!installedVersion) {
      slog('Core library not found — installing v' + latestVersion + '...')
      if (_updateSplash) _updateSplash('Installing core library...', 65, 'v' + latestVersion)
    } else if (latestVersion !== installedVersion) {
      slog('Core library update: v' + installedVersion + ' → v' + latestVersion)
      if (_updateSplash) _updateSplash('Updating core library...', 65, 'v' + installedVersion + ' → v' + latestVersion)
    } else {
      slog('Core library v' + installedVersion + ' (already latest)')
      if (_updateSplash) _updateSplash('Core library up to date', 80, 'v' + installedVersion)
    }

    if (!installedVersion || latestVersion !== installedVersion) {
      const tgzUrl = `https://registry.npmjs.org/${CORE_PKG}/-/agent-launcher-${latestVersion}.tgz`
      const tgzPath = path.join(os.tmpdir(), `agent-launcher-${latestVersion}.tgz`)
      const destDir = path.join(GLOBAL_MODULES, CORE_PKG)

      await downloadFile(https, tgzUrl, tgzPath, null)
      try { fs.rmSync(destDir, { recursive: true, force: true }) } catch {}
      fs.mkdirSync(destDir, { recursive: true })
      execSync(`tar -xzf "${tgzPath}" -C "${destDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' })
      try { fs.unlinkSync(tgzPath) } catch {}

      const newVersion = (() => { try { return JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version } catch { return null } })()
      if (newVersion) {
        slog('Core library installed: v' + newVersion)
        if (_updateSplash) _updateSplash('Core library ready', 80, 'v' + newVersion)
        installedVersion = newVersion
        _addToPrefixPackageJson(CORE_PKG, newVersion)
      }
    }
  } catch (e: unknown) {
    slog('Core update failed: ' + (e as Error).message)
    if (!installedVersion) {
      slog('Falling back to npm...')
      const npmCmd = findNpmCommand()
      if (npmCmd) {
        try {
          execSync(`${npmCmd} install --prefix "${PORTABLE_NODE_DIR}" ${CORE_PKG}@latest --ignore-scripts`, {
            stdio: 'pipe', timeout: 120000,
            env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
          })
          try { installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version } catch {}
        } catch {}
      }
    }
  }

  coreVersion = installedVersion

  const npmCheck = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!fs.existsSync(npmCheck)) {
    slog('npm was removed by --prefix install — reinstalling...')
    try {
      const npmTgz = path.join(os.tmpdir(), 'npm-reinstall.tgz')
      const npmDir = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm')
      await downloadFile(https, 'https://registry.npmjs.org/npm/-/npm-10.9.2.tgz', npmTgz, null)
      fs.mkdirSync(npmDir, { recursive: true })
      execSync(`tar -xzf "${npmTgz}" -C "${npmDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' })
      try { fs.unlinkSync(npmTgz) } catch {}
      slog('npm reinstalled')
    } catch (e: unknown) {
      slog('npm reinstall failed: ' + (e as Error).message)
    }
  }

  if (installedVersion && agentManager) {
    agentManager.reloadCore()
  }
}

async function checkCoreUpdate(): Promise<void> {
  const npmCmd = findNpmCommand()
  if (!npmCmd) return
  try {
    const latest = execSync(`${npmCmd} view ${CORE_PKG} version`, {
      encoding: 'utf-8', timeout: 15000,
      env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
    }).trim()

    if (coreVersion && latest && latest !== coreVersion) {
      if (mainWindow) {
        mainWindow.webContents.send('core-update-available', { current: coreVersion, latest })
      }
    }
  } catch {}
}

function createWindow(): void {
  if (mainWindow) {
    if (process.platform === 'darwin' && app.dock) app.dock.show()
    mainWindow.show()
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: 'OpenAgents Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (process.platform === 'darwin' && app.dock) app.dock.show()
    mainWindow!.show()
  })

  mainWindow.on('close', (e) => {
    if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) {
      e.preventDefault()
      mainWindow!.hide()
      if (process.platform === 'darwin' && app.dock) app.dock.hide()
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function createPlaceholderIcon(): Electron.NativeImage {
  const size = 16
  const canvas = Buffer.alloc(size * size * 4)
  const cx = 7.5, cy = 7.5, r = 7, ri = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      if (d <= r) {
        if (d <= ri) {
          canvas[i] = 0xFF; canvas[i + 1] = 0xFF; canvas[i + 2] = 0xFF; canvas[i + 3] = 0xFF
        } else {
          canvas[i] = 0x6C; canvas[i + 1] = 0x63; canvas[i + 2] = 0xFF; canvas[i + 3] = 0xFF
        }
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

function createTray(): void {
  const assetsDir = path.join(__dirname, '../../assets')
  let trayIcon: Electron.NativeImage

  if (process.platform === 'darwin') {
    trayIcon = nativeImage.createFromPath(path.join(assetsDir, 'tray-iconTemplate.png'))
  } else {
    trayIcon = nativeImage.createFromPath(path.join(assetsDir, 'tray-icon.png'))
  }

  if (!trayIcon || trayIcon.isEmpty()) trayIcon = createPlaceholderIcon()

  tray = new Tray(trayIcon)
  tray.setToolTip('OpenAgents Launcher')
  updateTrayMenu()
  tray.on('click', () => createWindow())
}

let _pendingAgentUpdates: Array<{ name: string; current: string | null; latest: string | null }> = []

function updateTrayMenu(): void {
  if (!tray) return

  const agents = agentManager ? agentManager.getAgents() as Array<{ name: string; state: string }> : []
  const agentItems = agents.length > 0
    ? agents.map(a => ({ label: `${a.name} (${a.state})`, enabled: false }))
    : [{ label: 'No agents configured', enabled: false }]

  const updateItems: Electron.MenuItemConstructorOptions[] = _pendingAgentUpdates.length > 0
    ? [
        { type: 'separator' },
        { label: `Updates available (${_pendingAgentUpdates.length})`, enabled: false },
        ..._pendingAgentUpdates.slice(0, 5).map((u): Electron.MenuItemConstructorOptions => ({
          label: `${u.name}: v${u.current ?? '?'} → v${u.latest ?? '?'}`,
          click: () => {
            createWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('navigate-to-install', u.name)
            }
          },
        })),
      ]
    : []

  const menu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => createWindow() },
    { type: 'separator' },
    ...agentItems,
    ...updateItems,
    { type: 'separator' },
    {
      label: 'Quit OpenAgents',
      click: async () => {
        const { dialog } = require('electron')
        const result = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Quit', 'Cancel'],
          defaultId: 1,
          title: 'Quit OpenAgents Launcher',
          message: 'Quit OpenAgents Launcher?',
          detail: 'The daemon will stop and all connected agents will go offline.',
        })
        if (result.response === 0) {
          (app as typeof app & { isQuitting: boolean }).isQuitting = true
          try { if (agentManager) await agentManager.stopAll() } catch {}
          app.quit()
        }
      },
    },
  ])

  tray.setContextMenu(menu)
  if (_pendingAgentUpdates.length > 0) {
    tray.setToolTip(`OpenAgents Launcher · ${_pendingAgentUpdates.length} update${_pendingAgentUpdates.length > 1 ? 's' : ''} available`)
  } else {
    tray.setToolTip('OpenAgents Launcher')
  }
}

async function refreshAgentUpdates(): Promise<void> {
  if (!agentManager) return
  try {
    const all = await agentManager.checkAgentUpdates({ force: true })
    _pendingAgentUpdates = all.filter((u) => u.current && u.latest && u.current !== u.latest)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-updates-changed', _pendingAgentUpdates)
    }
    updateTrayMenu()
  } catch {}
}

type InstallPhase = 'idle' | 'preparing' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
type InstallVerb = 'install' | 'update' | 'uninstall' | 'rollback'

function broadcastInstallProgress(payload: {
  agent: string
  verb: InstallVerb
  phase: InstallPhase
  detail?: string
  log?: string
  error?: string
}): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('install:progress', payload)
  }
}

function classifyInstallChunk(chunk: string, verb: InstallVerb): { phase?: InstallPhase; detail?: string } {
  const line = chunk.toLowerCase()
  if (verb === 'uninstall') {
    if (line.includes('removed') || line.includes('uninstall')) return { phase: 'installing', detail: 'Removing files' }
    if (line.includes('done!')) return { phase: 'verifying', detail: 'Cleaning shims' }
    return {}
  }
  if (line.includes('downloading') || /\b\d+\s*%/.test(line) || line.includes('mb')) {
    return { phase: 'downloading', detail: chunk.trim().slice(0, 80) }
  }
  if (line.includes('extracting') || line.includes('expanding')) {
    return { phase: 'installing', detail: 'Extracting archive' }
  }
  if (line.includes('npm warn') || line.includes('npm http')) {
    return { phase: 'installing' }
  }
  if (line.includes('added ') && line.includes('package')) {
    return { phase: 'verifying', detail: chunk.trim().slice(0, 80) }
  }
  if (line.includes('done!') || line.includes('installed.')) {
    return { phase: 'verifying', detail: 'Finalizing' }
  }
  return {}
}

async function runInstallWithPhases<T>(
  agent: string,
  verb: InstallVerb,
  runner: (onData: (data: string) => void) => Promise<T>,
): Promise<T> {
  let currentPhase: InstallPhase = 'preparing'
  broadcastInstallProgress({ agent, verb, phase: 'preparing', detail: 'Resolving dependencies' })

  const onData = (data: string): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('install:output', data)
    const { phase, detail } = classifyInstallChunk(data, verb)
    if (phase && phase !== currentPhase) {
      currentPhase = phase
      broadcastInstallProgress({ agent, verb, phase, detail })
    } else if (detail) {
      broadcastInstallProgress({ agent, verb, phase: currentPhase, detail })
    }
  }

  try {
    const result = await runner(onData)
    broadcastInstallProgress({ agent, verb, phase: 'done', detail: 'Complete' })
    return result
  } catch (e: unknown) {
    broadcastInstallProgress({ agent, verb, phase: 'error', error: (e as Error).message })
    throw e
  }
}

function resolveNpmInvocation(): { node: string; args: string[] } | null {
  const nodeUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node')
  const nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'node')
  if (!fs.existsSync(nodeBin)) return null
  const candidates = [
    path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(PORTABLE_NODE_DIR, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  const npmCli = candidates.find(p => fs.existsSync(p))
  if (npmCli) return { node: nodeBin, args: [npmCli] }
  if (process.platform !== 'win32') {
    const npmBin = path.join(PORTABLE_NODE_DIR, 'bin', 'npm')
    if (fs.existsSync(npmBin)) return { node: npmBin, args: [] }
  }
  return null
}

async function refreshRuntimeInfo(force = false): Promise<RuntimeInfo> {
  const now = Date.now()
  const info = _runtimeCache.value
  info.coreVersion = coreVersion || info.coreVersion || null

  if (_runtimeCache.refreshing) return info
  const needStable = force || !info.nodeVersion || !info.npmVersion || (now - _runtimeCache.stableAt > RUNTIME_STABLE_TTL)
  const needLatest = force || !info.latestVersion || (now - _runtimeCache.latestAt > RUNTIME_LATEST_TTL)
  if (!needStable && !needLatest) return info

  _runtimeCache.refreshing = true
  try {
    const env = { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') }
    const npm = resolveNpmInvocation()

    if (needStable) {
      const nodeUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node')
      const nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'node')
      if (fs.existsSync(nodeBin)) {
        try { info.nodeVersion = await execFileAsync(nodeBin, ['--version'], { timeout: 5000 }) } catch {}
      }
      if (npm) {
        try {
          info.npmVersion = await execFileAsync(npm.node, [...npm.args, '--version'], { timeout: 5000, env })
        } catch {}
      }
      _runtimeCache.stableAt = now
    }

    if (needLatest) {
      if (npm) {
        try {
          info.latestVersion = await execFileAsync(npm.node, [...npm.args, 'view', CORE_PKG, 'version'], { timeout: 10_000, env })
        } catch {}
      }
      _runtimeCache.latestAt = now
    }
  } finally {
    _runtimeCache.refreshing = false
  }
  return info
}

function setupIPC(): void {
  ipcMain.handle('python:status', () => ({
    pythonPath: null,
    pythonFound: true,
    sdkInstalled: true,
    sdkVersion: coreVersion || 'not installed',
    launcherVersion: getLauncherVersion(),
    runtime: 'node',
  }))
  ipcMain.handle('python:install', () => ({ success: true, message: 'No installation needed — using Node.js agent-connector' }))

  ipcMain.handle('runtime:info', async (_e, opts?: { force?: boolean }) => {
    const force = !!(opts && opts.force)
    const info = _runtimeCache.value
    const needStable = force || !info.nodeVersion || !info.npmVersion
    if (needStable && !_runtimeCache.refreshing) {
      _runtimeCache.refreshing = true
      try {
        const env = { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') }
        const npm = resolveNpmInvocation()
        const nodeUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node')
        const nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'node')
        if (fs.existsSync(nodeBin)) {
          try { info.nodeVersion = await execFileAsync(nodeBin, ['--version'], { timeout: 5000 }) } catch {}
        }
        if (npm) {
          try { info.npmVersion = await execFileAsync(npm.node, [...npm.args, '--version'], { timeout: 5000, env }) } catch {}
        }
        _runtimeCache.stableAt = Date.now()
      } finally {
        _runtimeCache.refreshing = false
      }
    }
    info.coreVersion = coreVersion || info.coreVersion || null
    const needLatest = force || !info.latestVersion || (Date.now() - _runtimeCache.latestAt > RUNTIME_LATEST_TTL)
    if (needLatest) {
      // Don't block IPC on the network call. Refresh in background.
      void refreshRuntimeInfo(force).catch(() => {})
    }
    return { ...info }
  })

  const requireManager = (): AgentManager => {
    if (!agentManager) throw new Error('Launcher is still initializing, please wait a moment')
    return agentManager
  }

  ipcMain.handle('agents:list', () => agentManager ? agentManager.getAgents() : [])
  ipcMain.handle('agents:supported-types', () => agentManager ? agentManager.getSupportedAgentTypes() : [])
  ipcMain.handle('agents:core-info', () => agentManager ? agentManager.getCoreInfo() : { version: null, supportedTypes: [], globalCorePresent: false })
  ipcMain.handle('agents:add', (_e, config) => requireManager().addAgent(config))
  ipcMain.handle('agents:remove', (_e, name) => requireManager().removeAgent(name))
  ipcMain.handle('agents:update', (_e, name, config) => requireManager().updateAgent(name, config))

  ipcMain.handle('agents:start', (_e, name) => requireManager().startAgent(name))
  ipcMain.handle('agents:stop', (_e, name) => requireManager().stopAgent(name))
  ipcMain.handle('agents:start-all', () => requireManager().startAll())
  ipcMain.handle('agents:stop-all', () => requireManager().stopAll())
  ipcMain.handle('agents:status', () => agentManager ? agentManager.getAllStatus() : {})
  ipcMain.handle('agents:daemon-status', () => {
    if (!agentManager) return { state: 'starting', pid: null }
    try { return agentManager.getDaemonState() } catch { return { state: 'offline', pid: null } }
  })
  ipcMain.handle('agents:logs', (_e, name, lines) => requireManager().getLogs(name, lines))
  ipcMain.handle('agents:tail-logs', (_e, name, lines, offset) => {
    if (!agentManager) return { lines: [], size: 0 }
    try { return agentManager.tailLogs(name, lines, offset) } catch { return { lines: [], size: 0 } }
  })
  ipcMain.handle('agents:clear-logs-range', (_e, start, end) => requireManager().clearLogsInRange(start, end))

  ipcMain.handle('agents:install-type', (_e, agentType) => requireManager().installAgentType(agentType))
  ipcMain.handle('agents:install-type-streaming', async (_e, agentType) => {
    const verb = agentManager?.getInstalledVersion(agentType) ? 'update' : 'install'
    const result = await runInstallWithPhases(agentType, verb, (cb) =>
      requireManager().installAgentTypeStreaming(agentType, cb),
    )
    // installAgentTypeStreaming clears the updates cache. Re-fetch now so
    // the next `checkAgentUpdates()` call (from the post-job refresh) gets
    // fresh data instead of an empty cache — otherwise a just-updated agent
    // could keep showing "Update available" because the renderer overrides
    // its store with the empty list before the hourly background refresh.
    refreshAgentUpdates().catch(() => {})
    return result
  })
  ipcMain.handle('agents:uninstall-type', (_e, agentType) => requireManager().uninstallAgentType(agentType))
  ipcMain.handle('agents:uninstall-type-streaming', async (_e, agentType) => {
    const result = await runInstallWithPhases(agentType, 'uninstall', (cb) =>
      requireManager().uninstallAgentTypeStreaming(agentType, cb),
    )
    refreshAgentUpdates().catch(() => {})
    return result
  })

  ipcMain.handle('agents:installed-list', () => agentManager ? agentManager.listInstalledAgents() : [])
  ipcMain.handle('agents:check-updates', async () => {
    if (!agentManager) return []
    try { return await agentManager.checkAgentUpdates() } catch { return [] }
  })
  ipcMain.handle('agents:rollback', async (_e, agentType) => {
    if (!agentManager) return { success: false, error: 'Launcher initializing' }
    const result = await runInstallWithPhases(agentType, 'rollback', (cb) =>
      agentManager!.rollbackAgentType(agentType, cb),
    )
    refreshAgentUpdates().catch(() => {})
    return result
  })
  ipcMain.handle('agents:changelog', async (_e, agentType) => {
    if (!agentManager) return { versions: [], error: 'Launcher initializing' }
    try { return await agentManager.getAgentChangelog(agentType) }
    catch (e: unknown) { return { versions: [], error: (e as Error).message } }
  })
  ipcMain.handle('agents:check-type', (_e, agentType) => {
    if (!agentManager) return { installed: false, binary: null }
    try { return agentManager.checkAgentType(agentType) } catch { return { installed: false, binary: null } }
  })
  ipcMain.handle('agents:catalog', async () => {
    if (!agentManager) return []
    try {
      return await agentManager.getCatalog()
    } catch { return [] }
  })

  ipcMain.handle('agents:env-fields', (_e, agentType) => requireManager().getEnvFields(agentType))
  ipcMain.handle('agents:get-env', (_e, agentType) => requireManager().getAgentEnv(agentType))
  ipcMain.handle('agents:save-env', (_e, agentType, env) => requireManager().saveAgentEnv(agentType, env))
  ipcMain.handle('agents:get-instance-env', (_e, agentName) => requireManager().getAgentInstanceEnv(agentName))
  ipcMain.handle('agents:save-instance-env', (_e, agentName, env) => requireManager().saveAgentInstanceEnv(agentName, env))
  ipcMain.handle('agents:test-llm', (_e, env) => requireManager().testLLM(env))
  ipcMain.handle('agents:signal-reload', () => requireManager().signalReload())

  ipcMain.handle('workspace:connect', (_e, agentName, slug) => requireManager().connectWorkspace(agentName, slug))
  ipcMain.handle('workspace:disconnect', (_e, agentName) => requireManager().disconnectWorkspace(agentName))
  ipcMain.handle('workspace:remove', (_e, slug) => requireManager().removeWorkspace(slug))
  ipcMain.handle('workspace:list', () => agentManager ? agentManager.getNetworks() : [])
  ipcMain.handle('workspace:create', (_e, name) => requireManager().createWorkspace(name))

  ipcMain.handle('settings:get', (_e, key) => store.get(key))
  ipcMain.handle('settings:set', (_e, key, value) => store.set(key, value))

  ipcMain.handle('agents:health-check', (_e, type) => {
    if (!agentManager) return null
    try { return agentManager.healthCheck(type) } catch { return null }
  })

  ipcMain.handle('core:update', async () => {
    const npmUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'npm.cmd' : 'npm')
    const npmBin = fs.existsSync(npmUnified) ? npmUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'npm')
    try {
      execSync(`"${npmBin}" install --prefix "${PORTABLE_NODE_DIR}" ${CORE_PKG}@latest --ignore-scripts`, {
        stdio: 'ignore', timeout: 120000,
        env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
      })
      const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, 'package.json')
      try { coreVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version } catch {}
      if (agentManager) {
        try { await agentManager.stopAll() } catch {}
        agentManager._ensureDaemon().catch(() => {})
      }
      return { success: true, version: coreVersion }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('shell:open-external', (_e, url) => shell.openExternal(url))
  ipcMain.handle('shell:open-terminal', (_e, cmd) => {
    const { spawn } = require('child_process')
    if (process.platform === 'win32') {
      const { execSync: exec } = require('child_process')
      const home = process.env.USERPROFILE || os.homedir()
      const portableNode = path.join(home, '.openagents', 'nodejs')
      const npmBin = path.join(process.env.APPDATA || '', 'npm')
      const runtimeBins: string[] = []
      try {
        const rd = path.join(home, '.openagents', 'runtimes')
        for (const d of fs.readdirSync(rd, { withFileTypes: true })) {
          if (d.isDirectory()) runtimeBins.push(path.join(rd, d.name, 'node_modules', '.bin'))
        }
      } catch {}
      const allBins = [...runtimeBins, path.join(portableNode, 'node_modules', '.bin'), portableNode, npmBin].join(';')
      const setPath = `set PATH=${allBins};%PATH%`
      exec(`start "" cmd /K "${setPath} && ${cmd}"`, { stdio: 'ignore', shell: true })
    } else if (process.platform === 'darwin') {
      const home = os.homedir()
      const portableNode = path.join(home, '.openagents', 'nodejs')
      const portableNodeBin = path.join(portableNode, 'bin')
      const runtimeBins: string[] = []
      try {
        const rd = path.join(home, '.openagents', 'runtimes')
        for (const d of fs.readdirSync(rd, { withFileTypes: true })) {
          if (d.isDirectory()) runtimeBins.push(path.join(rd, d.name, 'node_modules', '.bin'))
        }
      } catch {}
      const allBins = [...runtimeBins, path.join(portableNode, 'node_modules', '.bin'), portableNodeBin, portableNode, '/usr/local/bin'].join(':')
      const setPath = `export PATH=${allBins}:$PATH`
      const fullCmd = `${setPath} && ${cmd}`.replace(/"/g, '\\"')
      spawn('osascript', ['-e', `tell app "Terminal" to do script "${fullCmd}"`], { detached: true, stdio: 'ignore' })
    } else {
      const terminals = ['x-terminal-emulator', 'gnome-terminal', 'xterm']
      for (const term of terminals) {
        try { spawn(term, ['-e', cmd], { detached: true, stdio: 'ignore' }); return } catch {}
      }
    }
  })
  ipcMain.handle('shell:exec', (_e, cmd) => {
    const { execSync: exec } = require('child_process')
    const sh = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : true
    return exec(cmd, { encoding: 'utf-8', timeout: 30000, shell: sh })
  })

  ipcMain.handle('icons:get-dir', () => {
    const coreIconsDir = path.join(GLOBAL_MODULES, CORE_PKG, 'icons')
    if (fs.existsSync(coreIconsDir)) return coreIconsDir
    return null
  })
  ipcMain.handle('icons:get-path', (_e, name) => {
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
    const coreIcon = path.join(GLOBAL_MODULES, CORE_PKG, 'icons', `${slug}.svg`)
    if (fs.existsSync(coreIcon)) return coreIcon
    return null
  })
  ipcMain.handle('debug:env', () => ({
    ComSpec: process.env.ComSpec,
    SystemRoot: process.env.SystemRoot,
    PATH: (process.env.PATH || '').slice(0, 500),
    platform: process.platform,
  }))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  setupIPC()
  createTray()

  const nodeExists = fs.existsSync(path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node'))
    || fs.existsSync(path.join(PORTABLE_NODE_DIR, 'bin', 'node'))

  let splash: BrowserWindow | null = null

  if (isHeadless && process.platform === 'darwin' && app.dock) app.dock.hide()

  if (!isHeadless) {
    splash = new BrowserWindow({
      width: 420, height: 260, frame: false, resizable: false, center: true,
      alwaysOnTop: true, transparent: false, skipTaskbar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    const splashHtml = `data:text/html,
      <html><body style="margin:0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:%23f5f5f7;color:%23333;">
        <div style="font-size:28px;font-weight:700;margin-bottom:8px;">OpenAgents Launcher</div>
        <div id="msg" style="font-size:14px;color:%23888;margin-bottom:20px;">${!nodeExists ? 'Preparing first launch...' : 'Starting...'}</div>
        <div style="width:240px;height:6px;background:%23e0e0e0;border-radius:3px;overflow:hidden;">
          <div id="bar" style="width:10%25;height:100%25;background:%236C63FF;border-radius:3px;transition:width 0.5s;"></div>
        </div>
        <div id="detail" style="font-size:11px;color:%23aaa;margin-top:8px;"></div>
      </body></html>`
    splash.loadURL(splashHtml)
    splash.show()
  }

  const updateSplash = (msg: string, pct: number, detail?: string): void => {
    if (splash && !splash.isDestroyed()) {
      splash.webContents.executeJavaScript(`
        document.getElementById('msg').textContent='${msg.replace(/'/g, "\\'")}';
        document.getElementById('bar').style.width='${pct}%';
        document.getElementById('detail').textContent='${(detail || '').replace(/'/g, "\\'")}';
      `).catch(() => {})
    }
  }

  if (!nodeExists) {
    slog('Node.js not found — starting download')
    updateSplash('Downloading Node.js runtime...', 20, 'This only happens once')
    try {
      await downloadNodejs(PORTABLE_NODE_DIR, (pct, detail) => {
        updateSplash('Downloading Node.js...', 20 + pct * 0.5, detail)
      })
      updateSplash('Node.js installed', 70)
    } catch (e: unknown) {
      slog(`Node.js install FAILED: ${(e as Error).message}`)
      updateSplash('Setup failed: ' + (e as Error).message, 50, 'Check ~/.openagents/startup.log')
      await new Promise(r => setTimeout(r, 5000))
    }
  } else {
    updateSplash('Starting...', 50)
  }

  const npmCliPath = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!fs.existsSync(npmCliPath)) {
    slog('npm not found — installing...')
    updateSplash('Installing npm...', 55)
    try {
      const https = require('https')
      const npmVersion = '10.9.2'
      const npmTgz = path.join(os.tmpdir(), `npm-${npmVersion}.tgz`)
      const npmModDir = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm')
      await downloadFile(https, `https://registry.npmjs.org/npm/-/npm-${npmVersion}.tgz`, npmTgz, null)
      fs.mkdirSync(npmModDir, { recursive: true })
      execSync(`tar -xzf "${npmTgz}" -C "${npmModDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' })
      try { fs.unlinkSync(npmTgz) } catch {}
      if (process.platform === 'win32') {
        const nodeExe = path.join(PORTABLE_NODE_DIR, 'node.exe')
        fs.writeFileSync(path.join(PORTABLE_NODE_DIR, 'npm.cmd'),
          `@echo off\r\n"${nodeExe}" "${path.join(npmModDir, 'bin', 'npm-cli.js')}" %*\r\n`)
      }
      slog('npm installed')
    } catch (e: unknown) {
      slog('npm install failed: ' + (e as Error).message)
    }
  }

  updateSplash('Checking for updates...', 60)
  _updateSplash = updateSplash

  if (process.platform === 'win32') {
    const pathDirs = (process.env.PATH || '').toLowerCase().split(';')
    const candidates = [
      PORTABLE_NODE_DIR,
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    ].filter(d => {
      try { return d && fs.existsSync(d) && !pathDirs.includes(d.toLowerCase()) } catch { return false }
    })
    if (candidates.length) process.env.PATH += ';' + candidates.join(';')
  } else {
    const binDir = path.join(PORTABLE_NODE_DIR, 'bin')
    if (fs.existsSync(binDir) && !(process.env.PATH || '').includes(binDir)) {
      process.env.PATH = binDir + ':' + (process.env.PATH || '')
    }
  }

  await ensureCoreLibrary()

  if (fs.existsSync(GLOBAL_MODULES) && !require('module').globalPaths.includes(GLOBAL_MODULES)) {
    require('module').globalPaths.push(GLOBAL_MODULES)
  }

  if (splash && !splash.isDestroyed()) {
    splash.webContents.executeJavaScript(`
      document.getElementById('msg').textContent='Ready!';
      document.getElementById('bar').style.width='100%';
    `).catch(() => {})
    await new Promise(r => setTimeout(r, 500))
    splash.close()
    splash = null
  }

  agentManager = new AgentManager(store)
  agentManager!._ensureDaemon().catch(() => {})

  setInterval(() => updateTrayMenu(), 5000)

  if (!isHeadless) createWindow()

  const FOUR_HOURS = 4 * 60 * 60 * 1000
  const ONE_HOUR = 60 * 60 * 1000
  setInterval(() => checkCoreUpdate().catch(() => {}), FOUR_HOURS)
  setTimeout(() => checkCoreUpdate().catch(() => {}), 30000)

  setTimeout(() => refreshAgentUpdates(), 45000)
  setInterval(() => refreshAgentUpdates(), ONE_HOUR)
})

app.on('window-all-closed', () => { /* keep running in tray */ })

app.on('activate', () => {
  if (!isHeadless) createWindow()
})

app.on('before-quit', () => {
  (app as typeof app & { isQuitting: boolean }).isQuitting = true
  try { if (agentManager) agentManager.stopAll() } catch {}
})
