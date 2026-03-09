# OpenAgents Agent Client — Task Tracker

**Last updated:** 2026-03-09

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

## Pending

| # | Task | Files | Priority | Notes |
|---|------|-------|----------|-------|
| P4 | Connector extraction | `connector/` (new) | High | Extract shared connectivity logic (auth, discovery, reconnect, transport negotiation) from adapters into a shared connector layer. Adapters become thin I/O translators. |
| P5 | Network manifest | workspace backend, SDK networks | Medium | Implement `/.well-known/openagents.json` on hosted workspace and SDK networks. Formalize in ONM spec. |
| P6 | `yaml-agent` plugin type | `plugin_registry.py` | Medium | Convert `openagents agents start <folder>` into a plugin type so YAML-defined agents are managed by daemon. |
| P7 | `openagents[sdk]` package split | `pyproject.toml` | Low | Move heavy deps (grpcio, cryptography, framework bridges) to optional extra. Base package stays lightweight. |
| P8 | `network start` refactor | `cli.py` | Low | Separate network launching (Layer 3) from agent launching. Currently `network start` also launches agents. |
| P9 | Community plugins | `openagents-aider/`, etc. | Low | Publish `openagents-aider`, `openagents-goose` as pip-installable plugin packages. |
| P10 | Plugin marketplace / catalog API | `plugin_registry.py` | Low | Serve curated catalog from `openagents.org/plugins` instead of hardcoding in `_KNOWN_AGENTS`. |
| P11 | Remote agents via SSH tunnel | `daemon.py` | Low | Support agents running on remote servers, connected via SSH tunnel. |
| P12 | Workspace auto-open browser | `cli.py` | Low | When `openagents start` creates/joins workspace, auto-open browser. Currently implemented but needs testing across platforms. |
| P14 | Windows installer (`install.ps1`) | `install.ps1` (new) | Medium | PowerShell equivalent of `install.sh` for native Windows (not WSL). |
| P15 | Homebrew formula | `Formula/openagents.rb` | Medium | `brew install openagents` for macOS/Linux. |
| P16 | Standalone binary (PyInstaller/Nuitka) | CI pipeline | Low | Zero-dependency binary for each platform. |
| P17 | Workspace token rotation/revocation | workspace backend | Medium | Currently tokens never expire. Need `POST /v1/workspaces/{id}/rotate-token` endpoint. |
| P18 | Workspace member list / invite management | workspace backend, `cli.py` | Medium | `openagents workspace members`, `openagents workspace invite`. |

## Context

### P4: Connector Extraction

**Current state:** All 3 adapters (`adapters/claude.py`, `adapters/openclaw.py`, `adapters/codex.py`) independently implement:
- Polling: `await self.client.poll_pending()` (adaptive 2s-15s)
- Control polling: `await self.client.poll_control()` for mode changes
- Heartbeat: every 30s via `await self.client.heartbeat()`
- Event skipping on startup: `_skip_existing_events()`
- Channel join/rejoin logic
- Multi-channel task tracking

All use `WorkspaceClient` (`workspace_client.py`) as the HTTP abstraction. No raw WebSocket — all HTTP polling.

**ClaudeAdapter structure** (`adapters/claude.py:26-60`):
```python
class ClaudeAdapter:
    def __init__(self, workspace_id, channel_name, token, agent_name, endpoint, disabled_modules=None):
        self.client = WorkspaceClient(endpoint=endpoint)
        ...
    async def run(self):
        self._running = True
        await self._skip_existing_events()
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        await self._poll_loop()
```

**What's needed:** Extract common poll loop, heartbeat, channel management, event skipping into a `Connector` class. Adapters become thin translators: `Connector` delivers events, adapter calls the agent runtime, adapter sends response back through `Connector`.

---

### P5: Network Manifest

**Current state:** No `/.well-known/openagents.json` endpoint exists anywhere. The `GET /v1/profile` endpoint in `workspace/backend/app/routers/network.py:348-380` returns similar metadata (id, slug, name, capabilities, agents_online) but is not at the well-known path.

**A2A tests** reference `/.well-known/agent.json` (different spec — A2A agent cards, not ONM network manifest).

**What's needed:** New endpoint in workspace backend at `GET /.well-known/openagents.json` returning:
```json
{
  "onm_version": "1.0",
  "network_id": "...",
  "name": "...",
  "transports": [{"type": "http", "url": "..."}],
  "auth": {"methods": ["token"]},
  "capabilities": ["channels", "files", "events"]
}
```
Also add to SDK network (`openagents network start`). Formalize in ONM spec doc at `docs/openagents_network_model.md`.

---

### P6: `yaml-agent` Plugin Type

**Current state:** `cli.py:2775-2854` — `@agents_app.command("start")` takes a folder path, discovers `*.yaml/*.yml` files via `BulkAgentManager().discover_agents(folder_path)`, returns `AgentInfo` objects, manages concurrent startup.

**What's needed:** Create a `YamlAgentPlugin(AgentPlugin)` in `plugin_registry.py` that:
- `name = "yaml-agent"`
- `is_installed()` always returns True
- `create_adapter()` loads the YAML config and creates the appropriate adapter
- Agents defined in YAML can then be managed by `openagents start yaml-agent --path ./my-agents/` and run by the daemon like any other plugin.

This replaces the separate `openagents agents start <folder>` command.

---

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
- **P10 (Catalog API):** Replace hardcoded `_KNOWN_AGENTS` list in `plugin_registry.py:351-384` with API call to `openagents.org/api/plugins`.
- **P11 (SSH tunnel):** New feature in `daemon.py` — launch SSH tunnel before connecting adapter.
- **P14 (Windows installer):** PowerShell version of `install.sh` at repo root.
- **P15 (Homebrew):** Formula file, publish to tap.
- **P16 (Standalone binary):** PyInstaller/Nuitka CI pipeline.

---

### P17: Workspace Token Rotation

**Current state:** `workspace/backend/app/models.py:74-91` — `Workspace.password_hash` stores the token as plaintext (not actually hashed):
```python
password_hash = Column(Text, nullable=True)  # stores raw token
```

Token validation in `workspaces.py:51-63`:
```python
if token and token == workspace.password_hash:  # direct string comparison
    return True
```

Token generated as `secrets.token_urlsafe(32)` in `workspaces.py:154`.

**What's needed:** New endpoint `POST /v1/workspaces/{id}/rotate-token` that:
1. Requires owner auth (Firebase bearer token)
2. Generates new `secrets.token_urlsafe(32)`
3. Updates `password_hash`
4. Returns new token
5. Old token immediately stops working

Also consider: token expiry timestamps, multiple active tokens for rotation windows.

---

### P18: Workspace Member Management

**Current state:** `workspace/backend/app/models.py:93-109` — `WorkspaceMember` model:
```python
class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    workspace_id = Column(UUID, ForeignKey("workspaces.id"), nullable=False)
    agent_name = Column(Text, nullable=False)
    role = Column(Text, default="member")       # master | member | observer
    agent_type = Column(Text, nullable=True)
    status = Column(Text, default="offline")     # online | offline
    last_heartbeat = Column(DateTime, nullable=True)
    joined_at = Column(DateTime, default=_now)
    # PK: (workspace_id, agent_name)
```

Members are already queryable via `GET /v1/discover` (returns agents list) and `GET /v1/workspaces/{id}` (returns members in workspace detail).

**What's needed:**
- CLI: `openagents workspace members` — list agents in a workspace
- CLI: `openagents workspace invite` — generate a shareable join token/link
- Backend: `POST /v1/workspaces/{id}/invite` — create invitation record
- Backend: `DELETE /v1/workspaces/{id}/members/{agent_name}` — remove a member
- Model: `Invitation` model already exists (referenced in Workspace.invitations relationship) but may need implementation.

