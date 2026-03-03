"""Tests for workspace SDK modules: workspace_client, mcp_server, adapters."""

import json
import pytest
from pathlib import Path
from unittest.mock import patch, AsyncMock, MagicMock

from openagents.workspace_client import (
    WorkspaceClient,
    LocalAgentIdentity,
    WorkspaceInfo,
    generate_agent_name,
    get_identity,
    save_identity,
    get_user_email,
    set_user_email,
    clear_user_email,
    _load_identities,
    _save_identities,
    IDENTITY_FILE,
)


class TestGenerateAgentName:
    def test_format(self):
        name = generate_agent_name("claude")
        assert name.startswith("claude-")
        assert len(name) == len("claude-") + 4  # 4 hex chars

    def test_unique(self):
        names = {generate_agent_name("claude") for _ in range(10)}
        assert len(names) > 1  # extremely unlikely all 10 are the same


class TestIdentityStorage:
    @pytest.fixture(autouse=True)
    def _use_tmp(self, tmp_path, monkeypatch):
        """Redirect identity storage to a temp directory."""
        identity_dir = tmp_path / ".openagents"
        identity_file = identity_dir / "identity.json"
        monkeypatch.setattr(
            "openagents.workspace_client.IDENTITY_DIR", identity_dir
        )
        monkeypatch.setattr(
            "openagents.workspace_client.IDENTITY_FILE", identity_file
        )

    def test_save_and_load(self):
        identity = LocalAgentIdentity(
            agent_name="claude-abcd",
            agent_type="claude",
            api_key="oa_agentid_test123",
        )
        save_identity(identity)

        loaded = get_identity("claude")
        assert loaded is not None
        assert loaded.agent_name == "claude-abcd"
        assert loaded.agent_type == "claude"
        assert loaded.api_key == "oa_agentid_test123"

    def test_get_nonexistent(self):
        assert get_identity("nonexistent") is None

    def test_user_email(self):
        assert get_user_email() is None
        set_user_email("test@example.com")
        assert get_user_email() == "test@example.com"
        clear_user_email()
        assert get_user_email() is None

    def test_api_key_storage(self):
        data = _load_identities()
        data["api_key"] = "oa-test-key"
        _save_identities(data)

        loaded = _load_identities()
        assert loaded["api_key"] == "oa-test-key"


class TestWorkspaceClient:
    def test_init(self):
        client = WorkspaceClient()
        assert client.endpoint == "https://endpoint.openagents.org"

    def test_custom_endpoint(self):
        client = WorkspaceClient(endpoint="https://custom.example.com/")
        assert client.endpoint == "https://custom.example.com"  # trailing slash stripped


class TestMCPServer:
    def test_create(self):
        from openagents.mcp_server import create_mcp_server

        server = create_mcp_server(
            workspace_id="ws-123",
            session_id="sess-456",
            token="ws_test_token",
            agent_name="claude-abcd",
        )
        assert server is not None

    def test_server_name(self):
        from openagents.mcp_server import create_mcp_server

        server = create_mcp_server(
            workspace_id="ws-123",
            session_id="sess-456",
            token="ws_test_token",
            agent_name="claude-abcd",
        )
        assert server.name == "openagents-workspace"


class TestClaudeAdapter:
    def test_init(self):
        from openagents.adapters.claude import ClaudeAdapter

        adapter = ClaudeAdapter(
            workspace_id="ws-123",
            session_id="sess-456",
            token="ws_test_token",
            agent_name="claude-abcd",
        )
        assert adapter.workspace_id == "ws-123"
        assert adapter.agent_name == "claude-abcd"
        assert adapter._running is False
