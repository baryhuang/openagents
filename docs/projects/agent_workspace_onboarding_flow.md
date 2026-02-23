# Agent Workspace — Developer Onboarding Flow

**Status:** Current implementation (2026-02-23)
**Codebases:**
- **SDK:** `~/works/openagents` — CLI, adapter, workspace client
- **Web:** `~/works/openagents-web` — FastAPI backend + Next.js frontend

---

## Quick Start

```bash
# Install everything (openagents CLI + Claude Code)
curl -fsSL https://workspace.openagents.org/install.sh | bash

# Connect — registers agent, creates workspace, starts listening
openagents connect claude
```

That's it. The install script handles Python checks, pip install, and Claude Code setup. Then `connect` does the rest.

### Manual install (alternative)

```bash
pip install openagents                                    # SDK + CLI
curl -fsSL https://claude.ai/install.sh | bash            # Claude Code
openagents connect claude                                  # Go
```

---

## What Happens Under the Hood

### Step-by-step: `openagents connect claude`

```
Developer runs: openagents connect claude
    |
    v
1. Resolve identity
   - Checks ~/.openagents/identity.json for saved agent name + API key
   - If no saved identity, generates a random name (e.g. "claude-blue-fox")
   - Can override with --name flag
    |
    v
2. Register agent (POST /v1/agentid/register)
   - Registers the agent name on the OpenAgents network
   - Requires API key (--api-key or OA_API_KEY env var or saved via `openagents login`)
   - Agent names are globally unique
   - Idempotent: re-registering an existing name is fine (409 = already exists)
    |
    v
3. Create workspace (POST /v1/ws)
   - Creates a new workspace with the agent as "master"
   - Returns: workspace_id, session_id, token, URL
   - No auth required for this step (workspace is anonymous by default)
    |
    v
4. Print workspace URL
   - URL: https://workspace.openagents.org/{workspace_id}?token={ws_token}
   - Developer opens this in any browser
    |
    v
5. Start adapter loop
   - Heartbeat every 30s (POST /v1/ws/{id}/agents/{name}/heartbeat)
   - Poll for messages every 2-15s (GET /v1/ws/{id}/sessions/{sid}/messages?after={cursor})
   - On new message: spawn `claude` CLI subprocess to process it
   - Post response back via workspace MCP tools
   - Press Ctrl+C to disconnect
```

### Message Processing Flow

```
User types in browser
  |
  v
Frontend sends: POST /v1/ws/{id}/sessions/{sid}/messages
  |
  v
Adapter polls, picks up new message
  |
  v
Spawns: claude -p "{message}" --output-format stream-json --verbose
  |
  +---> Claude reads files, writes code, runs commands
  |     (intermediate tool use streamed as status messages)
  |
  +---> Claude calls workspace_send_message MCP tool
  |     (response appears in browser)
  |
  v
Adapter syncs cursor past all new messages, resumes polling
```

---

## CLI Commands

| Command | Purpose |
|---------|---------|
| `openagents connect claude` | Register + create workspace + start adapter |
| `openagents login --api-key oa-xxx` | Save API key for future use |
| `openagents rename <new-name>` | Rename local agent identity |
| `openagents mcp-server --workspace-id ... --session-id ...` | Start MCP server (used internally by adapter) |

### `connect claude` flags

| Flag | Default | Description |
|------|---------|-------------|
| `--api-key` | `OA_API_KEY` env or saved | OpenAgents API key |
| `--name` | auto-generated | Custom agent name |
| `--workspace-name` | random hex | Custom workspace name |
| `--endpoint` | `https://endpoint.openagents.org` | API endpoint |

---

## Files and Components

### SDK (`~/works/openagents/src/openagents/`)

| File | Role |
|------|------|
| `cli.py` | `connect_claude`, `login_cmd`, `rename_cmd`, `mcp_server_cmd` |
| `workspace_client.py` | HTTP client for workspace API + identity storage (`~/.openagents/identity.json`) |
| `adapters/claude.py` | `ClaudeAdapter` — polls messages, spawns `claude` CLI, streams responses |
| `mcp_server.py` | MCP server providing workspace tools to the Claude subprocess |

### Backend (`~/works/openagents-web/backend/`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/agentid/register` | POST | Register agent name (requires API key) |
| `/v1/ws` | POST | Create workspace |
| `/v1/ws/{id}` | GET | Get workspace details |
| `/v1/ws/{id}/sessions` | POST | Create new session |
| `/v1/ws/{id}/sessions/{sid}/messages` | GET | Poll messages (supports `?after=` cursor) |
| `/v1/ws/{id}/sessions/{sid}/messages` | POST | Send message |
| `/v1/ws/{id}/agents/{name}/heartbeat` | POST | Agent heartbeat |
| `/v1/ws/{id}/agents/{name}/disconnect` | POST | Agent disconnect |

### Frontend (`~/works/openagents-web/workspace_frontend/`)

Next.js app at `workspace.openagents.org/{workspace_id}?token={ws_token}`:
- Chat interface with session sidebar
- Polls for messages (2s active / 15s idle)
- Settings dialog for workspace name
- Human messages (blue, right-aligned), agent messages (left-aligned), status messages (centered, italic)

---

## Identity and Storage

### Local identity file: `~/.openagents/identity.json`

```json
{
  "api_key": "oa-xxxxx",
  "agents": {
    "claude": {
      "agent_name": "claude-blue-fox",
      "agent_type": "claude",
      "api_key": "oa-xxxxx"
    }
  }
}
```

Created automatically by `openagents connect claude` or `openagents login`.

### Workspace token

- Format: `ws_{base64}` (e.g. `ws_ybVVZTY_d6CYP5I0RD-B6y1fyBSqpw8jIdin4Go_5TI`)
- Passed as `Authorization: Bearer {token}` for all workspace API calls
- Embedded in the workspace URL as `?token=` query parameter
- Anyone with the token can read/write to the workspace

---

## Architecture Decisions

### Why CLI subprocess instead of SDK?

The adapter spawns `claude -p --output-format stream-json` as a subprocess rather than using the `claude-agent-sdk` Python package. Reasons:

1. **Rate limit resilience** — The SDK crashes on `rate_limit_event` messages (`MessageParseError: Unknown message type`). The CLI handles rate limits internally with its own retry logic.
2. **No Python dependency** — Only needs `claude` CLI installed.
3. **Simpler code** — Parse JSON lines, skip unknown event types. No retry/backoff machinery needed.

### Why polling instead of WebSocket?

- Works through any firewall/proxy
- Stateless — agent can disconnect and reconnect without losing messages
- Adaptive polling (2s when active, 15s when idle) keeps load minimal
- Messages are persisted server-side, so nothing is lost

### Why MCP for workspace tools?

The Claude subprocess gets workspace access via an MCP server (`openagents mcp-server`) rather than direct API calls. This means:
- Claude uses its standard tool-calling interface
- No custom code injection into the Claude prompt
- Tools are discoverable and permission-controlled

---

## Known Limitations

1. **API key required** — Agent registration needs an `oa-` API key. There's no self-service key creation flow yet. Workspace creation itself is anonymous, so the registration step could be simplified.
2. **No reconnect to existing workspace** — Each `openagents connect claude` creates a new workspace. There's no `--workspace-id` flag to rejoin an existing one.
3. **Single session** — The adapter listens on the default session created with the workspace. If the user creates additional sessions in the UI, the adapter won't see messages in those.
4. **Frontend is local dev only** — `workspace.openagents.org` doesn't exist yet; testing uses `localhost:3001`.
5. **Agent name collision** — Names are globally unique. Two developers picking the same name will conflict.
