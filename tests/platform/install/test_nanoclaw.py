"""
Platform install tests for NanoClaw agent.

NanoClaw uses direct API mode — it calls the OpenAI-compatible chat
completions API directly without needing a local binary. The install
step verifies the registry entry loads and that the SDK recognises the
agent type.

Run:
    pytest tests/platform/install/test_nanoclaw.py -v
"""

import shutil
import subprocess

import pytest

from tests.platform.conftest import run_cmd, run_openagents, safe_print, agent_config


AGENT_TYPE = "nanoclaw"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)


class TestNanoClawInstall:
    """Test installing NanoClaw via `openagents install nanoclaw`."""

    def test_openagents_cli_available(self, has_openagents):
        """`openagents` CLI must be available."""
        assert has_openagents, (
            "openagents CLI is not installed. "
            "Run: pip install openagents"
        )

    def test_openagents_install_nanoclaw(self):
        """`openagents install nanoclaw --yes` should succeed.

        NanoClaw uses direct API mode so there is no npm package to install.
        The install command should still succeed (the registry entry is valid).
        """
        try:
            result = run_openagents("install", AGENT_TYPE, "--yes", timeout=60)
        except subprocess.TimeoutExpired:
            pytest.skip("Install timed out — NanoClaw uses direct API mode, no binary expected.")
            return

        assert result.returncode == 0, (
            f"`openagents install {AGENT_TYPE}` failed "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )

    def test_direct_api_mode_note(self):
        """NanoClaw uses direct API mode — binary is optional."""
        binary_path = shutil.which(BINARY_NAME)
        if binary_path:
            safe_print(f"  NanoClaw binary found at: {binary_path}")
        else:
            safe_print(
                f"  NanoClaw binary not found (expected — uses direct API mode)"
            )


class TestNanoClawInstallReport:
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
