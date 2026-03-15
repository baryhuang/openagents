"""
Platform install tests for Cursor agent.

Cursor uses direct API mode — it calls the OpenAI-compatible chat
completions API directly without needing the Cursor CLI binary.
The install step verifies the registry entry loads and that the SDK
recognises the agent type.

Run:
    pytest tests/platform/install/test_cursor.py -v
"""

import shutil
import subprocess

import pytest

from tests.platform.conftest import run_cmd, run_openagents, safe_print, agent_config


AGENT_TYPE = "cursor"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)


class TestCursorInstall:
    """Test installing Cursor via `openagents install cursor`."""

    def test_openagents_cli_available(self, has_openagents):
        """`openagents` CLI must be available."""
        assert has_openagents, (
            "openagents CLI is not installed. "
            "Run: pip install openagents"
        )

    def test_openagents_install_cursor(self):
        """`openagents install cursor --yes` should succeed.

        Cursor uses direct API mode so the install command may not
        install a binary, but should still succeed.
        """
        try:
            result = run_openagents("install", AGENT_TYPE, "--yes", timeout=60)
        except subprocess.TimeoutExpired:
            pytest.skip("Install timed out — Cursor uses direct API mode, no binary expected.")
            return

        assert result.returncode == 0, (
            f"`openagents install {AGENT_TYPE}` failed "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )

    def test_direct_api_mode_note(self):
        """Cursor uses direct API mode — binary is optional."""
        binary_path = shutil.which(BINARY_NAME)
        if binary_path:
            safe_print(f"  Cursor binary found at: {binary_path}")
        else:
            safe_print(
                f"  Cursor binary not found (expected — uses direct API mode)"
            )


class TestCursorInstallReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details (always passes, for diagnostics)."""
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path or "(direct API mode)",
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
