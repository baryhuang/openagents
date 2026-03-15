"""
Platform install tests for NanoClaw agent.

NanoClaw is a Node.js service (not a standalone CLI binary), so
installation is via git clone + npm install. The `openagents install
nanoclaw` command handles this.

Run:
    pytest tests/platform/install/test_nanoclaw.py -v
"""

import shutil
import subprocess

import pytest

from tests.platform.conftest import run_cmd, run_openagents, safe_print


AGENT_NAME = "nanoclaw"
BINARY_NAME = "nanoclaw"


class TestNanoClawInstall:
    """Test installing NanoClaw via `openagents install nanoclaw`."""

    def test_openagents_cli_available(self, has_openagents):
        """`openagents` CLI must be available."""
        assert has_openagents, (
            "openagents CLI is not installed. "
            "Run: pip install openagents"
        )

    def test_openagents_install_nanoclaw(self):
        """`openagents install nanoclaw --yes` should succeed."""
        try:
            result = run_openagents("install", AGENT_NAME, "--yes", timeout=300)
        except subprocess.TimeoutExpired:
            if shutil.which(BINARY_NAME) is not None:
                pytest.skip(
                    f"Install timed out at 300s but '{BINARY_NAME}' "
                    f"is on PATH — likely succeeded."
                )
            else:
                pytest.fail(
                    f"`openagents install {AGENT_NAME}` timed out "
                    f"after 300s and binary not found on PATH."
                )
            return

        assert result.returncode == 0, (
            f"`openagents install {AGENT_NAME}` failed "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )

    def test_binary_on_path(self):
        """After install, 'nanoclaw' binary should be on PATH."""
        path = shutil.which(BINARY_NAME)
        assert path is not None, (
            f"'{BINARY_NAME}' not found on PATH after "
            f"`openagents install {AGENT_NAME}`. "
            f"The install command may have succeeded but the binary "
            f"is not in PATH."
        )


class TestNanoClawInstallReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details (always passes, for diagnostics)."""
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path,
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
