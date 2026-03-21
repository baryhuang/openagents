'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY_URL = 'https://endpoint.openagents.org/v1/agent-registry';
const CACHE_FILE = 'agent_catalog.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Agent registry — fetches the catalog of available agent types.
 *
 * Priority: remote API → local cache (24h) → bundled registry.json
 */
class Registry {
  constructor(configDir, registryUrl) {
    this.configDir = configDir;
    this.registryUrl = registryUrl || DEFAULT_REGISTRY_URL;
    this.cacheFile = path.join(configDir, CACHE_FILE);
    this._catalog = null; // in-memory cache
  }

  /**
   * Get the full agent catalog. Tries remote, then cache, then bundled.
   * @returns {Promise<object[]>}
   */
  async getCatalog() {
    if (this._catalog) return this._catalog;

    // Try cache first (avoids network on every call)
    const cached = this._loadCache();
    if (cached) {
      this._catalog = cached;
      // Refresh in background if stale (but still return cached)
      this._refreshInBackground();
      return cached;
    }

    // No cache — try remote
    const remote = await this._fetchRemote();
    if (remote) {
      this._catalog = remote;
      return remote;
    }

    // Fallback to bundled
    this._catalog = this._loadBundled();
    return this._catalog;
  }

  /**
   * Get catalog synchronously (cache or bundled only, no network).
   */
  getCatalogSync() {
    if (this._catalog) return this._catalog;
    const cached = this._loadCache();
    if (cached) { this._catalog = cached; return cached; }
    this._catalog = this._loadBundled();
    return this._catalog;
  }

  /**
   * Get env field definitions for an agent type.
   */
  getEnvFields(agentType) {
    const catalog = this.getCatalogSync();
    const entry = catalog.find((e) => e.name === agentType);
    return entry ? (entry.env_config || []) : [];
  }

  /**
   * Get resolve_env rules for an agent type.
   */
  getResolveRules(agentType) {
    const catalog = this.getCatalogSync();
    const entry = catalog.find((e) => e.name === agentType);
    if (!entry || !entry.resolve_env) return [];
    return entry.resolve_env.rules || [];
  }

  /**
   * Get a single catalog entry by name.
   */
  getEntry(agentType) {
    const catalog = this.getCatalogSync();
    return catalog.find((e) => e.name === agentType) || null;
  }

  /**
   * Force refresh from remote API.
   */
  async refresh() {
    const remote = await this._fetchRemote();
    if (remote) this._catalog = remote;
    return this._catalog || this.getCatalogSync();
  }

  // -- Internal --

  _loadCache() {
    try {
      if (!fs.existsSync(this.cacheFile)) return null;
      const stat = fs.statSync(this.cacheFile);
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
      const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
      return Array.isArray(data) ? data : null;
    } catch {
      return null;
    }
  }

  _saveCache(data) {
    try {
      fs.mkdirSync(this.configDir, { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
  }

  _loadBundled() {
    try {
      const bundledPath = path.join(__dirname, '..', 'registry.json');
      if (fs.existsSync(bundledPath)) {
        return JSON.parse(fs.readFileSync(bundledPath, 'utf-8'));
      }
    } catch {}
    return [];
  }

  async _fetchRemote() {
    try {
      const data = await httpGetJson(this.registryUrl, 5000);
      // API returns { data: [...] } or directly [...]
      const catalog = Array.isArray(data) ? data : (data.data || []);
      if (catalog.length > 0) {
        this._saveCache(catalog);
      }
      return catalog;
    } catch {
      return null;
    }
  }

  _refreshInBackground() {
    // Check if cache is older than TTL
    try {
      const stat = fs.statSync(this.cacheFile);
      if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) return;
    } catch {
      return;
    }
    // Fire and forget
    this._fetchRemote().catch(() => {});
  }
}

/**
 * Simple HTTP GET that returns parsed JSON. No external dependencies.
 */
function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? require('https') : require('http');

    const req = transport.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        httpGetJson(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

module.exports = { Registry };
