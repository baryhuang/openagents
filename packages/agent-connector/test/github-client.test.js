'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { GitHubClient } = require('../src/github-client');

describe('GitHubClient', () => {
  it('constructs with default base url', () => {
    const client = new GitHubClient();
    assert.equal(client.baseUrl, 'https://api.github.com');
  });

  it('strips trailing slash from base url', () => {
    const client = new GitHubClient({ baseUrl: 'https://ghe.example.com/api/v3/' });
    assert.equal(client.baseUrl, 'https://ghe.example.com/api/v3');
  });

  it('_headers includes auth + accept + UA + api-version', () => {
    const client = new GitHubClient();
    const h = client._headers('tok-123');
    assert.equal(h.Authorization, 'Bearer tok-123');
    assert.equal(h.Accept, 'application/vnd.github+json');
    assert.equal(h['X-GitHub-Api-Version'], '2022-11-28');
    assert.match(h['User-Agent'], /agent-launcher/);
  });

  it('probe rejects without a token', async () => {
    const client = new GitHubClient();
    await assert.rejects(() => client.probe(), /Missing GitHub token/);
  });

  describe('parseRepo', () => {
    it('parses owner/name shorthand', () => {
      assert.deepEqual(GitHubClient.parseRepo('anthropics/claude-code'), {
        owner: 'anthropics',
        name: 'claude-code',
      });
    });

    it('parses https URLs (with or without .git suffix)', () => {
      assert.deepEqual(
        GitHubClient.parseRepo('https://github.com/anthropics/claude-code'),
        { owner: 'anthropics', name: 'claude-code' },
      );
      assert.deepEqual(
        GitHubClient.parseRepo('https://github.com/anthropics/claude-code.git'),
        { owner: 'anthropics', name: 'claude-code' },
      );
    });

    it('parses git@ SSH URLs', () => {
      assert.deepEqual(
        GitHubClient.parseRepo('git@github.com:anthropics/claude-code.git'),
        { owner: 'anthropics', name: 'claude-code' },
      );
    });

    it('keeps owner/name when given a deeper URL', () => {
      assert.deepEqual(
        GitHubClient.parseRepo('https://github.com/anthropics/claude-code/issues/1'),
        { owner: 'anthropics', name: 'claude-code' },
      );
    });

    it('returns null on garbage input', () => {
      assert.equal(GitHubClient.parseRepo(''), null);
      assert.equal(GitHubClient.parseRepo('not a repo'), null);
      assert.equal(GitHubClient.parseRepo(null), null);
    });
  });
});
