"""Unit tests for the Goose adapter, registry wiring, and install detection.

No real Goose binary is installed and no model credits are used: a fake
``goose`` executable plus monkeypatching cover command building, session
isolation, provider env, working-dir validation, and an end-to-end stream-json
run. Mirrors packages/agent-connector/test/goose.test.js.

Run:
    pytest tests/agents/test_goose_adapter.py -v
"""

import asyncio
import functools
import json
import os
import stat

import pytest

import openagents.registry.loader as loader
from openagents.adapters import goose as goose_mod
from openagents.adapters.goose import (
    GooseAdapter,
    MIN_GOOSE_VERSION,
    find_goose_binary,
    goose_session_name,
    goose_version_meets_minimum,
    parse_goose_version,
)


def _aiorun(coro_fn):
    """Run an async test body via asyncio.run so the suite doesn't depend on a
    pytest async plugin being installed (pytest still injects fixtures via the
    preserved signature)."""
    @functools.wraps(coro_fn)
    def wrapper(*args, **kwargs):
        return asyncio.run(coro_fn(*args, **kwargs))
    return wrapper


# ---------------------------------------------------------------------------
# Registry wiring
# ---------------------------------------------------------------------------

def _goose_data():
    return next(d for d in loader.load_registry_yamls() if d.get("name") == "goose")


class TestRegistry:
    def test_goose_is_builtin(self):
        data = _goose_data()
        assert data.get("builtin") is True
        assert data["adapter"]["module"] == "openagents.adapters.goose"
        assert data["adapter"]["class"] == "GooseAdapter"

    def test_env_config_fields(self):
        data = _goose_data()
        names = [f["name"] for f in data.get("env_config", [])]
        assert names == [
            "GOOSE_PROVIDER", "GOOSE_MODEL", "GOOSE_PROVIDER__API_KEY",
            "GOOSE_PROVIDER__HOST", "GOOSE_MODE",
        ]
        # The API key must be a password field and not required.
        key = next(f for f in data["env_config"] if f["name"] == "GOOSE_PROVIDER__API_KEY")
        assert key.get("password") is True
        assert key.get("required") is False

    def test_install_is_non_interactive(self):
        data = _goose_data()
        install = data["install"]
        assert "CONFIGURE=false" in install["macos"]
        assert "CONFIGURE=false" in install["linux"]
        assert "CONFIGURE=false" in install["windows"] or "$env:CONFIGURE" in install["windows"]
        # CONFIGURE belongs on the shell side, not on curl.
        assert "CONFIGURE=false curl" not in install["macos"]
        assert "| CONFIGURE=false bash" in install["linux"]
        # Never run goose configure during install.
        assert "goose configure" not in install["macos"]

    def test_create_adapter_returns_goose_adapter(self):
        data = _goose_data()
        plugin = loader._make_plugin_from_yaml(data)
        adapter = plugin.create_adapter("ws", "chan", "tok", "agent", "http://x")
        assert isinstance(adapter, GooseAdapter)

    def test_other_agents_unaffected(self):
        names = {d["name"] for d in loader.load_registry_yamls()}
        # Amp/Aider must remain catalog-only; their builtin status is unchanged.
        for n in ("amp", "aider"):
            data = next(d for d in loader.load_registry_yamls() if d["name"] == n)
            assert not data.get("builtin"), f"{n} must stay catalog-only"
        for n in ("claude", "codex", "opencode"):
            data = next(d for d in loader.load_registry_yamls() if d["name"] == n)
            assert data.get("builtin") is True


# ---------------------------------------------------------------------------
# Install detection / marker reconciliation
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
    markers_path = home / ".openagents" / "installed_agents.json"
    monkeypatch.setattr(loader, "_INSTALLED_MARKERS_PATH", markers_path)
    return home


def _write_exe(path, body="#!/bin/sh\necho goose 1.38.0\n"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


class TestInstallDetection:
    def test_finds_goose_in_local_bin(self, isolated_home, monkeypatch):
        goose_bin = isolated_home / ".local" / "bin" / "goose"
        _write_exe(goose_bin)
        # find_goose_binary's fallback list checks ~/.local/bin
        assert find_goose_binary() == str(goose_bin)

    def test_finds_goose_on_path(self, isolated_home, monkeypatch):
        bindir = isolated_home / "pathbin"
        goose_bin = bindir / "goose"
        _write_exe(goose_bin)
        monkeypatch.setenv("PATH", str(bindir))
        assert find_goose_binary() == str(goose_bin)

    def test_missing_binary_returns_none(self, isolated_home):
        assert find_goose_binary() is None

    def test_check_ready_cli_missing_with_stale_marker(self, isolated_home):
        # require_binary: a stale marker must NOT mask a missing CLI.
        plugin = loader._make_plugin_from_yaml(_goose_data())
        loader.mark_installed("goose")  # marker exists
        assert plugin._which_binary() is None
        ready, msg = plugin.check_ready()
        assert ready is False
        assert "not found" in msg.lower()

    def test_check_ready_ok_when_binary_present(self, isolated_home, monkeypatch):
        bindir = isolated_home / "pathbin"
        _write_exe(bindir / "goose")
        monkeypatch.setenv("PATH", str(bindir))
        plugin = loader._make_plugin_from_yaml(_goose_data())
        ready, _ = plugin.check_ready()
        assert ready is True


# ---------------------------------------------------------------------------
# Adapter construction + command/env/session
# ---------------------------------------------------------------------------

@pytest.fixture
def adapter(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    # Make the adapter believe goose exists at a fake path (no detection noise).
    monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: "/fake/goose")
    proj = tmp_path / "project"
    proj.mkdir()
    a = GooseAdapter("ws1", "general", "tok", "agentA", "http://x",
                     working_dir=str(proj))
    return a


class TestVersion:
    def test_minimum_is_stable_137(self):
        # Verified against block/goose v1.37.0 (the stable tag).
        assert MIN_GOOSE_VERSION == (1, 37, 0)

    def test_parse(self):
        assert parse_goose_version("goose 1.37.0") == (1, 37, 0)
        assert parse_goose_version("goose-cli 1.40.2 (abc1234)") == (1, 40, 2)
        assert parse_goose_version("1.37.0\n") == (1, 37, 0)
        assert parse_goose_version("no version here") is None
        assert parse_goose_version("") is None

    def test_meets_minimum(self):
        assert goose_version_meets_minimum((1, 37, 0)) is True
        assert goose_version_meets_minimum((1, 40, 1)) is True
        assert goose_version_meets_minimum((2, 0, 0)) is True
        assert goose_version_meets_minimum((1, 36, 9)) is False
        assert goose_version_meets_minimum((1, 0, 0)) is False
        # Unknown version must be lenient (don't block a working setup).
        assert goose_version_meets_minimum(None) is True


class TestSessionNaming:
    def test_stable(self):
        assert goose_session_name("w", "a", "c") == goose_session_name("w", "a", "c")

    def test_isolated_across_dimensions(self):
        base = goose_session_name("w", "a", "c")
        assert base != goose_session_name("w", "a", "c2")   # channel
        assert base != goose_session_name("w", "a2", "c")   # agent
        assert base != goose_session_name("w2", "a", "c")   # workspace

    def test_safe_characters_only(self):
        name = goose_session_name("ws/../x", "a b", "../../etc/passwd")
        assert name.startswith("oa_")
        assert all(c.isalnum() or c == "_" for c in name)

    def test_does_not_leak_inputs(self):
        name = goose_session_name("workspace-token-abc", "agentA", "secret-channel")
        assert "workspace-token-abc" not in name
        assert "secret-channel" not in name


class TestCommandBuilding:
    def test_new_session_command(self, adapter):
        name = goose_session_name("ws1", "agentA", "general")
        cmd = adapter._build_cmd(name, resume=False, system_prompt="SYS")
        assert cmd[0] == "/fake/goose"
        assert cmd[1] == "run"
        assert "--output-format" in cmd and cmd[cmd.index("--output-format") + 1] == "stream-json"
        assert "--name" in cmd and cmd[cmd.index("--name") + 1] == name
        assert "--no-profile" in cmd
        assert cmd[cmd.index("--with-builtin") + 1] == "developer"
        assert "--resume" not in cmd
        assert cmd[-2:] == ["-i", "-"]  # prompt comes from stdin
        assert "--max-turns" in cmd and "--max-tool-repetitions" in cmd

    def test_resume_session_command(self, adapter):
        name = goose_session_name("ws1", "agentA", "general")
        cmd = adapter._build_cmd(name, resume=True, system_prompt="SYS")
        assert "--resume" in cmd

    def test_prompt_never_in_argv(self, adapter):
        cmd = adapter._build_cmd("oa_x", resume=False, system_prompt="SYS")
        # The user prompt is fed via stdin; only the system prompt is an arg.
        assert "-i" in cmd and cmd[cmd.index("-i") + 1] == "-"
        # No element equals a user prompt placeholder
        assert "USER_PROMPT" not in cmd

    def test_missing_binary_raises(self, adapter, monkeypatch):
        adapter._goose_binary = None
        monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: None)
        with pytest.raises(FileNotFoundError):
            adapter._build_cmd("oa_x", resume=False, system_prompt="SYS")


class TestEnvProvider:
    def test_mode_defaults_to_auto(self, adapter, monkeypatch):
        monkeypatch.delenv("GOOSE_MODE", raising=False)
        env = adapter._build_env()
        assert env["GOOSE_MODE"] == "auto"

    def test_blocking_mode_coerced_to_auto(self, adapter, monkeypatch):
        monkeypatch.setenv("GOOSE_MODE", "smart_approve")
        assert adapter._build_env()["GOOSE_MODE"] == "auto"
        monkeypatch.setenv("GOOSE_MODE", "approve")
        assert adapter._build_env()["GOOSE_MODE"] == "auto"

    def test_chat_mode_respected(self, adapter, monkeypatch):
        monkeypatch.setenv("GOOSE_MODE", "chat")
        assert adapter._build_env()["GOOSE_MODE"] == "chat"

    def test_provider_env_passthrough(self, adapter, monkeypatch):
        monkeypatch.setenv("GOOSE_PROVIDER", "openai")
        monkeypatch.setenv("GOOSE_MODEL", "gpt-4o")
        monkeypatch.setenv("GOOSE_PROVIDER__API_KEY", "sk-secret")
        monkeypatch.setenv("GOOSE_PROVIDER__HOST", "https://proxy.example/v1")
        env = adapter._build_env()
        assert env["GOOSE_PROVIDER"] == "openai"
        assert env["GOOSE_MODEL"] == "gpt-4o"
        assert env["GOOSE_PROVIDER__API_KEY"] == "sk-secret"  # passed via env, not argv
        assert env["GOOSE_PROVIDER__HOST"] == "https://proxy.example/v1"

    def test_existing_provider_env_not_cleared(self, adapter, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "existing")
        env = adapter._build_env()
        assert env["OPENAI_API_KEY"] == "existing"

    def test_key_not_in_argv(self, adapter, monkeypatch):
        monkeypatch.setenv("GOOSE_PROVIDER__API_KEY", "sk-zzz-secret")
        cmd = adapter._build_cmd("oa_x", resume=False, system_prompt="SYS")
        assert all("sk-zzz-secret" not in str(part) for part in cmd)

    def test_secret_redacted_in_safe(self, adapter, monkeypatch):
        # _collect_secret_values runs in __init__; build a fresh adapter so it
        # sees the key.
        monkeypatch.setenv("GOOSE_PROVIDER__API_KEY", "sk-zzz-supersecret")
        a = GooseAdapter("ws1", "general", "tok", "agentA", "http://x")
        masked = a._safe("error using sk-zzz-supersecret here")
        assert "sk-zzz-supersecret" not in masked


class TestWorkingDir:
    def test_valid_dir(self, adapter):
        assert adapter._resolve_cwd() == adapter.working_dir

    def test_missing_dir_raises(self, tmp_path, monkeypatch):
        monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: "/fake/goose")
        a = GooseAdapter("ws", "c", "t", "ag", "http://x",
                         working_dir=str(tmp_path / "nope"))
        with pytest.raises(NotADirectoryError):
            a._resolve_cwd()

    def test_file_not_dir_raises(self, tmp_path, monkeypatch):
        monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: "/fake/goose")
        f = tmp_path / "afile"
        f.write_text("x")
        a = GooseAdapter("ws", "c", "t", "ag", "http://x", working_dir=str(f))
        with pytest.raises(NotADirectoryError):
            a._resolve_cwd()


class TestSessionPersistence:
    def test_save_and_reload(self, adapter, monkeypatch):
        adapter._channel_sessions["general"] = "oa_abc"
        adapter._save_sessions()
        # New adapter instance reloads the mapping (survives restart).
        a2 = GooseAdapter("ws1", "general", "tok", "agentA", "http://x",
                          working_dir=adapter.working_dir)
        assert a2._channel_sessions.get("general") == "oa_abc"


# ---------------------------------------------------------------------------
# End-to-end stream-json run against a FAKE goose (no real binary, no model)
# ---------------------------------------------------------------------------

def _make_fake_goose(tmp_path, stream_lines, exit_code=0, stderr="", version="1.37.0"):
    """Write a fake goose script that answers --version then emits stream-json."""
    script = tmp_path / "fake_goose.sh"
    body = [
        "#!/bin/sh",
        'for a in "$@"; do',
        f'  if [ "$a" = "--version" ]; then echo "goose {version}"; exit 0; fi',
        "done",
        "cat >/dev/null",  # consume stdin (the prompt)
    ]
    for line in stream_lines:
        esc = line.replace("'", "'\\''")
        body.append(f"printf '%s\\n' '{esc}'")
    if stderr:
        esc = stderr.replace("'", "'\\''")
        body.append(f"printf '%s\\n' '{esc}' 1>&2")
    body.append(f"exit {exit_code}")
    script.write_text("\n".join(body) + "\n")
    script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return str(script)


def _instrument(adapter):
    """Capture status/response/error instead of hitting the network."""
    sent = {"status": [], "response": [], "error": []}
    async def _status(ch, content): sent["status"].append(content)
    async def _response(ch, content): sent["response"].append(content)
    async def _error(ch, content): sent["error"].append(content)
    async def _title(ch, content): pass
    adapter._send_status = _status
    adapter._send_response = _response
    adapter._send_error = _error
    adapter._auto_title_channel = _title
    return sent


@_aiorun
async def test_e2e_success_run(tmp_path, monkeypatch):
    proj = tmp_path / "proj"; proj.mkdir()
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    lines = [
        json.dumps({"type": "message", "message": {"role": "assistant", "created": 1,
            "content": [{"type": "toolRequest", "id": "t1", "toolCall": {"status": "success",
                "value": {"name": "developer__shell", "arguments": {"command": "echo hi"}}}}]}}),
        json.dumps({"type": "message", "message": {"role": "assistant", "created": 2,
            "content": [{"type": "text", "text": "All done!"}]}}),
        json.dumps({"type": "complete", "total_tokens": 7}),
    ]
    fake = _make_fake_goose(tmp_path, lines)
    monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: fake)
    a = GooseAdapter("ws", "general", "tok", "agentA", "http://x", working_dir=str(proj))
    a._goose_binary = fake
    sent = _instrument(a)

    await a._handle_message({"content": "do the thing", "sessionId": "general"})

    assert sent["response"] == ["All done!"]   # final answer sent exactly once
    assert sent["error"] == []
    assert any("developer__shell" in s for s in sent["status"])  # tool progress shown
    # session recorded for resume
    assert "general" in a._channel_sessions


@_aiorun
async def test_e2e_nonzero_exit_is_failure(tmp_path, monkeypatch):
    proj = tmp_path / "proj"; proj.mkdir()
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    # Some text on stdout, but exit 1 + an auth error on stderr.
    lines = [json.dumps({"type": "message", "message": {"role": "assistant", "created": 1,
        "content": [{"type": "text", "text": "partial"}]}})]
    fake = _make_fake_goose(tmp_path, lines, exit_code=1,
                            stderr="Error: 401 Unauthorized invalid api key")
    monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: fake)
    a = GooseAdapter("ws", "general", "tok", "agentA", "http://x", working_dir=str(proj))
    a._goose_binary = fake
    sent = _instrument(a)

    await a._handle_message({"content": "hi", "sessionId": "general"})

    assert sent["response"] == []           # never report partial text as success
    assert len(sent["error"]) == 1
    assert "authentication" in sent["error"][0].lower()
    assert "general" not in a._channel_sessions  # failed run does not record a session


@_aiorun
async def test_e2e_error_event_with_exit_zero_is_failure(tmp_path, monkeypatch):
    # Goose can emit an error event then still exit 0 — must be treated as failure.
    proj = tmp_path / "proj"; proj.mkdir()
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    lines = [
        json.dumps({"type": "error", "error": "model gpt-x does not exist"}),
        json.dumps({"type": "complete"}),
    ]
    fake = _make_fake_goose(tmp_path, lines, exit_code=0)
    monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: fake)
    a = GooseAdapter("ws", "general", "tok", "agentA", "http://x", working_dir=str(proj))
    a._goose_binary = fake
    sent = _instrument(a)

    await a._handle_message({"content": "hi", "sessionId": "general"})
    assert sent["response"] == []
    assert len(sent["error"]) == 1
    assert "model" in sent["error"][0].lower()


@_aiorun
async def test_e2e_second_message_resumes(tmp_path, monkeypatch):
    proj = tmp_path / "proj"; proj.mkdir()
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    lines = [
        json.dumps({"type": "message", "message": {"role": "assistant", "created": 1,
            "content": [{"type": "text", "text": "ok"}]}}),
        json.dumps({"type": "complete"}),
    ]
    fake = _make_fake_goose(tmp_path, lines)
    monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: fake)
    a = GooseAdapter("ws", "general", "tok", "agentA", "http://x", working_dir=str(proj))
    a._goose_binary = fake
    _instrument(a)

    captured_cmds = []
    orig_build = a._build_cmd
    def spy(name, resume, system_prompt):
        captured_cmds.append({"name": name, "resume": resume})
        return orig_build(name, resume, system_prompt)
    a._build_cmd = spy

    await a._handle_message({"content": "first", "sessionId": "general"})
    await a._handle_message({"content": "second", "sessionId": "general"})

    assert captured_cmds[0]["resume"] is False   # first creates
    assert captured_cmds[1]["resume"] is True    # second resumes
    assert captured_cmds[0]["name"] == captured_cmds[1]["name"]  # same channel → same session


def _make_heal_goose(tmp_path):
    """Fake goose that fails 'No session found' on --resume, succeeds on create."""
    script = tmp_path / "heal_goose.sh"
    success = json.dumps({"type": "message", "message": {"role": "assistant",
        "created": 1, "content": [{"type": "text", "text": "fresh"}]}})
    complete = json.dumps({"type": "complete"})
    s_esc = success.replace("'", "'\\''")
    c_esc = complete.replace("'", "'\\''")
    body = [
        "#!/bin/sh",
        'for a in "$@"; do',
        '  if [ "$a" = "--version" ]; then echo "goose 1.37.0"; exit 0; fi',
        "done",
        "cat >/dev/null",
        'for a in "$@"; do',
        '  if [ "$a" = "--resume" ]; then',
        "    printf 'Error: No session found with name oa_x\\n' 1>&2; exit 1",
        "  fi",
        "done",
        f"printf '%s\\n' '{s_esc}'",
        f"printf '%s\\n' '{c_esc}'",
        "exit 0",
    ]
    script.write_text("\n".join(body) + "\n")
    script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return str(script)


@_aiorun
async def test_e2e_too_old_version_blocks(tmp_path, monkeypatch):
    # A Goose CLI older than the minimum is refused with an upgrade prompt and
    # the task never runs.
    proj = tmp_path / "proj"; proj.mkdir()
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    lines = [json.dumps({"type": "message", "message": {"role": "assistant",
        "created": 1, "content": [{"type": "text", "text": "should not run"}]}}),
        json.dumps({"type": "complete"})]
    fake = _make_fake_goose(tmp_path, lines, version="1.10.0")
    monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: fake)
    a = GooseAdapter("ws", "general", "tok", "agentA", "http://x", working_dir=str(proj))
    a._goose_binary = fake
    sent = _instrument(a)

    await a._handle_message({"content": "hi", "sessionId": "general"})

    assert sent["response"] == []  # task did not run
    assert len(sent["error"]) == 1
    assert ">= 1.37.0" in sent["error"][0] and "too old" in sent["error"][0].lower()


@_aiorun
async def test_e2e_missing_session_auto_heals(tmp_path, monkeypatch):
    # A persisted mapping points at a session Goose no longer has: --resume fails
    # with "No session found", and the adapter recreates it instead of erroring.
    proj = tmp_path / "proj"; proj.mkdir()
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    fake = _make_heal_goose(tmp_path)
    monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: fake)
    a = GooseAdapter("ws", "general", "tok", "agentA", "http://x", working_dir=str(proj))
    a._goose_binary = fake
    a._channel_sessions["general"] = goose_session_name("ws", "agentA", "general")  # stale
    sent = _instrument(a)

    await a._handle_message({"content": "hi", "sessionId": "general"})

    assert sent["response"] == ["fresh"]  # recovered via a fresh session
    assert any("new one" in s.lower() or "reset" in s.lower() for s in sent["status"])
    assert sent["error"] == []


@_aiorun
async def test_e2e_invalid_working_dir_reports_error(tmp_path, monkeypatch):
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    fake = _make_fake_goose(tmp_path, [json.dumps({"type": "complete"})])
    monkeypatch.setattr(goose_mod, "find_goose_binary", lambda: fake)
    a = GooseAdapter("ws", "general", "tok", "agentA", "http://x",
                     working_dir=str(tmp_path / "missing"))
    a._goose_binary = fake
    sent = _instrument(a)
    await a._handle_message({"content": "hi", "sessionId": "general"})
    assert sent["error"] and "does not exist" in sent["error"][0]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
