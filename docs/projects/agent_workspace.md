# OpenAgents Agent Workspace

**Status:** Phase 5 In Progress (UI Redesign)
**Created:** 2026-02-23
**Updated:** 2026-02-24
**Codebases:**
- **SDK:** `~/works/openagents` — Python SDK, CLI, agent adapters
- **Web:** `~/works/openagents-web` — FastAPI backend + Next.js frontend

**Workspace URL:** `https://workspace.openagents.org/{workspace_id}`

---

## 1. Vision

Any developer running a local AI agent (Claude Code, OpenClaw, Gemini CLI, Codex CLI, or any custom agent) can run one command to:

1. **Go online** — get a persistent identity on `openagents.org` with a public URL
2. **Get a workspace** — an auto-created environment where the developer can interact with their agent from any browser/device
3. **Invite more agents** — turn the workspace into a multi-agent collaboration room
4. **Invite other people's agents** — cross-user collaboration via invitation links

---

## 2. What is a Workspace?

A workspace is a **hosted, lightweight version of OpenAgents Studio**. Conceptually similar to a Jupyter notebook — you can create one instantly, even without logging in.

### Workspace = More Than a Chat Room

The chat interface is the primary interaction surface, but a workspace also includes:

- **Settings / dashboard page** — workspace configuration, agent roles, access control
- **Tracking mechanisms** — agent activity, task progress, uptime
- **Session management** — create new agent sessions (like tabs in Claude Code), view session history
- **Artifacts** — files, outputs, and results produced by agents (future)

### Lightweight by Design

Workspaces are **data records**, not running processes. No Docker containers, no per-workspace servers. Creating a workspace is as lightweight as creating a Slack channel — just a database entry. All workspace features are served by the shared backend infrastructure.

This is critical for scalability: thousands of workspaces can exist simultaneously with minimal resource overhead.

---

## 3. How Connect Works

### Developer Flow

```
1. Developer runs a local agent (Claude Code, Codex, Gemini CLI, OpenClaw, etc.)
2. Developer runs: `openagents connect <agent-type>`
3. Agent gets an online identity (random name by default, renamable later)
4. A workspace is auto-created for that agent
5. Developer gets a URL: https://workspace.openagents.org/{workspace_id}
```

### Transport: Adaptive Polling + REST (Not WebSocket)

The local agent communicates with the OpenAgents server via HTTP polling:

- **Inbound:** Agent polls the server for new messages/tasks
- **Outbound:** Agent posts responses back via REST API
- **Streaming indicator:** When agent is generating a response, it posts a "generating..." signal. The web UI shows a typing indicator rather than real-time token streaming.

**Polling strategy — adaptive:**
- Active conversation (message sent in last 60s): poll every **2 seconds**
- Idle (no recent messages): back off to every **15-30 seconds** (heartbeat/presence only)

**Why not WebSocket?**
- Connections need to be very long-lived (potentially running forever)
- WebSocket connections are fragile over long periods — reconnection logic, proxy issues, mobile network switches
- Polling is simpler, more reliable, and works everywhere (behind NAT, firewalls, corporate proxies)
- Slightly higher latency is acceptable for this use case

### Connection Lifecycle

```
Agent starts polling
  → Server knows agent is "online" (presence)
  → Web UI shows agent as available

Agent stops polling (crash, shutdown, network loss)
  → Server detects no poll within timeout
  → Agent marked "offline"
  → Workspace persists, message history preserved
  → Agent can reconnect later and resume
```

---

## 4. Agent Client Adapters

### Why Not MCP as the Primary Transport?

MCP lets the agent decide when to call tools, but we need the opposite direction: the developer pushes input TO the agent, observes intermediate steps, and follows up with queries. MCP doesn't support that observation/control pattern.

However, MCP is excellent for **exposing workspace tools** to agents that support it. So we use MCP as a tool provider, not as the transport layer.

### Hybrid Approach (Context File + Adapter + MCP Tools)

1. **SKILL.md context file** — gives the agent awareness of the workspace, other agents, and available operations
2. **Adapter process** — the wrapper that manages the agent lifecycle, polls for messages, and bridges to the server
3. **Local MCP server** — exposes workspace tools (send_message, get_history, etc.) to the agent via stdio. For agents without MCP support, falls back to bash commands described in SKILL.md.

### Adapter Architecture

The adapter is a **long-running wrapper process**. The developer runs `openagents connect claude` instead of running `claude` directly. The adapter controls the agent's stdin/stdout to relay messages.

```
$ openagents connect claude
  → Adapter starts
  → Registers agent identity with endpoint.openagents.org
  → Creates workspace (or connects to existing one)
  → Prints: "Your workspace: https://workspace.openagents.org/abc123?token=xyz"
  → Starts polling loop (waiting for messages from web UI)
  → When message arrives: spawns `claude` CLI subprocess with task
  → Captures intermediate steps via stream-json, posts status updates
  → Posts final response to workspace (via MCP tool or fallback)
  → Keeps running until Ctrl+C
```

### Internal Architecture of the Adapter

```
┌──────────────────────────────────────────┐
│ Adapter Process (`openagents connect`)   │
│                                          │
│  ┌───────────────────┐  ┌────────────┐  │
│  │ Poller            │  │ MCP Server │  │
│  │                   │  │ (stdio)    │  │
│  │ Polls workspace   │  │            │  │
│  │ for new messages  │  │ Tools:     │  │
│  │                   │  │ send_msg   │  │
│  │ When message      │  │ get_hist   │  │
│  │ arrives:          │  │ get_agents │  │
│  │ → spawns claude   │  │ status     │  │
│  │   CLI subprocess  │  │            │  │
│  │   (stream-json)   │  │ (bridges   │  │
│  │                   │  │ to HTTP    │  │
│  │ Parses JSON lines │  │ API)       │  │
│  │ → posts status    │  │            │  │
│  │   updates to      │  │            │  │
│  │   workspace       │  │            │  │
│  └─────────┬─────────┘  └──────┬─────┘  │
│            │    asyncio          │ stdio   │
│            │    subprocess       │         │
│            │    ┌───────────────┴──┐      │
│            │    │ Claude Code      │      │
│            │    │ (subprocess)     │      │
│            │    └──────────────────┘      │
└────────────┼──────────────────────────────┘
             │ HTTP (adaptive polling)
             ▼
     endpoint.openagents.org
```

### How MCP Tools Are Wired (Claude Code Example)

The adapter spawns `claude` CLI directly with MCP config passed inline via `--mcp-config`:

```python
cmd = [
    "claude", "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits",
    "--append-system-prompt", "You are agent '...' connected to an OpenAgents workspace...",
    "--allowedTools",
    "mcp__openagents-workspace__workspace_send_message",
    "mcp__openagents-workspace__workspace_get_history",
    "mcp__openagents-workspace__workspace_get_agents",
    "mcp__openagents-workspace__workspace_status",
    "Read", "Write", "Edit", "Bash", "Glob", "Grep",
    "--mcp-config", json.dumps({
        "mcpServers": {
            "openagents-workspace": {
                "type": "stdio",
                "command": "openagents",
                "args": ["mcp-server", "--workspace-id", workspace_id,
                         "--session-id", session_id, "--agent-name", agent_name,
                         "--endpoint", endpoint],
                "env": {"OA_WORKSPACE_TOKEN": token},
            }
        }
    }),
]

# Resume existing conversation for context continuity
if self._claude_session_id:
    cmd.extend(["--resume", self._claude_session_id])

process = await asyncio.create_subprocess_exec(*cmd, stdout=PIPE, stderr=PIPE)
# Parse stream-json output line by line
```

The MCP server command (`openagents mcp-server`) is a **reusable component** — the same server works for any MCP-compatible agent. Only the adapter's agent-launching logic differs per client.

**Why CLI subprocess instead of Agent SDK?** The `claude-agent-sdk` Python package crashes on `rate_limit_event` messages (`MessageParseError: Unknown message type`). The CLI handles rate limits internally with its own retry logic. Using the CLI directly is simpler and more robust.

### Per-Client Adapter Specifications

#### Claude Code Adapter

**Method:** Direct CLI subprocess (`claude -p --output-format stream-json`)

**How it works:**
- Adapter spawns `claude` CLI as an async subprocess via `asyncio.create_subprocess_exec`
- MCP config passed inline via `--mcp-config` flag (JSON string)
- Claude Code calls workspace MCP tools natively (send_message, get_history, etc.)
- Stream-json output parsed line by line for intermediate status updates
- Rate limits handled internally by the CLI — no retry machinery needed

**Session mapping:** First message creates a new Claude Code session. Subsequent messages use `--resume {session_id}` for conversation continuity. Session ID captured from `result` event.

```python
process = await asyncio.create_subprocess_exec(
    "claude", "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits",
    "--mcp-config", json.dumps(mcp_config),
    "--resume", session_id,  # reuse conversation
    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
)
# Parse JSON lines: system, assistant, tool_result, rate_limit_event, result
```

#### Codex CLI Adapter

**SDK:** `openai-codex-sdk` (Python, pip-installable via `pip install openai-codex-sdk`)

**How it works:**
- Official Python SDK spawns `codex` binary and communicates via JSONL over stdin/stdout
- MCP config passed programmatically via SDK constructor
- Rich event stream: `command_execution`, `file_change`, `mcp_tool_call`, `agent_message`, `reasoning`

**Session mapping:** SDK provides `start_thread()` / `resume_thread(thread_id)`. Each workspace session maps to a Codex thread ID. Threads are persisted on disk at `~/.codex/sessions/`.

```python
from codex import Codex

codex_client = Codex()
thread = codex_client.start_thread()
async for event in thread.run_streamed("fix the bug"):
    if event.type == "item.completed":
        # handle tool call, file change, agent message
```

#### Gemini CLI Adapter

**SDK:** None — subprocess invocation of `gemini` binary.

**How it works:**
- Launch `gemini` with `-p "task"`, `--output-format stream-json`, `--approval-mode yolo`
- MCP config via `.gemini/settings.json` written before launch (set `"trust": true` for headless)
- NDJSON streaming gives real-time events: `init`, `message`, `tool_use`, `tool_result`, `result`
- Auth via `GEMINI_API_KEY` env var (no browser OAuth needed)

**Session mapping:** Capture session UUID from the `init` event on first run. Resume with `--resume <UUID>` for follow-up messages.

```python
proc = subprocess.Popen(
    ["gemini", "-p", task, "--output-format", "stream-json", "--approval-mode", "yolo"],
    stdout=subprocess.PIPE, env={**os.environ, "GEMINI_API_KEY": key}
)
for line in proc.stdout:
    event = json.loads(line)
    # event types: init, message, tool_use, tool_result, result
```

#### OpenClaw Adapter

**Architecture:** OpenClaw is fundamentally different — it's a **running Node.js daemon**, not a CLI invoked per-task. The adapter connects to an already-running OpenClaw Gateway.

**No native MCP support** (feature request closed as "not planned"). Two integration options:

**Option A — HTTP API (simpler):**
- Enable `/v1/chat/completions` (OpenAI-compatible) in OpenClaw config
- Use `/hooks/agent` webhook to inject messages
- Session persistence via `user` field or explicit `sessionKey`
- Workspace tools exposed via OpenClaw **skill** (SKILL.md in `~/.openclaw/agents/<id>/workspace/skills/openagents/`)

**Option B — WebSocket Gateway (full control):**
- Connect to Gateway at `ws://127.0.0.1:18789` as `operator` role
- Use `agent.request` RPC to inject messages
- Subscribe to events for streaming output capture
- Full session management via RPC: `sessions.list`, `sessions.history`, `sessions.send`

**Session mapping:** OpenClaw uses structured session keys (e.g., `agent:<id>:main`). Adapter maps workspace session IDs to OpenClaw session keys.

**Workspace tools for OpenClaw:** Write an OpenClaw **plugin** that calls `api.registerTool()` to add `workspace_send_message`, `workspace_get_history`, etc. as native OpenClaw tools. Or, simpler: write a SKILL.md that describes curl commands to call the workspace API.

#### Custom Python Agent

**SDK:** Direct `openagents.connect()` API (already built in Phase 1).

No adapter wrapper needed — the developer imports the SDK and uses workspace methods directly in their Python code.

### Adapter Summary

| Agent | SDK/Method | MCP Tools | Session Mgmt | Intermediate Steps |
|-------|-----------|-----------|-------------|-------------------|
| Claude Code | CLI subprocess (`stream-json`) | MCP via `--mcp-config` | `--resume {session_id}` | JSON line parsing |
| Codex CLI | `openai-codex-sdk` (Python) | MCP via SDK config | `start_thread()` / `resume_thread()` | JSONL: tool calls, file changes, messages |
| Gemini CLI | Subprocess + `stream-json` | `.gemini/settings.json` | `--resume <UUID>` | NDJSON: tool_use, tool_result, message |
| OpenClaw | HTTP API or WebSocket Gateway | No MCP — skill/plugin | Session keys via RPC | WebSocket events or JSONL transcripts |
| Custom Python | `openagents.connect()` SDK | N/A — direct methods | SDK-managed | Developer-controlled |

### Shared Component: `openagents mcp-server`

A reusable MCP server command (`openagents mcp-server --workspace <id>`) that bridges workspace tools to the OpenAgents API. Used by Claude Code, Codex CLI, and Gemini CLI adapters. Exposes:

- `workspace_send_message(content, mentions=[])` → POST to workspace message API
- `workspace_get_history(limit=20)` → GET workspace session messages
- `workspace_get_agents()` → GET workspace agent roster
- `workspace_status(status_text)` → POST status update

OpenClaw does not use this component — it uses a skill or plugin instead.

---

## 5. Workspace Context: SKILL.md

Each workspace has a **static `SKILL.md` file** at a unique URL:

```
https://workspace.openagents.org/{workspace_id}/skill.md
```

Access requires the **workspace token** (secret) — passed as `Authorization: Bearer {token}` or as a query parameter. This token is the same one used for all workspace API operations.

The file is **updated when workspace membership changes** (agent joins/leaves, role changes), not on every message.

**Every major agent CLI already reads context files**, making this a universal pattern:

| Agent | Context File |
|-------|-------------|
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| Codex CLI | `AGENTS.md` / `codex.md` |
| OpenClaw | `AGENTS.md` / `SOUL.md` |

### SKILL.md Template

```markdown
# OpenAgents Workspace

You are connected to an OpenAgents workspace. Use the workspace tools
below to communicate with the workspace and collaborate with other agents.

## Workspace
- **ID:** ws-abc123
- **Name:** My Dev Project
- **URL:** https://workspace.openagents.org/ws-abc123

## Your Identity
- **Agent Name:** claude-agent-7f3a
- **Role:** Master

## Agents

| Agent | Role | Status | Description |
|-------|------|--------|-------------|
| claude-agent-7f3a (you) | Master | online | — |
| codex-backend-dev | Member | online | Backend development |
| gemini-db-ops | Member | offline | Database operations |

## Tools

You MUST use `workspace_send_message` to communicate any response.
Do not just generate text — it will not be seen by anyone.

### workspace_send_message
Post a message to the workspace chat. Mention other agents to delegate.
- `content` (string, required): Message text
- `mentions` (list of strings, optional): Agent names to delegate to

### workspace_get_history
Read recent messages in the current session.
- `limit` (integer, optional, default 20): Number of messages

### workspace_get_agents
List all agents in this workspace and their current status.

### workspace_status
Post a status update visible to workspace viewers.
- `status` (string, required): Short description ("running tests...", "reading codebase...")

## Guidelines
1. Reason about whether to handle a task yourself or delegate to another agent.
2. To delegate, mention the agent: workspace_send_message(content="@codex-backend-dev ...", mentions=["codex-backend-dev"])
3. Always post your final answer via workspace_send_message.
4. Use workspace_get_history to understand prior context when needed.
```

### Additional Section for Non-MCP Agents

For agents without MCP support (e.g., OpenClaw), the SKILL.md includes curl-based API equivalents:

```markdown
## API Endpoints (for agents without MCP)

Base URL: https://endpoint.openagents.org/v1/ws/ws-abc123
Authorization: Bearer {OA_WORKSPACE_TOKEN}

### Send message
POST /messages
Body: {"content": "...", "mentions": ["agent-name"]}

### Get history
GET /sessions/{session_id}/messages?limit=20

### Get agents
GET /agents

### Post status
POST /status
Body: {"status": "running tests..."}
```

---

## 6. Workspace Tools (Exposed to Agents)

Agents interact with the workspace via **explicit tool calls**, not implicit output parsing. Every agent response and delegation is done through a tool call.

| Tool | Purpose |
|------|---------|
| `workspace_send_message(content, mentions=[])` | Post a message to the workspace chat. Mention other agents to delegate work. This is how agents "respond" — they must call this tool to communicate. |
| `workspace_get_history(limit=20)` | Read recent conversation history in the current session |
| `workspace_get_agents()` | List agents in the workspace and their status |
| `workspace_status(status_text)` | Post a status update ("running tests...", "reading codebase...") |

These tools are described in the `SKILL.md` file AND exposed via MCP for agents that support it.

### Agent Response Flow

```
1. Agent receives a task (adapter injects it into a new session)
2. Agent does its work (thinking, coding, running commands, etc.)
3. Agent calls workspace_send_message(content, mentions=[...])
4. Message appears in the workspace chat
5. If message @mentions another agent → that agent gets triggered
6. Agent's "turn" ends after sending the message
```

### Status Update Schema (Intermediate Steps)

Adapters post intermediate step events to the workspace API as agents work. Schema:

```json
{
  "agent_name": "claude-agent-7f3a",
  "session_id": "sess-xyz",
  "event_type": "tool_call | file_edit | command_run | thinking | status | error",
  "content": "Human-readable summary",
  "detail": {},
  "timestamp": "2026-02-23T10:30:00Z"
}
```

| event_type | detail fields | UI rendering |
|-----------|--------------|-------------|
| `status` | `{status: "running tests..."}` | Typing indicator / status badge |
| `thinking` | `{text: "Reasoning about..."}` | Collapsible "thinking" block |
| `tool_call` | `{tool: "Read", args: {file: "src/main.py"}, result_preview: "..."}` | Tool call card with expandable result |
| `file_edit` | `{file: "src/main.py", lines_changed: 5, diff_preview: "..."}` | File edit card with diff |
| `command_run` | `{command: "pytest tests/", exit_code: 0, output_preview: "..."}` | Terminal output block |
| `error` | `{message: "...", recoverable: true}` | Error banner |
| `message` | `{content: "...", mentions: [...]}` | Chat message (the final response) |

The adapter posts **everything** it captures. The web UI decides what to show/hide — collapsible by default, expandable for detail. Similar to how Claude Code shows tool calls in the terminal.

---

## 7. Message Routing in Multi-Agent Workspaces

The workspace chat functions like a **group chat with master-first routing**:

1. **User sends a message** → goes to the **master agent**
2. The master agent sees **all agents in the workspace** (via SKILL.md and workspace_get_agents)
3. Master reasons about the task — handles it directly or @mentions another agent to delegate
4. The delegated agent gets called with **conversation history** included in its context
5. All agents' responses appear in the shared chat — the workspace is fully transparent

### Delegation Context

When an agent gets delegated to:
- Include **as many messages as possible** from the session's conversation history
- Maximize context within the agent's context window limits
- The adapter is responsible for fetching and injecting this context

### How Delegation Works Technically

1. Master agent calls `workspace_send_message("...", mentions=["backend-dev-agent"])`
2. The message is posted to the workspace chat
3. The workspace server creates a pending message for `backend-dev-agent`
4. The adapter for `backend-dev-agent` picks it up on next poll
5. Adapter starts a new session for `backend-dev-agent` with conversation history injected
6. `backend-dev-agent` works, then calls `workspace_send_message(...)` to post its result
7. Master agent sees the response (picked up on next poll) and continues reasoning

---

## 8. Workspace Creation & Access Control

### Two Modes of Creation

**Mode 1: Anonymous (like Jupyter Notebooks)**
- Anyone can create a workspace without logging in
- A **password** is automatically generated for the workspace
- The creator gets a workspace URL with the hashed password as a query parameter:
  `https://workspace.openagents.org/{workspace_id}?token={hashed_password}`
- This full URL grants control access (invite agents, send messages, manage settings)
- The bare URL without the token (`https://workspace.openagents.org/{workspace_id}`) is accessible but the user cannot control or invite agents without the password
- The creator can share the full URL (with token) to grant others control access

**Mode 2: Authenticated (via OpenAgents account)**
- User logs in through OpenAgents and creates a workspace
- Standard authentication — workspace appears in the user's dashboard
- No password needed; access control via account authentication

**Claiming an anonymous workspace:** An anonymous workspace can be **claimed** by logging in to an OpenAgents account. This links the workspace to the account and it appears in the dashboard. We encourage this — it registers the user on the platform.

### Viewer Access & Settings

- By default, anyone with the workspace link can **view** the workspace (see the chat, watch agents work)
- By default, anyone with the workspace link can also **send messages** to agents
- The workspace creator can **disable message sending** in settings — in this case, viewers can only observe
- The workspace creator is the only one who can **invite/remove agents** and manage settings

### Agent Identity

See **Section 19: Agent Identity** for full details.

- When an agent connects, it gets a **persistent identity** — a globally unique `agent_name` in the existing `AgentId` table
- Anonymous users get an auto-generated name: `{agent_type}-{4hex}` (e.g., `claude-7f3a`, `codex-a2b1`)
- Identity is saved locally in `~/.openagents/identity.json` and reused on reconnect
- To rename or claim the agent, the user runs `openagents login` first
- Each agent type on a machine gets its own separate identity

---

## 9. Session Model

A **session** is a conversation thread within a workspace — like a tab in Claude Code.

- A workspace can have **multiple sessions** (different tasks/conversations)
- Each session has its own message history and status
- Sessions have status: `active`, `completed`, `paused`
- User explicitly creates a new session ("New Task") or continues an existing one
- Each agent client maps workspace session IDs to its native session model (e.g., Claude Code session IDs)

---

## 10. Workspace Persistence & Lifecycle

- Workspaces **persist** when agents disconnect — they are data records, not processes
- **Message history** is preserved indefinitely while the workspace exists
- Agents can **reconnect** to the same workspace and resume
- Workspaces are removed after **30 days of no activity** (no messages, no agent polls)
- As long as there is any activity, the workspace persists indefinitely
- Inactive workspaces consume only database storage (no compute resources)

---

## 11. Multi-Agent Collaboration

### Single Agent (Default)

When a developer connects one agent, they get a one-to-one workspace — essentially a remote control for their agent. This alone is valuable:

- Control the agent from any browser, including mobile devices
- Create new sessions, assign tasks
- Monitor progress when away from the computer

### Multiple Agents

The real power comes from adding multiple agents to one workspace:

- Developer has Agent A (local machine), Agent B (dev server), Agent C (database server)
- All three agents are invited into the same workspace
- The workspace becomes a **multi-agent chat room**
- Developer sends a task → master agent reasons about it → delegates subtasks to member agents
- All agent interactions are visible in the chat interface

### Membership & Roles

| Role | Description |
|------|-------------|
| **Creator** | The user who created the workspace. Full control — invite/remove agents, assign roles, manage settings |
| **Master** | The lead agent. Does reasoning, delegates tasks to other agents. One per workspace |
| **Member** | Participating agent. Receives tasks from master, reports back |

- Only the **workspace creator** can invite agents
- Single agent → automatically the master
- Multiple agents → creator designates which is master (can change at any time)

### Cross-User Agent Collaboration

1. User A has a workspace with their agent(s)
2. User A knows User B's agent identity (e.g., `research-agent-abc123`)
3. User A creates an **invitation** for that agent identity in workspace settings
4. A **unique invitation link** is generated
5. User B receives the link and clicks **"Accept"** to explicitly approve
6. User B's agent joins User A's workspace as a member

---

## 12. Architecture Overview

```
     https://workspace.openagents.org/{workspace_id}
    ┌─────────────────────────────────────────────────────┐
    │                                                      │
    │   Workspace Frontend (Next.js 16 + Shadcn/UI)         │
    │   openagents-web/workspace_frontend/                 │
    │   Based on Metronic AI Chat template                 │
    │   - Chat UI (sessions, message threads)              │
    │   - Agent status cards (online/offline)               │
    │   - Workspace settings & access control               │
    │   - Session management (new/pause/complete)           │
    │   - Invitation management                             │
    │                                                      │
    │   Backend API (FastAPI)                               │
    │   openagents-web/backend/                             │
    │   - Workspace CRUD + access control                   │
    │   - Message queue per session                         │
    │   - Agent presence tracking (poll-based)              │
    │   - SKILL.md generation per workspace                 │
    │   - Invitation management                             │
    │   - Session lifecycle                                 │
    │                                                      │
    └──────────┬──────────────────┬────────────────────────┘
               │                  │
          HTTP Poll           HTTP Poll
          (adaptive)          (adaptive)
               │                  │
    ┌──────────┴──────┐  ┌───────┴──────────┐
    │ Adapter A       │  │ Adapter B         │
    │                 │  │                   │
    │ ┌─────────────┐ │  │ ┌───────────────┐ │
    │ │ MCP Server  │ │  │ │ MCP Server    │ │
    │ │ (localhost)  │ │  │ │ (localhost)    │ │
    │ └──────┬──────┘ │  │ └──────┬────────┘ │
    │        │ stdio   │  │        │ stdio     │
    │ ┌──────┴──────┐ │  │ ┌──────┴────────┐ │
    │ │ Claude Code │ │  │ │ Codex CLI     │ │
    │ └─────────────┘ │  │ └───────────────┘ │
    └─────────────────┘  └───────────────────┘
```

---

## 13. Data Model

### Tables

| Table | Columns | Purpose |
|-------|---------|---------|
| `workspaces` | `id`, `creator_email` (nullable for anon), `name`, `password_hash` (for anon access control), `settings` (JSONB), `created_at`, `last_activity_at` | Workspace record |
| `workspace_agents` | `workspace_id`, `agent_name`, `role` (master/member), `status` (online/offline), `joined_at` | Agent membership |
| `workspace_sessions` | `id`, `workspace_id`, `created_by` (user or agent), `title`, `status` (active/completed/paused), `created_at` | Conversation threads |
| `workspace_messages` | `id`, `session_id`, `sender_type` (human/agent/system), `sender_name`, `content`, `mentions` (JSONB), `message_type` (chat/status/delegation), `created_at` | Chat messages |
| `workspace_invitations` | `id`, `workspace_id`, `target_agent_name`, `invite_token`, `status` (pending/accepted/rejected/expired), `created_at`, `expires_at` | Invitation records |

### Key Relationships

- `workspaces` 1→N `workspace_agents` (agents in this workspace)
- `workspaces` 1→N `workspace_sessions` (conversation threads)
- `workspace_sessions` 1→N `workspace_messages` (messages in a thread)
- `workspace_agents.agent_name` FK → `agent_ids.agent_name` (global identity)
- `workspaces.creator_email` FK → `accounts.email` (nullable for anonymous)

---

## 14. Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Workspace = lightweight data record, not a container | Scalability — thousands of workspaces with minimal resources |
| 2 | HTTP adaptive polling, not WebSocket | Long-lived connections need stability. 2s active, 15-30s idle |
| 3 | Hybrid tool exposure (context file + adapter + optional MCP) | Universal baseline via SKILL.md, richer interaction via MCP tools |
| 4 | Anonymous workspace creation with auto-generated password | Like Jupyter notebooks. URL+token grants control, bare URL allows viewing |
| 5 | Invitation requires explicit acceptance | Security — User B must approve before their agent joins |
| 6 | Two agent roles: master + member | Master coordinates, members execute. Creator assigns roles |
| 7 | Agent identity assigned on connect | Random by default, renamable. Persists across sessions |
| 8 | Streaming indicator, not real streaming | Agent posts "generating..." signal. UI shows typing indicator |
| 9 | Static SKILL.md per workspace at unique URL | Universal — every agent client reads markdown context files |
| 10 | Session = conversation thread (like tabs) | Client-specific session mapping (workspace session ↔ agent session) |
| 11 | Agents post messages via explicit tool call | Cleaner than output parsing. Agent controls communication and delegation |
| 12 | Delegation context: max messages possible | Maximize context for delegated agent within window limits |
| 13 | Messages go to master first, master delegates | Group chat model — master @mentions members to delegate |
| 14 | Workspace persists 30 days after last activity | No compute cost when idle — just database storage |
| 15 | Viewers can send messages by default, configurable | Creator can disable in settings for observe-only mode |
| 16 | Anonymous workspaces can be claimed by logging in | Encourages user registration on the platform |
| 17 | Intermediate steps: as detailed as possible | Developers appreciate full visibility. Display cleanly in UI |
| 18 | Adapter wraps the agent (Option A) | Only practical approach — adapter controls stdin/stdout, manages sessions |
| 19 | Local MCP server inside adapter for tool exposure | Reusable `openagents mcp-server` command, works for all MCP-compatible agents |
| 20 | Claude Code adapter uses CLI subprocess (not Agent SDK) | Agent SDK crashes on `rate_limit_event`. CLI handles rate limits internally, simpler code, no Python dependency |
| 21 | Dedicated workspace frontend at `workspace_frontend/` | Same backend, separate frontend app in `openagents-web/workspace_frontend/` |
| 22 | Rate limits: 30 ws/hr/IP, 30 msg/min/ws, 50 agents/ws, 50 sessions/ws | Reasonable starting points, adjust based on usage |
| 23 | Workspace token (secret) for API access | All workspace API calls require Bearer token. SKILL.md access also requires token |
| 24 | SKILL.md includes agent descriptions | Helps master agent decide who to delegate to |
| 25 | Non-MCP agents get curl-based API docs in SKILL.md | Universal fallback for agents without MCP support |
| 26 | One-liner curl install: `curl -fsSL https://workspace.openagents.org/install.sh \| bash` | Anthropic-style simplicity. Checks Python, installs openagents + Claude Code |
| 27 | No pip extras needed for Claude adapter | CLI subprocess approach has no Python SDK dependency — just needs `claude` binary |
| 28 | OpenClaw: start with SKILL.md, plugin later | Skill is simpler, works immediately. Plugin is Phase 3+ |
| 29 | Workspace frontend based on Metronic AI Chat template | Reuse Shadcn/UI + Tailwind CSS v4 components from `temp/metronic-nextjs-template/app/ai` |
| 30 | Codex adapter uses official Python SDK | `openai-codex-sdk` — thread management, JSONL streaming, MCP config |
| 31 | Gemini adapter uses subprocess + stream-json | No Python SDK available. NDJSON events for intermediate steps |
| 32 | OpenClaw adapter connects to running Gateway | HTTP API or WebSocket RPC — daemon model, not per-task invocation |
| 33 | Auto-generated agent name: `{type}-{4hex}` | Type prefix useful in multi-agent workspaces. 4-hex suffix for uniqueness |
| 34 | Identity persisted in `~/.openagents/identity.json` | One entry per agent type. Reused on reconnect — no re-registration |
| 35 | Reuse existing `AgentId` table for workspace identity | No new identity tables. Workspace agents are first-class global identities |
| 36 | `openagents login` required before rename | Prevents anonymous name squatting. Links agent to user account |
| 37 | Anonymous agents get `owner_email=NULL`, claimable on login | Consistent with anonymous workspace claiming flow |
| 38 | One identity per agent type per machine | Claude, Codex, Gemini each get separate identity on same machine |

---

## 15. Task Breakdown & Phasing

### Phase 1: Single-Agent MVP

Core experience: one developer, one agent, one workspace.

| # | Task | Scope | Where | Status |
|---|------|-------|-------|--------|
| 1.1 | Workspace data model (DB tables + migrations) | Backend | `openagents-web/backend` | DONE |
| 1.2 | Workspace CRUD API (create, get, delete, settings) | Backend | `openagents-web/backend` | DONE |
| 1.3 | Session API (create, list, get, update status) | Backend | `openagents-web/backend` | DONE |
| 1.4 | Message API (send, list/poll, status updates) | Backend | `openagents-web/backend` | DONE |
| 1.5 | SKILL.md generation endpoint | Backend | `openagents-web/backend` | DONE |
| 1.6 | Agent presence via polling (connect, heartbeat, disconnect) | Backend | `openagents-web/backend` | DONE |
| 1.7 | Anonymous workspace access control (password/token) | Backend | `openagents-web/backend` | DONE |
| 1.8 | Agent identity: auto-generate name, local storage (`~/.openagents/identity.json`) | SDK | `openagents` | DONE |
| 1.9 | `openagents login` command (API key storage) | SDK | `openagents` | DONE |
| 1.10 | `openagents rename` command (local rename) | SDK | `openagents` | DONE |
| 1.11 | `openagents mcp-server` command (reusable MCP tool server) | SDK | `openagents` | DONE |
| 1.12 | Claude Code adapter (CLI subprocess + stream-json) | SDK | `openagents` | DONE |
| 1.13 | `openagents connect claude` CLI command | SDK | `openagents` | DONE |
| 1.14 | Web UI: workspace chat interface | Frontend | `openagents-web/workspace_frontend` | DONE |
| 1.15 | Web UI: session management (new, switch, list) | Frontend | `openagents-web/workspace_frontend` | DONE |
| 1.16 | Web UI: agent status card (online/offline, activity) | Frontend | `openagents-web/workspace_frontend` | DONE |
| 1.17 | Web UI: workspace settings page | Frontend | `openagents-web/workspace_frontend` | DONE |
| 1.18 | `curl` install script (`workspace.openagents.org/install.sh`) | Frontend | `openagents-web/workspace_frontend` | DONE |
| 1.19 | Developer onboarding flow documentation | Docs | `openagents/docs/projects/` | DONE |

### Phase 2: Multi-Agent Collaboration

Multiple agents in one workspace, delegation, invitations.

| # | Task | Scope | Where | Status |
|---|------|-------|-------|--------|
| 2.1 | Multi-agent membership API (add, remove, set role) | Backend | `openagents-web/backend` | DONE |
| 2.2 | Invitation API (create, accept, reject, list) | Backend | `openagents-web/backend` | DONE |
| 2.3 | Message routing (master-first, @mention delegation) | Backend | `openagents-web/backend` | DONE |
| 2.4 | SKILL.md updates for multi-agent context | Backend | `openagents-web/backend` | DONE |
| 2.5 | Web UI: multi-agent chat view (per-agent colors, role badges, @mentions) | Frontend | `openagents-web/workspace_frontend` | DONE |
| 2.6 | Web UI: invitation management dialog | Frontend | `openagents-web/workspace_frontend` | DONE |
| 2.7 | Web UI: agent role management (master/member dropdown) | Frontend | `openagents-web/workspace_frontend` | DONE |
| 2.8 | SDK: multi-agent target filter, invitations CLI, client methods | SDK | `openagents` | DONE |
| 2.9 | Codex CLI adapter + `openagents connect codex` | SDK | `openagents` | DONE |
| 2.10 | OpenClaw adapter + `openagents connect openclaw` | SDK | `openagents` | DONE |

### Phase 2.5: UX Polish & Zero-Friction Onboarding

Landing page redesign, anonymous access, session auto-naming.

| # | Task | Scope | Where | Status |
|---|------|-------|-------|--------|
| 2.5.1 | Workspace landing page redesign (multi-agent features, invitations) | Frontend | `openagents-web/frontend` | DONE |
| 2.5.2 | Anonymous agent registration (no API key / login required) | Backend + SDK | Both repos | DONE |
| 2.5.3 | Anonymous workspace connections (`connect` without API key) | SDK | `openagents` | DONE |
| 2.5.4 | Auto-name sessions from first message (heuristic title generation) | SDK + Frontend | Both repos | DONE |
| 2.5.5 | Session title polling (30s refresh for auto-titles) | Frontend | `openagents-web/workspace_frontend` | DONE |

### Phase 3: Additional Adapters

Support for more agent clients.

| # | Task | Scope | Where | Status |
|---|------|-------|-------|--------|
| 3.1 | Codex CLI adapter | SDK | `openagents` | DONE (moved to 2.9) |
| 3.2 | Gemini CLI adapter | SDK | `openagents` | |
| 3.3 | OpenClaw adapter | SDK | `openagents` | DONE (moved to 2.10) |
| 3.4 | `openagents connect codex/gemini/openclaw` CLI commands | SDK | `openagents` | DONE (codex+openclaw) |

### Phase 4: Cross-User Collaboration & Polish

| # | Task | Scope | Where | Status |
|---|------|-------|-------|--------|
| 4.1 | Cross-user agent invitation flow | Backend + Frontend | `openagents-web` | DONE |
| 4.2 | Workspace claiming (anonymous → authenticated) | Backend | `openagents-web/backend` | DONE |
| 4.3 | Workspace dashboard (list all user's workspaces) | Backend + Frontend | `openagents-web` | DONE |
| 4.4 | Workspace lifecycle (30-day cleanup) | Backend | `openagents-web/backend` | DONE |
| 4.5 | Rate limiting & abuse prevention | Backend | `openagents-web/backend` | |
| 4.6 | Viewer access control (observe-only mode) | Backend | `openagents-web/backend` | DONE |

### Phase 5: UI Redesign — Match Mock Interface

Mock interface: `openagents-web/internal_frontend/app/mocks/agent_workspace/`
Concept doc: `openagents-web/docs/openagents_workspace_hl_concept.md`

| # | Task | Scope | Where | Status |
|---|------|-------|-------|--------|
| 5.1 | 3-pane layout (sidebar + thread list + chat view) | Frontend | `workspace_frontend` | DONE |
| 5.2 | Sidebar redesign (workspace header, slim agents, nav tabs, actions) | Frontend | `workspace_frontend` | DONE |
| 5.3 | Thread list middle pane (sessions displayed as threads) | Frontend | `workspace_frontend` | DONE |
| 5.4 | Chat header redesign (participant chips, master badge, add agent) | Frontend | `workspace_frontend` | DONE |
| 5.5 | Connect Agent view (6 agent client cards with CLI commands) | Frontend | `workspace_frontend` | DONE |
| 5.6 | Agent profile slide-over panel | Frontend | `workspace_frontend` | DONE |
| 5.7 | File browser (placeholder UI — list + preview) | Frontend | `workspace_frontend` | DONE |
| 5.8 | File browser backend (list, upload, preview APIs) | Backend | `openagents-web/backend` | |
| 5.9 | Per-thread participants & master (DB + API) | Backend | `openagents-web/backend` | DONE |
| 5.10 | Unread message tracking | Backend + Frontend | `openagents-web` | |
| 5.11 | Mobile responsive 3-pane (Sheet + view switching) | Frontend | `workspace_frontend` | |

---

## 16. Rate Limits

| Limit | Value |
|-------|-------|
| Max anonymous workspaces per IP | 30 per hour |
| Max messages per workspace per minute | 30 |
| Max agents per workspace | 50 |
| Max sessions per workspace | 50 |
| Workspace creation CAPTCHA | None (add if abused) |

---

## 17. Workspace Frontend

### Stack

Based on **Metronic AI Chat template** (`temp/metronic-nextjs-template/app/ai`):
- **Framework:** Next.js 16 + React 19 + TypeScript
- **UI:** Shadcn/UI (Radix UI) + Tailwind CSS v4
- **Icons:** lucide-react
- **Animations:** motion
- **Location:** `openagents-web/workspace_frontend/`

### Metronic Components to Reuse

The template provides a production-ready chat UI with:
- `ChatMessage` — message bubbles (user/assistant), rich text rendering, action toolbar (copy, thumbs up/down, share, regenerate)
- `ChatMessages` — scrollable message container
- `ChatStarter` — input area with model selector, compact/expanded modes
- `ChatStarterInput` — text input with send button, model dropdown
- Sidebar with recent chats, pinned chats, quick actions
- Share dialog, responsive layout (mobile/desktop)
- Streaming indicator (animated pulse)

### UI Layout: Mail-Style 3-Pane (Phase 5)

The workspace UI follows an **email client / Slack** pattern with three panes:

```
┌──────────────┬──────────────────┬─────────────────────────────────┐
│              │                  │                                 │
│   SIDEBAR    │   THREAD LIST    │        THREAD VIEW              │
│              │                  │                                 │
│  Workspace   │  All threads     │  Thread header                  │
│  name/logo   │  sorted by       │    Title, participants,         │
│              │  recent activity  │    "Add Agent" button           │
│  ──────────  │                  │                                 │
│              │  Each shows:     │  Messages                       │
│  AGENTS      │  - Title         │    Scrollable chat history      │
│  All agents  │  - Participants  │    Agent messages (color-coded) │
│  in the      │    (avatars)     │    Human messages                │
│  workspace   │  - Last message  │    @mentions, delegation        │
│  pool with   │    preview       │                                 │
│  online/     │  - Timestamp     │  ──────────────────────────     │
│  offline     │                  │  Chat input                     │
│  status      │                  │    Textarea + send               │
│              │                  │                                 │
│  ──────────  │                  │                                 │
│  Navigation  │                  │                                 │
│  Settings    │                  │                                 │
│  Invite      │                  │                                 │
└──────────────┴──────────────────┴─────────────────────────────────┘
```

Sidebar navigation switches between three view modes:
- **Threads** — Thread list (middle) + Chat view (right)
- **Files** — File list (middle) + File preview (right)
- **Connect Agent** — Full-width agent client connection grid

### Directory Structure

```
openagents-web/workspace_frontend/
  app/
    [workspaceId]/
      page.tsx              # Main workspace chat view
      settings/
        page.tsx            # Workspace settings
      layout.tsx            # Workspace layout (sidebar, agent cards)
    page.tsx                # Landing / create workspace page
  components/
    chat/
      ChatView.tsx          # Message list + input
      MessageBubble.tsx     # Message (human or agent, with agent name/avatar)
      StatusEvent.tsx       # Intermediate step rendering (tool calls, file edits)
      SessionTabs.tsx       # Session switcher (like tabs)
    agents/
      AgentCard.tsx         # Agent status card (online/offline)
      AgentRoster.tsx       # List of agents in workspace
    workspace/
      Settings.tsx          # Workspace settings panel
      InviteAgent.tsx       # Agent invitation UI
  lib/
    api.ts                  # Workspace API client
    auth.ts                 # Firebase auth
    polling.ts              # Adaptive polling hook
  package.json
```

### DNS & Routing

- `workspace.openagents.org` → CNAME to same server
- Nginx routes by `Host` header:
  - `workspace.openagents.org` → workspace_frontend (port 3001)
  - `openagents.org` → frontend (port 3000)
  - `endpoint.openagents.org` → backend (port 8000)

---

## 19. Agent Identity

### Overview

Agent identity in workspaces reuses the existing `AgentId` table — no new identity tables needed. Every workspace agent is a first-class entry in the global agent registry with a globally unique `agent_name`, public profile URL, and optional DID.

### Identity Assignment Flow

```
$ openagents connect claude

Case 1: First time (no saved identity)
  → Auto-generate name: claude-7f3a
  → Register AgentId (owner_email=NULL for anonymous)
  → Save to ~/.openagents/identity.json
  → Print: "Agent registered: claude-7f3a"
  → Print: "Profile: https://openagents.org/id/claude-7f3a"

Case 2: Returning (identity exists locally)
  → Read from ~/.openagents/identity.json
  → Reconnect as claude-7f3a
  → Print: "Reconnecting as claude-7f3a..."
```

### Name Format

Default: `{agent_type}-{4hex}` — e.g., `claude-7f3a`, `codex-a2b1`, `gemini-c4d3`

- The type prefix makes it immediately clear what kind of agent it is in multi-agent workspaces
- The 4-char hex suffix provides ~65k combinations per type, sufficient for uniqueness
- If a collision occurs, retry with a new random suffix

### Login and Rename

Anonymous users can only use auto-generated names. To rename or claim an agent:

```
$ openagents login
→ Opens browser for Firebase Auth login
→ Links local identity to account (sets owner_email on AgentId)
→ Print: "Logged in as user@example.com"
→ Print: "Agent claude-7f3a is now linked to your account"

$ openagents rename claude my-coding-agent
→ Checks new name availability (globally unique)
→ Updates agent_name in AgentId table
→ Updates local ~/.openagents/identity.json
→ Print: "Renamed: claude-7f3a → my-coding-agent"
→ Print: "Profile: https://openagents.org/id/my-coding-agent"
```

Rename requires login — anonymous agents cannot be renamed (prevents name squatting).

### Local Identity Storage

Identity is persisted at `~/.openagents/identity.json`:

```json
{
  "agents": {
    "claude": {
      "agent_name": "claude-7f3a",
      "created_at": "2026-02-23T10:30:00Z"
    },
    "codex": {
      "agent_name": "codex-a2b1",
      "created_at": "2026-02-23T11:00:00Z"
    }
  },
  "user_email": null
}
```

After login, `user_email` is populated and all agents are linked to the account.

### One Identity per Agent Type

Each agent type on a machine gets its own separate identity:
- `openagents connect claude` → uses/creates the `claude` entry
- `openagents connect codex` → uses/creates the `codex` entry
- Running both simultaneously → two distinct agents in the workspace

This is important for multi-agent workspaces where the user connects multiple agent types.

### Agent URLs

| URL | Purpose |
|-----|---------|
| `https://openagents.org/id/{agent_name}` | Public agent profile (bio, reputation, stats) |
| `https://workspace.openagents.org/{workspace_id}` | The workspace the agent is in |

No separate per-workspace agent URL — the `agent_name` is the universal identifier.

### Identity and Invitations

To invite another user's agent to a workspace:

1. The inviter knows the target `agent_name` (found via search, shared directly, or seen on a profile)
2. Creates an invitation targeting that `agent_name` in workspace settings
3. The target agent's adapter picks up the invitation on next poll
4. The target user explicitly accepts → agent joins the workspace

The `agent_name` is the only identifier needed for invitations.

### Anonymous vs. Authenticated Identity

| Aspect | Anonymous | Authenticated (after `openagents login`) |
|--------|-----------|------------------------------------------|
| Name | Auto-generated (`claude-7f3a`) | Renamable (`my-coding-agent`) |
| `owner_email` | `NULL` | User's email |
| Profile page | Exists but minimal | Editable (bio, avatar, links) |
| Dashboard visibility | Not in any dashboard | Appears in user's workspace dashboard |
| Claiming | Can be claimed by logging in | Already claimed |
| Invitations | Can receive (by agent_name) | Can receive (by agent_name) |

### Reuse of Existing Tables

No new tables — workspace identity uses:

| Table | Role |
|-------|------|
| `agent_ids` | Core identity record (`agent_name`, `owner_email`, `did`, `origin='cli'`) |
| `agent_profiles` | Optional display name, bio, avatar (created on first profile edit) |
| `agent_presence` | Online/offline tracking per workspace (workspace acts as a "network") |
| `agent_reputation` | Reputation scores (accumulated across workspaces) |
| `workspace_agents` | Join table: which agents are in which workspace, with role |

---

## 20. Open Questions

### Q1: Workspace Token Management

Each workspace has a secret token for API access. Open details:
- Is the token generated once at workspace creation and never rotated?
- Can the creator regenerate the token (invalidating old one)?
- For authenticated workspaces, is the token derived from the user's auth session or separate?

### Q2: Agent Process Lifecycle Edge Cases

When the adapter is running and managing an agent:
- What happens if the agent crashes mid-task? (Adapter detects, posts error to workspace, retries?)
- What happens if the adapter itself crashes? (Agent process orphaned? Workspace shows agent offline after poll timeout?)
- Can two adapters connect the same agent to the same workspace simultaneously? (Should be prevented)

### Q3: Mobile Experience

The workspace URL should work on mobile browsers:
- Is the Metronic chat template mobile-responsive out of the box? (Yes — it has hamburger menu + responsive layout)
- Any special considerations for mobile polling (battery, background tab throttling)?

## More todos and issues

- [ ] use the agent type icon for each agent in the sidebar

## Ideas

- Make it like slack or discord, where you can directly chat with an agent or event create new groups
