#!/usr/bin/env node
/**
 * Dev launcher: compiles TS main+preload, starts Vite, then launches Electron.
 * Vite is started in foreground for hot-reload; Electron is restarted on
 * main/preload changes via a simple watch loop.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// `require('electron')` returns the path string to the electron binary.
const electronBin = require('electron');

function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5180' },
    ...opts,
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code} (signal: ${signal})`);
    }
  });
  return child;
}

async function main() {
  // 1) Initial TS compile for main + preload
  console.log('[dev] Building main + preload (one-shot)…');
  const buildMain = run('tsc-main', 'npx', ['tsc', '-p', 'tsconfig.main.json']);
  const buildPreload = run('tsc-preload', 'npx', ['tsc', '-p', 'tsconfig.preload.json']);
  await Promise.all([
    new Promise((r) => buildMain.on('exit', r)),
    new Promise((r) => buildPreload.on('exit', r)),
  ]);

  // 2) Start Vite renderer server
  console.log('[dev] Starting Vite renderer server on :5180…');
  const vite = run('vite', 'npx', ['vite']);

  // 3) Start watchers for main + preload (rebuild on change)
  run('tsc-main-watch', 'npx', ['tsc', '-p', 'tsconfig.main.json', '--watch', '--preserveWatchOutput']);
  run('tsc-preload-watch', 'npx', [
    'tsc', '-p', 'tsconfig.preload.json', '--watch', '--preserveWatchOutput',
  ]);

  // 4) Launch Electron (waiting briefly for Vite to bind)
  await new Promise((r) => setTimeout(r, 1500));
  console.log('[dev] Launching Electron…');
  const electron = run('electron', electronBin, ['.', '--remote-debugging-port=9223']);

  const shutdown = () => {
    try { vite.kill(); } catch {}
    try { electron.kill(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[dev] failed:', err);
  process.exit(1);
});
