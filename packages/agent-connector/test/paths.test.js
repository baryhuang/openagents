'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getExtraBinDirs, getEnhancedPATH, getEnhancedEnv, whichBinary, clearBinaryLookupCache, IS_WINDOWS } = require('../src/paths');

describe('Paths', () => {
  it('getExtraBinDirs returns array', () => {
    const dirs = getExtraBinDirs();
    assert.ok(Array.isArray(dirs));
  });

  it('getEnhancedPATH includes current PATH', () => {
    const enhanced = getEnhancedPATH();
    assert.ok(enhanced.includes(process.env.PATH || ''));
  });

  it('getEnhancedEnv returns object with PATH', () => {
    const env = getEnhancedEnv();
    assert.ok(typeof env === 'object');
    assert.ok(typeof env.PATH === 'string');
  });

  it('getEnhancedEnv merges base env', () => {
    const env = getEnhancedEnv({ FOO: 'bar', PATH: '/custom' });
    assert.equal(env.FOO, 'bar');
    assert.ok(env.PATH.includes('/custom'));
  });

  it('getEnhancedEnv sets UTF-8 vars on Windows', () => {
    if (!IS_WINDOWS) return; // skip on non-Windows
    const env = getEnhancedEnv();
    assert.equal(env.PYTHONIOENCODING, 'utf-8');
    assert.equal(env.PYTHONUTF8, '1');
  });

  it('whichBinary finds node', () => {
    const result = whichBinary('node');
    assert.ok(result, 'node should be found');
    assert.ok(result.includes('node'));
  });

  it('whichBinary returns null for nonexistent binary', () => {
    const result = whichBinary('definitely-not-a-real-binary-xyz');
    assert.equal(result, null);
  });

  it('whichBinary returns null for empty input', () => {
    assert.equal(whichBinary(''), null);
    assert.equal(whichBinary(null), null);
  });

  it('getExtraBinDirs picks up ~/.cursor/bin once it exists (after install)', () => {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) return;
    const cursorBin = path.join(home, '.cursor', 'bin');
    const preExisted = fs.existsSync(cursorBin);
    let created = false;
    if (!preExisted) {
      try { fs.mkdirSync(cursorBin, { recursive: true }); created = true; } catch { return; }
    }
    try {
      clearBinaryLookupCache();
      const dirs = getExtraBinDirs();
      assert.ok(dirs.includes(cursorBin), `expected ${cursorBin} in extra bin dirs, got: ${dirs.join(', ')}`);
    } finally {
      if (created) {
        try { fs.rmdirSync(cursorBin); } catch {}
        try { fs.rmdirSync(path.dirname(cursorBin)); } catch {}
      }
      clearBinaryLookupCache();
    }
  });

  it('clearBinaryLookupCache lets whichBinary re-resolve after PATH changes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-cache-'));
    const fakeName = `_oa_test_bin_${process.pid}_${Date.now()}`;
    const binPath = path.join(tmp, IS_WINDOWS ? `${fakeName}.cmd` : fakeName);
    const originalPATH = process.env.PATH;
    try {
      // First lookup: binary does not exist anywhere → cached null
      clearBinaryLookupCache();
      assert.equal(whichBinary(fakeName), null);

      // Create the binary, add its dir to PATH, but DON'T clear the cache —
      // we should still get null because whichBinary cached the prior miss
      // keyed by PATH content (so we put the dir at a different spot to
      // change PATH and force a cache miss key — but more importantly we
      // verify the explicit clear API works below).
      fs.writeFileSync(binPath, IS_WINDOWS ? '@echo ok' : '#!/bin/sh\necho ok', 'utf-8');
      if (!IS_WINDOWS) fs.chmodSync(binPath, 0o755);

      process.env.PATH = tmp + (IS_WINDOWS ? ';' : ':') + (originalPATH || '');
      clearBinaryLookupCache();
      const found = whichBinary(fakeName);
      assert.ok(found, `whichBinary should find ${fakeName} after clear + PATH update`);
    } finally {
      process.env.PATH = originalPATH;
      try { fs.unlinkSync(binPath); } catch {}
      try { fs.rmdirSync(tmp); } catch {}
      clearBinaryLookupCache();
    }
  });
});
