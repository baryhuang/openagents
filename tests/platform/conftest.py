"""
Cross-platform agent test suite.

Tests the full user journey: openagents install -> binary available -> binary works.

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

IS_WINDOWS = platform.system().lower() == "windows"


def current_platform() -> str:
    """Return normalized platform name: linux, macos, or windows."""
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    return system


def run_cmd(
    cmd: list[str], timeout: int = 180
) -> subprocess.CompletedProcess:
    """Run a command cross-platform, handling Windows encoding and .cmd wrappers.

    On Windows:
    - Uses shell=True so .cmd wrappers (npm global installs) resolve correctly
    - Forces UTF-8 encoding to avoid cp1252 decode errors from Unicode output
    """
    kwargs: dict = {
        "capture_output": True,
        "text": True,
        "timeout": timeout,
    }
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

    return run_cmd([binary, *args], timeout=timeout)


def safe_print(text: str) -> None:
    """Print text safely on all platforms.

    On Windows with cp1252, Unicode characters (box-drawing, emoji) cause
    UnicodeEncodeError. This replaces un-encodable chars with '?'.
    """
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))
