"""Unit tests for Cursor install detection in the Python registry loader.

Regression coverage for the CLI-vs-Launcher inconsistency: Cursor's native
installer drops ``cursor-agent`` into ``~/.cursor/bin`` but only edits the
interactive shell profile. When that directory is not on the current
process PATH, ``loader._which_binary`` previously could not find it (it only
searched the raw PATH plus nvm/fnm/volta), so the ``openagents`` Python CLI
reported Cursor as "not installed" while the Electron Launcher — which does
search ``~/.cursor/bin`` — reported it installed.

These tests pin the parity fix and guard the existing install-marker
fallback against regression.

Run:
    pytest tests/agents/test_cursor_install_detection.py -v
"""

import os
import stat

import pytest

import openagents.registry.loader as loader


def _make_cursor_plugin():
    """Build the Cursor plugin instance from the bundled registry YAML."""
    data = next(
        d for d in loader.load_registry_yamls() if d.get("name") == "cursor"
    )
    plugin = loader._make_plugin_from_yaml(data)
    assert plugin is not None, "cursor must be a builtin plugin"
    return plugin


def _write_executable(path, body="#!/bin/sh\necho ok\n"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    """Point HOME/USERPROFILE at a temp dir and give the process an empty PATH.

    Empty PATH guarantees ``shutil.which`` cannot find cursor-agent on PATH,
    so detection must fall through to the ~/.cursor/bin fallback. The marker
    store is also redirected into the temp HOME so tests don't read or write
    the developer's real ~/.openagents.
    """
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))

    empty_bin = tmp_path / "empty_bin"
    empty_bin.mkdir()
    monkeypatch.setenv("PATH", str(empty_bin))

    # Redirect the (module-level, import-time-bound) marker path into HOME.
    markers_path = home / ".openagents" / "installed_agents.json"
    monkeypatch.setattr(loader, "_INSTALLED_MARKERS_PATH", markers_path)
    return home


class TestCursorBinaryInCursorBin:
    """cursor-agent present in ~/.cursor/bin, NOT on PATH."""

    def test_which_binary_finds_cursor_bin(self, isolated_home):
        cursor_agent = isolated_home / ".cursor" / "bin" / "cursor-agent"
        _write_executable(cursor_agent)

        plugin = _make_cursor_plugin()
        resolved = plugin._which_binary()

        assert resolved == str(cursor_agent), (
            f"expected _which_binary to resolve {cursor_agent}, got {resolved!r}"
        )

    def test_is_installed_via_cursor_bin_without_marker(self, isolated_home):
        # No install marker exists — detection must rely purely on the
        # ~/.cursor/bin binary, mirroring an external (non-Launcher) install.
        assert not loader._is_marked_installed("cursor")

        cursor_agent = isolated_home / ".cursor" / "bin" / "cursor-agent"
        _write_executable(cursor_agent)

        plugin = _make_cursor_plugin()
        assert plugin.is_installed() is True

    def test_alias_binary_in_cursor_bin_is_found(self, isolated_home):
        # Older Cursor CLI shipped the binary as `agent` (a registry alias).
        agent_bin = isolated_home / ".cursor" / "bin" / "agent"
        _write_executable(agent_bin)

        plugin = _make_cursor_plugin()
        assert plugin._which_binary() == str(agent_bin)


class TestMarkerFallbackNotRegressed:
    """The existing install-marker fallback must keep working."""

    def test_marker_only_still_reports_installed(self, isolated_home):
        # No binary anywhere, but a marker was written (post-install state).
        plugin = _make_cursor_plugin()
        assert plugin._which_binary() is None
        assert plugin.is_installed() is False  # sanity: nothing yet

        loader.mark_installed("cursor")
        assert plugin._which_binary() is None  # still no binary
        assert plugin.is_installed() is True  # marker carries it

    def test_no_binary_no_marker_reports_not_installed(self, isolated_home):
        plugin = _make_cursor_plugin()
        assert plugin._which_binary() is None
        assert plugin.is_installed() is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
