# -*- coding: utf-8 -*-
"""
Tests for workspace CRUD endpoints.
"""

import pytest


class TestCreateWorkspace:
    """POST /v1/workspaces — create a workspace."""

    def test_create_workspace(self, client):
        """Create workspace returns ID, slug, token, and default channel."""
        resp = client.post("/v1/workspaces", json={
            "name": "My Workspace",
            "agent_name": "test-agent",
        })
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert "workspaceId" in data
        assert "slug" in data
        assert "token" in data
        assert "channel" in data
        assert data["name"] == "My Workspace"

    def test_create_workspace_has_channel_with_master(self, client):
        """Default channel has the creating agent as master and participant."""
        resp = client.post("/v1/workspaces", json={
            "name": "Test",
            "agent_name": "agent-alpha",
        })
        channel = resp.json()["data"]["channel"]
        assert channel["masterAgent"] == "agent-alpha"
        assert "agent-alpha" in channel["participants"]

    def test_create_workspace_with_email(self, client):
        """Creator email is stored."""
        resp = client.post("/v1/workspaces", json={
            "name": "Test",
            "agent_name": "agent-alpha",
            "creator_email": "user@example.com",
        })
        ws_id = resp.json()["data"]["workspaceId"]
        detail = client.get(f"/v1/workspaces/{ws_id}")
        assert detail.json()["data"]["creatorEmail"] == "user@example.com"


class TestGetWorkspace:
    """GET /v1/workspaces/{id} — get workspace details."""

    def test_get_workspace_by_id(self, client, workspace):
        """Fetch workspace by ID."""
        resp = client.get(f"/v1/workspaces/{workspace['id']}")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["workspaceId"] == workspace["id"]
        assert data["name"] == workspace["name"]

    def test_get_workspace_by_slug(self, client, workspace):
        """Fetch workspace by slug."""
        resp = client.get(f"/v1/workspaces/{workspace['slug']}")
        assert resp.status_code == 200
        assert resp.json()["data"]["workspaceId"] == workspace["id"]

    def test_get_workspace_includes_agents(self, client, workspace):
        """Workspace detail includes agent list."""
        resp = client.get(f"/v1/workspaces/{workspace['id']}")
        agents = resp.json()["data"]["agents"]
        assert len(agents) >= 1
        assert agents[0]["agentName"] == "agent-alpha"
        assert agents[0]["role"] == "master"

    def test_get_nonexistent_workspace(self, client):
        """Nonexistent workspace returns 404."""
        resp = client.get("/v1/workspaces/nonexistent")
        assert resp.status_code == 404


class TestUpdateWorkspace:
    """PATCH /v1/workspaces/{id} — update workspace."""

    def test_update_name(self, client, workspace):
        """Update workspace name."""
        resp = client.patch(f"/v1/workspaces/{workspace['id']}", json={
            "name": "Updated Name",
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["name"] == "Updated Name"

    def test_update_settings(self, client, workspace):
        """Update workspace settings."""
        resp = client.patch(f"/v1/workspaces/{workspace['id']}", json={
            "settings": {"theme": "dark"},
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["settings"]["theme"] == "dark"


class TestDeleteWorkspace:
    """DELETE /v1/workspaces/{id} — soft-delete workspace."""

    def test_delete_workspace(self, client, workspace):
        """Soft-delete sets status to 'deleted'."""
        resp = client.delete(f"/v1/workspaces/{workspace['id']}")
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "deleted"

    def test_deleted_workspace_hidden_from_list(self, client, workspace):
        """Deleted workspace doesn't appear in list."""
        client.delete(f"/v1/workspaces/{workspace['id']}")
        resp = client.get("/v1/workspaces")
        ids = [w["workspaceId"] for w in resp.json()["data"]]
        assert workspace["id"] not in ids


class TestListWorkspaces:
    """GET /v1/workspaces — list workspaces."""

    def test_list_empty(self, client):
        """Empty workspace list."""
        resp = client.get("/v1/workspaces")
        assert resp.status_code == 200
        assert resp.json()["data"] == []

    def test_list_returns_workspaces(self, client, workspace):
        """Workspaces appear in list."""
        resp = client.get("/v1/workspaces")
        assert len(resp.json()["data"]) >= 1

    def test_list_filter_by_agent(self, client, workspace):
        """Filter workspaces by agent membership."""
        resp = client.get("/v1/workspaces", params={"agent_name": "agent-alpha"})
        assert len(resp.json()["data"]) >= 1

        resp2 = client.get("/v1/workspaces", params={"agent_name": "nonexistent"})
        assert resp2.json()["data"] == []
