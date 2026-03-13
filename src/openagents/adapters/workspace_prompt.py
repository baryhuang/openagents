"""
Shared workspace prompt builder for all adapters.

Generates system prompt sections that teach agents about:
- Their identity and workspace context
- Multi-agent collaboration (@mention delegation)
- Workspace REST API skills (files, browser, tunnels)

Claude gets these as context alongside MCP tools.
Non-MCP agents (OpenClaw, Codex) get these as actionable API
instructions they can call via curl/requests/fetch.
"""

from typing import Optional


def build_workspace_identity(
    agent_name: str,
    workspace_id: str,
    channel_name: str,
    mode: str = "execute",
) -> str:
    """Build the identity section common to all adapters."""
    return (
        f"You are agent '{agent_name}' connected to an OpenAgents workspace.\n"
        f"Your text responses are automatically posted to the workspace chat "
        f"— just write your answer naturally.\n\n"
        f"## Workspace Context\n"
        f"- Workspace ID: {workspace_id}\n"
        f"- Channel: {channel_name}\n"
        f"- Mode: {mode}\n"
    )


def build_collaboration_prompt() -> str:
    """Build the multi-agent collaboration instructions."""
    return (
        "\n## Multi-Agent Collaboration\n"
        "To delegate work to another agent, @mention them in your response. "
        "Only @mentioned agents will receive the message.\n\n"
        "IMPORTANT: Do NOT @mention an agent just to say thanks or acknowledge "
        "— that wakes them up for nothing. Only @mention when you need them "
        "to do work. When the task is complete, report results to the user "
        "without @mentioning other agents.\n\n"
        "To discover available agents, use the workspace discover endpoint "
        "or the workspace_get_agents tool (if available).\n"
    )


def build_mode_prompt(mode: str) -> str:
    """Build mode-specific instructions."""
    if mode == "plan":
        return (
            "\n## Mode: PLAN\n"
            "You are in PLAN mode. Only read, analyze, and propose.\n"
            "- Do NOT write code, make changes, or execute actions.\n"
            "- Outline your plan step by step.\n"
            "- Describe what changes you would make and why.\n"
            "- Ask clarifying questions if needed.\n"
            "- When the user is satisfied, they can switch you to Execute mode.\n"
        )
    return (
        "\n## Mode: EXECUTE\n"
        "You are in EXECUTE mode. You can write code, make changes, "
        "and take actions.\n"
        "Be helpful, concise, and direct. Use markdown formatting.\n"
    )


def build_api_skills_prompt(
    endpoint: str,
    workspace_id: str,
    token: str,
    agent_name: str,
    channel_name: str,
    disabled_modules: Optional[set] = None,
    mode: str = "execute",
) -> str:
    """Build REST API skill instructions for non-MCP agents.

    These teach the agent how to interact with workspace resources
    (files, browser, tunnels) by calling HTTP endpoints directly
    using curl, Python requests, or any HTTP client.

    In plan mode, only read-only operations are documented.
    """
    _disabled = disabled_modules or set()
    base_url = endpoint.rstrip("/")
    is_plan = mode == "plan"

    sections = []

    sections.append(
        "## Workspace API Skills\n\n"
        "You have access to shared workspace resources via HTTP API. "
        "Use `curl`, Python `requests`, or any HTTP client to call these.\n\n"
        "**Authentication** — include this header on every request:\n"
        f"```\nX-Workspace-Token: {token}\n```\n\n"
        f"**Base URL:** `{base_url}`\n"
    )

    # ── Agents / Discovery ──
    sections.append(
        "\n### Discover Agents\n"
        f"```\nGET {base_url}/v1/discover?network={workspace_id}\n"
        f"X-Workspace-Token: {token}\n```\n"
        "Returns `{\"data\": {\"agents\": [...], \"channels\": [...]}}`\n"
    )

    # ── Files ──
    if "files" not in _disabled:
        files_section = "\n### Shared Files\n"

        files_section += (
            "**List files:**\n"
            f"```\nGET {base_url}/v1/files?network={workspace_id}\n"
            f"X-Workspace-Token: {token}\n```\n"
            "Returns `{\"data\": {\"files\": [{\"id\", \"filename\", \"size\", ...}]}}`\n\n"
        )

        files_section += (
            "**Download file:**\n"
            f"```\nGET {base_url}/v1/files/{{file_id}}\n"
            f"X-Workspace-Token: {token}\n```\n"
            "Returns the raw file bytes.\n\n"
        )

        files_section += (
            "**File info (metadata only):**\n"
            f"```\nGET {base_url}/v1/files/{{file_id}}/info\n"
            f"X-Workspace-Token: {token}\n```\n"
        )

        if not is_plan:
            files_section += (
                "\n**Upload file (JSON base64):**\n"
                f"```\nPOST {base_url}/v1/files/base64\n"
                f"X-Workspace-Token: {token}\n"
                "Content-Type: application/json\n\n"
                "{\n"
                f'  "filename": "report.md",\n'
                f'  "content_base64": "<base64-encoded-content>",\n'
                f'  "content_type": "text/markdown",\n'
                f'  "network": "{workspace_id}",\n'
                f'  "source": "openagents:{agent_name}",\n'
                f'  "channel_name": "{channel_name}"\n'
                "}\n```\n\n"
            )

            files_section += (
                "**Delete file:**\n"
                f"```\nDELETE {base_url}/v1/files/{{file_id}}\n"
                f"X-Workspace-Token: {token}\n```\n"
            )

        sections.append(files_section)

    # ── Browser ──
    if "browser" not in _disabled:
        browser_section = "\n### Shared Browser\n"

        browser_section += (
            "**List tabs:**\n"
            f"```\nGET {base_url}/v1/browser/tabs?network={workspace_id}\n"
            f"X-Workspace-Token: {token}\n```\n"
            "Returns `{\"data\": {\"tabs\": [{\"id\", \"url\", \"title\", ...}]}}`\n\n"
        )

        browser_section += (
            "**Get tab screenshot** (returns PNG):\n"
            f"```\nGET {base_url}/v1/browser/tabs/{{tab_id}}/screenshot\n"
            f"X-Workspace-Token: {token}\n```\n\n"
        )

        browser_section += (
            "**Get accessibility snapshot** (returns text):\n"
            f"```\nGET {base_url}/v1/browser/tabs/{{tab_id}}/snapshot\n"
            f"X-Workspace-Token: {token}\n```\n"
        )

        if not is_plan:
            browser_section += (
                "\n**Open new tab:**\n"
                f"```\nPOST {base_url}/v1/browser/tabs\n"
                f"X-Workspace-Token: {token}\n"
                "Content-Type: application/json\n\n"
                "{\n"
                f'  "url": "https://example.com",\n'
                f'  "network": "{workspace_id}",\n'
                f'  "source": "openagents:{agent_name}"\n'
                "}\n```\n"
                "Returns `{\"data\": {\"id\": \"<tab_id>\", \"url\": \"...\"}}`\n\n"
            )

            browser_section += (
                "**Navigate tab:**\n"
                f"```\nPOST {base_url}/v1/browser/tabs/{{tab_id}}/navigate\n"
                f"X-Workspace-Token: {token}\n"
                "Content-Type: application/json\n\n"
                '{\"url\": \"https://example.com\"}\n```\n\n'
            )

            browser_section += (
                "**Click element:**\n"
                f"```\nPOST {base_url}/v1/browser/tabs/{{tab_id}}/click\n"
                f"X-Workspace-Token: {token}\n"
                "Content-Type: application/json\n\n"
                '{\"selector\": \"button.submit\"}\n```\n\n'
            )

            browser_section += (
                "**Type text:**\n"
                f"```\nPOST {base_url}/v1/browser/tabs/{{tab_id}}/type\n"
                f"X-Workspace-Token: {token}\n"
                "Content-Type: application/json\n\n"
                '{\"selector\": \"input#search\", \"text\": \"hello\"}\n```\n\n'
            )

            browser_section += (
                "**Close tab:**\n"
                f"```\nDELETE {base_url}/v1/browser/tabs/{{tab_id}}\n"
                f"X-Workspace-Token: {token}\n```\n"
            )

        sections.append(browser_section)

    # ── Tunnels ──
    # Tunnels are local-only (run on the agent's machine via cloudflared),
    # not accessible via REST API. Skip for non-MCP agents.

    return "\n".join(sections)


def build_claude_system_prompt(
    agent_name: str,
    workspace_id: str,
    channel_name: str,
    mode: str = "execute",
) -> str:
    """Build the system prompt for Claude adapter (MCP-based).

    Claude gets identity + collaboration instructions but NOT API skills,
    because it uses MCP tools instead.
    """
    parts = []
    parts.append(build_workspace_identity(agent_name, workspace_id, channel_name, mode))
    parts.append(
        "Use workspace_get_history to read previous messages.\n"
        "Use workspace_get_agents to see other agents.\n"
    )
    parts.append(build_collaboration_prompt())

    if mode == "plan":
        parts.append(
            "\nYou are in PLAN mode. Only read, analyze, and propose "
            "changes. Do not make edits.\n"
        )

    parts.append(
        "\nIMPORTANT: Never use AskUserQuestion. "
        "AskUserQuestion blocks the subprocess and will hang the thread. "
        "If you need to ask the user something, just write the question "
        "as your text response.\n"
    )

    return "\n".join(parts)


def build_openclaw_system_prompt(
    agent_name: str,
    workspace_id: str,
    channel_name: str,
    endpoint: str,
    token: str,
    mode: str = "execute",
    disabled_modules: Optional[set] = None,
) -> str:
    """Build the full system prompt for OpenClaw/non-MCP agents.

    Includes identity, collaboration, mode instructions, and
    REST API skills for workspace resources.
    """
    parts = []
    parts.append(build_workspace_identity(agent_name, workspace_id, channel_name, mode))
    parts.append(build_collaboration_prompt())
    parts.append(build_mode_prompt(mode))
    parts.append(build_api_skills_prompt(
        endpoint=endpoint,
        workspace_id=workspace_id,
        token=token,
        agent_name=agent_name,
        channel_name=channel_name,
        disabled_modules=disabled_modules,
        mode=mode,
    ))
    return "\n".join(parts)
