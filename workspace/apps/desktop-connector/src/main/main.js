const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const { AgentManager } = require('./agent-manager');
const { PythonManager } = require('./python-manager');
const { Store } = require('./store');

const store = new Store();
let mainWindow = null;
let tray = null;
let agentManager = null;
let pythonManager = null;

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
    title: 'OpenAgents Connector',
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
  // Use a simple 16x16 tray icon (placeholder — replace with real icon)
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch {
    // Fallback: create a simple colored icon
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.isEmpty() ? createPlaceholderIcon() : trayIcon);
  tray.setToolTip('OpenAgents Connector');

  updateTrayMenu();

  tray.on('click', () => {
    createWindow();
  });
}

function createPlaceholderIcon() {
  // Generate a simple 16x16 icon programmatically
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 0x33;     // R
    canvas[i * 4 + 1] = 0x99; // G
    canvas[i * 4 + 2] = 0xFF; // B
    canvas[i * 4 + 3] = 0xFF; // A
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
  // Python / SDK status
  ipcMain.handle('python:status', () => pythonManager.getStatus());
  ipcMain.handle('python:install', () => pythonManager.installSDK());

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
  ipcMain.handle('agents:uninstall-type', (_e, agentType) => agentManager.uninstallAgentType(agentType));
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

  // Shell
  ipcMain.handle('shell:open-external', (_e, url) => shell.openExternal(url));
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

  pythonManager = new PythonManager();
  agentManager = new AgentManager(store, pythonManager);

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
