# Cline (CLI) in OpenAgents

[Cline](https://github.com/cline/cline) is an autonomous coding agent. OpenAgents
drives its **command-line interface** (`cline`, npm package
[`cline`](https://www.npmjs.com/package/cline)) — *not* the VS Code extension —
to run tasks inside a workspace channel and stream the results back.

> **Status: Beta.** Verified end-to-end against Cline CLI **v3.0.26 / v3.0.27**
> on Linux. It is intentionally kept out of the first-run onboarding wizard
> (still installable from the Install tab). See [Known limitations](#known-limitations).

## Supported platforms & minimum version

| Platform | Status | Notes |
|----------|--------|-------|
| macOS | ✅ Verified (manual E2E) | `npm install -g cline` |
| Linux | ✅ Verified (manual E2E) | `npm install -g cline` |
| Windows | ⚠️ Implemented, automated tests only | `npm install -g cline` (ships a native `cline.exe`). Command parsing, `.cmd`/exe/Node-wrapper resolution, and process-tree termination have unit tests, but a real Windows end-to-end run has **not** yet been done. |

- **Minimum CLI version: `3.0.0`** (HARD minimum; constant `MIN_CLINE_VERSION`,
  and registry `check_ready.min_version`).
  - A **confirmed-older** CLI (`< 3.0.0`) is treated as **incompatible**: the
    Launcher reports `installed: true`, `compatible: false`, `ready: false`,
    and the agent **refuses to start**, returning an upgrade prompt
    (`npm install -g cline@latest`). It is **never** shown as "not installed".
  - An **undetermined** version (`cline --version` unparseable or failing) is
    reported as unknown (`compatible: null`) and the agent proceeds leniently —
    we don't lock users out on a future `--version` format change.
  - The version is cached (per binary path) so status refreshes don't re-spawn
    `cline --version`; the cache is cleared on install/upgrade so a new version
    is reflected promptly.
- Requires **Node.js** to install (the published binary is a self-contained
  bun build, so Node is not needed to *run* it).

## Install

From the OpenAgents **Launcher → Install** tab, choose **Cline** (runs
`npm install -g cline` into an isolated runtime prefix at
`~/.openagents/runtimes/cline/`). Or install it yourself:

```bash
npm install -g cline
cline --version   # 3.0.x
```

> **Windows PATH / `.cmd` note.** npm installs a native `cline.exe` plus a
> `cline` Node wrapper. The adapter resolves the binary across nvm/fnm/volta,
> npm-global, and the OpenAgents runtime prefix. Because Cline declares its
> `bin` as `"./bin/cline"`, a local prefix install does **not** create a
> `node_modules/.bin/cline` shim — the installer/adapter fall back to the
> package's own `bin/cline` (run under Node), so detection works regardless.

## Configure & authenticate

Cline supports many providers (its own Cline account, Anthropic, OpenAI,
OpenRouter, …). There are two ways to authenticate:

1. **Sign in with Cline's own flow** (recommended for the Cline account or a
   provider's OAuth):
   ```bash
   cline auth                 # interactive
   cline auth -p anthropic -k <key> -m claude-sonnet-4-6   # non-interactive
   ```
   Credentials are stored in `~/.cline/data/settings/providers.json`.

2. **Let the Launcher manage an API key.** In the agent's config, set:
   - `CLINE_API_KEY` — the provider key (passed to Cline via `-k`)
   - `CLINE_PROVIDER` — e.g. `anthropic`, `openai`, `openrouter` (passed via `-P`)
   - `CLINE_MODEL` — e.g. `anthropic/claude-sonnet-4.6` (passed via `-m`)

   These are optional — leave them blank to use whatever `cline auth` configured.

### How readiness is reported

Config detection is a **heuristic** — `providers.json` is a Cline-version-specific
internal file, so the real authority is the run result, not the file.

- The Launcher badge shows **ready** when an API key env var is configured
  (`CLINE_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY`).
- Otherwise the adapter classifies auth conservatively from `providers.json`:
  - **ready** only on a positive signal (a credential field is present, or an env key is set);
  - **no_credentials** only when it can confirm a key-based provider is selected with no credential anywhere;
  - **unknown** for everything it cannot confirm — file missing, unparseable, structure changed, or an account/OAuth provider (e.g. the `cline` account) whose credential lives outside `providers.json`.
- **Config state never blocks startup** (only an incompatible version does). If
  you authenticated via `cline auth` or an env var the adapter doesn't recognize,
  the agent still runs and the run result decides. When detection is `unknown`
  and a run fails on auth, the error message says detection couldn't confirm and
  points you at the fix.
- The adapter never reads, returns, or logs your API key value, and never writes
  `providers.json` contents to a log — only whether the file exists, parses, and
  what kind of config it is. Auth state is derived only from the *presence* of a
  credential field.

## Run from the Launcher / use in the Workspace

1. Create a **Cline** agent and pick its **working directory** (the project to
   work in). The directory must exist — there is no silent fallback.
2. Connect it to a workspace and send a task in a channel.
3. You'll see streamed **thinking**, **tool** activity (file edits, commands,
   searches), and a final **answer**. File edits and shell commands run in the
   chosen working directory.

Each user message runs one `cline --json -c <dir> [...] <prompt>` process. The
prompt is passed as a positional argument (an args array — never a shell
string), so quotes, newlines, Chinese text, and shell metacharacters are
delivered verbatim with no injection risk, and OpenAgents does not write the
task text to its own logs.

> **Process-argument visibility.** Cline's CLI requires the prompt as a
> positional argument, so while the args array avoids any shell-injection risk
> and OpenAgents redacts it from its logs, the prompt **can still appear in the
> operating system's process list** (e.g. `ps`/Task Manager) and in diagnostic
> tooling for the lifetime of the run, and Cline records it in its own session
> history. Don't assume the prompt is fully private.

## Permissions & auto-approve

In normal (act) mode the agent runs **non-interactively with auto-approval on**
(`--auto-approve true`). This is required for headless operation — there is no
TTY to confirm each step — so **Cline will automatically run the tools and shell
commands it decides to use** inside the working directory, without per-step
confirmation. Plan/Act gating from the interactive TUI does not apply here.

What this means in practice:

- Point the agent at a working directory whose contents you're comfortable
  having an autonomous agent edit and run commands in.
- You can **interrupt** at any time from the Workspace (see *Stopping a task*).
- Use **plan mode** for a read-only run: when the channel/agent is in plan mode
  the adapter passes `-p` (plan) instead of `--auto-approve`, so Cline
  investigates and proposes a plan rather than modifying files.

Auto-approval is fixed-on for act mode (a headless requirement) and is **not**
configurable to "confirm each step" from OpenAgents — that's a known, documented
behavior, not a hidden default.

## Sessions / resume

Cline supports resuming a conversation with `--id <session-id>`, and OpenAgents
uses it for per-channel continuity. Because Cline does **not** emit the session
id in its `--json` stream, the adapter correlates the run's session via a
**before/after snapshot** of `cline history --json`: it records the existing
session ids *before* spawning, reads history again *after*, and considers only
records that are new since then, in the same working directory, within the run
window. It binds the **real** Cline session id (bound to the working directory)
**only when exactly one candidate remains** — if two runs in the same directory
finish close together (ambiguous), it declines and starts fresh next turn rather
than risk binding the wrong session. It never resumes another project's session,
and a stored session that can't be resumed degrades gracefully to a fresh
session seeded with a short channel recap. Correlation failure never fails the
task, and the prompt is never written to logs (only candidate counts are).

## Stopping a task

Use the workspace **Stop** control (or `/stop`). The adapter sends `SIGINT`
(Cline's graceful abort), then escalates to `SIGTERM`/`SIGKILL` on the whole
process group (POSIX) or `taskkill /F /T` (Windows). The UI returns to idle and
no Cline worker process is left running.

> Cline also starts a shared, long-lived `cline --cline-hub-daemon` per working
> directory (like a language server). It is **not** killed on task stop because
> it is shared infrastructure, not the task. Clean up stale ones with
> `cline doctor fix`.

## Common errors

| Symptom | Meaning | Fix |
|---------|---------|-----|
| "Cline CLI not found" | Not installed / not on PATH | `npm install -g cline` |
| "Cline is not authenticated … re-authenticate" | No valid credential | Set `CLINE_API_KEY` in the Launcher, or run `cline auth` |
| "The configured model is unavailable" | Bad `CLINE_MODEL` | Pick a valid model for the provider |
| "The selected provider is unavailable" | Bad/unknown `CLINE_PROVIDER` | Use a supported provider id |
| "rate-limiting or over quota" | Provider 429 | Retry shortly |
| "Working directory does not exist" | Bad agent working dir | Point the agent at an existing folder |
| "Cline became unresponsive" | No output for ~5 min | The watchdog killed a hung run; retry |

Error messages shown to users are friendly summaries; full (secret-redacted)
detail goes only to the daemon log.

## Known limitations

- **No native multi-agent collaboration.** Cline runs as a **standalone coding
  agent** — it can join a workspace, receive a task, and stream results back,
  but it has no agent-to-agent messaging or `@mention` delegation. Its registry
  capability is therefore `support.collaboration: false` (vs `workspace: true`).
- **Workspace MCP tools.** The OpenAgents workspace MCP toolset (browser, file
  sharing, todos, `@mention`) is not wired into Cline yet — it works only within
  its working directory.
- **Auto-approval is always on in act mode** (headless requirement; see
  *Permissions & auto-approve*). Use plan mode for a read-only run.
- **Interactive questions.** If Cline calls `ask_question` / `ask_followup_question`
  mid-task, the question is surfaced to the channel, but a headless run cannot
  round-trip an answer back into the same process — answer in your next message
  (a new run).
- **Prompt visibility.** The prompt may appear in the OS process list / Cline's
  own history while a run is in flight (see *Run from the Launcher*).
- **Windows** is implemented and unit-tested but not yet verified with a real
  end-to-end run.
- **Authenticated end-to-end** runs depend on you providing a provider key; CI
  uses a mock CLI fixture rather than a real account.
- The shared `cline-hub-daemon` persists per working directory (see *Stopping a
  task*). It is shared infrastructure, not a leaked task process; clear stale
  ones with `cline doctor fix`.
