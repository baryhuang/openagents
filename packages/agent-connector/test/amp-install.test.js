'use strict';

/**
 * Amp-only post-install verification tests.
 *
 * Pins the fix for the "install command exited 0 but no runnable amp.exe →
 * Launcher still showed installed" bug. The verification is scoped to
 * agentType === 'amp'; these tests also assert other agent types keep the
 * original "exit 0 → mark installed" behavior (no new binary check).
 *
 * No real install runs: install() stubs _execShell, installStreaming() mocks
 * child_process.spawn, and binary resolution is controlled via _whichBinary +
 * an isolated HOME / AMP_HOME so the on-disk candidate checks are deterministic.
 *
 * Run: node --test test/amp-install.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const cp = require('child_process');

const { Installer } = require('../src/installer');

const mockRegistry = {
  getEntry: (name) => {
    if (name === 'amp') {
      return {
        name: 'amp',
        install: {
          binary: 'amp',
          macos: 'curl -fsSL https://ampcode.com/install.sh | bash',
          linux: 'curl -fsSL https://ampcode.com/install.sh | bash',
          windows: 'powershell -c "irm https://ampcode.com/install.ps1 | iex"',
        },
      };
    }
    // A non-npm "other agent" used to prove the non-amp path is unchanged
    // (non-npm avoids installStreaming's npm/nodejs bootstrap machinery).
    if (name === 'otherapp') {
      return {
        name: 'otherapp',
        install: {
          binary: 'otherapp',
          macos: 'echo install',
          linux: 'echo install',
          windows: 'echo install',
        },
      };
    }
    return null;
  },
};

let tmpDir;
let tmpHome;
let saved;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-inst-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-home-'));
  saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    AMP_HOME: process.env.AMP_HOME,
    spawn: cp.spawn,
  };
  // os.homedir() honors $HOME on POSIX and %USERPROFILE% on Windows.
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.AMP_HOME;
});

afterEach(() => {
  cp.spawn = saved.spawn;
  for (const k of ['HOME', 'USERPROFILE', 'AMP_HOME']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

function markerHas(name) {
  const f = path.join(tmpDir, 'installed_agents.json');
  if (!fs.existsSync(f)) return false;
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')).includes(name); } catch { return false; }
}

// Fake child_process.spawn: emits the given exit code with no output. The
// installer destructures `spawn` from require('child_process') per call, so
// mutating cp.spawn here is picked up by installStreaming().
function mockSpawnExit(code) {
  cp.spawn = () => {
    const proc = new EventEmitter();
    const mkStream = () => { const e = new EventEmitter(); e.setEncoding = () => {}; return e; };
    proc.stdout = mkStream();
    proc.stderr = mkStream();
    proc.pid = 4321;
    setImmediate(() => proc.emit('close', code));
    return proc;
  };
}

function writeAmpBinary(dir) {
  const isWin = process.platform === 'win32';
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, isWin ? 'amp.exe' : 'amp');
  // Executable stub so the best-effort `--version` probe can succeed too.
  fs.writeFileSync(p, isWin ? 'amp\n' : '#!/bin/sh\necho "amp 1.0.0-test"\n');
  if (!isWin) fs.chmodSync(p, 0o755);
  return p;
}

// ---------------------------------------------------------------------------
// Test 1 — install command succeeds but no real binary → must FAIL, no marker
// ---------------------------------------------------------------------------

describe('Amp install — verification failure (no binary)', () => {
  it('install(): exit 0 but binary missing → throws, writes no marker', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._execShell = async () => 'install output';
    inst._whichBinary = () => null; // not on PATH; ~/.amp/bin absent in tmpHome

    await assert.rejects(
      () => inst.install('amp'),
      /Amp install command completed, but the Amp CLI binary could not be found/,
    );
    assert.equal(markerHas('amp'), false, 'no marker must be written on verification failure');
  });

  it('installStreaming(): exit 0 but binary missing → rejects, no marker, no "Done"', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null;
    mockSpawnExit(0);

    const out = [];
    await assert.rejects(
      () => inst.installStreaming('amp', (d) => out.push(d)),
      /Amp CLI binary could not be found/,
    );
    assert.equal(markerHas('amp'), false);
    const joined = out.join('');
    assert.ok(!joined.includes('Done!'), 'must NOT print "Done!" when verification fails');
  });
});

// ---------------------------------------------------------------------------
// Test 2 — binary present at ~/.amp/bin (or AMP_HOME), not on PATH → SUCCESS
// ---------------------------------------------------------------------------

describe('Amp install — verification success (binary resolved off PATH)', () => {
  it('install(): binary in ~/.amp/bin (not on PATH) → marker written + resolved path logged', async () => {
    const ampPath = writeAmpBinary(path.join(tmpHome, '.amp', 'bin'));
    const inst = new Installer(mockRegistry, tmpDir);
    inst._execShell = async () => 'install output';
    inst._whichBinary = () => null; // force fallback to the ~/.amp/bin candidate

    const res = await inst.install('amp');
    assert.equal(res.success, true);
    assert.equal(markerHas('amp'), true);
    assert.ok(
      res.output.includes(`Amp CLI resolved: ${ampPath}`),
      `output should log the resolved absolute path; got:\n${res.output}`,
    );
  });

  it('installStreaming(): binary in ~/.amp/bin → marker written + "Done!" + resolved path', async () => {
    const ampPath = writeAmpBinary(path.join(tmpHome, '.amp', 'bin'));
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null;
    mockSpawnExit(0);

    const out = [];
    const res = await inst.installStreaming('amp', (d) => out.push(d));
    assert.equal(res.success, true);
    assert.equal(markerHas('amp'), true);
    const joined = out.join('');
    assert.ok(joined.includes(`Amp CLI resolved: ${ampPath}`));
    assert.ok(joined.includes('Done!'));
  });

  it('install(): respects AMP_HOME/bin when resolving the binary', async () => {
    const ampHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-AMPHOME-'));
    process.env.AMP_HOME = ampHome;
    const ampPath = writeAmpBinary(path.join(ampHome, 'bin'));
    try {
      const inst = new Installer(mockRegistry, tmpDir);
      inst._execShell = async () => 'ok';
      inst._whichBinary = () => null;

      const res = await inst.install('amp');
      assert.equal(res.success, true);
      assert.equal(markerHas('amp'), true);
      assert.ok(res.output.includes(`Amp CLI resolved: ${ampPath}`));
    } finally {
      try { fs.rmSync(ampHome, { recursive: true, force: true }); } catch {}
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3 — non-amp agents are UNCHANGED (no new binary verification)
// ---------------------------------------------------------------------------

describe('Amp install — no impact on other agent types', () => {
  it('install(): non-amp still marks installed on exit 0 even without a resolvable binary', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._execShell = async () => 'ok';
    inst._whichBinary = () => null; // binary not resolvable

    const res = await inst.install('otherapp');
    assert.equal(res.success, true);
    assert.equal(markerHas('otherapp'), true, 'non-amp must keep original exit0 → marker behavior');
    assert.ok(!String(res.output).includes('Amp CLI resolved'), 'non-amp must not run amp verification');
  });

  it('installStreaming(): non-amp still marks installed + prints "Done" on exit 0', async () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => null;
    mockSpawnExit(0);

    const out = [];
    const res = await inst.installStreaming('otherapp', (d) => out.push(d));
    assert.equal(res.success, true);
    assert.equal(markerHas('otherapp'), true);
    const joined = out.join('');
    assert.ok(joined.includes('Done!'));
    assert.ok(!joined.includes('Amp CLI resolved'), 'non-amp must not run amp verification');
  });
});

// ---------------------------------------------------------------------------
// Stale-marker reconciliation — getInstallInfo()/isInstalled() for Amp
// ---------------------------------------------------------------------------

describe('Amp install status — historical marker reconciliation', () => {
  it('amp marker present but no real CLI → NOT installed, cli-missing, marker preserved', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._markInstalled('amp');        // simulate a historical/stale install record
    inst._whichBinary = () => null;    // real CLI absent (and ~/.amp/bin isolated/empty)

    const info = inst.getInstallInfo('amp');
    assert.equal(info.installed, false, 'a stale marker alone must not count as installed for amp');
    assert.equal(info.location, 'cli-missing', 'diagnostic must distinguish "record exists but CLI missing"');
    assert.equal(inst.isInstalled('amp'), false);
    assert.equal(markerHas('amp'), true, 'the historical marker must NOT be deleted');
  });

  it('amp marker AND real CLI present → installed (real CLI takes priority over marker)', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._markInstalled('amp');
    inst._whichBinary = () => '/usr/bin/amp'; // real CLI resolves outside ~/.openagents

    const info = inst.getInstallInfo('amp');
    assert.equal(info.installed, true);
    assert.equal(info.location, 'global');
    assert.equal(inst.isInstalled('amp'), true);
  });

  it('amp without marker but real CLI present → installed', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._whichBinary = () => '/usr/bin/amp';

    assert.equal(inst.getInstallInfo('amp').installed, true);
    assert.equal(inst.isInstalled('amp'), true);
    assert.equal(markerHas('amp'), false);
  });

  it('non-amp marker present but no CLI → still installed via marker (UNCHANGED)', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._markInstalled('otherapp');
    inst._whichBinary = () => null;

    const info = inst.getInstallInfo('otherapp');
    assert.equal(info.installed, true, 'non-amp marker fallback must be unchanged');
    assert.equal(info.location, 'marker');
    assert.equal(inst.isInstalled('otherapp'), true);
  });
});
