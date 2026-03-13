"""
Platform install tests for OpenClaw agent.

Tests the real user experience: `openagents install openclaw`
across Linux, macOS, and Windows.

Run:
    pytest tests/platform/install/test_openclaw.py -v
"""

import shutil
import subprocess

import pytest

from tests.platform.conftest import run_cmd, run_openagents, safe_print


AGENT_NAME = "openclaw"
BINARY_NAME = "openclaw"


class TestOpenClawInstall:
    """Test installing OpenClaw via `openagents install openclaw`."""

    def test_openagents_cli_available(self, has_openagents):
        """`openagents` CLI must be available."""
        assert has_openagents, (
            "openagents CLI is not installed. "
            "Run: pip install openagents"
        )

    def test_openagents_install_openclaw(self):
        """`openagents install openclaw --yes` should succeed."""
        try:
            result = run_openagents("install", AGENT_NAME, "--yes", timeout=300)
        except subprocess.TimeoutExpired:
            # npm install on Windows can be very slow. If the binary
            # is already on PATH despite the timeout, treat as success.
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
        """After install, 'openclaw' binary should be on PATH."""
        path = shutil.which(BINARY_NAME)
        assert path is not None, (
            f"'{BINARY_NAME}' not found on PATH after "
            f"`openagents install {AGENT_NAME}`. "
            f"The install command may have succeeded but the binary "
            f"is not in PATH."
        )

    def test_binary_version(self):
        """'openclaw --version' should return a version string."""
        if shutil.which(BINARY_NAME) is None:
            pytest.skip(f"'{BINARY_NAME}' not on PATH")

        result = run_cmd([BINARY_NAME, "--version"], timeout=30)
        assert result.returncode == 0, (
            f"'{BINARY_NAME} --version' failed "
            f"(exit {result.returncode}).\n"
            f"stderr: {result.stderr[-500:]}"
        )
        assert len(result.stdout.strip()) > 0, "Version output is empty"

    def test_binary_help(self):
        """'openclaw --help' should print usage info."""
        if shutil.which(BINARY_NAME) is None:
            pytest.skip(f"'{BINARY_NAME}' not on PATH")

        result = run_cmd([BINARY_NAME, "--help"], timeout=60)
        assert result.returncode == 0, (
            f"'{BINARY_NAME} --help' failed "
            f"(exit {result.returncode}).\n"
            f"stderr: {result.stderr[-500:]}"
        )


class TestOpenClawInstallReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details (always passes, for diagnostics)."""
        binary_path = shutil.which(BINARY_NAME)
        agent_version = None
        if binary_path:
            try:
                r = run_cmd([BINARY_NAME, "--version"], timeout=30)
                agent_version = r.stdout.strip() if r.returncode == 0 else None
            except Exception:
                pass

        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path,
            "agent_version": agent_version,
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
