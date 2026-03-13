"""
Cross-platform agent test suite.

Tests the full user journey: openagents install → binary available → binary works.

Run:
    pytest tests/platform/ -v

Structure:
    tests/platform/
    ├── install/          # Test 1: Can the agent be installed via `openagents install`?
    │   ├── test_claude.py
    │   └── test_openclaw.py
    ├── start/            # Test 2: Can the agent start?
    ├── connect/          # Test 3: Can it connect to a workspace?
    ├── respond/          # Test 4: Can it respond to a message?
    ├── tools/            # Test 5: Can it execute tool calls?
    ├── workspace_tools/  # Test 6: Can it use workspace tools?
    └── collaborate/      # Test 7: Can agents collaborate?
"""

import platform
import shutil
import subprocess
import sys

import pytest


def current_platform() -> str:
    """Return normalized platform name: linux, macos, or windows."""
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    return system


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
        result = subprocess.run(
            [binary, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def run_openagents(*args: str, timeout: int = 180) -> subprocess.CompletedProcess:
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

    cmd = [binary, *args]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
