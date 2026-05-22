'use strict';

const https = require('https');

const DEFAULT_BASE_URL = 'https://api.github.com';
const USER_AGENT = '@openagents-org/agent-launcher';

/**
 * Thin GitHub REST API client used by the launcher's GitHub integration.
 *
 * Auth is via a personal access token (classic or fine-grained) or GitHub
 * App installation token. Each call accepts an explicit token so the caller
 * can resolve it from the launcher's credentials store at request time.
 */
class GitHubClient {
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /**
   * Verify a token and return identity / rate-limit info.
   * Mirrors `GET /user` + `GET /rate_limit`.
   */
  async probe(token) {
    if (!token) throw new Error('Missing GitHub token');
    const user = await this._get('/user', token);
    const rate = await this._get('/rate_limit', token).catch(() => null);
    return {
      ok: true,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      scopes: user.__scopes || [],
      rate: rate ? rate.rate : null,
    };
  }

  async getRepo(owner, name, token) {
    return this._get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);
  }

  /**
   * @param {string} owner
   * @param {string} name
   * @param {{ state?: 'open'|'closed'|'all', perPage?: number, page?: number }} opts
   * @param {string} token
   */
  async listIssues(owner, name, opts = {}, token) {
    const state = opts.state || 'open';
    const perPage = opts.perPage || 20;
    const page = opts.page || 1;
    // GitHub's /issues endpoint returns PRs too — filter to issue-only.
    const items = await this._get(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=${state}&per_page=${perPage}&page=${page}`,
      token,
    );
    return items.filter((i) => !i.pull_request);
  }

  async listPullRequests(owner, name, opts = {}, token) {
    const state = opts.state || 'open';
    const perPage = opts.perPage || 20;
    const page = opts.page || 1;
    return this._get(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=${state}&per_page=${perPage}&page=${page}`,
      token,
    );
  }

  async createIssueComment(owner, name, issueNumber, body, token) {
    return this._post(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${issueNumber}/comments`,
      { body },
      token,
    );
  }

  /**
   * Parse a GitHub-ish input into { owner, name }.
   * Accepts: "owner/name", "https://github.com/owner/name", "git@github.com:owner/name.git".
   */
  static parseRepo(input) {
    if (!input) return null;
    const v = String(input).trim();
    if (!v) return null;
    // SSH form: git@github.com:owner/name(.git)
    const ssh = v.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (ssh) return { owner: ssh[1], name: ssh[2] };
    // URL form
    try {
      const u = new URL(v);
      if (/github\.com$/i.test(u.hostname)) {
        const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
        if (parts.length >= 2 && parts[0] && parts[1]) {
          return { owner: parts[0], name: parts[1] };
        }
      }
    } catch {
      // not a URL — fall through
    }
    // Plain "owner/name"
    const plain = v.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (plain) return { owner: plain[1], name: plain[2] };
    return null;
  }

  _headers(token, extra = {}) {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${token}`,
      ...extra,
    };
  }

  _get(urlPath, token, timeout = 20000) {
    return this._request('GET', urlPath, null, token, timeout);
  }

  _post(urlPath, body, token, timeout = 30000) {
    return this._request('POST', urlPath, body, token, timeout);
  }

  _request(method, urlPath, body, token, timeout) {
    const fullUrl = this.baseUrl + urlPath;
    const jsonBody = body == null ? null : JSON.stringify(body);
    const headers = this._headers(token);
    if (jsonBody != null) headers['Content-Type'] = 'application/json';

    return new Promise((resolve, reject) => {
      const req = https.request(fullUrl, { method, headers, timeout }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const status = res.statusCode || 0;
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { parsed = null; }
          if (status >= 400) {
            const msg = (parsed && (parsed.message || parsed.error)) || `HTTP ${status}`;
            const err = new Error(`GitHub ${method} ${urlPath} failed: ${msg}`);
            err.status = status;
            err.body = parsed;
            return reject(err);
          }
          // Attach OAuth scopes for /user probe convenience.
          if (parsed && method === 'GET' && urlPath === '/user') {
            const scopes = res.headers['x-oauth-scopes'];
            if (typeof scopes === 'string') {
              parsed.__scopes = scopes.split(',').map((s) => s.trim()).filter(Boolean);
            }
          }
          resolve(parsed);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('GitHub request timed out')); });
      if (jsonBody != null) req.write(jsonBody);
      req.end();
    });
  }
}

module.exports = { GitHubClient };
