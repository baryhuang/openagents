import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron';

import { IPC_CHANNELS, IPC_EVENTS } from '../shared/api';
import type { CoreUpdateInfo, DebugEnv, RuntimeInfo } from '../shared/models';
import { AgentManager } from './agent-manager';
import {
  checkCoreUpdate,
  CORE_PKG,
  downloadNodejs,
  ensureCoreLibrary,
  ensureNpm,
  GLOBAL_MODULES,
  hasCoreLibrary,
  hasPortableNode,
  pathWith,
  PORTABLE_NODE_DIR,
  registerGlobalModulesPath,
  updateProcessPath,
} from './bootstrap';
import { slog } from './logging';
import { Store } from './store';

interface AppExtended {
  isQuitting?: boolean;
}

const isHeadless = process.argv.includes('--headless');
if (process.argv.includes('--disable-gpu') || isHeadless) {
  app.disableHardwareAcceleration();
}

registerGlobalModulesPath();

const store = new Store();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let agentManager: AgentManager | null = null;
let coreVersion: string | null = null;

// ── Window ───────────────────────────────────────────────────────────────
function createWindow(): void {
  if (mainWindow) {
    if (process.platform === 'darwin' && app.dock) app.dock.show();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: 'OpenAgents Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const rendererHtml = path.resolve(__dirname, '..', '..', 'dist-renderer', 'index.html');
    mainWindow.loadFile(rendererHtml);
  }

  mainWindow.once('ready-to-show', () => {
    if (process.platform === 'darwin' && app.dock) app.dock.show();
    mainWindow?.show();
  });

  mainWindow.on('close', (e) => {
    if (!(app as AppExtended).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      if (process.platform === 'darwin' && app.dock) app.dock.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Tray ─────────────────────────────────────────────────────────────────
function createPlaceholderIcon() {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  const cx = 7.5;
  const cy = 7.5;
  const r = 7;
  const ri = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= r) {
        if (d <= ri) {
          canvas[i] = 0xff;
          canvas[i + 1] = 0xff;
          canvas[i + 2] = 0xff;
          canvas[i + 3] = 0xff;
        } else {
          canvas[i] = 0x6c;
          canvas[i + 1] = 0x63;
          canvas[i + 2] = 0xff;
          canvas[i + 3] = 0xff;
        }
      } else {
        canvas[i] = 0;
        canvas[i + 1] = 0;
        canvas[i + 2] = 0;
        canvas[i + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function createTray(): void {
  const assetsDir = path.resolve(__dirname, '..', '..', 'assets');
  const iconName = process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon.png';
  let icon = nativeImage.createFromPath(path.join(assetsDir, iconName));
  if (icon.isEmpty()) icon = createPlaceholderIcon();

  tray = new Tray(icon);
  tray.setToolTip('OpenAgents Launcher');
  updateTrayMenu();
  tray.on('click', () => createWindow());
}

function updateTrayMenu(): void {
  if (!tray) return;
  const agents = agentManager ? agentManager.getAgents() : [];
  const agentItems = agents.length
    ? agents.map((a) => ({ label: `${a.name} (${a.state})`, enabled: false }))
    : [{ label: 'No agents configured', enabled: false }];

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => createWindow() },
      { type: 'separator' },
      ...agentItems,
      { type: 'separator' },
      {
        label: 'Quit OpenAgents',
        click: async () => {
          const result = await dialog.showMessageBox({
            type: 'question',
            buttons: ['Quit', 'Cancel'],
            defaultId: 1,
            title: 'Quit OpenAgents Launcher',
            message: 'Quit OpenAgents Launcher?',
            detail: 'The daemon will stop and all connected agents will go offline.',
          });
          if (result.response === 0) {
            (app as AppExtended).isQuitting = true;
            try { if (agentManager) await agentManager.stopAll(); } catch { /* ignore */ }
            app.quit();
          }
        },
      },
    ]),
  );
}

// ── IPC ──────────────────────────────────────────────────────────────────
function getEnhancedEnv(): NodeJS.ProcessEnv {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(GLOBAL_MODULES, '@openagents-org', 'agent-launcher')) as {
      paths?: { getEnhancedEnv?: () => NodeJS.ProcessEnv };
    };
    return mod.paths?.getEnhancedEnv?.() ?? process.env;
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@openagents-org/agent-launcher') as {
        paths?: { getEnhancedEnv?: () => NodeJS.ProcessEnv };
      };
      return mod.paths?.getEnhancedEnv?.() ?? process.env;
    } catch {
      return process.env;
    }
  }
}

function setupIPC(): void {
  if (!agentManager) throw new Error('AgentManager not initialized');
  const am = agentManager;

  // Runtime info (legacy "python" channels report Node)
  ipcMain.handle(IPC_CHANNELS.pythonStatus, () => ({
    pythonPath: null,
    pythonFound: true,
    sdkInstalled: true,
    sdkVersion: coreVersion || 'not installed',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    launcherVersion: (require('../../package.json') as { version: string }).version,
    runtime: 'node',
  }));
  ipcMain.handle(IPC_CHANNELS.installSDK, () => ({
    success: true,
    message: 'No installation needed — using Node.js agent-connector',
  }));
  ipcMain.handle(IPC_CHANNELS.runtimeInfo, async (): Promise<RuntimeInfo> => {
    const info: RuntimeInfo = { nodeVersion: null, npmVersion: null, coreVersion, latestVersion: null };
    const nodeUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node');
    const nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'node');
    if (fs.existsSync(nodeBin)) {
      try {
        info.nodeVersion = execSync(`"${nodeBin}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
      } catch { /* ignore */ }
    }
    const npmCli = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(nodeBin) && fs.existsSync(npmCli)) {
      try {
        info.npmVersion = execSync(`"${nodeBin}" "${npmCli}" --version`, {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env, PATH: pathWith(PORTABLE_NODE_DIR) },
        }).trim();
        info.latestVersion = execSync(`"${nodeBin}" "${npmCli}" view ${CORE_PKG} version`, {
          encoding: 'utf-8',
          timeout: 10000,
          env: { ...process.env, PATH: pathWith(PORTABLE_NODE_DIR) },
        }).trim();
      } catch { /* ignore */ }
    }
    return info;
  });

  // Agent CRUD
  ipcMain.handle(IPC_CHANNELS.listAgents, () => am.getAgents());
  ipcMain.handle(IPC_CHANNELS.supportedTypes, () => am.getSupportedAgentTypes());
  ipcMain.handle(IPC_CHANNELS.coreInfo, () => am.getCoreInfo());
  ipcMain.handle(IPC_CHANNELS.addAgent, (_e, config) => am.addAgent(config));
  ipcMain.handle(IPC_CHANNELS.removeAgent, (_e, name: string) => am.removeAgent(name));
  ipcMain.handle(IPC_CHANNELS.updateAgent, (_e, name: string, config) => am.updateAgent(name, config));

  // Lifecycle
  ipcMain.handle(IPC_CHANNELS.startAgent, (_e, name: string) => am.startAgent(name));
  ipcMain.handle(IPC_CHANNELS.stopAgent, (_e, name: string) => am.stopAgent(name));
  ipcMain.handle(IPC_CHANNELS.startAll, () => am.startAll());
  ipcMain.handle(IPC_CHANNELS.stopAll, () => am.stopAll());
  ipcMain.handle(IPC_CHANNELS.status, () => am.getAllStatus());
  ipcMain.handle(IPC_CHANNELS.logs, (_e, name?: string | null, lines?: number) => am.getLogs(name, lines));
  ipcMain.handle(IPC_CHANNELS.tailLogs, (_e, name?: string | null, lines?: number, offset?: number) =>
    am.tailLogs(name, lines, offset),
  );
  ipcMain.handle(IPC_CHANNELS.clearLogsRange, (_e, start, end) => am.clearLogsInRange(start, end));

  // Install / catalog
  ipcMain.handle(IPC_CHANNELS.installType, (_e, type: string) => am.installAgentType(type));
  ipcMain.handle(IPC_CHANNELS.installTypeStreaming, async (_e, type: string) =>
    am.installAgentTypeStreaming(type, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_EVENTS.installOutput, data);
      }
    }),
  );
  ipcMain.handle(IPC_CHANNELS.uninstallType, (_e, type: string) => am.uninstallAgentType(type));
  ipcMain.handle(IPC_CHANNELS.uninstallTypeStreaming, async (_e, type: string) =>
    am.uninstallAgentTypeStreaming(type, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_EVENTS.installOutput, data);
      }
    }),
  );
  ipcMain.handle(IPC_CHANNELS.checkType, (_e, type: string) => am.checkAgentType(type));
  ipcMain.handle(IPC_CHANNELS.catalog, () => am.getCatalog());

  // Configuration
  ipcMain.handle(IPC_CHANNELS.envFields, (_e, type: string) => am.getEnvFields(type));
  ipcMain.handle(IPC_CHANNELS.getEnv, (_e, type: string) => am.getAgentEnv(type));
  ipcMain.handle(IPC_CHANNELS.saveEnv, (_e, type: string, env) => am.saveAgentEnv(type, env));
  ipcMain.handle(IPC_CHANNELS.getInstanceEnv, (_e, name: string) => am.getAgentInstanceEnv(name));
  ipcMain.handle(IPC_CHANNELS.saveInstanceEnv, (_e, name: string, env) => am.saveAgentInstanceEnv(name, env));
  ipcMain.handle(IPC_CHANNELS.testLlm, (_e, env) => am.testLLM(env));
  ipcMain.handle(IPC_CHANNELS.signalReload, () => am.signalReload());

  // Workspace
  ipcMain.handle(IPC_CHANNELS.workspaceConnect, (_e, name: string, slug: string) =>
    am.connectWorkspace(name, slug),
  );
  ipcMain.handle(IPC_CHANNELS.workspaceDisconnect, (_e, name: string) =>
    am.disconnectWorkspace(name),
  );
  ipcMain.handle(IPC_CHANNELS.workspaceRemove, (_e, slug: string) => am.removeWorkspace(slug));
  ipcMain.handle(IPC_CHANNELS.workspaceList, () => am.getNetworks());
  ipcMain.handle(IPC_CHANNELS.workspaceCreate, (_e, name?: string) => am.createWorkspace(name));

  // Settings
  ipcMain.handle(IPC_CHANNELS.settingsGet, (_e, key?: string) => store.get(key as never));
  ipcMain.handle(IPC_CHANNELS.settingsSet, (_e, key: string, value) =>
    store.set(key as never, value),
  );

  // Health
  ipcMain.handle(IPC_CHANNELS.healthCheck, (_e, type: string) => am.healthCheck(type));

  // Core update
  ipcMain.handle(IPC_CHANNELS.coreUpdate, async () => {
    const npmUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const npmBin = fs.existsSync(npmUnified) ? npmUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'npm');
    try {
      execSync(`"${npmBin}" install --prefix "${PORTABLE_NODE_DIR}" ${CORE_PKG}@latest --ignore-scripts`, {
        stdio: 'ignore',
        timeout: 120000,
        env: { ...process.env, PATH: pathWith(PORTABLE_NODE_DIR) },
      });
      const corePkg = path.join(GLOBAL_MODULES, CORE_PKG, 'package.json');
      try {
        coreVersion = JSON.parse(fs.readFileSync(corePkg, 'utf-8')).version as string;
      } catch { /* ignore */ }
      if (agentManager) {
        try { await agentManager.stopAll(); } catch { /* ignore */ }
        agentManager._ensureDaemon().catch(() => undefined);
      }
      return { success: true, version: coreVersion };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  // Shell
  ipcMain.handle(IPC_CHANNELS.shellOpenExternal, (_e, url: string) => shell.openExternal(url));
  ipcMain.handle(IPC_CHANNELS.shellOpenTerminal, (_e, cmd: string) => openTerminal(cmd));
  ipcMain.handle(IPC_CHANNELS.shellExec, (_e, cmd: string): string => {
    const env = getEnhancedEnv();
    if (process.platform === 'win32') {
      return execSync(cmd, {
        encoding: 'utf-8',
        timeout: 30000,
        shell: process.env.ComSpec || 'cmd.exe',
        env,
      });
    }
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, env });
  });

  // Icons
  ipcMain.handle(IPC_CHANNELS.iconsGetDir, () => {
    const dir = path.join(GLOBAL_MODULES, CORE_PKG, 'icons');
    return fs.existsSync(dir) ? dir : null;
  });
  ipcMain.handle(IPC_CHANNELS.iconsGetPath, (_e, name: string) => {
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const p = path.join(GLOBAL_MODULES, CORE_PKG, 'icons', `${slug}.svg`);
    return fs.existsSync(p) ? p : null;
  });

  ipcMain.handle(IPC_CHANNELS.debugEnv, (): DebugEnv => ({
    ComSpec: process.env.ComSpec,
    SystemRoot: process.env.SystemRoot,
    PATH: (process.env.PATH || '').slice(0, 500),
    platform: process.platform,
  }));
}

function openTerminal(cmd: string): void {
  const env = getEnhancedEnv();
  const home = os.homedir();
  const portableNode = path.join(home, '.openagents', 'nodejs');
  const runtimeBins: string[] = [];
  try {
    const rd = path.join(home, '.openagents', 'runtimes');
    for (const d of fs.readdirSync(rd, { withFileTypes: true })) {
      if (d.isDirectory()) runtimeBins.push(path.join(rd, d.name, 'node_modules', '.bin'));
    }
  } catch { /* ignore */ }

  if (process.platform === 'win32') {
    const npmBin = path.join(process.env.APPDATA || '', 'npm');
    const allBins = [...runtimeBins, path.join(portableNode, 'node_modules', '.bin'), portableNode, npmBin].join(';');
    const setPath = `set PATH=${allBins};%PATH%`;
    execSync(`start "" cmd /K "${setPath} && ${cmd}"`, { stdio: 'ignore', env, shell: 'cmd.exe' });
  } else if (process.platform === 'darwin') {
    const portableNodeBin = path.join(portableNode, 'bin');
    const allBins = [
      ...runtimeBins,
      path.join(portableNode, 'node_modules', '.bin'),
      portableNodeBin,
      portableNode,
      '/usr/local/bin',
    ].join(':');
    const setPath = `export PATH=${allBins}:$PATH`;
    const fullCmd = `${setPath} && ${cmd}`.replace(/"/g, '\\"');
    spawn('osascript', ['-e', `tell app "Terminal" to do script "${fullCmd}"`], {
      detached: true,
      stdio: 'ignore',
    });
  } else {
    for (const term of ['x-terminal-emulator', 'gnome-terminal', 'xterm']) {
      try {
        spawn(term, ['-e', cmd], { detached: true, stdio: 'ignore', env });
        return;
      } catch { /* try next */ }
    }
  }
}

// ── Single instance ───────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Splash ────────────────────────────────────────────────────────────────
type SplashUpdate = (msg: string, pct: number, detail?: string) => void;

function createSplash(): { window: BrowserWindow; update: SplashUpdate } | null {
  if (isHeadless) return null;
  const window = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    transparent: false,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const html = `data:text/html,
    <html><body style="margin:0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:%23f5f5f7;color:%23333;">
      <div style="font-size:28px;font-weight:700;margin-bottom:8px;">OpenAgents Launcher</div>
      <div id="msg" style="font-size:14px;color:%23888;margin-bottom:20px;">Starting...</div>
      <div style="width:240px;height:6px;background:%23e0e0e0;border-radius:3px;overflow:hidden;">
        <div id="bar" style="width:10%25;height:100%25;background:%236C63FF;border-radius:3px;transition:width 0.5s;"></div>
      </div>
      <div id="detail" style="font-size:11px;color:%23aaa;margin-top:8px;"></div>
    </body></html>`;
  window.loadURL(html);
  window.show();

  const update: SplashUpdate = (msg, pct, detail) => {
    if (window.isDestroyed()) return;
    const js =
      `document.getElementById('msg').textContent=${JSON.stringify(msg)};` +
      `document.getElementById('bar').style.width=${JSON.stringify(`${pct}%`)};` +
      `document.getElementById('detail').textContent=${JSON.stringify(detail || '')};`;
    window.webContents.executeJavaScript(js).catch(() => undefined);
  };
  return { window, update };
}

// ── App lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  createTray();

  const nodeReady = hasPortableNode();
  const splash = createSplash();
  const update = splash?.update ?? (() => undefined);

  if (isHeadless && process.platform === 'darwin' && app.dock) app.dock.hide();

  if (!nodeReady) {
    update('Downloading Node.js runtime...', 20, 'This only happens once');
    try {
      await downloadNodejs((pct, detail) => update('Downloading Node.js...', 20 + pct * 0.5, detail));
      update('Node.js installed', 70);
    } catch (e) {
      slog(`Node.js install FAILED: ${(e as Error).message}`);
      update('Setup failed: ' + (e as Error).message, 50, 'Check ~/.openagents/startup.log');
      await new Promise((r) => setTimeout(r, 5000));
    }
  } else {
    update('Starting...', 50);
  }

  update('Installing npm...', 55);
  try { await ensureNpm(); } catch { /* logged in helper */ }

  update('Checking for updates...', 60);
  updateProcessPath();
  coreVersion = await ensureCoreLibrary(update);
  registerGlobalModulesPath();

  if (splash) {
    update('Ready!', 100);
    await new Promise((r) => setTimeout(r, 500));
    if (!splash.window.isDestroyed()) splash.window.close();
  }

  // Suppress unused-warning for hasCoreLibrary — it's a useful predicate to keep available
  void hasCoreLibrary;

  agentManager = new AgentManager(store);
  agentManager._ensureDaemon().catch(() => undefined);

  setInterval(() => updateTrayMenu(), 5000);

  setupIPC();
  if (!isHeadless) createWindow();

  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const sendIfUpdate = (latest: string | null): void => {
    if (latest && mainWindow && !mainWindow.isDestroyed()) {
      const info: CoreUpdateInfo = { current: coreVersion, latest };
      mainWindow.webContents.send(IPC_EVENTS.coreUpdateAvailable, info);
    }
  };
  setInterval(() => {
    checkCoreUpdate(coreVersion).then(sendIfUpdate).catch(() => undefined);
  }, FOUR_HOURS);
  setTimeout(() => {
    checkCoreUpdate(coreVersion).then(sendIfUpdate).catch(() => undefined);
  }, 30000);
});

app.on('window-all-closed', () => {
  // Keep running in tray — do not quit.
});

app.on('activate', () => {
  if (!isHeadless) createWindow();
});

app.on('before-quit', () => {
  (app as AppExtended).isQuitting = true;
  try { if (agentManager) agentManager.stopAll(); } catch { /* ignore */ }
});
