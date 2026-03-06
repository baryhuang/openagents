"""
Daemon configuration — YAML-based persistent config for agent connections.

Config file: ~/.openagents/daemon.yaml
"""

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

CONFIG_DIR = Path.home() / ".openagents"
CONFIG_PATH = CONFIG_DIR / "daemon.yaml"
PID_PATH = CONFIG_DIR / "daemon.pid"
LOG_PATH = CONFIG_DIR / "daemon.log"
STATUS_PATH = CONFIG_DIR / "daemon.status.json"

DEFAULT_ENDPOINT = "https://workspace-endpoint.openagents.org"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class AgentEntry:
    """A single agent in a workspace."""
    name: str
    type: str  # claude, openclaw, codex
    role: str = "worker"
    options: dict = field(default_factory=dict)


@dataclass
class WorkspaceEntry:
    """A workspace with its agents."""
    id: str
    slug: str
    name: str
    token: str
    endpoint: str = DEFAULT_ENDPOINT
    agents: list[AgentEntry] = field(default_factory=list)


@dataclass
class DaemonConfig:
    """Top-level daemon configuration."""
    version: int = 1
    workspaces: list[WorkspaceEntry] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Load / Save
# ---------------------------------------------------------------------------

def load_config(path: Optional[Path] = None) -> DaemonConfig:
    """Load daemon config from YAML. Returns empty config if file missing."""
    p = Path(path) if path else CONFIG_PATH
    if not p.exists():
        return DaemonConfig()

    try:
        raw = yaml.safe_load(p.read_text()) or {}
    except Exception as e:
        logger.warning(f"Failed to parse {p}: {e}")
        return DaemonConfig()

    workspaces = []
    for ws_raw in raw.get("workspaces", []):
        agents = [
            AgentEntry(
                name=a["name"],
                type=a["type"],
                role=a.get("role", "worker"),
                options=a.get("options", {}),
            )
            for a in ws_raw.get("agents", [])
        ]
        workspaces.append(WorkspaceEntry(
            id=ws_raw["id"],
            slug=ws_raw.get("slug", ""),
            name=ws_raw.get("name", ""),
            token=ws_raw["token"],
            endpoint=ws_raw.get("endpoint", DEFAULT_ENDPOINT),
            agents=agents,
        ))

    return DaemonConfig(
        version=raw.get("version", 1),
        workspaces=workspaces,
    )


def save_config(config: DaemonConfig, path: Optional[Path] = None) -> None:
    """Save daemon config to YAML."""
    p = Path(path) if path else CONFIG_PATH
    p.parent.mkdir(parents=True, exist_ok=True)

    data = {
        "version": config.version,
        "workspaces": [
            {
                "id": ws.id,
                "slug": ws.slug,
                "name": ws.name,
                "token": ws.token,
                "endpoint": ws.endpoint,
                "agents": [
                    {
                        k: v for k, v in {
                            "name": a.name,
                            "type": a.type,
                            "role": a.role,
                            "options": a.options or None,
                        }.items() if v is not None
                    }
                    for a in ws.agents
                ],
            }
            for ws in config.workspaces
        ],
    }

    p.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))
    try:
        p.chmod(0o600)  # token is sensitive
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Config manipulation helpers
# ---------------------------------------------------------------------------

def add_agent_to_config(
    workspace_id: str,
    agent: AgentEntry,
    path: Optional[Path] = None,
) -> None:
    """Add an agent to an existing workspace in the config."""
    config = load_config(path)
    for ws in config.workspaces:
        if ws.id == workspace_id or ws.slug == workspace_id:
            # Check for duplicate
            if any(a.name == agent.name for a in ws.agents):
                # Update existing
                ws.agents = [agent if a.name == agent.name else a for a in ws.agents]
            else:
                ws.agents.append(agent)
            save_config(config, path)
            return
    raise ValueError(f"Workspace {workspace_id} not found in config")


def add_workspace_to_config(
    workspace: WorkspaceEntry,
    path: Optional[Path] = None,
) -> None:
    """Add a workspace to the config (or update if exists)."""
    config = load_config(path)
    for i, ws in enumerate(config.workspaces):
        if ws.id == workspace.id:
            # Merge agents
            existing_names = {a.name for a in ws.agents}
            for a in workspace.agents:
                if a.name not in existing_names:
                    ws.agents.append(a)
            ws.token = workspace.token
            ws.endpoint = workspace.endpoint
            save_config(config, path)
            return
    config.workspaces.append(workspace)
    save_config(config, path)


def remove_agent_from_config(
    agent_name: str,
    path: Optional[Path] = None,
) -> bool:
    """Remove an agent by name. Returns True if found and removed."""
    config = load_config(path)
    for ws in config.workspaces:
        original_len = len(ws.agents)
        ws.agents = [a for a in ws.agents if a.name != agent_name]
        if len(ws.agents) < original_len:
            save_config(config, path)
            return True
    return False


def find_agent_in_config(
    agent_name: str,
    path: Optional[Path] = None,
) -> Optional[tuple[WorkspaceEntry, AgentEntry]]:
    """Find an agent by name across all workspaces."""
    config = load_config(path)
    for ws in config.workspaces:
        for a in ws.agents:
            if a.name == agent_name:
                return ws, a
    return None


# ---------------------------------------------------------------------------
# Status file (written by daemon, read by `openagents status`)
# ---------------------------------------------------------------------------

def write_status(statuses: dict, pid: int) -> None:
    """Write daemon status to JSON file."""
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "pid": pid,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "agents": statuses,
    }
    STATUS_PATH.write_text(json.dumps(data, indent=2, default=str))


def read_status() -> Optional[dict]:
    """Read daemon status. Returns None if not available."""
    if not STATUS_PATH.exists():
        return None
    try:
        return json.loads(STATUS_PATH.read_text())
    except Exception:
        return None
