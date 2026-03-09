# OpenAgents Agent Client — Task Tracker

**Last updated:** 2026-03-10

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

## Pending

| # | Task | Files | Priority | Notes |
|---|------|-------|----------|-------|
| P7 | `openagents[sdk]` package split | `pyproject.toml` | Low | Move heavy deps (grpcio, cryptography, framework bridges) to optional extra. Base package stays lightweight. |
| P8 | `network start` refactor | `cli.py` | Low | Separate network launching (Layer 3) from agent launching. Currently `network start` also launches agents. |
| P9 | Community plugins | `openagents-aider/`, etc. | Low | Publish `openagents-aider`, `openagents-goose` as pip-installable plugin packages. |
| P10 | Agent registry API (backend) | `openagents-web/backend` | High | `agent_registry` DB table + `GET/POST /v1/agent-registry` endpoints on `endpoint.openagents.org`. SDK client side done (item 39). |
| P11 | Remote agents via SSH tunnel | `daemon.py` | Low | Support agents running on remote servers, connected via SSH tunnel. |
| P14 | Windows installer (`install.ps1`) | `install.ps1` (new) | Medium | PowerShell equivalent of `install.sh` for native Windows (not WSL). |
| P15 | Homebrew formula | `Formula/openagents.rb` | Medium | `brew install openagents` for macOS/Linux. |
| P16 | Standalone binary (PyInstaller/Nuitka) | CI pipeline | Low | Zero-dependency binary for each platform. |
| P23 | Repository restructure — layered architecture | `src/openagents/` | High | **Phase 1 (CLI split) DONE** — 6K-line `cli.py` split into 9 domain modules. Phase 2 remaining: create `client/` + `sdk/` directories, move files, update imports. |
| P24 | Package + test split (`openagents` vs `openagents[sdk]`) | `pyproject.toml`, `conftest.py` | High | **DONE** — pyproject.toml split, import guards, pytest markers. Remaining: CI pipeline split (fast client-tests vs full sdk-tests). |
| P25 | Update internal docs — agent workspace concept | `~/works/openagents-web/internal_frontend/docs/202602-agent-workspace` | Medium | Update the agent-workspace internal doc to reflect latest concept: token-only join, `openagents start` flow, workspace CLI commands, agent registry, layered architecture, repo restructure plan. |

## Context

### P7: `openagents[sdk]` Package Split

**Current `pyproject.toml` dependencies** (all bundled):
- **Lightweight (keep in base):** `typer`, `rich`, `pyyaml`, `pydantic`, `aiohttp`, `requests`, `click`
- **Heavy (move to `[sdk]` extra):** `grpcio` + `grpcio-tools`, `cryptography`, `pynacl`, `mcp`, `openai`, `prometheus-client`, `jinja2`
- **Existing extras:** `p2p`, `webrtc`, `langchain`, `dev`, `docs`

**What's needed:** Add `[sdk]` extra in `pyproject.toml` that includes grpcio, cryptography, pynacl, mcp, jinja2. Guard imports in Layer 3 code with try/except. Base package (`pip install openagents`) should only need ~10 deps for the CLI + client.

---

### P8: `network start` Refactor

**Current state:** `cli.py:1866-2050` — `@network_app.command("start")` delegates to `launch_network()` from `openagents.launchers.network_launcher`. This function currently launches both the network service AND the agents defined in the network config.

**What's needed:** `network start` should ONLY launch the network service (Layer 3). Agents should connect separately via `openagents start` + `openagents connect` (Layer 1+2). This requires refactoring `network_launcher.py` to not auto-start agents.

---

### P9-P11, P14-P16: Distribution & Ecosystem

No specific code context needed — these are new work:
- **P9 (Community plugins):** Create template repo for `openagents-<name>` packages with `AgentPlugin` subclass + `pyproject.toml` entry_points.
- **P10 (Agent Registry):** See dedicated section below.
- **P11 (SSH tunnel):** New feature in `daemon.py` — launch SSH tunnel before connecting adapter.
- **P14 (Windows installer):** PowerShell version of `install.sh` at repo root.
- **P15 (Homebrew):** Formula file, publish to tap.
- **P16 (Standalone binary):** PyInstaller/Nuitka CI pipeline.

---

### P10: Agent Registry API + Client

**Problem:** `plugin_registry.py:371-404` hardcodes `_KNOWN_AGENTS` (4 agents). Adding a new agent requires releasing a new openagents version. Users must `openagents update` before they can discover/install new agents. This doesn't scale — like requiring a pip upgrade to see new PyPI packages.

**Backend (~/works/openagents-web):**

New model in `backend/app/models.py`:
```python
class AgentRegistryEntry(Base):
    __tablename__ = "agent_registry"
    name = Column(Text, primary_key=True)           # "aider"
    label = Column(Text, nullable=False)             # "Aider"
    description = Column(Text)                       # "AI pair programming..."
    install_command = Column(Text)                    # "pip install aider-chat"
    check_command = Column(Text)                      # "aider --version"
    homepage = Column(Text)                           # "https://aider.chat"
    tags = Column(ARRAY(Text), default=[])            # ["coding", "open-source"]
    adapter_package = Column(Text)                    # "openagents-aider" (pip plugin)
    latest_version = Column(Text)                     # "0.82.0"
    tier = Column(Text, default="community")          # builtin | official | community
    status = Column(Text, default="active")           # active | deprecated
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

New router `backend/app/routers/agent_registry.py`:
```
GET    /v1/agent-registry             — list all active agents (public, no auth)
GET    /v1/agent-registry/{name}      — single agent detail (public)
POST   /v1/agent-registry             — add agent (admin, API key auth)
PATCH  /v1/agent-registry/{name}      — update agent (admin)
DELETE /v1/agent-registry/{name}      — deprecate agent (admin)
```

Register in `main.py`: `app.include_router(agent_registry.router)`

**SDK client (~/works/openagents, plugin_registry.py):**

Replace `_KNOWN_AGENTS` with remote fetch + 24h cache + offline fallback:
```python
REGISTRY_URL = "https://endpoint.openagents.org/v1/agent-registry"
CACHE_PATH = Path.home() / ".openagents" / "agent_catalog.json"
CACHE_TTL = 86400  # 24 hours

def _fetch_remote_catalog() -> list[PluginInfo]:
    if CACHE_PATH.exists() and (time.time() - CACHE_PATH.stat().st_mtime) < CACHE_TTL:
        return _parse_cached(CACHE_PATH)
    try:
        resp = requests.get(REGISTRY_URL, timeout=5)
        data = resp.json()["data"]
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(data))
        return [PluginInfo(**a) for a in data]
    except Exception:
        if CACHE_PATH.exists():
            return _parse_cached(CACHE_PATH)
        return _KNOWN_AGENTS  # bundled fallback, never removed
```

**Impact on other commands:**
- `openagents search` — queries remote catalog, finds agents without upgrading
- `openagents install <name>` — looks up install_command from registry
- `openagents update` (P22) — checks latest_version against installed version

**Seed data:** Migrate current `_KNOWN_AGENTS` (aider, goose, cline, swebench) + built-ins (claude, openclaw, codex) into the DB table.

---

### P23: Repository Restructure — Layered Architecture

**Problem:** `src/openagents/` is a flat directory mixing three products: the lightweight CLI client (Layer 1+2), the heavy SDK (Layer 3), and shared ONM primitives. `cli.py` is 6,154 lines handling everything. This makes the `openagents[sdk]` package split (P7) difficult and the codebase hard to navigate.

**Current structure (flat):**
```
src/openagents/
├── cli.py                  ← 6,154 lines, ALL commands mixed together
├── daemon.py               ← client (Layer 1)
├── daemon_config.py        ← client (Layer 1)
├── plugin_registry.py      ← client (Layer 1)
├── agent_setup.py          ← client (Layer 1+2)
├── workspace_client.py     ← client (Layer 2)
├── connect.py              ← client (Layer 2)
├── tunnel.py               ← client (Layer 2)
├── mcp_server.py           ← SDK feature
├── adapters/               ← client (Layer 2)
├── core/                   ← MIXED: onm_*.py (shared) + network.py, client.py, etc. (SDK)
├── agents/                 ← SDK: framework bridges
├── mods/                   ← SDK: network modules
├── models/                 ← SDK: data models
├── launchers/              ← SDK: network launcher
├── studio/                 ← bundled web UI
└── ...
```

**Target structure:**
```
src/openagents/
├── client/                          ← Layer 1+2: lightweight CLI client
│   ├── cli.py                       ← main app + start/connect/bare scan
│   ├── cli_daemon.py                ← up/down/status/autostart
│   ├── cli_agents.py                ← install/search/update/agents
│   ├── cli_workspace.py             ← workspace create/join/list/members
│   ├── daemon.py
│   ├── daemon_config.py
│   ├── plugin_registry.py
│   ├── agent_setup.py
│   └── workspace_client.py
│
├── adapters/                        ← Layer 2: connectivity (unchanged)
│   ├── claude.py, codex.py, openclaw.py
│   ├── connector.py                 ← (future P4)
│   └── utils.py
│
├── core/                            ← ONM primitives only (shared)
│   ├── onm_addressing.py
│   ├── onm_events.py
│   ├── onm_mods.py
│   └── onm_pipeline.py
│
├── sdk/                             ← Layer 3: heavy SDK (optional install)
│   ├── network.py                   ← from core/network.py
│   ├── client.py                    ← from core/client.py
│   ├── agent_manager.py             ← from core/agent_manager.py
│   ├── workspace.py                 ← from core/workspace.py
│   ├── event_gateway.py, topology.py, system_commands.py, ...
│   ├── transports/                  ← from core/transports/
│   └── connectors/                  ← from core/connectors/
│
├── agents/                          ← SDK: framework bridges (unchanged)
├── mods/                            ← SDK: network modules (unchanged)
├── models/                          ← SDK: data models (unchanged)
└── studio/                          ← bundled web UI (unchanged)
```

**Phase 1 — `client/` extraction + CLI split (do first):**
1. Create `src/openagents/client/` directory
2. Move `daemon.py`, `daemon_config.py`, `plugin_registry.py`, `agent_setup.py`, `workspace_client.py`, `connect.py` into `client/`
3. Split `cli.py` (6,154 lines) into domain files sharing `app = typer.Typer()` and `console = Console()`
4. Update all internal imports
5. Keep backward-compat re-exports in old locations (temporary)

**Phase 2 — `sdk/` extraction (do with P7):**
1. Create `src/openagents/sdk/` directory
2. Move heavy files from `core/` into `sdk/` (keep only `onm_*.py` in `core/`)
3. Guard all `sdk/` imports with try/except for `openagents[sdk]` optional install
4. Update `pyproject.toml` extras

**CLI split detail — how to share the Typer app:**

`client/cli.py` (main):
```python
app = typer.Typer()
console = Console()

# Import and register sub-modules
from openagents.client.cli_daemon import daemon_commands
from openagents.client.cli_agents import agents_commands
from openagents.client.cli_workspace import workspace_app

app.add_typer(workspace_app, name="workspace")
# daemon_commands(app) registers up/down/status directly on app
# agents_commands(app) registers install/search/update directly on app
```

Each sub-module gets `app` passed in or registers via `typer.Typer()` + `add_typer()`.

**Files affected:** All imports from `openagents.cli`, `openagents.daemon`, `openagents.plugin_registry`, etc. throughout `tests/`, `workspace/`, `examples/`. Mechanical find-and-replace.

**Risk:** Import paths change. Mitigate with re-exports in old locations during transition period.


