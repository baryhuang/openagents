# OpenAgents Agent Client — Task Tracker

**Last updated:** 2026-03-20

## Completed

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Daemon manager — asyncio task runner, auto-restart, cross-platform signals | `daemon.py` | Done |
| 2 | Daemon config v2 — flat agents/networks, v1 auto-migration | `daemon_config.py` | Done |
| 3 | Plugin registry — `AgentPlugin` base, built-ins, entry_points, catalog | `plugin_registry.py` | Done |
| 4 | Plugin `check_ready()` — credential/config detection per agent type | `plugin_registry.py` | Done |
| 5 | `scan_agents()` — machine-wide agent readiness scan | `plugin_registry.py` | Done |
| 6 | Agent setup extraction — shared register/join/adapter logic | `agent_setup.py` | Done |
| 7 | CLI `start` command — idempotent, creates agent + prompts workspace + starts daemon | `cli.py` | Done |
| 8 | CLI `stop` command — stop daemon (individual agent stop is TODO) | `cli.py` | Done |
| 9 | CLI `connect` — token-only join (no workspace ID needed) | `cli.py` | Done |
| 10 | CLI `disconnect` — detach agent from network | `cli.py` | Done |
| 11 | CLI `workspace create` — create workspace, get token | `cli.py` | Done |
| 12 | CLI `workspace join <token>` — join with token-only | `cli.py` | Done |
| 13 | CLI `workspace list` — list configured workspaces | `cli.py` | Done |
| 14 | Backend `POST /v1/token/resolve` — resolve workspace from token | `network.py` | Done |
| 15 | Backend `POST /v1/join` — support token-only (no network ID) | `network.py` | Done |
| 16 | SDK `resolve_token()` — client method for token resolution | `workspace_client.py` | Done |
| 17 | SDK `join_network()` — optional network param | `workspace_client.py` | Done |
| 18 | Install script — `curl \| bash`, auto-installs Python, detects agents | `install.sh` | Done |
| 19 | Bare `openagents` scan — shows agent readiness on no subcommand | `cli.py` | Done |
| 20 | CLI `up/down/status` — daemon lifecycle | `cli.py` | Done |
| 21 | CLI `install` — install agent runtimes with npm detection | `cli.py` | Done |
| 22 | CLI `search` — browse agent catalog | `cli.py` | Done |
| 23 | CLI `autostart` — systemd/launchd/Task Scheduler | `cli.py` | Done |
| 24 | Cross-platform daemonize — Unix fork + Windows DETACHED_PROCESS | `daemon.py` | Done |
| 25 | Config v1→v2 migration | `daemon_config.py` | Done |
| 26 | Commit all uncommitted changes (plugin registry, CLI, daemon, config, install) | all | Done |
| 27 | Update concept doc — `create` → `start` in user-facing examples | `openagents_agent_client_concept.md` | Done |
| 28 | Integration tests for `POST /v1/token/resolve` and token-only `POST /v1/join` | `test_network.py` | Done |
| 29 | Local agent process management — subprocess launch via `get_launch_command()` | `daemon.py`, `plugin_registry.py` | Done |
| 30 | Individual agent stop via file-based command (`daemon.cmd`) | `daemon.py`, `daemon_config.py`, `cli.py` | Done |
| 31 | Hot reload — SIGHUP re-reads config, starts/stops agents as needed | `daemon.py`, `cli.py` | Done |
| 32 | Workspace token rotation — `POST /v1/workspaces/{id}/rotate-token` | `workspaces.py`, `test_workspaces.py` | Done |
| 33 | Workspace member removal — `DELETE /v1/workspaces/{id}/members/{name}` | `workspaces.py`, `test_workspaces.py` | Done |
| 34 | CLI `workspace members` — list agents in a workspace via discover API | `cli.py` | Done |
| 35 | BaseAdapter extraction — common poll/heartbeat/dispatch/control logic | `adapters/base.py`, `adapters/claude.py`, `adapters/openclaw.py`, `adapters/codex.py` | Done |
| 36 | Network manifest — `GET /.well-known/openagents.json` | `workspace/backend/app/main.py`, `test_network.py` | Done |
| 37 | Workspace auto-open browser — `--no-browser` flag on `start` | `cli.py` | Done |
| 38 | `openagents update` — self-update + agent runtime check | `cli.py` | Done |
| 39 | Remote agent catalog client — 24h cache + offline fallback | `plugin_registry.py` | Done |
| 40 | CLI split — 6,154-line `cli.py` into 9 domain modules | `cli.py`, `cli_shared.py`, `cli_helpers.py`, `cli_network.py`, `cli_agent.py`, `cli_identity.py`, `cli_daemon.py`, `cli_packages.py`, `cli_legacy.py` | Done |
| 41 | `yaml-agent` plugin type — YAML-defined agents managed by daemon | `plugin_registry.py` | Done |
| 42 | Package split — `openagents[sdk]` optional extra for heavy deps | `pyproject.toml`, SDK files | Done |
| 43 | `openagents logs` — view and follow daemon logs with agent filtering | `cli_daemon.py` | Done |
| 44 | Windows installer — `install.ps1` for native PowerShell | `install.ps1` | Done |
| 45 | Homebrew formula template for `brew install openagents` | `Formula/openagents.rb` | Done |
| 46 | Agent registry API — model, CRUD endpoints, 15 tests | `openagents-web: models.py, agent_registry.py, test_agent_registry.py` | Done |
| 47 | Repository restructure — layered architecture (3 phases) | `src/openagents/client/`, `src/openagents/sdk/`, `src/openagents/core/` | Done |
| 48 | CI pipeline split — client-tests (fast) + sdk-tests (full) | `.github/workflows/pytest.yml` | Done |
| 49 | Desktop connector Electron app — agent CRUD, config, workspace, tray | `workspace/apps/desktop-connector/` | Done |
| 50 | Fix CSP — replace inline onclick with data-action event delegation | `desktop-connector/src/renderer/renderer.js` | Done |
| 51 | Fix workspace polling — remove member filter from poll_pending | `workspace_client.py` | Done |
| 52 | Uninstall agent types — derive uninstall cmd + clear install markers | `desktop-connector/src/main/agent-manager.js` | Done |

---

## Phase N: Node.js Agent Connector — `@openagents-org/agent-connector`

**Goal:** Extract agent management into a standalone Node.js package that works as both a CLI tool and a library for the Electron desktop app. Eliminates the Python dependency for users who only run Node-based agents (Claude Code, OpenClaw, Codex, Gemini CLI, etc.).

**Why:** The current Electron app shells out to `python -m openagents` for every operation. This requires Python 3.10+ installed, causes subprocess quoting/encoding bugs on Windows, and doubles memory usage (Python daemon + Node agent). Most supported agents are Node.js — requiring both runtimes is unnecessary friction.

**Design principles:**
- Works as a CLI (`npx @openagents-org/agent-connector up`) for Linux/headless servers
- Works as a library (`require('@openagents-org/agent-connector')`) for Electron app on Windows/macOS
- Cross-platform: Windows, macOS, Linux — first-class support for all three
- Agent registry is remote-first (fetch from API) with bundled offline fallback
- Zero Python dependency for Node-based agent workflows
- Python SDK continues to exist for workspace backend, ONM, and Python-based agents

### Package Structure

```
packages/agent-connector/
├── src/
│   ├── index.js              # main export — AgentConnector class
│   ├── config.js             # daemon.yaml read/write (YAML parser exists)
│   ├── env.js                # ~/.openagents/env/<type>.env read/write + resolve_env
│   ├── registry.js           # remote agent catalog fetch + 24h cache + offline fallback
│   ├── installer.js          # npm/pip install/uninstall + install markers
│   ├── daemon.js             # process spawn/monitor/stop, PID file, log rotation
│   ├── workspace-client.js   # HTTP client for workspace API (join/connect/events)
│   └── cli.js                # CLI entry point
├── registry.json             # bundled fallback catalog (generated from YAML plugins)
├── package.json
├── bin/
│   └── agent-connector       # CLI binary → src/cli.js
└── test/
    ├── config.test.js
    ├── env.test.js
    ├── registry.test.js
    ├── installer.test.js
    ├── daemon.test.js
    └── workspace-client.test.js
```

### Tasks

| # | Task | Priority | Status | Notes |
|---|------|----------|--------|-------|
| N1 | Scaffold package — package.json, directory structure, ESM/CJS dual export | High | Pending | `@openagents-org/agent-connector`, MIT license, bin entry for CLI |
| N2 | `config.js` — read/write `daemon.yaml`, agent/network CRUD | High | Pending | Port YAML parser from `agent-manager.js`, add write support. Must preserve comments/formatting where possible. |
| N3 | `env.js` — read/write `~/.openagents/env/<type>.env`, `resolve_env` rules | High | Pending | Port from `agent-manager.js:_loadAgentEnv/_saveAgentEnv`. Add `resolve_env` logic (LLM_* → provider-specific vars) from Python `registry/loader.py`. |
| N4 | `registry.js` — fetch agent catalog from remote API + cache | High | Pending | `GET https://registry.openagents.org/v1/agents` → cache at `~/.openagents/agent_catalog.json` (24h TTL). Fallback to bundled `registry.json`. Returns: name, label, description, install_command, uninstall_command, env_fields, binary_names. |
| N5 | Generate `registry.json` — script to convert YAML plugin definitions to JSON | High | Pending | Read `src/openagents/registry/agents/*.yaml`, output `registry.json` with all fields needed by the connector. Run as build step. |
| N6 | `installer.js` — install/uninstall agent runtimes | High | Pending | `npm install -g`, `pip install`, curl-pipe-bash. Manage install markers (`~/.openagents/installed_agents.json`). Detect existing binaries on PATH + nvm/fnm/volta dirs. |
| N7 | `daemon.js` — agent process lifecycle management | High | Pending | Spawn agent processes, monitor health, auto-restart on crash, PID file, log to `~/.openagents/daemon.log`. Cross-platform: Unix signals (SIGHUP/SIGTERM), Windows file-based commands (`daemon.cmd`). |
| N8 | `workspace-client.js` — workspace API HTTP client | High | Pending | `POST /v1/events`, `GET /v1/events` (poll), `POST /v1/join`, `POST /v1/token/resolve`, `GET /v1/networks`, `POST /v1/workspaces`. Token auth via `X-Workspace-Token` header. |
| N9 | `cli.js` — CLI commands for Linux/headless use | High | Pending | Commands: `up`, `down`, `status`, `create <type> [name]`, `install <type>`, `uninstall <type>`, `connect <agent> <workspace>`, `disconnect <agent>`, `workspace create/list/join`, `logs`, `search`. Use `commander` or `yargs` for arg parsing. Must work via `npx @openagents-org/agent-connector <cmd>` and as global install. |
| N10 | Wire Electron app to use package directly | High | Pending | Replace `agent-manager.js` subprocess calls with `require('@openagents-org/agent-connector')`. Eliminate all `_execPythonCode()` and `_runOpenAgents()` calls. |
| N11 | Cross-platform PATH detection | Medium | Pending | Find agent binaries across: system PATH, nvm/fnm/volta dirs, `~/.local/bin`, `%APPDATA%\npm`, Homebrew dirs. Port logic from `install.sh` and `python-manager.js`. |
| N12 | Agent health check — binary existence + version check | Medium | Pending | Per-agent health: check binary on PATH, run `--version`, compare against registry's latest. Used by `status` command and dashboard. |
| N13 | Log management — write, rotate, tail, filter | Medium | Pending | Agent stdout/stderr → `~/.openagents/daemon.log` with timestamps and agent name prefix. `logs` CLI command with `--follow` and `--agent` filter. Rotate at 10MB. |
| N14 | Config hot-reload — watch `daemon.yaml` for changes | Medium | Pending | `fs.watch` on `daemon.yaml` + debounce. Start new agents, stop removed ones, restart changed ones. Replace SIGHUP mechanism on Unix; works natively on Windows. |
| N15 | `autostart` — register as system service | Low | Pending | Linux: generate systemd unit file. macOS: generate launchd plist. Windows: Task Scheduler via `schtasks`. CLI: `agent-connector autostart [enable\|disable]`. |
| N16 | Tests — unit tests for all modules | High | Pending | Use `vitest` or `jest`. Mock filesystem for config/env tests, mock HTTP for registry/workspace tests, mock child_process for daemon/installer tests. Target 80% coverage. |
| N17 | CI pipeline — lint, test, publish | Medium | Pending | GitHub Actions: lint (eslint), test (vitest), publish to npm on tag. Test on ubuntu, macos, windows runners. |
| N18 | Migrate Electron app to use `@openagents-org/agent-connector` | High | Pending | After N10. Remove `agent-manager.js`, `python-manager.js`. Electron `main.js` creates `AgentConnector` instance, IPC handlers call it directly. Preload/renderer unchanged. |
| N19 | Global install CLI — `npm install -g @openagents-org/agent-connector` | Medium | Pending | Ensure bin entry works globally. Add alias: `agent-connector` and `openagents-connector`. Test on clean machines (Windows, macOS, Linux). |
| N20 | macOS app packaging — DMG with code signing | Low | Pending | electron-builder config for macOS. Code signing with Apple Developer cert. Auto-update via electron-updater. |
| N21 | Windows app packaging — NSIS installer or MSIX | Low | Pending | electron-builder config for Windows. Code signing with EV cert. Auto-update. Include Node.js runtime if not detected. |
| N22 | Linux packaging — AppImage + .deb + .rpm | Low | Pending | electron-builder config for Linux. AppImage for universal, .deb for Ubuntu/Debian, .rpm for Fedora/RHEL. |

### Migration Path

**Phase 1 — Core library (N1-N6)**
Scaffold the package. Port config, env, registry, and installer modules. These are mostly file I/O and HTTP calls — straightforward to port from the existing `agent-manager.js` and Python code. The Electron app continues working unchanged during this phase.

**Phase 2 — Daemon + workspace (N7-N8)**
Port the daemon process manager and workspace client. The daemon is the most complex piece — process spawning, signal handling, auto-restart, cross-platform differences. The workspace client is simpler — just HTTP calls with token auth.

**Phase 3 — CLI (N9)**
Build the CLI interface. This makes the connector usable on headless Linux servers without the Electron app. Commands mirror the existing `openagents` CLI but powered by Node.js.

**Phase 4 — Electron integration (N10, N18)**
Wire the Electron app to use the package directly. Replace all Python subprocess calls. This is where the real payoff happens — direct function calls, no subprocess overhead, no encoding bugs.

**Phase 5 — Distribution (N19-N22)**
Global npm install, platform-specific app packaging, CI/CD pipeline for automated releases.

### What Stays in Python

- **Workspace backend** (`workspace/backend/`) — FastAPI + PostgreSQL, runs server-side
- **ONM primitives** (`src/openagents/core/onm_*.py`) — shared protocol definitions
- **Python SDK** (`src/openagents/sdk/`) — for building custom agents/networks in Python
- **Python-based agents** (Aider, SWE-bench) — still need Python, connector just runs `pip install` + spawns the binary
- **Adapters** (`src/openagents/adapters/`) — agent-specific protocol bridges, run inside the daemon

### API Surface

The package exports a single `AgentConnector` class:

```js
const { AgentConnector } = require('@openagents-org/agent-connector');
const connector = new AgentConnector({ configDir: '~/.openagents' });

// Registry
await connector.getCatalog();                      // → [{name, label, installed, ...}]
await connector.getEnvFields('openclaw');           // → [{name, required, description}]

// Install / Uninstall
await connector.install('openclaw');                // npm install -g openclaw@latest
await connector.uninstall('openclaw');              // npm uninstall -g openclaw
await connector.isInstalled('openclaw');            // → true/false

// Agent CRUD
connector.listAgents();                            // → [{name, type, state, network, env}]
connector.addAgent({ name, type });                 // adds to daemon.yaml
connector.removeAgent('my-agent');                  // removes from daemon.yaml
connector.getAgentEnv('openclaw');                  // reads env file
connector.saveAgentEnv('openclaw', { LLM_API_KEY }); // writes env file

// Daemon lifecycle
await connector.start();                           // start daemon (all agents)
await connector.stop();                             // stop daemon
await connector.startAgent('my-agent');             // start single agent
await connector.stopAgent('my-agent');              // stop single agent
connector.getStatus();                              // → {agents: {name: {state, restarts}}}
connector.getLogs({ agent: 'my-agent', lines: 100 }); // tail logs

// Workspace
await connector.connectWorkspace('my-agent', slug); // connect agent to workspace
await connector.disconnectWorkspace('my-agent');    // disconnect
await connector.createWorkspace('my-ws');           // create new workspace
await connector.listWorkspaces();                   // list configured workspaces
await connector.testLLM({ LLM_API_KEY, LLM_BASE_URL, LLM_MODEL }); // test connection
```

---

## Legacy Pending (Python SDK)

| # | Task | Priority | Notes |
|---|------|----------|-------|
| P8 | `network start` refactor | Low | Separate network launching (Layer 3) from agent launching. |
| P9 | Community plugins | Low | Publish `openagents-aider`, `openagents-goose` as pip-installable plugin packages. |
| P10 | Agent registry API — seed data + deployment | Medium | Seed built-in + known agents into DB. Deploy to `endpoint.openagents.org`. |
| P11 | Remote agents via SSH tunnel | Low | Support agents running on remote servers, connected via SSH tunnel. |
| P25 | Update internal docs — agent workspace concept | Medium | Update the agent-workspace internal doc to reflect latest concept. |
| P27 | README rewrite — three-layer narrative | High | Full rewrite with layered narrative. |
