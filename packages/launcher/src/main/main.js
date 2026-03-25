const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
// AgentManager is loaded lazily after core library is ensured

// ── Core library resolution ──
// Use the globally installed core library at ~/.openagents/nodejs/ instead of
// the bundled copy. This allows independent updates without rebuilding the app.
const PORTABLE_NODE_DIR = path.join(os.homedir(), '.openagents', 'nodejs');
const GLOBAL_MODULES = path.join(PORTABLE_NODE_DIR, 'node_modules');
const CORE_PKG = '@openagents-org/agent-launcher';

// Add global modules to Node's resolution path so require(CORE_PKG) finds it
if (fs.existsSync(GLOBAL_MODULES)) {
  require('module').globalPaths.push(GLOBAL_MODULES);
}

const { Store } = require('./store');

const store = new Store();
let mainWindow = null;
let tray = null;
let agentManager = null;
let coreVersion = null;

// ── Node.js download (no external deps — works from packaged app) ──
async function downloadNodejs(nodejsDir, onProgress) {
  const https = require('https');
  const nodeVersion = 'v22.14.0';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  fs.mkdirSync(nodejsDir, { recursive: true });

  if (process.platform === 'win32') {
    const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-win-${arch}.zip`;
    const zipPath = path.join(os.tmpdir(), `node-${nodeVersion}.zip`);

    // Download
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(zipPath);
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          https.get(res.headers.location, (r2) => {
            const total = parseInt(r2.headers['content-length'] || '0');
            let downloaded = 0;
            r2.on('data', (chunk) => {
              downloaded += chunk.length;
              file.write(chunk);
              if (total && onProgress) onProgress(Math.round(downloaded / total * 100), `${(downloaded/1e6).toFixed(1)} MB`);
            });
            r2.on('end', () => { file.end(); resolve(); });
            r2.on('error', reject);
          }).on('error', reject);
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0');
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          file.write(chunk);
          if (total && onProgress) onProgress(Math.round(downloaded / total * 100), `${(downloaded/1e6).toFixed(1)} MB`);
        });
        res.on('end', () => { file.end(); resolve(); });
        res.on('error', reject);
      }).on('error', reject);
    });

    // Extract using PowerShell
    if (onProgress) onProgress(90, 'Extracting...');
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${nodejsDir}' -Force"`, { timeout: 120000 });

    // Flatten nested folder
    const nested = path.join(nodejsDir, `node-${nodeVersion}-win-${arch}`);
    if (fs.existsSync(nested)) {
      for (const entry of fs.readdirSync(nested)) {
        const src = path.join(nested, entry);
        const dest = path.join(nodejsDir, entry);
        if (!fs.existsSync(dest)) fs.renameSync(src, dest);
        else if (fs.statSync(src).isDirectory() && fs.statSync(dest).isDirectory()) {
          for (const sub of fs.readdirSync(src)) {
            const ss = path.join(src, sub), dd = path.join(dest, sub);
            if (!fs.existsSync(dd)) fs.renameSync(ss, dd);
          }
        }
      }
      try { fs.rmSync(nested, { recursive: true }); } catch {}
    }
    try { fs.unlinkSync(zipPath); } catch {}

  } else {
    // macOS/Linux: download tar.gz
    const platName = process.platform === 'darwin' ? 'darwin' : 'linux';
    const ext = process.platform === 'darwin' ? 'tar.gz' : 'tar.xz';
    const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-${platName}-${arch}.${ext}`;
    const tarPath = path.join(os.tmpdir(), `node-${nodeVersion}.${ext}`);

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tarPath);
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          https.get(res.headers.location, (r2) => {
            const total = parseInt(r2.headers['content-length'] || '0');
            let downloaded = 0;
            r2.on('data', (chunk) => { downloaded += chunk.length; file.write(chunk); if (total && onProgress) onProgress(Math.round(downloaded/total*100), `${(downloaded/1e6).toFixed(1)} MB`); });
            r2.on('end', () => { file.end(); resolve(); });
            r2.on('error', reject);
          }).on('error', reject);
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0');
        let downloaded = 0;
        res.on('data', (chunk) => { downloaded += chunk.length; file.write(chunk); if (total && onProgress) onProgress(Math.round(downloaded/total*100), `${(downloaded/1e6).toFixed(1)} MB`); });
        res.on('end', () => { file.end(); resolve(); });
        res.on('error', reject);
      }).on('error', reject);
    });

    if (onProgress) onProgress(90, 'Extracting...');
    const flag = ext === 'tar.gz' ? '-xzf' : '-xJf';
    execSync(`tar ${flag} "${tarPath}" -C "${nodejsDir}" --strip-components=1`, { timeout: 120000 });
    try { fs.unlinkSync(tarPath); } catch {}
  }

  if (onProgress) onProgress(100, 'Done');
}

// ── Core library management ──
const SKIP_DIRS = new Set(['.git', 'test', 'tests', 'docs', 'example', 'examples', '.github']);
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function ensureCoreLibrary() {
  const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, 'package.json');
  let installedVersion = null;

  if (fs.existsSync(corePkgPath)) {
    try { installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version; } catch {}
  }

  if (!installedVersion) {
    // First launch — copy bundled core library to global path
    // This avoids needing npm/network on first startup
    const bundledPath = path.join(__dirname, '..', '..', 'node_modules', CORE_PKG);
    // Also check asar-extracted path for packaged apps
    const asarUnpacked = path.join(__dirname, '..', '..', '..', 'app.asar.unpacked', 'node_modules', CORE_PKG);

    let srcPath = null;
    if (fs.existsSync(path.join(bundledPath, 'package.json'))) srcPath = bundledPath;
    else if (fs.existsSync(path.join(asarUnpacked, 'package.json'))) srcPath = asarUnpacked;

    if (srcPath) {
      console.log('First launch: copying bundled core library from', srcPath);
      try {
        const destPath = path.join(GLOBAL_MODULES, CORE_PKG);
        // Ensure parent dirs exist
        fs.mkdirSync(path.join(GLOBAL_MODULES, '@openagents-org'), { recursive: true });
        copyDirSync(srcPath, destPath);
        // Also copy dependencies (ws, blessed)
        for (const dep of ['ws', 'blessed']) {
          const depSrc = path.join(path.dirname(srcPath), dep);
          const depDest = path.join(GLOBAL_MODULES, dep);
          if (fs.existsSync(depSrc) && !fs.existsSync(depDest)) {
            copyDirSync(depSrc, depDest);
          }
        }
        try { installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version; } catch {}
        console.log('Core library v' + installedVersion + ' ready');
      } catch (e) {
        console.error('Failed to copy bundled core library:', e.message);
      }
    }

    // If copy failed and npm is available, try npm install (slow — requires network)
    if (!installedVersion) {
      const npmBin = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'npm.cmd' : 'bin/npm');
      if (fs.existsSync(npmBin)) {
        console.log('Bundled copy not found — installing core library via npm (this may take a moment)...');
        try {
          execSync(`"${npmBin}" install -g ${CORE_PKG}@latest`, {
            stdio: 'ignore', timeout: 120000,
            env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
          });
          try { installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version; } catch {}
        } catch (e) {
          console.error('Failed to install core library:', e.message);
        }
      }
    }
  }

  coreVersion = installedVersion;

  // Check for updates in background (don't block startup)
  const npmBin = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'npm.cmd' : 'bin/npm');
  if (fs.existsSync(npmBin)) {
    checkCoreUpdate(npmBin).catch(() => {});
  }
}

async function checkCoreUpdate(npmBin) {
  try {
    const latest = execSync(`"${npmBin}" view ${CORE_PKG} version`, {
      encoding: 'utf-8', timeout: 15000,
      env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
    }).trim();

    if (coreVersion && latest && latest !== coreVersion) {
      // Send update info to renderer (shown in sidebar, not a popup)
      if (mainWindow) {
        mainWindow.webContents.send('core-update-available', { current: coreVersion, latest });
      }
    }
  } catch {}
}

function createWindow() {
  if (mainWindow) {
    // Restore Dock icon on macOS before showing window
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show();
    }
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
      // Hide Dock icon on macOS so it doesn't distract
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
      }
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
      label: 'Quit OpenAgents',
      click: async () => {
        const { dialog } = require('electron');
        const result = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Quit', 'Cancel'],
          defaultId: 1,
          title: 'Quit OpenAgents Launcher',
          message: 'Quit OpenAgents Launcher?',
          detail: 'The daemon will stop and all connected agents will go offline.',
        });
        if (result.response === 0) {
          app.isQuitting = true;
          try { if (agentManager) await agentManager.stopAll(); } catch {}
          app.quit();
        }
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
    sdkVersion: coreVersion || 'not installed',
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
  ipcMain.handle('agents:health-check', (_e, type) => agentManager.healthCheck(type));

  // Core library update
  ipcMain.handle('core:update', async () => {
    const npmBin = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'npm.cmd' : 'bin/npm');
    try {
      execSync(`"${npmBin}" install -g ${CORE_PKG}@latest`, {
        stdio: 'ignore', timeout: 120000,
        env: { ...process.env, PATH: PORTABLE_NODE_DIR + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') },
      });
      const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, 'package.json');
      try { coreVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version; } catch {}
      // Restart daemon
      if (agentManager) {
        try { await agentManager.stopAll(); } catch {}
        agentManager._ensureDaemon().catch(() => {});
      }
      return { success: true, version: coreVersion };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Shell
  ipcMain.handle('shell:open-external', (_e, url) => shell.openExternal(url));
  ipcMain.handle('shell:open-terminal', (_e, cmd) => {
    const { spawn } = require('child_process');
    const { getEnhancedEnv } = require('@openagents-org/agent-launcher').paths;
    const env = getEnhancedEnv();
    if (process.platform === 'win32') {
      // Open a visible terminal window with PATH set
      const { execSync } = require('child_process');
      const home = process.env.USERPROFILE || require('os').homedir();
      const portableNode = path.join(home, '.openagents', 'nodejs');
      const npmBin = path.join(process.env.APPDATA || '', 'npm');
      const setPath = `set PATH=${portableNode};${npmBin};%PATH%`;
      execSync(`start "" cmd /K "${setPath} && ${cmd}"`, { stdio: 'ignore', env, shell: true });
    } else if (process.platform === 'darwin') {
      // Open Terminal.app with PATH set so agent binaries are found
      const home = require('os').homedir();
      const npmGlobal = path.join(home, '.openagents', 'npm-global', 'bin');
      const setPath = `export PATH=${npmGlobal}:/usr/local/bin:$PATH`;
      const fullCmd = `${setPath} && ${cmd}`.replace(/"/g, '\\"');
      spawn('osascript', ['-e', `tell app "Terminal" to do script "${fullCmd}"`], { detached: true, stdio: 'ignore' });
    } else {
      // Linux — try common terminal emulators
      const terminals = ['x-terminal-emulator', 'gnome-terminal', 'xterm'];
      for (const term of terminals) {
        try { spawn(term, ['-e', cmd], { detached: true, stdio: 'ignore', env }); return; } catch {}
      }
    }
  });
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

app.whenReady().then(async () => {
  // Hide menu bar on Windows/Linux (keep on macOS for system conventions)
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  createTray();

  // ── Splash screen for first-time setup ──
  const nodeExists = fs.existsSync(path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'bin/node'));
  const coreExists = fs.existsSync(path.join(GLOBAL_MODULES, CORE_PKG, 'package.json'));

  let splash = null;
  if (!nodeExists || !coreExists) {
    // Show splash window for first-time setup
    splash = new BrowserWindow({
      width: 420, height: 260, frame: false, resizable: false, center: true,
      alwaysOnTop: true, transparent: false, skipTaskbar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    const splashHtml = `data:text/html,
      <html><body style="margin:0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:%23f5f5f7;color:%23333;">
        <div style="font-size:28px;font-weight:700;margin-bottom:8px;">OpenAgents Launcher</div>
        <div id="msg" style="font-size:14px;color:%23888;margin-bottom:20px;">Preparing first launch...</div>
        <div style="width:240px;height:6px;background:%23e0e0e0;border-radius:3px;overflow:hidden;">
          <div id="bar" style="width:10%25;height:100%25;background:%236C63FF;border-radius:3px;transition:width 0.5s;"></div>
        </div>
        <div id="detail" style="font-size:11px;color:%23aaa;margin-top:8px;"></div>
      </body></html>`;
    splash.loadURL(splashHtml);
    splash.show();

    const updateSplash = (msg, pct, detail) => {
      if (splash && !splash.isDestroyed()) {
        splash.webContents.executeJavaScript(`
          document.getElementById('msg').textContent='${msg.replace(/'/g, "\\'")}';
          document.getElementById('bar').style.width='${pct}%';
          document.getElementById('detail').textContent='${(detail || '').replace(/'/g, "\\'")}';
        `).catch(() => {});
      }
    };

    // Step 1: Install Node.js if needed
    if (!nodeExists) {
      updateSplash('Downloading Node.js runtime...', 20, 'This only happens once');
      try {
        await downloadNodejs(PORTABLE_NODE_DIR, (pct, detail) => {
          updateSplash('Downloading Node.js...', 20 + pct * 0.5, detail);
        });
        updateSplash('Node.js installed', 70);
      } catch (e) {
        console.error('Node.js install failed:', e.message);
        updateSplash('Setup failed: ' + e.message, 50, 'Will retry on next launch');
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // Step 2: Ensure core library
    updateSplash('Setting up core library...', 60);
  }

  // ── PATH setup ──
  if (process.platform === 'win32') {
    const pathDirs = (process.env.PATH || '').toLowerCase().split(';');
    const candidates = [
      PORTABLE_NODE_DIR,
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    ].filter(d => {
      try { return d && fs.existsSync(d) && !pathDirs.includes(d.toLowerCase()); }
      catch { return false; }
    });
    if (candidates.length) {
      process.env.PATH += ';' + candidates.join(';');
    }
  } else {
    const binDir = path.join(PORTABLE_NODE_DIR, 'bin');
    if (fs.existsSync(binDir) && !process.env.PATH.includes(binDir)) {
      process.env.PATH = binDir + ':' + process.env.PATH;
    }
  }

  // Ensure core library is installed and check for updates
  await ensureCoreLibrary();

  // Add global modules path
  if (fs.existsSync(GLOBAL_MODULES) && !require('module').globalPaths.includes(GLOBAL_MODULES)) {
    require('module').globalPaths.push(GLOBAL_MODULES);
  }

  // Close splash
  if (splash && !splash.isDestroyed()) {
    splash.webContents.executeJavaScript(`
      document.getElementById('msg').textContent='Ready!';
      document.getElementById('bar').style.width='100%';
    `).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    splash.close();
    splash = null;
  }

  const { AgentManager } = require('./agent-manager');
  agentManager = new AgentManager(store);

  // Start the daemon on app launch (long-lived background process)
  agentManager._ensureDaemon().catch(() => {});

  // Periodically update tray menu with agent status
  setInterval(() => updateTrayMenu(), 5000);

  setupIPC();
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
  // Stop daemon — agents go offline when launcher quits
  try { if (agentManager) agentManager.stopAll(); } catch {}
});
