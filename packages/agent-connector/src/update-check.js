'use strict';

/**
 * Update check + prompt flow.
 *
 * Queries the npm registry for the latest @openagents-org/agent-launcher
 * version and, if newer than the running version, prints a notification
 * and (for TTY invocations) prompts the user to update in place.
 */

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');

const PKG_NAME = '@openagents-org/agent-launcher';
const CACHE_FILE = path.join(os.homedir(), '.openagents', '.update-check.json');
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function currentVersion() {
  return require('../package.json').version;
}

function compareSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (data && data.latest && data.checkedAt &&
        Date.now() - data.checkedAt < CACHE_TTL_MS) {
      return data.latest;
    }
  } catch {}
  return null;
}

function saveCache(latest) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ latest, checkedAt: Date.now() }));
  } catch {}
}

function fetchLatest(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = https.request(
      `https://registry.npmjs.org/${PKG_NAME}/latest`,
      { method: 'GET', timeout: timeoutMs, headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.version || null);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Return { current, latest, isNewer } or null if the check failed / offline.
 */
async function checkForUpdate() {
  const current = currentVersion();
  let latest = loadCache();
  if (!latest) {
    latest = await fetchLatest();
    if (latest) saveCache(latest);
  }
  if (!latest) return null;
  return { current, latest, isNewer: compareSemver(latest, current) > 0 };
}

/**
 * Walk up from __dirname until we find the enclosing node_modules; the
 * directory containing node_modules is the install prefix.
 */
function detectInstallPrefix() {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    if (path.basename(parent) === 'node_modules') {
      return path.dirname(parent);
    }
    dir = parent;
  }
  return null;
}

function findNpmBin() {
  const nodeDir = path.dirname(process.execPath);
  for (const name of ['npm', 'npm.cmd']) {
    const candidate = path.join(nodeDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return execSync(process.platform === 'win32' ? 'where npm' : 'which npm', {
      encoding: 'utf-8', timeout: 3000,
    }).trim().split(/\r?\n/)[0];
  } catch { return 'npm'; }
}

/**
 * Run npm install to update to the latest version. Blocking.
 * Returns true on success.
 */
function runUpdate() {
  const prefix = detectInstallPrefix();
  const npmBin = findNpmBin();
  const args = ['install', '--no-save', `${PKG_NAME}@latest`];
  if (prefix) args.push('--prefix', prefix);
  else args.push('-g');
  process.stderr.write(`[launcher] Running: ${npmBin} ${args.join(' ')}\n`);
  const r = spawnSync(npmBin, args, { stdio: 'inherit' });
  return r.status === 0;
}

/**
 * Prompt for a Y/n keystroke. Defaults to Y on empty input.
 * Times out after `timeoutMs` and returns false.
 */
function promptYes(question, timeoutMs = 30000) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return resolve(false);
    process.stderr.write(question);
    let answered = false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const timer = setTimeout(() => {
      if (answered) return;
      answered = true;
      process.stderr.write('\n');
      rl.close();
      resolve(false);
    }, timeoutMs);
    rl.question('', (ans) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      rl.close();
      const a = (ans || '').trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}

/**
 * Check and print a warning if a newer version is available.
 * Never prompts or auto-updates — users run `agn update` explicitly.
 */
async function notifyAndMaybeUpdate() {
  let info;
  try { info = await checkForUpdate(); } catch { return; }
  if (!info || !info.isNewer) return;

  process.stderr.write(
    `\n[launcher] Update available: ${info.current} → ${info.latest}\n` +
    '[launcher] Run `agn update` to upgrade.\n\n'
  );
}

module.exports = {
  checkForUpdate,
  notifyAndMaybeUpdate,
  runUpdate,
  currentVersion,
};
