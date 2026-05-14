// Bootstrap helpers: portable Node.js download, npm install, core library
// installation/update. Extracted from main.ts so the lifecycle code stays small.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import { slog } from './logging';

export const PORTABLE_NODE_DIR = path.join(os.homedir(), '.openagents', 'nodejs');
export const GLOBAL_MODULES = path.join(PORTABLE_NODE_DIR, 'node_modules');
export const CORE_PKG = '@openagents-org/agent-launcher';
const NODE_VERSION = 'v22.14.0';
const NPM_VERSION = '10.9.2';

export type SplashUpdater = (msg: string, pct: number, detail?: string) => void;

// Ensure global modules path is on Node's resolution list so require(CORE_PKG)
// finds the disk install.
export function registerGlobalModulesPath(): void {
  if (fs.existsSync(GLOBAL_MODULES)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('module') as { globalPaths: string[] };
    if (!mod.globalPaths.includes(GLOBAL_MODULES)) mod.globalPaths.push(GLOBAL_MODULES);
  }
}

interface ProgressCallback {
  (percent: number, detail: string): void;
}

function downloadFile(url: string, destPath: string, onProgress?: ProgressCallback | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string): void => {
      https
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const next = res.headers.location;
            if (next) doGet(next);
            else reject(new Error('Redirect with no location'));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;
          const file = fs.createWriteStream(destPath);
          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            file.write(chunk);
            if (total && onProgress) {
              onProgress(Math.round((downloaded / total) * 100), `${(downloaded / 1e6).toFixed(1)} MB`);
            }
          });
          res.on('end', () => file.end(() => resolve()));
          res.on('error', reject);
        })
        .on('error', reject);
    };
    doGet(url);
  });
}

export async function downloadNodejs(onProgress?: ProgressCallback): Promise<void> {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  try {
    fs.rmSync(PORTABLE_NODE_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
  fs.mkdirSync(PORTABLE_NODE_DIR, { recursive: true });
  slog(`downloadNodejs: platform=${process.platform} arch=${arch}`);

  if (process.platform === 'win32') {
    const nodeExeUrl = `https://nodejs.org/dist/${NODE_VERSION}/win-${arch}/node.exe`;
    const nodeExeDest = path.join(PORTABLE_NODE_DIR, 'node.exe');
    await downloadFile(nodeExeUrl, nodeExeDest, onProgress);

    const npmUrl = `https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz`;
    const npmTgz = path.join(os.tmpdir(), `npm-${NPM_VERSION}.tgz`);
    const npmModDir = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm');
    if (onProgress) onProgress(85, 'Installing npm...');
    await downloadFile(npmUrl, npmTgz);
    fs.mkdirSync(npmModDir, { recursive: true });
    try {
      execSync(`tar -xzf "${npmTgz}" -C "${npmModDir}" --strip-components=1`, {
        timeout: 60000,
        stdio: 'pipe',
      });
    } catch (e) {
      slog(`npm extraction failed: ${(e as Error).message}`);
    }
    try { fs.unlinkSync(npmTgz); } catch { /* ignore */ }

    const npmCliPath = path.join(npmModDir, 'bin', 'npm-cli.js');
    if (fs.existsSync(npmCliPath)) {
      fs.writeFileSync(
        path.join(PORTABLE_NODE_DIR, 'npm.cmd'),
        `@echo off\r\n"${nodeExeDest}" "${npmCliPath}" %*\r\n`,
      );
      fs.writeFileSync(
        path.join(PORTABLE_NODE_DIR, 'npx.cmd'),
        `@echo off\r\n"${nodeExeDest}" "${path.join(npmModDir, 'bin', 'npx-cli.js')}" %*\r\n`,
      );
    }
  } else {
    const platName = process.platform === 'darwin' ? 'darwin' : 'linux';
    const ext = process.platform === 'darwin' ? 'tar.gz' : 'tar.xz';
    const url = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${platName}-${arch}.${ext}`;
    const tarPath = path.join(os.tmpdir(), `node-${NODE_VERSION}.${ext}`);
    await downloadFile(url, tarPath, onProgress);
    if (onProgress) onProgress(90, 'Extracting...');
    const flag = ext === 'tar.gz' ? '-xzf' : '-xJf';
    execSync(`tar ${flag} "${tarPath}" -C "${PORTABLE_NODE_DIR}" --strip-components=1`, { timeout: 120000 });
    try { fs.unlinkSync(tarPath); } catch { /* ignore */ }

    // Mirror Windows layout: ~/.openagents/nodejs/{node,npm,npx}
    const binDir = path.join(PORTABLE_NODE_DIR, 'bin');
    for (const name of ['node', 'npm', 'npx']) {
      const src = path.join(binDir, name);
      const dest = path.join(PORTABLE_NODE_DIR, name);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try { fs.symlinkSync(src, dest); } catch { /* ignore */ }
      }
    }
  }

  if (onProgress) onProgress(100, 'Done');
}

export async function ensureNpm(): Promise<void> {
  const npmCli = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(npmCli)) return;
  slog('npm missing — installing');
  const npmTgz = path.join(os.tmpdir(), `npm-${NPM_VERSION}.tgz`);
  const npmDir = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm');
  await downloadFile(`https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz`, npmTgz);
  fs.mkdirSync(npmDir, { recursive: true });
  execSync(`tar -xzf "${npmTgz}" -C "${npmDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' });
  try { fs.unlinkSync(npmTgz); } catch { /* ignore */ }
  if (process.platform === 'win32') {
    const nodeExe = path.join(PORTABLE_NODE_DIR, 'node.exe');
    fs.writeFileSync(
      path.join(PORTABLE_NODE_DIR, 'npm.cmd'),
      `@echo off\r\n"${nodeExe}" "${path.join(npmDir, 'bin', 'npm-cli.js')}" %*\r\n`,
    );
  }
}

export function findNpmCommand(): string | null {
  const nodeUnified = path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node');
  const nodeBin = fs.existsSync(nodeUnified) ? nodeUnified : path.join(PORTABLE_NODE_DIR, 'bin', 'node');
  if (!fs.existsSync(nodeBin)) return null;
  const candidates = [
    path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(PORTABLE_NODE_DIR, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const npmCli = candidates.find((p) => fs.existsSync(p));
  if (npmCli) return `"${nodeBin}" "${npmCli}"`;
  if (process.platform !== 'win32') {
    const npmBin = path.join(PORTABLE_NODE_DIR, 'bin', 'npm');
    if (fs.existsSync(npmBin)) return `"${npmBin}"`;
  }
  return null;
}

function addToPrefixPackageJson(pkg: string, version: string): void {
  const pkgJsonPath = path.join(PORTABLE_NODE_DIR, 'package.json');
  let data: { dependencies?: Record<string, string> } = {};
  try {
    data = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  } catch { /* missing file is fine */ }
  if (!data.dependencies) data.dependencies = {};
  data.dependencies[pkg] = version;
  try {
    fs.writeFileSync(pkgJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch { /* best-effort */ }
}

export async function ensureCoreLibrary(updateSplash?: SplashUpdater): Promise<string | null> {
  const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, 'package.json');
  let installedVersion: string | null = null;
  if (fs.existsSync(corePkgPath)) {
    try {
      installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version as string;
    } catch { /* ignore */ }
  }

  try {
    const latestVersion = await new Promise<string>((resolve, reject) => {
      https
        .get(`https://registry.npmjs.org/${CORE_PKG}/latest`, (res) => {
          let buf = '';
          res.on('data', (c) => { buf += c; });
          res.on('end', () => {
            try { resolve(JSON.parse(buf).version as string); }
            catch { reject(new Error('parse error')); }
          });
        })
        .on('error', reject);
    });

    if (!installedVersion) {
      slog(`Core library not found — installing v${latestVersion}`);
      updateSplash?.('Installing core library...', 65, `v${latestVersion}`);
    } else if (latestVersion !== installedVersion) {
      slog(`Core library v${installedVersion} → v${latestVersion}`);
      updateSplash?.('Updating core library...', 65, `v${installedVersion} → v${latestVersion}`);
    } else {
      slog(`Core library v${installedVersion} (already latest)`);
      updateSplash?.('Core library up to date', 80, `v${installedVersion}`);
    }

    if (!installedVersion || latestVersion !== installedVersion) {
      const tgzUrl = `https://registry.npmjs.org/${CORE_PKG}/-/agent-launcher-${latestVersion}.tgz`;
      const tgzPath = path.join(os.tmpdir(), `agent-launcher-${latestVersion}.tgz`);
      const destDir = path.join(GLOBAL_MODULES, CORE_PKG);
      await downloadFile(tgzUrl, tgzPath);
      try { fs.rmSync(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
      fs.mkdirSync(destDir, { recursive: true });
      execSync(`tar -xzf "${tgzPath}" -C "${destDir}" --strip-components=1`, { timeout: 60000, stdio: 'pipe' });
      try { fs.unlinkSync(tgzPath); } catch { /* ignore */ }
      try {
        installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version as string;
      } catch { /* ignore */ }
      if (installedVersion) {
        slog(`Core library installed: v${installedVersion}`);
        updateSplash?.('Core library ready', 80, `v${installedVersion}`);
        addToPrefixPackageJson(CORE_PKG, installedVersion);
      }
    }
  } catch (e) {
    slog(`Core update failed: ${(e as Error).message}`);
    if (!installedVersion) {
      const npmCmd = findNpmCommand();
      if (npmCmd) {
        try {
          execSync(`${npmCmd} install --prefix "${PORTABLE_NODE_DIR}" ${CORE_PKG}@latest --ignore-scripts`, {
            stdio: 'pipe',
            timeout: 120000,
            env: { ...process.env, PATH: pathWith(PORTABLE_NODE_DIR) },
          });
          try {
            installedVersion = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')).version as string;
          } catch { /* ignore */ }
        } catch { /* ignore */ }
      }
    }
  }

  // npm --prefix prunes packages outside package.json — restore it if needed.
  const npmCheck = path.join(PORTABLE_NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCheck)) {
    try {
      await ensureNpm();
    } catch (e) {
      slog(`npm reinstall failed: ${(e as Error).message}`);
    }
  }
  return installedVersion;
}

export async function checkCoreUpdate(currentVersion: string | null): Promise<string | null> {
  const npmCmd = findNpmCommand();
  if (!npmCmd || !currentVersion) return null;
  try {
    const latest = execSync(`${npmCmd} view ${CORE_PKG} version`, {
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env, PATH: pathWith(PORTABLE_NODE_DIR) },
    }).trim();
    if (latest && latest !== currentVersion) return latest;
  } catch { /* ignore */ }
  return null;
}

export function pathWith(extra: string): string {
  return extra + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '');
}

export function updateProcessPath(): void {
  if (process.platform === 'win32') {
    const dirs = (process.env.PATH || '').toLowerCase().split(';');
    const candidates = [
      PORTABLE_NODE_DIR,
      path.join(process.env.APPDATA || '', 'npm'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    ].filter((d) => {
      try {
        return d && fs.existsSync(d) && !dirs.includes(d.toLowerCase());
      } catch {
        return false;
      }
    });
    if (candidates.length) process.env.PATH = (process.env.PATH || '') + ';' + candidates.join(';');
  } else {
    const binDir = path.join(PORTABLE_NODE_DIR, 'bin');
    if (fs.existsSync(binDir) && !(process.env.PATH || '').includes(binDir)) {
      process.env.PATH = binDir + ':' + (process.env.PATH || '');
    }
  }
}

export function hasPortableNode(): boolean {
  return (
    fs.existsSync(path.join(PORTABLE_NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node')) ||
    fs.existsSync(path.join(PORTABLE_NODE_DIR, 'bin', 'node'))
  );
}

export function hasCoreLibrary(): boolean {
  return fs.existsSync(path.join(GLOBAL_MODULES, CORE_PKG, 'package.json'));
}

