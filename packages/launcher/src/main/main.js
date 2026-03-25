const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const { AgentManager } = require('./agent-manager');
const { Store } = require('./store');

const store = new Store();
let mainWindow = null;
let tray = null;
let agentManager = null;

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: 'OpenAgents Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of closing
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const assetsDir = path.join(__dirname, '..', '..', 'assets');
  let trayIcon;

  if (process.platform === 'darwin') {
    // macOS: use Template icon (auto-adapts to dark/light menu bar)
    trayIcon = nativeImage.createFromPath(path.join(assetsDir, 'tray-iconTemplate.png'));
  } else {
    // Windows/Linux: use color icon
    trayIcon = nativeImage.createFromPath(path.join(assetsDir, 'tray-icon.png'));
  }

  if (!trayIcon || trayIcon.isEmpty()) trayIcon = createPlaceholderIcon();

  tray = new Tray(trayIcon);
  tray.setToolTip('OpenAgents Launcher');

  updateTrayMenu();

  tray.on('click', () => {
    createWindow();
  });
}

function createPlaceholderIcon() {
  // Generate a 16x16 "OA" tray icon — purple circle with white center
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  const cx = 7.5, cy = 7.5, r = 7, ri = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= r) {
        if (d <= ri) {
          // White inner circle
          canvas[i] = 0xFF; canvas[i+1] = 0xFF; canvas[i+2] = 0xFF; canvas[i+3] = 0xFF;
        } else {
          // Purple ring (#6C63FF)
          canvas[i] = 0x6C; canvas[i+1] = 0x63; canvas[i+2] = 0xFF; canvas[i+3] = 0xFF;
        }
      } else {
        // Transparent
        canvas[i] = 0; canvas[i+1] = 0; canvas[i+2] = 0; canvas[i+3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function updateTrayMenu() {
  if (!tray) return;

  const agents = agentManager ? agentManager.getAgents() : [];
  const agentItems = agents.length > 0
    ? agents.map((a) => ({
        label: `${a.name} (${a.state})`,
        enabled: false,
      }))
    : [{ label: 'No agents configured', enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => createWindow() },
    { type: 'separator' },
    ...agentItems,
    { type: 'separator' },
    {
      label: 'Start All',
      click: () => agentManager && agentManager.startAll(),
    },
    {
      label: 'Stop All',
      click: () => agentManager && agentManager.stopAll(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        if (agentManager) agentManager.stopAll();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

// ---- IPC Handlers ----

function setupIPC() {
  // Runtime status (was Python, now Node.js agent-connector)
  ipcMain.handle('python:status', () => ({
    pythonPath: null,
    pythonFound: true,  // No longer needed — always "found" since we're Node.js native
    sdkInstalled: true,
    sdkVersion: require('@openagents-org/agent-launcher/package.json').version,
    launcherVersion: require('../../package.json').version,
    runtime: 'node',
  }));
  ipcMain.handle('python:install', () => ({ success: true, message: 'No installation needed — using Node.js agent-connector' }));

  // Agent CRUD
  ipcMain.handle('agents:list', () => agentManager.getAgents());
  ipcMain.handle('agents:add', (_e, config) => agentManager.addAgent(config));
  ipcMain.handle('agents:remove', (_e, name) => agentManager.removeAgent(name));
  ipcMain.handle('agents:update', (_e, name, config) => agentManager.updateAgent(name, config));

  // Agent lifecycle
  ipcMain.handle('agents:start', (_e, name) => agentManager.startAgent(name));
  ipcMain.handle('agents:stop', (_e, name) => agentManager.stopAgent(name));
  ipcMain.handle('agents:start-all', () => agentManager.startAll());
  ipcMain.handle('agents:stop-all', () => agentManager.stopAll());
  ipcMain.handle('agents:status', () => agentManager.getAllStatus());
  ipcMain.handle('agents:logs', (_e, name, lines) => agentManager.getLogs(name, lines));

  // Agent install (openclaw, etc.)
  ipcMain.handle('agents:install-type', (_e, agentType) => agentManager.installAgentType(agentType));
  ipcMain.handle('agents:install-type-streaming', async (_e, agentType) => {
    return agentManager.installAgentTypeStreaming(agentType, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('install:output', data);
      }
    });
  });
  ipcMain.handle('agents:uninstall-type', (_e, agentType) => agentManager.uninstallAgentType(agentType));
  ipcMain.handle('agents:uninstall-type-streaming', async (_e, agentType) => {
    return agentManager.uninstallAgentTypeStreaming(agentType, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('install:output', data);
      }
    });
  });
  ipcMain.handle('agents:check-type', (_e, agentType) => agentManager.checkAgentType(agentType));
  ipcMain.handle('agents:catalog', () => agentManager.getCatalog());

  // Agent configuration
  ipcMain.handle('agents:env-fields', (_e, agentType) => agentManager.getEnvFields(agentType));
  ipcMain.handle('agents:get-env', (_e, agentType) => agentManager.getAgentEnv(agentType));
  ipcMain.handle('agents:save-env', (_e, agentType, env) => agentManager.saveAgentEnv(agentType, env));
  ipcMain.handle('agents:test-llm', (_e, env) => agentManager.testLLM(env));
  ipcMain.handle('agents:signal-reload', () => agentManager.signalReload());

  // Workspace connection
  ipcMain.handle('workspace:connect', (_e, agentName, slug) => agentManager.connectWorkspace(agentName, slug));
  ipcMain.handle('workspace:disconnect', (_e, agentName) => agentManager.disconnectWorkspace(agentName));
  ipcMain.handle('workspace:list', () => agentManager.getNetworks());
  ipcMain.handle('workspace:create', (_e, name) => agentManager.createWorkspace(name));

  // Settings
  ipcMain.handle('settings:get', (_e, key) => store.get(key));
  ipcMain.handle('settings:set', (_e, key, value) => store.set(key, value));

  // Health check
  ipcMain.handle('agents:health-check', (_e, type) => mgr.healthCheck(type));

  // Shell
  ipcMain.handle('shell:open-external', (_e, url) => shell.openExternal(url));
  ipcMain.handle('shell:exec', (_e, cmd) => {
    const { execSync } = require('child_process');
    const { getEnhancedEnv } = require('@openagents-org/agent-launcher').paths;
    const env = getEnhancedEnv();
    // Use ComSpec directly — guaranteed to be the correct path on this system
    const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : true;
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, shell, env });
  });

  // Debug: expose env for troubleshooting
  ipcMain.handle('debug:env', () => {
    return {
      ComSpec: process.env.ComSpec,
      SystemRoot: process.env.SystemRoot,
      PATH: (process.env.PATH || '').slice(0, 500),
      platform: process.platform,
    };
  });
}

// ---- App lifecycle ----

app.whenReady().then(() => {
  // On Windows, ensure common tool directories are on PATH
  if (process.platform === 'win32') {
    const os = require('os');
    const pathDirs = (process.env.PATH || '').toLowerCase().split(';');
    const candidates = [
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    ].filter(d => {
      try { return d && require('fs').existsSync(d) && !pathDirs.includes(d.toLowerCase()); }
      catch { return false; }
    });
    if (candidates.length) {
      process.env.PATH += ';' + candidates.join(';');
    }
  }

  // Hide menu bar on Windows/Linux (keep on macOS for system conventions)
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  agentManager = new AgentManager(store);

  // Start the daemon on app launch (long-lived background process)
  agentManager._ensureDaemon().catch(() => {});

  // Periodically update tray menu with agent status
  setInterval(() => updateTrayMenu(), 5000);

  setupIPC();
  createTray();
  createWindow();
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
});

app.on('activate', () => {
  createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (agentManager) agentManager.stopAll();
});
