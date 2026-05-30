# -*- coding: utf-8 -*-
"""
End-to-end backend tests for the Skill Hub install flow.

Covers the Workspace → Launcher contract:
  - POST /skills/install marks the skill `installing` (NOT installed) and emits
    a `workspace.agent.control` event with `action=skill.install` + catalog
    metadata that the launcher polls for.
  - POST /skills/status (launcher callback) flips state to installed/failed and
    keeps the legacy `installed` list in sync.
  - POST /skills/uninstall emits a `skill.uninstall` control event and clears
    state.
"""

from sqlalchemy import select


def _join_agent(client, workspace, name, agent_type="claude"):
    resp = client.post("/v1/join", json={
        "agent_name": name,
        "token": workspace["token"],
        "network": workspace["id"],
        "agent_type": agent_type,
    })
    assert resp.status_code == 200, resp.text


def _control_events(client, workspace, agent_name):
    """Fetch workspace.agent.control events targeted at an agent (what the
    launcher's control poller queries)."""
    resp = client.get("/v1/events", params={
        "network": workspace["id"],
        "type": "workspace.agent.control",
        "target": f"openagents:{agent_name}",
    }, headers={"X-Workspace-Token": workspace["token"]})
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["events"]


def _member_skills(db, workspace, agent_name):
    from app.models import WorkspaceMember
    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace["id"],
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one()
    return dict(member.enabled_skills or {})


class TestSkillInstallRequest:
    def test_install_marks_installing_not_installed(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["state"] == "installing"
        # Not yet in the installed list — only the launcher's success callback
        # may add it.
        assert "claude-api" not in data["installedSkills"]
        assert data["skillStatus"]["claude-api"]["state"] == "installing"

    def test_install_emits_control_event_with_metadata(self, client, workspace):
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        events = _control_events(client, workspace, "claude")
        skill_events = [e for e in events if e["payload"].get("action") == "skill.install"]
        assert len(skill_events) == 1
        payload = skill_events[0]["payload"]
        assert payload["skill"]["id"] == "claude-api"
        assert payload["skill"]["source_repo"] == "anthropics/skills"
        assert payload["skill"]["source_path"] == "skills/claude-api"
        assert skill_events[0]["target"] == "openagents:claude"

    def test_install_unknown_skill_returns_404(self, client, workspace):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "does-not-exist"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 404

    def test_install_unknown_member_returns_404(self, client, workspace):
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/ghost/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 404

    def test_install_bad_token_returns_401(self, client, workspace):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": "wrong-token"},
        )
        assert resp.status_code == 401


class TestSkillStatusCallback:
    def test_status_installed_adds_to_installed_list(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed",
                  "path": "/work/.claude/skills/claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["state"] == "installed"
        assert "claude-api" in data["installedSkills"]
        skills = _member_skills(db, workspace, "claude")
        assert skills["skill_status"]["claude-api"]["state"] == "installed"
        assert skills["skill_status"]["claude-api"]["path"].endswith("claude-api")

    def test_status_failed_records_error_and_not_installed(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "failed",
                  "error": "could not fetch skill from anthropics/skills"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["state"] == "failed"
        assert "claude-api" not in data["installedSkills"]
        skills = _member_skills(db, workspace, "claude")
        assert skills["skill_status"]["claude-api"]["state"] == "failed"
        assert "could not fetch" in skills["skill_status"]["claude-api"]["error"]

    def test_status_invalid_state_returns_400(self, client, workspace):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "bogus"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 400

    def test_codex_agent_install_and_status_roundtrip(self, client, workspace, db):
        """Codex must work end-to-end exactly like Claude."""
        _join_agent(client, workspace, "codex", agent_type="codex")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/codex/skills/install",
            json={"skill_id": "mcp-builder"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        events = _control_events(client, workspace, "codex")
        assert any(e["payload"].get("action") == "skill.install" for e in events)

        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/codex/skills/status",
            json={"skill_id": "mcp-builder", "state": "installed",
                  "path": "/work/.codex/skills/mcp-builder"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        assert "mcp-builder" in resp.json()["data"]["installedSkills"]


class TestPerAgentIsolation:
    def test_install_is_scoped_per_agent(self, client, workspace, db):
        """Installing on Claude must NOT mark the skill installed on Codex."""
        _join_agent(client, workspace, "claude", agent_type="claude")
        _join_agent(client, workspace, "codex", agent_type="codex")

        # Install + confirm on claude only.
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
            headers={"X-Workspace-Token": workspace["token"]},
        )

        claude_skills = _member_skills(db, workspace, "claude")
        codex_skills = _member_skills(db, workspace, "codex")
        assert "claude-api" in claude_skills["installed"]
        # Codex must be completely untouched — no installed entry, no status.
        assert "claude-api" not in codex_skills.get("installed", [])
        assert "claude-api" not in codex_skills.get("skill_status", {})

        # And the control event only targeted claude.
        codex_events = _control_events(client, workspace, "codex")
        assert not any(e["payload"].get("action") == "skill.install" for e in codex_events)

    def test_discover_reports_distinct_status_per_agent(self, client, workspace, db):
        _join_agent(client, workspace, "claude", agent_type="claude")
        _join_agent(client, workspace, "codex", agent_type="codex")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        disc = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        agents = {a["address"]: a for a in disc.json()["data"]["agents"]}
        claude_status = (agents["openagents:claude"]["enabled_skills"] or {}).get("skill_status", {})
        codex_skills = agents["openagents:codex"]["enabled_skills"] or {}
        assert claude_status.get("claude-api", {}).get("state") == "installing"
        # Codex shows nothing for this skill.
        assert "claude-api" not in codex_skills.get("skill_status", {})


class TestPartialInstall:
    def test_partial_flag_is_persisted(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed", "partial": True},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        skills = _member_skills(db, workspace, "claude")
        assert skills["skill_status"]["claude-api"]["partial"] is True
        assert "claude-api" in skills["installed"]


class TestStatusAuth:
    def test_status_requires_workspace_token(self, client, workspace):
        _join_agent(client, workspace, "claude")
        # No token at all → 401, cannot forge an "installed" state.
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
        )
        assert resp.status_code == 401

    def test_status_wrong_token_rejected(self, client, workspace):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
            headers={"X-Workspace-Token": "forged-token"},
        )
        assert resp.status_code == 401

    def test_status_for_unknown_member_404(self, client, workspace):
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/ghost/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 404


class TestSkillUninstall:
    def test_uninstall_clears_state_and_emits_control_event(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        # Install + confirm
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        # Uninstall
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/uninstall",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        assert "claude-api" not in resp.json()["data"]["installedSkills"]

        skills = _member_skills(db, workspace, "claude")
        assert "claude-api" not in skills.get("skill_status", {})

        events = _control_events(client, workspace, "claude")
        assert any(e["payload"].get("action") == "skill.uninstall" for e in events)

    def test_install_appears_in_discover_enabled_skills(self, client, workspace, db):
        """The skill_status the UI reads must round-trip through /v1/discover."""
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        disc = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        agents = disc.json()["data"]["agents"]
        claude = next(a for a in agents if a["address"] == "openagents:claude")
        assert claude["enabled_skills"]["skill_status"]["claude-api"]["state"] == "installing"
