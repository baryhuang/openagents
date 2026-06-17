#!/usr/bin/env node
'use strict';

/**
 * Dev helper: overlay the Goose adapter into the *installed*
 * `@openagents-org/agent-launcher` core — the copy the daemon actually loads
 * (the Launcher auto-installs/updates it from npm via `ensureCoreLibrary`).
 *
 * Goose support lives in this repo's source, but until a core version that
 * includes it is published to npm, a running daemon resolves an older published
 * core and throws `Unknown agent type: goose`. Run this to deploy Goose into
 * that core so it works before publishing, then restart the daemon.
 *
 * - Idempotent: re-running is a no-op.
 * - Preserves every other adapter already in the core (e.g. `aider`).
 * - `--pin <version>` sets the core's package.json version (use the current
 *   `npm view @openagents-org/agent-launcher version`) so the Launcher's
 *   auto-updater treats it as "already latest" and won't revert the overlay.
 *
 * Usage:
 *   node scripts/deploy-goose-core.js [coreDir] [--pin <version>]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = path.resolve(__dirname, '..'); // packages/agent-connector

function findCore(explicit) {
  const candidates = [
    explicit,
    path.join(os.homedir(), '.openagents', 'nodejs', 'node_modules', '@openagents-org', 'agent-launcher'),
    path.join(os.homedir(), '.openagents', 'core', 'node_modules', '@openagents-org', 'agent-launcher'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'src', 'adapters', 'index.js'))) return c;
  }
  try {
    return path.dirname(require.resolve('@openagents-org/agent-launcher/package.json'));
  } catch { /* not resolvable from here */ }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const pinIdx = args.indexOf('--pin');
  const pinVersion = pinIdx >= 0 ? args[pinIdx + 1] : null;
  const explicit = args.find((a) => !a.startsWith('--') && a !== pinVersion);

  const core = findCore(explicit);
  if (!core) {
    console.error('Could not find an installed @openagents-org/agent-launcher core.');
    console.error('Pass its directory as the first argument.');
    process.exit(1);
  }
  const adir = path.join(core, 'src', 'adapters');

  // 1) Copy the Goose adapter + its parser (deps base/workspace-prompt/paths
  //    already exist in the core).
  for (const f of ['goose.js', 'goose-stream.js']) {
    fs.copyFileSync(path.join(SRC, 'src', 'adapters', f), path.join(adir, f));
  }

  // 2) Register it in the adapter map (idempotent, preserves other adapters).
  const idxPath = path.join(adir, 'index.js');
  let idx = fs.readFileSync(idxPath, 'utf-8');
  if (!/require\(['"]\.\/goose['"]\)/.test(idx)) {
    idx = idx.replace(
      /(const BaseAdapter = require\(['"]\.\/base['"]\);\n)/,
      "$1const GooseAdapter = require('./goose');\n",
    );
  }
  if (!/\bgoose:\s*GooseAdapter\b/.test(idx)) {
    idx = idx.replace(/(const ADAPTER_MAP = \{\n)/, '$1  goose: GooseAdapter,\n');
  }
  fs.writeFileSync(idxPath, idx);

  // 3) Inject the registry.json entry (idempotent). Optional for createAdapter,
  //    but keeps the core's catalog/env metadata complete.
  const goose = JSON.parse(fs.readFileSync(path.join(SRC, 'registry.json'), 'utf-8'))
    .find((e) => e.name === 'goose');
  const regPath = path.join(core, 'registry.json');
  if (goose && fs.existsSync(regPath)) {
    let reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
    reg = reg.filter((e) => e.name !== 'goose');
    const at = reg.findIndex((e) => e.name === 'opencode');
    reg.splice(at >= 0 ? at + 1 : reg.length, 0, goose);
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n');
  }

  // 4) Optionally pin the version so the Launcher's auto-updater won't revert.
  if (pinVersion) {
    const pkgPath = path.join(core, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    pkg.version = pinVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  // Verify the deployed core can build a Goose adapter.
  delete require.cache[require.resolve(idxPath)];
  const { ADAPTER_MAP } = require(idxPath);
  const ok = !!ADAPTER_MAP.goose;

  console.log(`Goose deployed to core: ${core}`);
  console.log(`  adapter map has goose: ${ok}`);
  if (pinVersion) console.log(`  version pinned to: ${pinVersion}`);
  console.log('Restart the daemon to load it (quit & relaunch the Launcher, or `agn down && agn up`).');
  process.exit(ok ? 0 : 2);
}

main();
