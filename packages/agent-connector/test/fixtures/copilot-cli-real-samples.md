# Real GitHub Copilot CLI output samples (provenance)

Captured from the **official** CLI to ground the adapter/parser. No tokens,
usernames, repo paths, prompts, or session contents are included.

- **Package:** `@github/copilot`
- **Version:** `1.0.63` (`copilot --version` → `GitHub Copilot CLI 1.0.63.`)
- **npm dist-tags:** `latest=1.0.63`, `prerelease=1.0.64-0`; version range `0.0.326` … `1.0.63` (728 published)
- **Platform captured on:** Linux x64
- **Auth state:** UNAUTHENTICATED (no Copilot subscription/token available in CI)
- **Capture commands:** `copilot --help`, `copilot --version`, `copilot help environment|permissions`,
  `copilot login --help`, and `copilot -p "say hi" --output-format json --stream on …`

> ⚠️ Because no authenticated session was available, the **success-path JSONL
> schema (text/tool/file/done events on stdout) is NOT verified**. Only the
> framing contract, error behaviour, flag set, tool IDs, and session/auth flags
> below are verified against the real CLI.

## Verified: `--output-format json`
From `copilot --help`:
> `--output-format <format>  Output format: 'text' (default) or 'json' (JSONL, one JSON object per line)`

## Verified: errors go to STDERR with EMPTY STDOUT and exit code 1

### No credentials (`-p … --output-format json`, no token)
- exit code: `1`
- stdout: empty (0 bytes — **no JSONL error event**)
- stderr:
```
Error: No authentication information found.

Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.

To authenticate, you can use any of the following methods:
  • Start 'copilot' and run the '/login' command
  • Set the COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variable
  • Run 'gh auth login' to authenticate with the GitHub CLI
```

### Invalid/unvalidatable token (`COPILOT_GITHUB_TOKEN=github_pat_FAKE…`)
- exit code: `1`
- stdout: empty (0 bytes)
- stderr:
```
Error: Authentication token found but could not be validated.

  Failed to fetch PAT user login (401): GitHub returned: Bad credentials

Your token may still be valid. Check your network connection and try again.
```

### Resume against a non-existent session (`--resume=<unknown>`)
- exit code: `1`
- stdout: empty (0 bytes)
- stderr:
```
Error: No session, task, or name matched 'nope'.

To resume by session or task ID:  copilot --resume=<id>
To resume by name:                copilot --resume=<name>
To name a new session:            copilot --name=<name>
To pick from existing sessions:   copilot --resume
To start a new session with ID:   copilot --session-id=<valid-uuid>
```

### Unknown flag
- stderr: `error: unknown option '--totally-bogus-flag'`

## Verified: token env vars & login
From `copilot login --help` / `copilot help environment`:
- Precedence: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`.
- Tokens stored in the system credential store, else plaintext under `~/.copilot/`.
- Supported: fine-grained v2 PATs (`github_pat_…`, "Copilot Requests" permission), OAuth from the Copilot CLI app, OAuth from `gh`. **Classic `ghp_` PATs are NOT supported.**
- `GH_HOST` / `COPILOT_GH_HOST` / `copilot login --host` for GitHub Enterprise Cloud (data residency).
- BYOK: `COPILOT_PROVIDER_BASE_URL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY`, … ; `COPILOT_OFFLINE`.
- `COPILOT_MODEL` sets the model (overridable by `--model`).

## Verified: permission flags & tool IDs
From `copilot help permissions`:
- `--allow-tool` / `--deny-tool` / `--allow-all-tools`; denial precedence over allow.
- Pattern form `kind(argument)`:
  - `shell(command:*?)` — `shell` alone allows all shell commands; `shell(git:*)` matches prefixes.
  - `write` — "tools that create and modify files, except shell tool invocations".
  - `<mcp-server>(tool?)`, `url(domain?)`.
- `--add-dir <directory>` (repeatable) scopes file access; `--allow-all-paths` disables path checks (we never use it).
- `--no-ask-user` disables the `ask_user` tool (autonomous).
- `--plan` starts plan mode.

## Verified: session & privacy flags
From `copilot --help`:
- `-r, --resume[=value]` — resume by session ID, task ID, ID prefix (7+ hex), or **name** (exact, case-insensitive).
- `-n, --name <name>` — set a name for the NEW session.
- `--session-id <id>` — resume by ID, or set the UUID for a new session.
- `--continue` — resume the most recent session.
- `--remote` / `--no-remote` — enable/disable remote control of the session from GitHub web & mobile.
- `--share[=path]` (markdown file) and `--share-gist` (secret gist) — opt-in only; nothing shared unless passed.
- `COPILOT_HOME` overrides session/state dir (default `~/.copilot`).

## Verified: optional-value flags accept `=` form (used by the adapter)
`--resume=…`, `--secret-env-vars=A,B`, `--allow-tool=shell` all parse and reach the
auth/session stage (vs `error: unknown option`). `--secret-env-vars` help:
> Environment variable **names** whose values are stripped from shell and MCP
> server environments and redacted from output (e.g., `--secret-env-vars=MY_KEY,OTHER_KEY`).
