"""Unit tests for Aider agent support (registry registration + AiderAdapter).

None of these require a real ``aider`` install, a model API key, or a live
workspace: the CLI is simulated with a fake ``asyncio`` subprocess that emits
plain (non-JSON) terminal text, binary detection runs against a fake executable
on an isolated PATH/HOME, and the network helpers are stubbed on the instance.

Covered (maps to the PR's test matrix):
- Aider agent-type registration (builtin plugin from the registry YAML)
- Executable detection (PATH + ~/.local/bin fallback, missing, wrong binary)
- Non-interactive command construction (message-file, safety flags, model)
- Default git safety (--no-auto-commits/--no-dirty-commits) + opt-in auto-commit
- Multi-provider key→env mapping (OpenAI/Anthropic/OpenRouter/Gemini/DeepSeek/base-url)
- API key never on the command line and never logged
- Long prompt delivered via a private message file outside the project
- stdout/stderr handling, ANSI stripping, exit-code-decides-success
- Auth / model / network / git / permission error classification
- Per-channel chat-history isolation, restore, path-traversal safety, corruption
- Stop control, session reset/clear, working directory
- No regression for existing agent types

Run:
    pytest tests/agents/test_aider.py -v
"""

import asyncio
import importlib
import logging
import os
import stat

import pytest

import openagents.registry.loader as loader
import openagents.adapters.aider as aider_mod
from openagents.adapters.aider import (
    AiderAdapter,
    resolve_aider_provider,
    _classify_error,
    _clean_output,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_aider_plugin():
    data = next(
        d for d in loader.load_registry_yamls() if d.get("name") == "aider"
    )
    plugin = loader._make_plugin_from_yaml(data)
    assert plugin is not None, "aider must be a builtin plugin"
    return plugin


def _write_executable(path, body="#!/bin/sh\necho 'aider 0.50.0'\n"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _make_adapter(tmp_path, working_dir=None):
    """Build an AiderAdapter without any network I/O (constructor is offline)."""
    return AiderAdapter(
        workspace_id="ws-test",
        channel_name="general",
        token="tok",
        agent_name="aider-bot",
        endpoint="https://example.invalid",
        working_dir=working_dir or str(tmp_path / "proj"),
    )


class _FakeStreamReader:
    """Minimal async reader yielding pre-canned lines, then EOF (b"")."""

    def __init__(self, lines=None):
        self._lines = list(lines or [])

    async def readline(self):
        if self._lines:
            return self._lines.pop(0)
        return b""


class _FakeProcess:
    def __init__(self, stdout_lines, returncode=0, stderr_lines=None):
        self.stdout = _FakeStreamReader(stdout_lines)
        self.stderr = _FakeStreamReader(stderr_lines or [])
        self.returncode = returncode
        self.pid = 4242

    async def wait(self):
        return self.returncode


@pytest.fixture
def patch_spawn(monkeypatch):
    """Patch asyncio.create_subprocess_exec; capture call args, return a fake."""
    captured = {}

    def _factory(stdout_lines, returncode=0, stderr_lines=None):
        async def fake_exec(*args, **kwargs):
            captured["args"] = args
            captured["kwargs"] = kwargs
            proc = _FakeProcess(stdout_lines, returncode, stderr_lines)
            captured["proc"] = proc
            return proc

        monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
        return captured

    return _factory


def _lines(*texts):
    return [(t + "\n").encode("utf-8") for t in texts]


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
    # No provider keys / config / install-dir overrides leak in from the shell.
    for var in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
                "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "LLM_API_KEY",
                "AIDER_PROVIDER", "AIDER_MODEL", "LLM_MODEL", "LLM_BASE_URL",
                "OPENAI_API_BASE", "AIDER_AUTO_COMMITS",
                "XDG_BIN_HOME", "XDG_DATA_HOME", "UV_TOOL_DIR", "APPDATA"):
        monkeypatch.delenv(var, raising=False)
    return home


# ---------------------------------------------------------------------------
# 1. Registration
# ---------------------------------------------------------------------------

class TestAiderRegistration:
    def test_aider_is_builtin_plugin(self):
        plugin = _make_aider_plugin()
        assert plugin.name == "aider"
        assert plugin.label == "Aider"

    def test_adapter_module_imports(self):
        data = next(d for d in loader.load_registry_yamls() if d["name"] == "aider")
        mod = importlib.import_module(data["adapter"]["module"])
        cls = getattr(mod, data["adapter"]["class"])
        assert cls is AiderAdapter

    def test_env_config_is_multiprovider(self):
        plugin = _make_aider_plugin()
        fields = plugin.required_env_vars()
        names = [e.get("name") for e in fields]
        assert "AIDER_PROVIDER" in names
        assert "AIDER_MODEL" in names
        assert "LLM_API_KEY" in names
        assert "LLM_BASE_URL" in names
        # Provider defaults to auto.
        provider = next(e for e in fields if e["name"] == "AIDER_PROVIDER")
        assert provider.get("default") == "auto"
        # The key must be flagged password so the launcher masks it; and there
        # is NOT a fixed single AIDER_API_KEY (Aider is multi-provider).
        api_key = next(e for e in fields if e["name"] == "LLM_API_KEY")
        assert api_key.get("password") is True
        assert "AIDER_API_KEY" not in names

    def test_workspace_support_flag(self):
        data = next(d for d in loader.load_registry_yamls() if d["name"] == "aider")
        assert data.get("builtin") is True
        assert data.get("support", {}).get("workspace") is True


# ---------------------------------------------------------------------------
# 2. Detection
# ---------------------------------------------------------------------------

class TestAiderDetection:
    def test_not_installed_without_binary(self, isolated_home):
        plugin = _make_aider_plugin()
        assert plugin._which_binary() is None
        assert plugin.is_installed() is False
        ready, msg = plugin.check_ready()
        assert ready is False
        assert "install aider" in msg.lower()

    def test_detects_binary_on_path(self, isolated_home, tmp_path, monkeypatch):
        bin_dir = tmp_path / "bin"
        aider_path = bin_dir / "aider"
        _write_executable(aider_path)
        monkeypatch.setenv("PATH", str(bin_dir))
        plugin = _make_aider_plugin()
        assert plugin._which_binary() == str(aider_path)
        assert plugin.is_installed() is True

    def test_detects_binary_in_local_bin_fallback(self, isolated_home):
        # uv tool / pipx / pip --user all install into ~/.local/bin, which a
        # GUI/daemon process may not have on PATH.
        aider_path = isolated_home / ".local" / "bin" / "aider"
        _write_executable(aider_path)
        plugin = _make_aider_plugin()
        assert plugin._which_binary() == str(aider_path)

    def test_adapter_find_binary_in_local_bin(self, isolated_home):
        aider_path = isolated_home / ".local" / "bin" / "aider"
        _write_executable(aider_path)
        assert AiderAdapter._find_aider_binary() == str(aider_path)

    def test_adapter_find_binary_in_uv_tools_venv(self, isolated_home):
        # The real Windows failure mode: `uv tool install` left the executable
        # only in its tools venv. Unix layout: ~/.local/share/uv/tools/<pkg>/bin.
        aider_path = (isolated_home / ".local" / "share" / "uv" / "tools"
                      / "aider-chat" / "bin" / "aider")
        _write_executable(aider_path)
        assert AiderAdapter._find_aider_binary() == str(aider_path)

    def test_adapter_find_binary_honors_xdg_bin_home(self, isolated_home, tmp_path, monkeypatch):
        # The official installer's first-priority dir.
        xdg = tmp_path / "xdg_bin"
        _write_executable(xdg / "aider")
        monkeypatch.setenv("XDG_BIN_HOME", str(xdg))
        assert AiderAdapter._find_aider_binary() == str(xdg / "aider")

    def test_adapter_find_binary_missing(self, isolated_home):
        assert AiderAdapter._find_aider_binary() is None

    def test_windows_prefers_exe_shim(self, monkeypatch):
        monkeypatch.setattr(aider_mod.platform, "system", lambda: "Windows")
        calls = []

        def fake_which(name):
            calls.append(name)
            return f"C:\\bin\\{name}" if name == "aider.exe" else None

        monkeypatch.setattr(aider_mod.shutil, "which", fake_which)
        assert AiderAdapter._find_aider_binary() == "C:\\bin\\aider.exe"
        assert calls[0] == "aider.exe"

    def test_is_real_aider_accepts_aider(self, monkeypatch):
        class _R:
            stdout = "aider 0.50.0"
            stderr = ""
        monkeypatch.setattr(aider_mod.subprocess, "run", lambda *a, **k: _R())
        assert AiderAdapter.is_real_aider("/usr/bin/aider") is True

    def test_is_real_aider_rejects_wrong_binary(self, monkeypatch):
        class _R:
            stdout = "some-other-tool 1.2.3"
            stderr = ""
        monkeypatch.setattr(aider_mod.subprocess, "run", lambda *a, **k: _R())
        assert AiderAdapter.is_real_aider("/usr/bin/aider") is False

    def test_is_real_aider_inconclusive_on_error(self, monkeypatch):
        def boom(*a, **k):
            raise OSError("cannot exec")
        monkeypatch.setattr(aider_mod.subprocess, "run", boom)
        # A flaky probe must not block a real install.
        assert AiderAdapter.is_real_aider("/usr/bin/aider") is True


# ---------------------------------------------------------------------------
# 3. Command construction + config
# ---------------------------------------------------------------------------

class TestAiderCommand:
    def test_new_session_command_defaults_to_no_commits(self, isolated_home, tmp_path):
        adapter = _make_adapter(tmp_path)
        adapter._aider_binary = "/usr/bin/aider"
        cmd = adapter._build_aider_cmd("general", "/tmp/msg.txt", restore=False)
        assert cmd[0] == "/usr/bin/aider"
        assert "--message-file" in cmd and "/tmp/msg.txt" in cmd
        assert "--yes-always" in cmd
        assert "--no-pretty" in cmd
        # Git safety defaults — never auto-commit, never commit pre-existing work,
        # never touch the tracked .gitignore.
        assert "--no-auto-commits" in cmd
        assert "--no-dirty-commits" in cmd
        assert "--no-gitignore" in cmd
        assert "--auto-commits" not in cmd
        # New session → no restore.
        assert "--restore-chat-history" not in cmd

    def test_resume_when_history_exists(self, isolated_home, tmp_path):
        adapter = _make_adapter(tmp_path)
        adapter._aider_binary = "/usr/bin/aider"
        # Materialize a non-empty, readable chat history for this channel.
        hist = adapter._chat_history_file("general")
        hist.parent.mkdir(parents=True, exist_ok=True)
        hist.write_text("# prior turn\n")
        restore = adapter._has_history("general")
        cmd = adapter._build_aider_cmd("general", "/tmp/msg.txt", restore=restore)
        assert "--restore-chat-history" in cmd

    def test_auto_commit_opt_in(self, isolated_home, tmp_path, monkeypatch):
        monkeypatch.setenv("AIDER_AUTO_COMMITS", "true")
        adapter = _make_adapter(tmp_path)
        adapter._aider_binary = "/usr/bin/aider"
        cmd = adapter._build_aider_cmd("general", "/tmp/msg.txt", restore=False)
        assert "--auto-commits" in cmd
        assert "--no-auto-commits" not in cmd

    def test_model_flag_passed(self, isolated_home, tmp_path, monkeypatch):
        monkeypatch.setenv("AIDER_MODEL", "claude-3-5-sonnet-20241022")
        adapter = _make_adapter(tmp_path)
        adapter._aider_binary = "/usr/bin/aider"
        cmd = adapter._build_aider_cmd("general", "/tmp/msg.txt", restore=False)
        i = cmd.index("--model")
        assert cmd[i + 1] == "claude-3-5-sonnet-20241022"

    def test_missing_binary_raises(self, isolated_home, tmp_path, monkeypatch):
        adapter = _make_adapter(tmp_path)
        adapter._aider_binary = None
        monkeypatch.setattr(AiderAdapter, "_find_aider_binary", staticmethod(lambda: None))
        with pytest.raises(FileNotFoundError, match="aider CLI not found"):
            adapter._build_aider_cmd("general", "/tmp/msg.txt", restore=False)

    def test_api_key_never_in_command_args(self, isolated_home, tmp_path, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "sk-secret-zzz")
        monkeypatch.setenv("AIDER_MODEL", "gpt-4o")
        adapter = _make_adapter(tmp_path)
        adapter._aider_binary = "/usr/bin/aider"
        cmd = adapter._build_aider_cmd("general", "/tmp/msg.txt", restore=False)
        assert all("sk-secret-zzz" not in str(part) for part in cmd)


# ---------------------------------------------------------------------------
# 4. Provider resolution (deterministic resolver)
# ---------------------------------------------------------------------------

class TestExplicitProvider:
    """§III.1 — explicit AIDER_PROVIDER wins and maps to the right env var."""

    def test_openai(self):
        r = resolve_aider_provider("openai", "gpt-4o", "sk", "")
        assert r.error is None and r.env == {"OPENAI_API_KEY": "sk"}

    def test_anthropic(self):
        r = resolve_aider_provider("anthropic", "sonnet", "sk", "")
        assert r.error is None and r.env == {"ANTHROPIC_API_KEY": "sk"}

    def test_openrouter(self):
        r = resolve_aider_provider("openrouter", "anything", "sk", "")
        assert r.error is None and r.env == {"OPENROUTER_API_KEY": "sk"}

    def test_gemini(self):
        r = resolve_aider_provider("gemini", "gemini-1.5-pro", "sk", "")
        assert r.error is None and r.env == {"GEMINI_API_KEY": "sk"}

    def test_deepseek(self):
        r = resolve_aider_provider("deepseek", "deepseek-chat", "sk", "")
        assert r.error is None and r.env == {"DEEPSEEK_API_KEY": "sk"}

    def test_openai_compatible(self):
        r = resolve_aider_provider("openai-compatible", "my-model", "sk", "https://relay/v1")
        assert r.error is None
        assert r.env == {"OPENAI_API_KEY": "sk", "OPENAI_API_BASE": "https://relay/v1"}
        assert r.model == "openai/my-model"

    def test_explicit_beats_model_inference(self):
        # §III.1 + test 21: provider wins; a bare gpt model under anthropic is
        # NOT a conflict (no provider prefix) so anthropic is honoured.
        r = resolve_aider_provider("anthropic", "gpt-4o", "sk", "")
        assert r.error is None and r.env == {"ANTHROPIC_API_KEY": "sk"}

    def test_unknown_provider_value_errors(self):
        r = resolve_aider_provider("bogus", "gpt-4o", "sk", "")
        assert r.error is not None and "Unknown AIDER_PROVIDER" in r.error


class TestModelInference:
    """§III.2 — auto/blank provider infers from an unambiguous model name."""

    @pytest.mark.parametrize("model", ["sonnet", "opus", "haiku", "claude-3-5-sonnet-20241022",
                                       "anthropic/claude-3", "SONNET", "Claude-3"])
    def test_anthropic_models(self, model):
        r = resolve_aider_provider("auto", model, "sk", "")
        assert r.error is None and r.env == {"ANTHROPIC_API_KEY": "sk"}

    @pytest.mark.parametrize("model", ["gpt-4o", "openai/gpt-4o", "GPT-4O", "o1-mini", "chatgpt-4o-latest"])
    def test_openai_models(self, model):
        r = resolve_aider_provider("auto", model, "sk", "")
        assert r.error is None and r.env == {"OPENAI_API_KEY": "sk"}

    def test_openrouter_prefix(self):
        r = resolve_aider_provider("auto", "openrouter/anthropic/claude-3.5-sonnet", "sk", "")
        assert r.env == {"OPENROUTER_API_KEY": "sk"}

    @pytest.mark.parametrize("model", ["gemini/gemini-1.5-pro", "gemini-1.5-flash", "GEMINI/gemini-2.0"])
    def test_gemini_models(self, model):
        r = resolve_aider_provider("auto", model, "sk", "")
        assert r.env == {"GEMINI_API_KEY": "sk"}

    @pytest.mark.parametrize("model", ["deepseek/deepseek-chat", "deepseek-coder", "DeepSeek/x"])
    def test_deepseek_models(self, model):
        r = resolve_aider_provider("auto", model, "sk", "")
        assert r.env == {"DEEPSEEK_API_KEY": "sk"}

    def test_blank_provider_treated_as_auto(self):
        r = resolve_aider_provider("", "sonnet", "sk", "")
        assert r.env == {"ANTHROPIC_API_KEY": "sk"}


class TestAmbiguityProtection:
    """§III.3 / §III.4 — never silently dump the key into OPENAI_API_KEY."""

    def test_empty_model_with_key_and_no_provider_errors(self):
        r = resolve_aider_provider("auto", "", "sk", "")
        assert r.env == {} and r.error is not None
        assert "Could not determine" in r.error

    def test_unknown_model_with_key_auto_errors(self):
        r = resolve_aider_provider("auto", "some-random-model-xyz", "sk", "")
        assert r.env == {} and r.error is not None

    def test_empty_model_no_key_is_allowed(self):
        # §III.4 + test 19 — auto + blank model + no key is a valid (auto) config.
        r = resolve_aider_provider("auto", "", "", "")
        assert r.error is None and r.env == {}

    def test_no_key_does_not_override_native_env(self):
        # The resolver only returns vars to ADD; with no key it adds nothing, so
        # the inherited native provider key is preserved by the caller.
        r = resolve_aider_provider("auto", "claude-3", "", "")
        assert r.error is None and r.env == {}

    def test_conflict_provider_vs_model_prefix(self):
        # §V — explicit provider conflicting with an explicit model prefix errors.
        r = resolve_aider_provider("anthropic", "openai/gpt-4o", "sk", "")
        assert r.env == {} and r.error is not None and "conflicts" in r.error
        r2 = resolve_aider_provider("openrouter", "anthropic/claude-3", "sk", "")
        assert r2.env == {} and r2.error is not None and "conflicts" in r2.error


class TestOpenAiCompatible:
    """§IV — OpenAI-compatible endpoint handling."""

    def test_base_url_and_key_mapping(self):
        r = resolve_aider_provider("openai-compatible", "llama3", "sk", "https://host/v1")
        assert r.env["OPENAI_API_BASE"] == "https://host/v1"   # test 23
        assert r.env["OPENAI_API_KEY"] == "sk"                 # test 24

    def test_plain_model_normalized(self):
        r = resolve_aider_provider("openai-compatible", "llama3", "sk", "https://host/v1")
        assert r.model == "openai/llama3"                      # test 25

    def test_existing_prefix_not_doubled(self):
        r = resolve_aider_provider("openai-compatible", "openai/llama3", "sk", "https://host/v1")
        assert r.model == "openai/llama3"                      # test 26

    def test_missing_base_url_errors(self):
        r = resolve_aider_provider("openai-compatible", "llama3", "sk", "")
        assert r.env == {} and r.error is not None             # test 27
        assert "LLM_BASE_URL" in r.error

    def test_base_url_not_written_to_unrelated_provider(self):
        # §IV.6 — a base URL with anthropic must NOT leak into OPENAI_API_BASE.
        r = resolve_aider_provider("anthropic", "sonnet", "sk", "https://host/v1")
        assert "OPENAI_API_BASE" not in r.env
        assert r.env == {"ANTHROPIC_API_KEY": "sk"}


class TestSubprocessEnvIntegration:
    def test_build_subprocess_env_maps_and_keeps_secret(self, isolated_home, tmp_path, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "sk-anthropic-secret")
        monkeypatch.setenv("AIDER_MODEL", "claude-3-5-sonnet-20241022")
        adapter = _make_adapter(tmp_path)
        env = adapter._build_subprocess_env()
        assert env["ANTHROPIC_API_KEY"] == "sk-anthropic-secret"
        assert env.get("NO_COLOR") == "1"

    def test_explicit_provider_via_config(self, isolated_home, tmp_path, monkeypatch):
        monkeypatch.setenv("AIDER_PROVIDER", "openrouter")
        monkeypatch.setenv("AIDER_MODEL", "anything/model")
        monkeypatch.setenv("LLM_API_KEY", "sk-or")
        adapter = _make_adapter(tmp_path)
        # openrouter explicit, model has no conflicting prefix → no error.
        res = adapter._resolve_config()
        assert res.error is None
        assert adapter._build_subprocess_env()["OPENROUTER_API_KEY"] == "sk-or"

    def test_openai_compatible_model_normalized_in_cmd(self, isolated_home, tmp_path, monkeypatch):
        monkeypatch.setenv("AIDER_PROVIDER", "openai-compatible")
        monkeypatch.setenv("AIDER_MODEL", "llama3")
        monkeypatch.setenv("LLM_API_KEY", "sk")
        monkeypatch.setenv("LLM_BASE_URL", "https://host/v1")
        adapter = _make_adapter(tmp_path)
        adapter._aider_binary = "/usr/bin/aider"
        cmd = adapter._build_aider_cmd("general", "/tmp/m.txt", restore=False)
        i = cmd.index("--model")
        assert cmd[i + 1] == "openai/llama3"
        env = adapter._build_subprocess_env()
        assert env["OPENAI_API_BASE"] == "https://host/v1"
        # test 28 — neither key nor base URL ever appears in argv.
        assert all("sk" != str(p) for p in cmd)
        assert all("https://host/v1" not in str(p) for p in cmd)

    def test_config_gate_blocks_run(self, isolated_home, tmp_path, monkeypatch):
        # Ambiguous config → _run_aider returns an error WITHOUT spawning.
        monkeypatch.setenv("LLM_API_KEY", "sk")  # key but no model/provider
        adapter = _make_adapter(tmp_path)
        adapter._aider_binary = "/usr/bin/aider"
        spawned = {"called": False}

        async def fake_spawn(cmd, ch):
            spawned["called"] = True
            return "", None

        adapter._spawn_aider = fake_spawn
        text, error = asyncio.run(adapter._run_aider("hi", "general"))
        assert spawned["called"] is False
        assert error is not None and "Configuration error" in error


# ---------------------------------------------------------------------------
# 5. Subprocess flow — output, working dir, message file, errors, secrets
# ---------------------------------------------------------------------------

def _run_spawn(adapter, msg_channel="general"):
    sent = {"status": [], "response": [], "error": []}

    async def fake_status(channel, content):
        sent["status"].append(content)

    adapter._send_status = fake_status
    cmd = ["/usr/bin/aider", "--message-file", "/tmp/m", "--no-pretty"]
    result = asyncio.run(adapter._spawn_aider(cmd, msg_channel))
    return result, sent


class TestAiderSubprocessFlow:
    def test_success_returns_cleaned_stdout(self, isolated_home, tmp_path, patch_spawn):
        patch_spawn(_lines("Applied edit to foo.py", "All done — added the function."))
        adapter = _make_adapter(tmp_path)
        (text, error), sent = _run_spawn(adapter)
        assert error is None
        assert "All done" in text
        # Progress line streamed as a status during the run.
        assert any("Applied edit" in s for s in sent["status"])
        # Process tracking cleared once the turn ends.
        assert "general" not in adapter._channel_processes

    def test_nonzero_exit_is_failure_even_with_stdout(self, isolated_home, tmp_path, patch_spawn):
        patch_spawn(_lines("partial output here"), returncode=1)
        adapter = _make_adapter(tmp_path)
        (text, error), _ = _run_spawn(adapter)
        assert text == ""
        assert error is not None
        assert "code 1" in error or "exit" in error.lower()

    def test_auth_error_classified(self, isolated_home, tmp_path, patch_spawn):
        patch_spawn(_lines("litellm.AuthenticationError: invalid api key"), returncode=1)
        adapter = _make_adapter(tmp_path)
        (text, error), _ = _run_spawn(adapter)
        assert "Authentication failed" in error

    def test_model_error_classified(self, isolated_home, tmp_path, patch_spawn):
        patch_spawn(_lines("NotFoundError: model_not_found: the model does not exist"), returncode=1)
        adapter = _make_adapter(tmp_path)
        (_, error), _ = _run_spawn(adapter)
        assert "Model not found" in error

    def test_network_error_classified(self, isolated_home, tmp_path, patch_spawn):
        patch_spawn([], returncode=1, stderr_lines=_lines("ConnectionError: could not connect"))
        adapter = _make_adapter(tmp_path)
        (_, error), _ = _run_spawn(adapter)
        assert "Network error" in error

    def test_permission_error_classified(self, isolated_home, tmp_path, patch_spawn):
        patch_spawn([], returncode=1, stderr_lines=_lines("PermissionError: [Errno 13] Permission denied"))
        adapter = _make_adapter(tmp_path)
        (_, error), _ = _run_spawn(adapter)
        assert "permission" in error.lower()

    def test_working_dir_is_process_cwd(self, isolated_home, tmp_path, patch_spawn):
        captured = patch_spawn(_lines("ok"))
        wd = str(tmp_path / "myproject")
        adapter = _make_adapter(tmp_path, working_dir=wd)
        asyncio.run(adapter._spawn_aider(["/usr/bin/aider"], "general"))
        assert captured["kwargs"].get("cwd") == wd

    def test_api_key_in_env_not_logged(self, isolated_home, tmp_path, patch_spawn, monkeypatch, caplog):
        secret = "sk-aider-supersecret"
        monkeypatch.setenv("LLM_API_KEY", secret)
        monkeypatch.setenv("AIDER_MODEL", "gpt-4o")
        patch_spawn(_lines("done"), stderr_lines=_lines("some provider noise"))
        adapter = _make_adapter(tmp_path)
        with caplog.at_level(logging.DEBUG, logger="openagents.adapters.aider"):
            _run_spawn(adapter)
        joined = "\n".join(r.getMessage() for r in caplog.records)
        assert secret not in joined

    def test_long_prompt_goes_to_message_file_outside_project(self, isolated_home, tmp_path, patch_spawn):
        captured = patch_spawn(_lines("done"))
        wd = str(tmp_path / "proj")
        os.makedirs(wd, exist_ok=True)
        adapter = _make_adapter(tmp_path, working_dir=wd)
        adapter._aider_binary = "/usr/bin/aider"
        big = "please refactor " * 5000  # well past any ARG_MAX concern
        text, error = asyncio.run(adapter._run_aider(big, "general"))
        argv = captured["args"]
        mf_index = argv.index("--message-file")
        msg_path = argv[mf_index + 1]
        # The message file lives under the sessions dir, NOT inside the project.
        assert str(adapter._sessions_dir) in msg_path
        assert wd not in msg_path
        # The prompt text is never an argv element.
        assert all(big not in str(a) for a in argv)

    def test_ansi_is_stripped(self):
        assert _clean_output("\x1b[31mred\x1b[0m text") == "red text"

    def test_empty_output_success_has_fallback(self, isolated_home, tmp_path, patch_spawn):
        patch_spawn([])  # exit 0, no output
        adapter = _make_adapter(tmp_path)
        (text, error), _ = _run_spawn(adapter)
        assert error is None
        assert text == ""  # _spawn returns empty; _handle_message supplies the fallback


# ---------------------------------------------------------------------------
# 6. Sessions — per-channel isolation, restore, traversal safety, corruption
# ---------------------------------------------------------------------------

class TestAiderSessions:
    def test_channels_use_separate_history_files(self, isolated_home, tmp_path):
        adapter = _make_adapter(tmp_path)
        a = adapter._chat_history_file("alpha")
        b = adapter._chat_history_file("beta")
        assert a != b
        assert a.parent == adapter._sessions_dir

    def test_channel_id_is_traversal_safe(self, isolated_home, tmp_path):
        adapter = _make_adapter(tmp_path)
        evil = adapter._chat_history_file("../../etc/passwd")
        # Sanitized to a single filename inside the sessions dir — no path
        # separators survive, so it cannot escape the sessions dir (the leftover
        # literal ".." chars are inert without a separator).
        assert evil.parent == adapter._sessions_dir
        assert "/" not in evil.name and "\\" not in evil.name
        assert evil.resolve().parent == adapter._sessions_dir.resolve()

    def test_corrupt_history_degrades_to_fresh(self, isolated_home, tmp_path):
        adapter = _make_adapter(tmp_path)
        hist = adapter._chat_history_file("general")
        hist.parent.mkdir(parents=True, exist_ok=True)
        hist.write_bytes(b"\xff\xfe\x00invalid-utf8")
        assert adapter._has_history("general") is False
        # The bad file is moved aside rather than re-read forever.
        assert hist.with_suffix(hist.suffix + ".corrupt").exists()

    def test_reset_channel_session_removes_files(self, isolated_home, tmp_path):
        adapter = _make_adapter(tmp_path)
        hist = adapter._chat_history_file("general")
        hist.parent.mkdir(parents=True, exist_ok=True)
        hist.write_text("x")
        adapter.reset_channel_session("general")
        assert not hist.exists()

    def test_clear_all_sessions(self, isolated_home, tmp_path):
        adapter = _make_adapter(tmp_path)
        hist = adapter._chat_history_file("general")
        hist.parent.mkdir(parents=True, exist_ok=True)
        hist.write_text("x")
        adapter.clear_all_sessions()
        assert not adapter._sessions_dir.exists()


# ---------------------------------------------------------------------------
# 7. Git hygiene
# ---------------------------------------------------------------------------

class TestAiderGit:
    def test_local_git_exclude_added_without_touching_gitignore(self, isolated_home, tmp_path):
        repo = tmp_path / "repo"
        (repo / ".git" / "info").mkdir(parents=True)
        adapter = _make_adapter(tmp_path, working_dir=str(repo))
        adapter._ensure_local_git_exclude(str(repo))
        exclude = (repo / ".git" / "info" / "exclude").read_text()
        assert ".aider*" in exclude
        # The tracked .gitignore must NOT be created/modified by us.
        assert not (repo / ".gitignore").exists()

    def test_non_git_dir_is_noop(self, isolated_home, tmp_path):
        plain = tmp_path / "plain"
        plain.mkdir()
        adapter = _make_adapter(tmp_path, working_dir=str(plain))
        adapter._ensure_local_git_exclude(str(plain))  # must not raise
        assert not (plain / ".git").exists()


# ---------------------------------------------------------------------------
# 8. Stop control
# ---------------------------------------------------------------------------

class TestAiderStop:
    def test_stop_terminates_and_clears_process(self, isolated_home, tmp_path):
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
# 9. No regression for existing agents
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
