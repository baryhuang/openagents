'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findNpmBin, runUpdate } = require('../src/update-check');

// Capture everything written to process.stderr while `fn` runs.
function captureStderr(fn) {
  const original = process.stderr.write;
  let out = '';
  process.stderr.write = (chunk) => { out += chunk; return true; };
  try {
    const result = fn();
    return { result, out };
  } finally {
    process.stderr.write = original;
  }
}

describe('findNpmBin', () => {
  it('prefers npm.cmd on Windows', () => {
    // Both files exist next to node — Windows must pick npm.cmd, not the
    // extensionless Unix shell script.
    const bin = findNpmBin({
      platform: 'win32',
      nodeDir: 'C:\\Program Files\\nodejs',
      exists: () => true,
    });
    assert.ok(bin.endsWith('npm.cmd'), `expected npm.cmd, got ${bin}`);
  });

  it('prefers npm on non-Windows', () => {
    const bin = findNpmBin({
      platform: 'linux',
      nodeDir: '/usr/local/bin',
      exists: () => true,
    });
    assert.ok(bin.endsWith('npm'), `expected npm, got ${bin}`);
    assert.ok(!bin.endsWith('npm.cmd'));
  });

  it('falls back to npm.cmd name on Windows when PATH lookup fails', () => {
    const bin = findNpmBin({
      platform: 'win32',
      nodeDir: 'C:\\nowhere',
      exists: () => false,            // skip the next-to-node candidates
      lookup: () => { throw new Error('no npm on PATH'); }, // force hard fallback
    });
    // The hard fallback must be the runnable Windows name, not the Unix script.
    assert.equal(bin, 'npm.cmd');
  });
});

describe('runUpdate', () => {
  it('returns false and prints the error when spawn fails to start', () => {
    const err = new Error('spawn npm.cmd ENOENT');
    err.code = 'ENOENT';
    const { result, out } = captureStderr(() =>
      runUpdate({
        platform: 'win32',
        npmBin: 'npm.cmd',
        prefix: null,
        spawn: () => ({ error: err }),
      }));
    assert.equal(result, false);
    assert.ok(out.includes('Failed to run npm'));
    assert.ok(out.includes('ENOENT'));
  });

  it('returns false and prints the exit code when npm exits non-zero', () => {
    const { result, out } = captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: 'npm',
        prefix: null,
        spawn: () => ({ status: 1 }),
      }));
    assert.equal(result, false);
    assert.ok(out.includes('exited with code 1'));
  });

  it('returns true when npm exits zero', () => {
    const { result } = captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: 'npm',
        prefix: null,
        spawn: () => ({ status: 0 }),
      }));
    assert.equal(result, true);
  });

  it('invokes npm.cmd through cmd.exe on Windows', () => {
    let captured = null;
    captureStderr(() =>
      runUpdate({
        platform: 'win32',
        npmBin: 'C:\\Program Files\\nodejs\\npm.cmd',
        prefix: null,
        spawn: (cmd, args) => { captured = { cmd, args }; return { status: 0 }; },
      }));
    assert.ok(/cmd\.exe$/i.test(captured.cmd) || captured.cmd.toLowerCase().includes('cmd'));
    assert.deepEqual(captured.args.slice(0, 4), ['/d', '/s', '/c', 'C:\\Program Files\\nodejs\\npm.cmd']);
    assert.ok(captured.args.includes('-g')); // prefix:null → global install
  });

  it('invokes npm directly on non-Windows', () => {
    let captured = null;
    captureStderr(() =>
      runUpdate({
        platform: 'linux',
        npmBin: '/usr/local/bin/npm',
        prefix: null,
        spawn: (cmd, args) => { captured = { cmd, args }; return { status: 0 }; },
      }));
    assert.equal(captured.cmd, '/usr/local/bin/npm');
    assert.equal(captured.args[0], 'install');
  });
});
