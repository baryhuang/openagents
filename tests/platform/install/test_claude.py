"""
Platform install tests for Claude Code agent.

Tests the real user experience: `openagents install claude`
across Linux, macOS, and Windows.

Run:
    pytest tests/platform/install/test_claude.py -v
"""

import shutil

import pytest

from tests.platform.conftest import run_cmd, run_openagents


AGENT_NAME = "claude"
BINARY_NAME = "claude"


class TestClaudeInstall:
    """Test installing Claude Code via `openagents install claude`."""

    def test_openagents_cli_available(self, has_openagents):
        """`openagents` CLI must be available."""
        assert has_openagents, (
            "openagents CLI is not installed. "
            "Run: pip install openagents"
        )

    def test_openagents_install_claude(self):
        """`openagents install claude --yes` should succeed."""
        result = run_openagents("install", AGENT_NAME, "--yes", timeout=180)
        assert result.returncode == 0, (
            f"`openagents install {AGENT_NAME}` failed "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )

    def test_binary_on_path(self):
        """After install, 'claude' binary should be on PATH."""
        path = shutil.which(BINARY_NAME)
        assert path is not None, (
            f"'{BINARY_NAME}' not found on PATH after "
            f"`openagents install {AGENT_NAME}`. "
            f"The install command may have succeeded but the binary "
            f"is not in PATH."
        )

    def test_binary_version(self):
        """'claude --version' should return a version string."""
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
        """'claude --help' should print usage info."""
        if shutil.which(BINARY_NAME) is None:
            pytest.skip(f"'{BINARY_NAME}' not on PATH")

        result = run_cmd([BINARY_NAME, "--help"], timeout=30)
        assert result.returncode == 0, (
            f"'{BINARY_NAME} --help' failed "
            f"(exit {result.returncode}).\n"
            f"stderr: {result.stderr[-500:]}"
        )


class TestClaudeInstallReport:
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
            print(f"  {k}: {v}")
