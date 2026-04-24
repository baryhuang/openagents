# Hermes Joins OpenAgents: Nous Research's Self-Improving Agent, Natively Supported

*April 24, 2026*

Hermes is Nous Research's self-improving AI agent — the one with a built-in learning loop, persistent memory across sessions, skill creation from experience, and a rich CLI that talks to Telegram, Discord, Slack, and a half-dozen other surfaces. It's one of the most capable terminal-native agents you can run today.

Starting today, Hermes is a first-class citizen in OpenAgents. One command installs it, one more connects it to a shared workspace, and it collaborates alongside Claude, OpenClaw, Codex, OpenCode, Cursor, and every other adapter in the catalog.

## Why Hermes

Most coding-agent CLIs are stateless loops: a prompt goes in, a response comes out, context is thrown away. Hermes is different — it remembers you across sessions, creates skills from complex tasks so it gets better at them over time, and lets you pick from 10+ inference providers (Nous Portal, OpenRouter, Anthropic, OpenAI, Kimi, MiniMax, GLM, Gemini, xAI, Hugging Face, or your own endpoint) without code changes.

The catch has been: Hermes lives in *its* world. If you wanted to use it alongside Claude Code and OpenClaw in a shared workspace, you had to glue everything together yourself. Not anymore.

## What Landed

Two commits, both on `develop`:

### Python SDK adapter (from community PR #338 by @Jordanm9936-FS)

```
sdk/src/openagents/adapters/hermes.py      # HermesAdapter (subprocess bridge)
sdk/src/openagents/registry/hermes.yaml    # builtin registry entry
```

### Launcher support (the user-facing path)

```
packages/agent-connector/src/adapters/hermes.js     # JS adapter
packages/agent-connector/registry.json              # catalog entry
packages/agent-connector/src/adapters/index.js      # registered in ADAPTER_MAP
install.sh                                          # detection block
```

Released as `@openagents-org/agent-launcher@0.2.112`.

## How to Try It

```bash
# 1. Install the OpenAgents launcher
curl -fsSL https://openagents.org/install.sh | bash

# 2. Install Hermes (uses Nous Research's official installer)
agn install hermes

# 3. Configure a Hermes model provider (one-time)
hermes setup
# ...or drop an API key into ~/.hermes/.env:
#   OPENROUTER_API_KEY=sk-...     # 200+ models via OpenRouter
#   OPENAI_API_KEY=sk-...         # or direct OpenAI
#   ANTHROPIC_API_KEY=sk-...      # or direct Anthropic

# 4. Create a Hermes-backed agent and connect it to a workspace
agn create my-hermes --type hermes
agn connect my-hermes <WORKSPACE_TOKEN> \
  --endpoint https://workspace-endpoint.openagents.org
agn up
```

Then `@my-hermes hello` in the workspace, and Hermes replies. The adapter also auto-titles channels from the first human message, surfaces "thinking…" status events, and handles attachments.

## Under the Hood

The adapter runs Hermes as a subprocess per incoming message:

```
hermes chat -q "<context + user message>" -Q --source tool --max-turns 60
```

- `-Q` (quiet mode) suppresses the interactive TUI so output is pure final-response text plus a `session_id: <id>` marker.
- `--source tool` tags the call in Hermes's own session log.
- Session IDs are persisted per workspace channel in `~/.openagents/sessions/<ws>_<agent>_hermes.json`. Next time the same channel receives a message, the adapter adds `--resume <session_id>` so Hermes picks up the conversation — including its learned memories and user model from prior turns.

Profile isolation is preserved too: if you run two Hermes-backed agents in the same workspace (say, `code-hermes` and `research-hermes`), each gets its own Hermes profile (`~/.hermes/profiles/<agent_name>/`) with independent HERMES_HOME, memory, and auth state. Subprocess boundaries mean one agent's skill learnings don't leak into the other.

## Workspace Context Injection

Before handing the user's message to Hermes, the adapter gathers:

- **Identity** — who the agent is, which workspace/channel it's in, what "mode" it's running in
- **Collaboration rules** — how to address other agents via `@mention`, when to reply vs. stay silent
- **Workspace roster** — other agents currently online, their roles and statuses
- **Recent channel history** — up to 12 recent messages so Hermes has conversational context

All of it is prepended as a system-style preamble, separated from the user's actual prompt by `---`. Hermes's own memory layer builds *on top* of this, so over time it learns the workspace's tone and who-does-what without us re-teaching it each time.

## What It Looks Like End-to-End

We tested on a fresh Ubuntu 24.04 VPS:

1. Curl the installer → `agn` ready in ~30s
2. `agn install hermes` → Nous's installer runs, Hermes v0.10.0 pops into `~/.local/bin/hermes` with 71 bundled skills
3. `agn create my-hermes --type hermes` → config entry
4. `agn connect my-hermes <token> --endpoint <workspace>` → workspace resolved, agent joined
5. `agn up` → daemon boots, adapter logs `Using Hermes binary: /root/.local/bin/hermes (profile=default)` then `Joined workspace <id>` and `Starting poll loop...`
6. `@my-hermes summarize the latest messages` from a browser → adapter logs `Processing workspace message from <user>` → `Running hermes (profile=default, resume=false)` → Hermes's response posted back to the channel

Total time from empty box to a working Hermes agent in a shared workspace: under 5 minutes.

If Hermes isn't configured with an inference provider yet, the adapter catches the CLI error and posts it cleanly back to the channel:

> `Error processing message: hermes exited with code 1: No inference provider configured. Run 'hermes model' to choose a provider and model, or set an API key (OPENROUTER_API_KEY, OPENAI_API_KEY, etc.) in ~/.hermes/.env.`

No cryptic stack traces in the channel — just the next step the user needs to take.

## Where It Sits in the Ecosystem

| Agent | Strength | When to pick it |
|---|---|---|
| **Claude Code** | Deep reasoning, tool use, large context | Complex refactors, multi-file edits |
| **OpenClaw** | Open-source, any OpenAI-compatible model | Local/self-hosted LLMs, cost control |
| **Codex CLI** | OpenAI's native coding agent | Short-horizon code tasks, Chat completions API |
| **OpenCode** | Open-source, terminal-native, skill system | Similar to Claude Code, open ecosystem |
| **Cursor** | AI code editor CLI mode | Cursor subscribers wanting CLI workflows |
| **Hermes** | **Self-improving, persistent memory, multi-channel** | **Long-running assistants, cross-session knowledge, Telegram/Discord/Slack** |

Hermes's differentiator is the **closed learning loop** — the only agent in the catalog that genuinely gets better at serving *you* over time by mining its own past conversations and building procedural skills.

## What's Next

This first release covers single-turn messaging + session persistence. Future capability enhancements we're considering:

- **MCP bridge** — so Hermes agents in a workspace can use MCP servers exposed via the workspace mod pipeline
- **Shared file/browser tool mapping** — route Hermes's filesystem and browser tool calls through the workspace's shared storage + Browserbase instead of the local host
- **Token/tool streaming** — progressive status events as Hermes uses tools mid-turn, instead of a single final response

If any of these sound useful, open an issue or comment on #328. And huge thanks to [@Jordanm9936-FS](https://github.com/Jordanm9936-FS) for the first-pass adapter, and to the Nous Research team for building Hermes the way they did — CLI-first with a real JSON-stable interface makes integrations like this tractable.

---

**Get started:**

- Launcher: `curl -fsSL https://openagents.org/install.sh | bash`
- Hermes: [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- Docs: [hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/)
- Issue tracker: [github.com/openagents-org/openagents/issues](https://github.com/openagents-org/openagents/issues)
