import path from "path"

const LOCAL_CORE = path.resolve(__dirname, "../../../agent-connector")

export interface GitHubProbeResult {
  ok: boolean
  login: string
  name?: string | null
  avatarUrl?: string | null
  scopes?: string[]
  rate?: {
    limit: number
    used: number
    remaining: number
    reset: number
  } | null
}

export interface GitHubRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  description: string | null
  html_url: string
  default_branch: string
  open_issues_count?: number
  stargazers_count?: number
  pushed_at?: string
}

export interface GitHubIssue {
  number: number
  title: string
  state: "open" | "closed"
  html_url: string
  user: { login: string; avatar_url?: string }
  created_at: string
  updated_at: string
  comments: number
  labels: Array<{ name: string; color?: string }>
  body?: string | null
}

export interface GitHubPullRequest {
  number: number
  title: string
  state: "open" | "closed"
  draft?: boolean
  merged_at?: string | null
  html_url: string
  user: { login: string; avatar_url?: string }
  created_at: string
  updated_at: string
  head: { ref: string }
  base: { ref: string }
}

export interface GitHubClientLike {
  probe(token: string): Promise<GitHubProbeResult>
  getRepo(owner: string, name: string, token: string): Promise<GitHubRepo>
  listIssues(
    owner: string,
    name: string,
    opts: { state?: "open" | "closed" | "all"; perPage?: number; page?: number },
    token: string,
  ): Promise<GitHubIssue[]>
  listPullRequests(
    owner: string,
    name: string,
    opts: { state?: "open" | "closed" | "all"; perPage?: number; page?: number },
    token: string,
  ): Promise<GitHubPullRequest[]>
  createIssueComment(
    owner: string,
    name: string,
    issueNumber: number,
    body: string,
    token: string,
  ): Promise<unknown>
}

interface GitHubClientStatic {
  new (opts?: { baseUrl?: string }): GitHubClientLike
  parseRepo(input: string): { owner: string; name: string } | null
}

let _ctor: GitHubClientStatic | null = null

function loadCtor(): GitHubClientStatic {
  if (_ctor) return _ctor
  try {
    const mod = require(LOCAL_CORE) as { GitHubClient: GitHubClientStatic }
    _ctor = mod.GitHubClient
    return _ctor
  } catch {
    // Fall back to the installed copy under the bundled global modules.
    const mod = require("@openagents-org/agent-launcher") as {
      GitHubClient: GitHubClientStatic
    }
    _ctor = mod.GitHubClient
    return _ctor
  }
}

let _client: GitHubClientLike | null = null

export function getGitHubClient(): GitHubClientLike {
  if (_client) return _client
  const Ctor = loadCtor()
  _client = new Ctor()
  return _client
}

export function parseGitHubRepo(input: string): { owner: string; name: string } | null {
  return loadCtor().parseRepo(input)
}
