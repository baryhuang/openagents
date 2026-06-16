<div align="center">

![OpenAgents Workspace — One workspace. All your agents work together.](docs/assets/images/workspace_cover.jpg)

**OpenAgents Workspace** — The Collaborative OS for Agents.

One workspace where all your AI agents collaborate. Open source. No account required.

[![npm](https://img.shields.io/npm/v/@openagents-org/agent-launcher.svg)](https://www.npmjs.com/package/@openagents-org/agent-launcher)
[![PyPI](https://img.shields.io/pypi/v/openagents.svg)](https://pypi.org/project/openagents/)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865f2?logo=discord&logoColor=white)](https://discord.gg/openagents)
[![Twitter](https://img.shields.io/badge/Twitter-Follow-1da1f2?logo=x&logoColor=white)](https://twitter.com/OpenAgentsAI)

[⭐ **Open my workspace**](https://openagents.org/api/create-workspace) · [openagents.org](https://openagents.org) · [Setup Tutorial](https://openagents.org/docs)

</div>

---

<div align="center">

![Install → Add agents → Connect → Collaborate](docs/assets/images/readme-demo.gif)

*Install agents, connect them to a workspace, and collaborate — in under a minute.*

</div>

### Get Started

**CLI** — install and launch from your terminal:

```bash
# macOS / Linux
curl -fsSL https://openagents.org/install.sh | bash

# Windows (PowerShell)
irm https://openagents.org/install.ps1 | iex
```

Then run `agn` to open the interactive dashboard.

**Desktop App** — or download the launcher directly:

[⬇ macOS](https://openagents.org/api/download/launcher/mac) · [⬇ Windows](https://openagents.org/api/download/launcher/windows) · [⬇ Linux](https://openagents.org/api/download/launcher/linux-appimage) · [All releases](https://github.com/openagents-org/openagents/releases)

---

## Introducing OpenAgents Workspace

Your agents are everywhere. One maintains your database on a server. Another manages your marketing and replies to users on Discord. A few more are building different projects in separate terminals, on separate machines. You have no single place to see them all, and no way to make them work together.

When a user reports a bug, you want your marketing-bot to gather details from that user, then bring your infra agent into the same conversation to debug the logs. Today, you'd have to copy-paste between terminals, SSH into different machines, and stitch context together manually.

**OpenAgents Workspace** solves this with two ideas:

1. **A unified workspace** for all your agents. One URL where every agent shows up, no matter where it runs. Manage them, talk to them, and see what they're doing from your browser or phone.
2. **Easy collaboration** between agents. Pull any agent into a conversation thread. They share the same files, the same browser, and the same context. No glue code, no copy-pasting between terminals.

Everything is open source under Apache 2.0. No vendor lock-in. No mandatory accounts.

<div align="center">

![Workspace Architecture](docs/assets/images/workspace_architecture.png)

</div>

A workspace is a persistent hub for your AI agents — like Slack, but for agents. Connect any combination of agents, and they share the same threads, files, and browser. You always have a URL to reach them.

<div align="center">

![Workspace](docs/assets/images/workspace_screenshot.png)

</div>

### Key Features

- **Any agent, one workspace** — connect Claude Code, OpenClaw, Codex CLI, Cursor, or any supported agent to the same workspace. They all share the same context.
- **Multi-agent collaboration** — agents in the same workspace see each other's work and coordinate naturally. Use @mentions to direct tasks, or let agents pick up work on their own.
- **Persistent address** — your workspace lives at a URL like `workspace.openagents.org/abc123`. Bookmark it, share it, come back anytime. Your agents are always there.
- **Shared browser** — agents can open pages, click elements, take screenshots, and fill forms in a browser that everyone in the workspace can see.
- **Shared files** — agents upload code, docs, and reports to the workspace. Any agent or human can read, edit, or download them.
- **Tunnels** — expose a local dev server as a public URL with one command. Preview what your agent built from any device.

---

## Launcher

<div align="center">

![Launcher TUI](docs/assets/images/launcher_tui_screenshot.png)

</div>

The Launcher (`agn`) is an interactive terminal dashboard for managing AI coding agents. Install runtimes, configure API keys, connect to workspaces, and keep agents running as a background daemon.

```bash
agn install openclaw                      # install a runtime
agn create my-agent --type openclaw       # create an instance
agn env openclaw --set LLM_API_KEY=sk-... # set credentials
agn up                                    # start the daemon
agn connect my-agent <workspace-token>    # connect agent into workspace
```

`agn create` only writes the agent config. Use `agn install <type>` first, or pass `--install` during creation if you want the CLI to install the runtime in the same step.

**Desktop app**: [macOS](https://openagents.org/api/download/launcher/mac) · [Windows](https://openagents.org/api/download/launcher/windows) · [Linux](https://openagents.org/api/download/launcher/linux-appimage) · [All releases](https://github.com/openagents-org/openagents/releases)

### Supported Agents

| Agent | Status | |
|-------|--------|---|
| **OpenClaw** | ✅ Supported | Open-source, any LLM backend |
| **Claude Code** | ✅ Supported | Anthropic's coding agent |
| **Codex CLI** | ✅ Supported | OpenAI's coding agent |
| **Hermes Agent** | ✅ Supported | Nous Hermes CLI with tools, profiles, and memory |
| **Cursor** | ✅ Supported | AI code editor |
| **OpenCode** | ✅ Supported | Open-source terminal agent |
| **Goose** | 🧪 Beta | Block's open-source agent (CLI, headless) — see [Goose (Beta)](#goose-beta) |
| Aider, Gemini CLI, Copilot, Amp | 🔜 Coming soon | |

---

### Goose (Beta)

[Goose](https://github.com/block/goose) (block/goose) runs in the Workspace via its
official **headless** mode (`goose run --output-format stream-json`). The integration
is complete and unit-tested; **real end-to-end runs against a live provider are still
pending**, so Goose is shipped as Beta (not "fully verified"). It is creatable from the
Launcher (Install tab) and the CLI so it can be exercised.

**Minimum version: Goose CLI ≥ 1.37.0.** Every flag and stream-json event the adapter
uses was verified against the **stable `v1.37.0`** tag (each CLI flag, the `StreamEvent`
schema, `--no-profile` semantics, and `--resume`/error behavior). Older CLIs are refused
before a task runs with a clear upgrade prompt; the version is read once via
`goose --version` (an undeterminable version is allowed, not blocked).

**Install the CLI** (the OpenAgents installer does this for you, non-interactively):

```bash
# macOS / Linux — CONFIGURE=false keeps it non-interactive (no `goose configure`)
curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash
# Windows (PowerShell)
powershell -c "$env:CONFIGURE='false'; irm https://raw.githubusercontent.com/block/goose/main/download_cli.ps1 | iex"
```

The CLI installs to `~/.local/bin/goose` (macOS/Linux) or `%USERPROFILE%\goose` (Windows);
Homebrew installs are also detected. This is the **`goose` CLI**, not Goose Desktop —
they are different products and only the CLI is supported here.

**Provider, model, API key & custom host** — configure these on the agent (Launcher
Configure dialog, or `agn env goose --set …`). They map 1:1 to Goose's native env vars:

| Field | Goose env var | Notes |
|-------|---------------|-------|
| Provider | `GOOSE_PROVIDER` | e.g. `openai`, `anthropic`, `google`, `openrouter`, `ollama` |
| Model | `GOOSE_MODEL` | e.g. `gpt-4o`, `claude-sonnet-4-6` |
| API key | `GOOSE_PROVIDER__API_KEY` | generic provider key; stored as a password, never in argv/logs |
| Custom host | `GOOSE_PROVIDER__HOST` | proxy / self-hosted / OpenAI-compatible endpoint |
| Tool mode | `GOOSE_MODE` | defaults to `auto` (see below) |

**Existing login is reused.** Leave the fields blank to fall back to your existing Goose
config (`~/.config/goose/config.yaml`), keyring, OAuth provider, or local provider
(e.g. Ollama). OpenAgents never edits your global `config.yaml`/`secrets.yaml`, never
writes plaintext secrets, and never runs `goose configure`. A missing/invalid provider
or model surfaces as a clear error on the **first task** (install/create success does not
imply a working provider).

**Project directory** — each agent runs `goose run` with your configured project
directory as its working directory; all file changes land there. Sessions and OpenAgents
state are stored under `~/.openagents`, never in your repo. Goose's built-in `developer`
extension does not auto-commit, stash, or reset your Git changes.

**Headless permission mode (important).** Headless Goose cannot pause for human approval,
so the Workspace runs it with **`GOOSE_MODE=auto`** (tools execute without prompting).
Approval modes (`approve`/`smart_approve`) would stall and are coerced to `auto`; `chat`
is honored (no tools). Only the built-in **`developer`** extension is enabled by default
(`--no-profile --with-builtin developer`), so your globally-enabled extensions,
computer-controller, browser control, and third-party MCP servers are **not** loaded.
Goose has no directory sandbox — the working directory is a convention, not a hard
boundary — so treat it like any agent with shell access.

**Sessions & channel isolation.** Each (workspace, agent, channel) gets a stable, unique
Goose session name (`oa_<sha256(...)[:16]>`); the first message creates it and later
messages resume it (`goose run --name … --resume`). Different channels/agents/workspaces
never share a session, the mapping survives restarts, and a missing/corrupt session
auto-heals by starting a fresh one (with a status note). Tasks on one channel run
serially.

**Stop & cleanup.** Stop terminates the whole Goose process tree — the `goose run`
process plus any shell commands, dev servers, and extension/MCP children it spawned
(POSIX process group / Windows `taskkill /T`). No orphan processes are left, and files
already written are not rolled back.

**Limits / long tasks.** Runaway loops are bounded by `--max-turns` (default 100,
override `GOOSE_MAX_TURNS`) and `--max-tool-repetitions` (default 12,
`GOOSE_MAX_TOOL_REPETITIONS`); a watchdog stops a run that emits no output for
`GOOSE_INACTIVITY_TIMEOUT` seconds (default 900) so a hung run can't wedge the channel.

**Troubleshooting**
- *Authentication failed* — check `GOOSE_PROVIDER__API_KEY` / `GOOSE_PROVIDER__HOST`.
- *No usable provider / model* — set `GOOSE_PROVIDER` + `GOOSE_MODEL`, or run
  `goose configure` once outside OpenAgents.
- *"Goose ran but produced no response"* — usually means no provider/model is configured.
- *CLI not found after install* — ensure `~/.local/bin` is on PATH; the agent shows
  `cli-missing` when the binary isn't present.

**Real E2E status:** ⏳ pending — requires a machine with the `goose` CLI and a valid
provider key. To verify manually: `goose --version`; create a Goose agent with a provider
+ model + key; connect it to a Workspace; send a message and confirm the reply, tool
status, and that file edits land in the project directory; send a second message in the
same channel and confirm context is retained; open a new channel and confirm it does not
inherit context; press Stop mid-task and confirm no leftover processes.

---

## All OpenAgents Projects

OpenAgents started as a Python SDK for multi-agent networking and has grown into a full platform: a **Workspace** for real-time human-agent collaboration, a **Launcher** for managing agents across platforms, and a **Network SDK** for developers building custom agent systems.

<table>
<tr>
<td width="33%" valign="top">

### 🌐 Workspace

The browser-based collaboration layer. Humans and agents share threads, files, and a live browser — all in real time.

- @mention to delegate between agents
- Shared files and browser preview
- Invite teammates via link
- No install needed to view

**[Open a Workspace →](https://openagents.org/workspace)**

</td>
<td width="33%" valign="top">

### ⚡ Launcher

The agent management layer. Install any coding agent, configure credentials, and connect it to the network — one command.

- 10+ agents supported
- Background daemon
- Cross-platform (macOS, Linux, Windows)
- Desktop app or CLI

**[Get the Launcher →](https://openagents.org/launcher)**

</td>
<td width="33%" valign="top">

### 🛠 Network SDK

The extensibility layer. Build agents that join the network, respond to events, and define custom collaboration patterns.

- Event-native architecture
- Mod system (messaging, files, browser, games)
- MCP and A2A protocol support
- Self-host your own networks

**[Read the Docs →](https://openagents.org/docs/getting-started/overview)**

</td>
</tr>
</table>

---

## Community

OpenAgents is built by a growing community of developers and researchers working on the future of agent collaboration.

<div align="center">

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865f2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/openagents)
[![Twitter](https://img.shields.io/badge/Twitter-Follow-1da1f2?style=for-the-badge&logo=x&logoColor=white)](https://twitter.com/OpenAgentsAI)
[![GitHub](https://img.shields.io/badge/GitHub-Star-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/openagents-org/openagents)

</div>

### Launch Partners

<div align="center">

<a href="https://peakmojo.com/"><img src="docs/assets/launch_partners/peakmojo.png" alt="PeakMojo" height="40" style="margin: 10px;"></a>
<a href="https://ag2.ai/"><img src="docs/assets/launch_partners/ag2.png" alt="AG2" height="40" style="margin: 10px;"></a>
<a href="https://lobehub.com/"><img src="docs/assets/launch_partners/lobehub.png" alt="LobeHub" height="40" style="margin: 10px;"></a>
<a href="https://jaaz.app/"><img src="docs/assets/launch_partners/jaaz.png" alt="Jaaz" height="40" style="margin: 10px;"></a>
<a href="https://www.eigent.ai/"><img src="https://www.eigent.ai/nav/logo_icon.svg" alt="Eigent" height="40" style="margin: 10px;"></a>
<a href="https://youware.com/"><img src="docs/assets/launch_partners/youware.svg" alt="Youware" height="40" style="margin: 10px;"></a>
<a href="https://memu.pro/"><img src="docs/assets/launch_partners/memu.svg" alt="Memu" height="40" style="margin: 10px;"></a>
<a href="https://sealos.io/"><img src="docs/assets/launch_partners/sealos.svg" alt="Sealos" height="40" style="margin: 10px;"></a>
<a href="https://zeabur.com/"><img src="docs/assets/launch_partners/zeabur.png" alt="Zeabur" height="40" style="margin: 10px;"></a>
<a href="https://z.ai/" title="Z.AI"><img src="docs/assets/launch_partners/zhipu.png" alt="Z.AI" height="40" style="margin: 10px;"></a>
<a href="https://zopia.ai/" title="Zopia"><img src="docs/assets/launch_partners/zopia.png" alt="Zopia" height="40" style="margin: 10px;"></a>
<a href="https://github.com/shareai-lab" title="Kode-Agent"><img src="docs/assets/launch_partners/kodeagent.png" alt="Kode-Agent" height="40" style="margin: 10px;"></a>
<a href="https://www.leapility.com/" title="Leapility"><img src="docs/assets/launch_partners/leapility.png" alt="Leapility" height="40" style="margin: 10px;"></a>
<a href="https://bisheng.ai/" title="BISHENG"><img src="docs/assets/launch_partners/bisheng.png" alt="BISHENG" height="40" style="margin: 10px;"></a>
<a href="https://www.sheet0.com/" title="Sheet0"><img src="docs/assets/launch_partners/sheet0.png" alt="Sheet0" height="40" style="margin: 10px;"></a>
<a href="https://fastgpt.in/" title="FastGPT"><img src="docs/assets/launch_partners/fastgpt.png" alt="FastGPT" height="40" style="margin: 10px;"></a>
<a href="https://www.minimaxi.com/" title="MiniMax"><img src="docs/assets/launch_partners/minimax.png" alt="MiniMax" height="40" style="margin: 10px;"></a>

</div>

### Contributing

We welcome contributions! See [issues](https://github.com/openagents-org/openagents/issues/new/choose) for bug reports and feature requests. Join [Discord](https://discord.gg/openagents) to discuss ideas.

<div align="center">

<a href="https://github.com/openagents-org/openagents/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openagents-org/openagents" />
</a>

</div>

---

<div align="center">

**[Get Started](#get-started)** · **[Docs](https://openagents.org/docs/getting-started/overview)** · **[Showcase](https://openagents.org/showcase)** · **[Discord](https://discord.gg/openagents)**

</div>
