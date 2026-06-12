"""Unit tests for Amp agent support (registry registration + AmpAdapter).

These tests never require a real ``amp`` install or a live workspace: the CLI
is simulated with a fake ``asyncio`` subprocess that emits Amp's
Claude-compatible ``--stream-json`` events, and binary detection is exercised
against a fake executable on an isolated PATH/HOME.

Covered:
- Amp agent-type registration (builtin plugin from the registry YAML)
- Amp executable detection (PATH + ~/.local/bin fallback, missing binary)
- Launch / execute command construction (new thread vs `threads continue`)
- Working-directory passing (cwd of the spawned process)
- Environment passing (AMP_API_KEY reaches the subprocess)
- Sensitive info (AMP_API_KEY) never reaches logs
- stream-json parsing → final text + per-channel thread persistence
- Stop control updates process state
- Existing agent types keep loading (no regression)

Run:
    pytest tests/agents/test_amp.py -v
"""

import asyncio
import importlib
import logging
import os
import stat

import pytest

import openagents.registry.loader as loader
from openagents.adapters.amp import AmpAdapter


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_amp_plugin():
    data = next(
        d for d in loader.load_registry_yamls() if d.get("name") == "amp"
    )
    plugin = loader._make_plugin_from_yaml(data)
    assert plugin is not None, "amp must be a builtin plugin"
    return plugin


def _write_executable(path, body="#!/bin/sh\necho ok\n"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _make_adapter(tmp_path, working_dir=None):
    """Build an AmpAdapter without any network I/O (constructor is offline)."""
    return AmpAdapter(
        workspace_id="ws-test",
        channel_name="general",
        token="tok",
        agent_name="amp-bot",
        endpoint="https://example.invalid",
        working_dir=working_dir or str(tmp_path / "proj"),
    )


class _FakeStreamReader:
    """Minimal async stdout/stderr reader yielding pre-canned lines."""

    def __init__(self, lines=None, blob=b""):
        # lines: list[bytes] returned one-per-readline, then EOF (b"")
        self._lines = list(lines or [])
        self._blob = blob

    async def readline(self):
        if self._lines:
            return self._lines.pop(0)
        return b""

    async def read(self):
        return self._blob


class _FakeStdin:
    def __init__(self):
        self.written = b""
        self.closed = False

    def write(self, data):
        self.written += data

    async def drain(self):
        pass

    def close(self):
        self.closed = True


class _FakeProcess:
    def __init__(self, stdout_lines, returncode=0, stderr=b""):
        self.stdin = _FakeStdin()
        self.stdout = _FakeStreamReader(lines=stdout_lines)
        self.stderr = _FakeStreamReader(blob=stderr)
        self.returncode = returncode
        self.pid = 4242

    async def wait(self):
        return self.returncode


@pytest.fixture
def patch_spawn(monkeypatch):
    """Patch asyncio.create_subprocess_exec; capture call args, return a fake."""
    captured = {}

    def _factory(stdout_lines, returncode=0, stderr=b""):
        async def fake_exec(*args, **kwargs):
            captured["args"] = args
            captured["kwargs"] = kwargs
            proc = _FakeProcess(stdout_lines, returncode=returncode, stderr=stderr)
            captured["proc"] = proc
            return proc

        monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
        return captured

    return _factory


# ---------------------------------------------------------------------------
# 1. Agent-type registration
# ---------------------------------------------------------------------------

class TestAmpRegistration:
    def test_amp_is_builtin_plugin(self):
        plugin = _make_amp_plugin()
        assert plugin.name == "amp"
        assert plugin.label == "Amp (Sourcegraph)"

    def test_amp_adapter_module_imports(self):
        data = next(d for d in loader.load_registry_yamls() if d["name"] == "amp")
        mod = importlib.import_module(data["adapter"]["module"])
        cls = getattr(mod, data["adapter"]["class"])
        assert cls is AmpAdapter

    def test_amp_env_config_exposes_api_key(self):
        plugin = _make_amp_plugin()
        names = [e.get("name") for e in plugin.required_env_vars()]
        assert "AMP_API_KEY" in names
        api_key = next(e for e in plugin.required_env_vars() if e["name"] == "AMP_API_KEY")
        # The key must be flagged as a password field so UIs mask it.
        assert api_key.get("password") is True

    def test_amp_login_command(self):
        assert _make_amp_plugin().login_command() == "amp login"


# ---------------------------------------------------------------------------
# 2. Executable detection
# ---------------------------------------------------------------------------

@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    empty_bin = tmp_path / "empty_bin"
    empty_bin.mkdir()
    monkeypatch.setenv("PATH", str(empty_bin))
    monkeypatch.setattr(
        loader, "_INSTALLED_MARKERS_PATH", home / ".openagents" / "installed_agents.json"
    )
    return home


class TestAmpDetection:
    def test_not_installed_without_binary(self, isolated_home):
        plugin = _make_amp_plugin()
        assert plugin._which_binary() is None
        assert plugin.is_installed() is False
        ready, msg = plugin.check_ready()
        assert ready is False
        assert "install amp" in msg.lower()

    def test_detects_binary_on_path(self, isolated_home, tmp_path, monkeypatch):
        bin_dir = tmp_path / "bin"
        amp_path = bin_dir / "amp"
        _write_executable(amp_path)
        monkeypatch.setenv("PATH", str(bin_dir))
        plugin = _make_amp_plugin()
        assert plugin._which_binary() == str(amp_path)
        assert plugin.is_installed() is True

    def test_detects_binary_in_local_bin_fallback(self, isolated_home):
        # The official installer drops `amp` into ~/.local/bin, which the
        # native installer only exports to interactive shells.
        amp_path = isolated_home / ".local" / "bin" / "amp"
        _write_executable(amp_path)
        plugin = _make_amp_plugin()
        assert plugin._which_binary() == str(amp_path)

    def test_detects_binary_in_amp_bin_fallback(self, isolated_home):
        # Canonical install dir of the official installer: ~/.amp/bin. The
        # symlink into ~/.local/bin is only made when that dir is already on
        # PATH, so a GUI/daemon process must still find ~/.amp/bin. Regression
        # guard for the "installed but Amp CLI not found" report.
        amp_path = isolated_home / ".amp" / "bin" / "amp"
        _write_executable(amp_path)
        plugin = _make_amp_plugin()
        assert plugin._which_binary() == str(amp_path)
        assert plugin.is_installed() is True

    def test_adapter_find_binary_in_amp_bin(self, isolated_home):
        amp_path = isolated_home / ".amp" / "bin" / "amp"
        _write_executable(amp_path)
        # PATH is empty (isolated_home), so resolution must fall back to ~/.amp/bin.
        assert AmpAdapter._find_amp_binary() == str(amp_path)

    def test_adapter_find_binary_matches(self, isolated_home, tmp_path, monkeypatch):
        bin_dir = tmp_path / "bin"
        amp_path = bin_dir / "amp"
        _write_executable(amp_path)
        monkeypatch.setenv("PATH", str(bin_dir))
        assert AmpAdapter._find_amp_binary() == str(amp_path)

    def test_windows_prefers_cmd_shim(self, monkeypatch):
        """On Windows the .cmd shim must win over the bare name (npm/installer
        drop a .cmd wrapper; the bare name can be a non-executable script)."""
        import openagents.adapters.amp as amp_mod

        monkeypatch.setattr(amp_mod.platform, "system", lambda: "Windows")
        calls = []

        def fake_which(name):
            calls.append(name)
            return f"C:\\bin\\{name}" if name == "amp.cmd" else None

        monkeypatch.setattr(amp_mod.shutil, "which", fake_which)
        assert AmpAdapter._find_amp_binary() == "C:\\bin\\amp.cmd"
        # .cmd must be probed before the bare name.
        assert calls[0] == "amp.cmd"


# ---------------------------------------------------------------------------
# 3. Command construction
# ---------------------------------------------------------------------------

class TestAmpCommand:
    def test_new_thread_command(self, tmp_path):
        adapter = _make_adapter(tmp_path)
        adapter._amp_binary = "/usr/bin/amp"
        cmd = adapter._build_amp_cmd("general", resume=False)
        assert cmd == ["/usr/bin/amp", "-x", "--stream-json"]

    def test_resume_thread_command(self, tmp_path):
        adapter = _make_adapter(tmp_path)
        adapter._amp_binary = "/usr/bin/amp"
        adapter._channel_threads["general"] = "T-123"
        cmd = adapter._build_amp_cmd("general", resume=True)
        assert cmd == ["/usr/bin/amp", "threads", "continue", "T-123", "-x", "--stream-json"]

    def test_missing_binary_raises(self, tmp_path, monkeypatch):
        adapter = _make_adapter(tmp_path)
        adapter._amp_binary = None
        monkeypatch.setattr(AmpAdapter, "_find_amp_binary", staticmethod(lambda: None))
        with pytest.raises(FileNotFoundError, match="amp CLI not found"):
            adapter._build_amp_cmd("general", resume=False)


# ---------------------------------------------------------------------------
# 4-8. Subprocess flow: working dir, env, parsing, threads, secrets
# ---------------------------------------------------------------------------

def _stream_lines():
    """A representative Amp --stream-json turn (Claude-compatible schema)."""
    import json
    events = [
        {"type": "system", "subtype": "init", "session_id": "T-thread-1"},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "Looking into it"}]}},
        {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "All done!"}]}},
        {"type": "result", "subtype": "success", "is_error": False, "result": "All done!", "session_id": "T-thread-1"},
    ]
    return [(json.dumps(e) + "\n").encode("utf-8") for e in events]


class TestAmpSubprocessFlow:
    def _run_spawn(self, adapter, captured_holder):
        # Silence the thinking/status network calls.
        sent = {"thinking": [], "status": []}

        async def fake_thinking(channel, content):
            sent["thinking"].append(content)

        async def fake_status(channel, content):
            sent["status"].append(content)

        adapter._send_thinking = fake_thinking
        adapter._send_status = fake_status

        cmd = ["/usr/bin/amp", "-x", "--stream-json"]
        result = asyncio.run(adapter._spawn_amp(cmd, "PROMPT-BODY", "general"))
        return result, sent

    def test_parses_final_text_and_persists_thread(self, isolated_home, tmp_path, patch_spawn):
        patch_spawn(_stream_lines())
        adapter = _make_adapter(tmp_path)
        (text, exit_code, stale), sent = self._run_spawn(adapter, None)

        assert text == "All done!", "final turn (after tool_use) should be the answer"
        assert exit_code == 0
        assert stale is False
        # Process tracking is cleared once the turn ends (so the channel is no
        # longer considered busy and a stuck thread is impossible).
        assert "general" not in adapter._channel_processes
        # Thread id captured + persisted per channel.
        assert adapter._channel_threads["general"] == "T-thread-1"
        # Intermediate text streamed as thinking.
        assert "Looking into it" in sent["thinking"]
        # Tool call surfaced as status.
        assert any("Bash" in s for s in sent["status"])

    def test_working_dir_is_process_cwd(self, isolated_home, tmp_path, patch_spawn):
        captured = patch_spawn(_stream_lines())
        wd = str(tmp_path / "myproject")
        adapter = _make_adapter(tmp_path, working_dir=wd)
        self._run_spawn(adapter, None)
        assert captured["kwargs"].get("cwd") == wd

    def test_prompt_sent_on_stdin(self, isolated_home, tmp_path, patch_spawn):
        captured = patch_spawn(_stream_lines())
        adapter = _make_adapter(tmp_path)
        self._run_spawn(adapter, None)
        assert captured["proc"].stdin.written == b"PROMPT-BODY"
        assert captured["proc"].stdin.closed is True

    def test_api_key_passed_to_subprocess_env(self, isolated_home, tmp_path, patch_spawn, monkeypatch):
        monkeypatch.setenv("AMP_API_KEY", "sk-amp-secret-xyz")
        captured = patch_spawn(_stream_lines())
        adapter = _make_adapter(tmp_path)
        self._run_spawn(adapter, None)
        env = captured["kwargs"].get("env") or {}
        assert env.get("AMP_API_KEY") == "sk-amp-secret-xyz"

    def test_api_key_never_logged(self, isolated_home, tmp_path, patch_spawn, monkeypatch, caplog):
        secret = "sk-amp-supersecret-should-not-log"
        monkeypatch.setenv("AMP_API_KEY", secret)
        patch_spawn(_stream_lines())
        adapter = _make_adapter(tmp_path)
        with caplog.at_level(logging.DEBUG, logger="openagents.adapters.amp"):
            self._run_spawn(adapter, None)
        joined = "\n".join(r.getMessage() for r in caplog.records)
        assert secret not in joined, "AMP_API_KEY must never appear in logs"

    def test_stale_thread_flagged_on_failure(self, isolated_home, tmp_path, patch_spawn):
        # Non-zero exit with no usable output → caller should retry fresh.
        patch_spawn([b'{"type":"result","is_error":true}\n'], returncode=1, stderr=b"thread not found")
        adapter = _make_adapter(tmp_path)
        adapter._channel_threads["general"] = "T-old"
        (text, exit_code, stale), _ = self._run_spawn(adapter, None)
        assert text == ""
        assert exit_code == 1
        assert stale is True


# ---------------------------------------------------------------------------
# 9. Stop control
# ---------------------------------------------------------------------------

class TestAmpStop:
    def test_stop_terminates_and_clears_process(self, tmp_path, monkeypatch):
        adapter = _make_adapter(tmp_path)

        killed = {"count": 0}

        async def fake_stop(proc):
            killed["count"] += 1

        async def fake_status(channel, content):
            pass

        adapter._stop_process = fake_stop
        adapter._send_status = fake_status

        class _P:
            returncode = None
            pid = 99
        adapter._channel_processes["general"] = _P()

        asyncio.run(adapter._on_control_action("stop", {}))

        assert killed["count"] == 1
        assert "general" not in adapter._channel_processes
        assert "general" in adapter._stopping_channels


# ---------------------------------------------------------------------------
# 10. No regression for existing agents
# ---------------------------------------------------------------------------

class TestNoRegression:
    @pytest.mark.parametrize("name", ["claude", "codex", "opencode", "cursor"])
    def test_existing_builtins_still_load(self, name):
        data = next(d for d in loader.load_registry_yamls() if d.get("name") == name)
        plugin = loader._make_plugin_from_yaml(data)
        assert plugin is not None
        assert plugin.name == name


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
