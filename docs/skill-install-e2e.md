# Skill Hub → Launcher → Agent Skill Install (end-to-end)

This document describes the end-to-end Skill installation pipeline wired up on
the `feature/skill-install-e2e` branch, and how to verify it manually.

> **Claude vs Codex support level.** Claude Code consumes skills via its
> **native project-level `.claude/skills/` discovery**. Codex has **no native
> skill support**; this change gives it a **minimal working path via
> system-context SKILL.md discovery** — installed skills are written to
> `.codex/skills/<id>/` and the adapter injects a list (with a `cat <path>`
> read instruction) into Codex's system context. Do not describe the Codex
> path as native Skill support.

## The chain

```
Workspace UI (Skill Hub)
  │  click "Add"  → POST /v1/workspaces/{id}/members/{agent}/skills/install {skill_id}
  ▼
Workspace backend (workspaces.py: install_skill)
  │  1. look up skill in skill_catalog (source_repo / source_path)
  │  2. set enabled_skills.skill_status[id] = {state: "installing"}
  │  3. emit a workspace.agent.control event:
  │       type:    workspace.agent.control
  │       target:  openagents:<agent>
  │       payload: { action: "skill.install", skill: {id,name,source_repo,source_path} }
  │     (persisted as an EventRecord + published to ws:{id}:events for SSE)
  ▼
Launcher daemon → adapter control poller (base.js _pollControl)
  │  GET /v1/events?type=workspace.agent.control&target=openagents:<agent>
  │  dispatch action → BaseAdapter._handleSkillInstall(payload)
  ▼
skill-installer.js
  │  1. resolve skills dir by agent type:
  │       claude → <workingDir>/.claude/skills/<id>/
  │       codex  → <workingDir>/.codex/skills/<id>/
  │       cursor → <workingDir>/.cursor/skills/<id>/
  │       other  → <workingDir>/.agent/skills/<id>/
  │  2. fetch files (git sparse-checkout of source_repo/source_path,
  │     fallback: raw SKILL.md over HTTPS)
  │  3. verify a SKILL.md actually landed (else throw — no silent success)
  ▼
Launcher reports back → POST /v1/workspaces/{id}/members/{agent}/skills/status
  │  { skill_id, state: "installing"|"installed"|"failed", path?, error? }
  ▼
Workspace backend (report_skill_status)
  │  update enabled_skills.skill_status + installed[]; publish workspace.skill.status
  ▼
Workspace UI
     discovery poll (every 5–15s) re-reads agent.enabled_skills.skill_status
     → badge shows Installing… / Installed / Failed · Retry
```

### Why this design

- **Reuses the existing control channel.** `workspace.agent.control` events were
  already polled per-agent by every adapter (used for `stop`, `restart`,
  `set_mode`, `status`). We added two new actions (`skill.install`,
  `skill.uninstall`) rather than inventing a new transport.
- **Real install, not a UI flag.** The backend never marks a skill `installed`
  itself. Only the launcher's `/skills/status` callback (after files land on
  disk) flips the state to `installed`. A failed fetch reports `failed` with the
  error message.
- **Claude vs Codex.** Claude Code natively auto-discovers `.claude/skills/<id>/SKILL.md`,
  so installing the files is enough. Codex has no native discovery, so the Codex
  adapter injects an "Installed Skills" section into its system context that
  lists each installed skill and the `cat <path>/SKILL.md` command to read it.

## Files changed

| File | Change |
|------|--------|
| `packages/agent-connector/src/skill-installer.js` | **New.** Core installer: per-type dir resolution, install/uninstall, list-installed, default git+HTTPS fetcher, SKILL.md verification. |
| `packages/agent-connector/src/adapters/base.js` | `skill.install` / `skill.uninstall` control actions → install on disk + report status; `_onSkillsChanged` hook. |
| `packages/agent-connector/src/adapters/codex.js` | Route control actions to base (`super._onControlAction`); inject installed skills into system context. |
| `packages/agent-connector/src/workspace-client.js` | `reportSkillStatus()` → POST `/skills/status`. |
| `workspace/backend/app/routers/workspaces.py` | `install_skill` emits control event + sets `installing`; new `report_skill_status` endpoint; `uninstall_skill` emits control event; `_emit_agent_control_event` + `_set_skill_status` helpers. |
| `workspace/backend/app/skill_catalog.py` | `find_skill(id)` lookup. |
| `workspace/frontend/components/skills/skills-view.tsx` | Badge driven by `skill_status` (Installing…/Installed/Failed·Retry). |
| `workspace/frontend/lib/types.ts` | Widen `enabledSkills` to `Record<string, unknown>`; add `SkillState` / `SkillStatusEntry`. |

Tests:
- `packages/agent-connector/test/skill-installer.test.js` (unit: dir resolution, install/uninstall/list, base + codex wiring)
- `packages/agent-connector/test/skill-install-smoke.test.js` (integration: real WorkspaceClient + stub backend, poll→install→report)
- `workspace/backend/tests/test_skill_install.py` (install event emission, status callback, failure, uninstall, discover round-trip, Codex parity)

## Manual verification

### 1. Start the backend
```bash
cd workspace/backend
# Postgres + Redis via docker-compose, or your usual dev DB
uvicorn app.main:app --reload --port 8000
```

### 2. Start the frontend (Skill Hub UI)
```bash
cd workspace/frontend
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
# open http://localhost:3000/<workspace-slug>
```

### 3. Connect a Claude agent via the launcher
```bash
# install the agent runtime + create an instance
agn install claude
agn create my-claude --type claude
agn connect my-claude <workspace-token>   # token from UI: Settings → Copy Token
agn up                                     # start the daemon
agn logs -f                                # tail logs in another terminal
```

### 4. Install a skill from the Skill Hub
1. Open the **Skill Hub** in the workspace sidebar.
2. Click a simple skill (e.g. **Claude API**).
3. Under **Add to Agent**, click **Add** next to `my-claude`.
4. Button shows **Installing…**.

### 5. Confirm the launcher received and executed the install
In `agn logs`, you should see:
```
adapter [my-claude]: skill.install: starting install of "claude-api" (type=claude, dir=...)
adapter [my-claude]: skill.install: Fetched anthropics/skills/skills/claude-api via git sparse-checkout
adapter [my-claude]: skill.install: SUCCESS "claude-api" → <workingDir>/.claude/skills/claude-api
```

### 6. Confirm the skill is on disk
```bash
ls <agent-working-dir>/.claude/skills/claude-api/
# → SKILL.md  (+ any scripts/references the skill ships)
```

### 7. Confirm the UI shows "Installed"
Within ~5–15s (discovery poll) the badge flips from **Installing…** to a green
**Installed**.

### 8. Confirm Claude can use the skill
Send a message in the workspace that needs the skill; Claude Code auto-discovers
`.claude/skills/claude-api/SKILL.md` and uses it.

### 9. Repeat for Codex
```bash
agn create my-codex --type codex
agn env codex --set OPENAI_API_KEY=sk-...
agn connect my-codex <workspace-token>
```
Install a skill onto `my-codex` from the Skill Hub. Verify:
```bash
ls <agent-working-dir>/.codex/skills/<skill>/   # → SKILL.md
```
Codex's system context now contains an **Installed Skills** section pointing at
`.codex/skills/<skill>/SKILL.md`; ask it to perform a task the skill covers and
it will `cat` and follow the SKILL.md.

### 10. Failure path
Install a skill whose `source_repo` is unreachable, or disconnect the network.
The launcher logs:
```
adapter [my-claude]: skill.install: FAILED "<id>": could not fetch skill ...
```
and POSTs `state: "failed"`. The UI badge turns red: **Failed · Retry**; the
backend logs an ERROR with the reason. Click **Failed · Retry** to re-queue.

## Security & robustness notes

- **Per-agent scoping.** Status lives in `WorkspaceMember.enabled_skills`, keyed
  by `(workspace_id, agent_name)`. Installing on Claude never touches Codex. The
  control event targets `openagents:<agent>` and each adapter only polls events
  with its own target, so only the intended agent installs.
- **Input validation (launcher-side).** The control-event payload is treated as
  untrusted. `skill-installer.js` validates `id` (`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`,
  not `.`/`..`), `source_repo` (`owner/repo`), and each `source_path` segment,
  then asserts the resolved dir stays inside the agent's skills dir. This blocks
  path traversal (a malicious `id`/`source_path` escaping the dir) and arg
  injection (a value starting with `-` read as a git/curl flag). `git`/`curl`
  are invoked via `execFile` (no shell). `uninstall` runs the same containment
  check before deleting.
- **Auth.** `/skills/install`, `/skills/uninstall`, and `/skills/status` all
  require the workspace token (`_verify_workspace_access`) and a real member
  (404 otherwise) — consistent with the rest of the workspace API. A request
  without/with a wrong token is rejected, so "installed" cannot be forged
  anonymously. (Per-agent session attribution, like the heartbeat `session_id`
  check, is a possible future tightening — see follow-ups.)
- **Partial installs are not silent.** The git path fetches the whole skill
  directory. The HTTPS fallback can only retrieve `SKILL.md`; when it's used the
  installer returns `partial:true`, logs a `WARNING`, reports `partial` to the
  backend (stored in `skill_status[id].partial`), and the backend logs a
  `WARNING`. So a skill that needs bundled scripts is never shown as a clean
  install without a trace.

## Follow-ups / possible improvements

- **Frontend automated tests**: the frontend package has no test runner today;
  adding Vitest + React Testing Library would let us assert the badge state
  machine directly (deferred to avoid introducing a heavy new dependency here).
- **Offline-agent queueing**: an install requested while an agent is offline is
  only delivered if the agent reconnects before the control event scrolls past
  its cursor. The UI already restricts installs to online agents; a durable
  "pending install on next connect" queue would harden this.
- **Progress granularity**: today we report `installing`/`installed`/`failed`.
  Large skills could stream finer progress (downloading, extracting).
- **Dependency / version pinning**: catalog entries pin a repo+path but not a
  ref; pinning a commit/tag would make installs reproducible.
