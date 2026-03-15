"""
Cross-platform agent test suite.

Tests the full user journey: openagents install -> binary available -> binary works.

Run:
    pytest tests/platform/ -v

Structure:
    tests/platform/
    ├── config.yaml       # Test configuration (models, endpoints, credentials)
    ├── install/          # Test 1: Can the agent be installed via `openagents install`?
    │   ├── test_claude.py
    │   ├── test_openclaw.py
    │   └── test_codex.py
    ├── start/            # Test 2: Can the agent start?
    ├── connect/          # Test 3: Can it connect to a workspace?
    ├── respond/          # Test 4: Can it respond to a message?
    ├── tools/            # Test 5: Can it execute tool calls?
    ├── workspace_tools/  # Test 6: Can it use workspace tools?
    └── collaborate/      # Test 7: Can agents collaborate?
"""

import os
import platform
from pathlib import Path
import shutil
import subprocess
import sys

import pytest
import yaml

IS_WINDOWS = platform.system().lower() == "windows"

# ---------------------------------------------------------------------------
# Test configuration loader
# ---------------------------------------------------------------------------

_CONFIG_PATH = Path(__file__).parent / "config.yaml"
_config: dict | None = None


def load_test_config() -> dict:
    """Load and cache tests/platform/config.yaml."""
    global _config
    if _config is None:
        with open(_CONFIG_PATH) as f:
            _config = yaml.safe_load(f)
    return _config


def agent_config(agent_type: str) -> dict:
    """Return the config block for a specific agent type."""
    cfg = load_test_config()
    return cfg.get("agents", {}).get(agent_type, {})


def workspace_endpoint() -> str:
    """Return the workspace endpoint from config."""
    return load_test_config().get("workspace_endpoint", "https://workspace-endpoint.openagents.org")


def has_credentials(agent_type: str) -> bool:
    """Check if any of the agent's credential env vars are set."""
    cfg = agent_config(agent_type)
    return any(os.environ.get(v) for v in cfg.get("credential_env", []))


def current_platform() -> str:
    """Return normalized platform name: linux, macos, or windows."""
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    return system


def run_cmd(
    cmd: list[str], timeout: int = 180, stdin_text: str | None = None,
) -> subprocess.CompletedProcess:
    """Run a command cross-platform, handling Windows encoding and .cmd wrappers.

    On Windows:
    - Uses shell=True so .cmd wrappers (npm global installs) resolve correctly
    - Forces UTF-8 encoding to avoid cp1252 decode errors from Unicode output

    Args:
        stdin_text: Optional text to pipe to the command's stdin.
    """
    kwargs: dict = {
        "capture_output": True,
        "text": True,
        "timeout": timeout,
    }
    if stdin_text is not None:
        kwargs["input"] = stdin_text
    if IS_WINDOWS:
        kwargs["shell"] = True
        kwargs["encoding"] = "utf-8"
        kwargs["errors"] = "replace"

    return subprocess.run(cmd, **kwargs)


@pytest.fixture
def os_platform() -> str:
    """Current OS platform."""
    return current_platform()


@pytest.fixture
def has_openagents() -> bool:
    """Check if the openagents CLI is available."""
    return shutil.which("openagents") is not None


@pytest.fixture
def openagents_version() -> str | None:
    """Get openagents CLI version, or None if not installed."""
    binary = shutil.which("openagents")
    if binary is None:
        return None
    try:
        result = run_cmd([binary, "--version"], timeout=10)
        return result.stdout.strip() if result.returncode == 0 else None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def run_openagents(
    *args: str, timeout: int = 180, stdin_text: str | None = None,
) -> subprocess.CompletedProcess:
    """Run an openagents CLI command and return the result.

    Tries the `openagents` binary first, falls back to the entry point
    script next to the current Python interpreter.
    """
    binary = shutil.which("openagents")
    if binary is None:
        # Fallback: look next to the Python interpreter (pip install -e .)
        import pathlib
        candidate = pathlib.Path(sys.executable).parent / "openagents"
        if candidate.exists():
            binary = str(candidate)
        else:
            binary = "openagents"  # let it fail with a clear error

    return run_cmd([binary, *args], timeout=timeout, stdin_text=stdin_text)


def is_daemon_running_with_agents() -> bool:
    """Check if a daemon is running with active network-connected agents.

    Platform start/connect tests must NOT run when a live daemon is active,
    because they call `openagents down` which would kill the running agents.
    """
    try:
        from openagents.client.daemon import read_daemon_pid
        from openagents.client.daemon_config import load_config
        pid = read_daemon_pid()
        if not pid:
            return False
        cfg = load_config()
        return any(a.network for a in cfg.agents)
    except Exception:
        return False


def safe_print(text: str) -> None:
    """Print text safely on all platforms.

    On Windows with cp1252, Unicode characters (box-drawing, emoji) cause
    UnicodeEncodeError. This replaces un-encodable chars with '?'.
    """
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))
