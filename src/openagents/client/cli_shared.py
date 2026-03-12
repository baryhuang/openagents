"""
Shared CLI state — Typer app, Rich console, and constants.

All CLI submodules import from here to avoid circular dependencies.
"""

import os
import sys

import typer
from rich.console import Console

# Ensure UTF-8 output on Windows (avoids charmap codec errors with emoji)
if sys.platform == "win32" and not os.environ.get("PYTHONIOENCODING"):
    os.environ["PYTHONIOENCODING"] = "utf-8"
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Shared Rich console
console = Console()

# Main Typer app
app = typer.Typer(
    name="openagents",
    help="[bold blue]OpenAgents[/bold blue] - AI Agent Networks for Open Collaboration",
    add_completion=False,
    rich_markup_mode="rich",
    invoke_without_command=True,
)

# Global verbose flag
VERBOSE_MODE = False

# OpenAgents API constants
OPENAGENTS_API_BASE = "https://endpoint.openagents.org/v1"
OPENAGENTS_RELAY_URL = "wss://relay.openagents.org"
LOCALHOST_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "local"]
