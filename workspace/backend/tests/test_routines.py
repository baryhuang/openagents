# -*- coding: utf-8 -*-
"""
Tests for routine schedule modes (daily + interval).
"""

from datetime import datetime, timezone

from app.routers.routines import _compute_next_fires_at


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _create_payload(workspace, **overrides):
    base = {
        "name": "Test routine",
        "message": "ping",
        "network": workspace["id"],
        "channel": workspace["channel"]["name"],
        "source": "openagents:agent-alpha",
    }
    base.update(overrides)
    return base


class TestComputeNextFires:
    def test_interval_mode_uses_now_plus_n(self):
        before = datetime.now(timezone.utc)
        result = _compute_next_fires_at(None, None, None, 5)
        after = datetime.now(timezone.utc)
        delta = (result - before).total_seconds()
        upper = (after - before).total_seconds() + 5 * 60
        assert 5 * 60 - 1 <= delta <= upper + 1

    def test_daily_mode_unchanged(self):
        # Future time today should be picked.
        now = datetime.now(timezone.utc)
        future_hour = (now.hour + 1) % 24
        result = _compute_next_fires_at(future_hour, 0, None, None)
        assert result.hour == future_hour
        assert result.minute == 0


class TestCreateRoutine:
    def test_create_daily_mode(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, hour=8, minute=30),
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["schedule_hour"] == 8
        assert data["schedule_minute"] == 30
        assert data["schedule_interval_minutes"] is None

    def test_create_interval_mode(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, interval_minutes=15),
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["schedule_interval_minutes"] == 15
        assert data["schedule_hour"] is None
        assert data["schedule_minute"] is None

    def test_reject_both_modes(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, hour=8, minute=0, interval_minutes=15),
            headers=_headers(workspace),
        )
        assert resp.status_code == 400

    def test_reject_neither_mode(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace),
            headers=_headers(workspace),
        )
        assert resp.status_code == 400

    def test_reject_interval_with_days(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, interval_minutes=15, days=[0, 1]),
            headers=_headers(workspace),
        )
        assert resp.status_code == 400

    def test_reject_interval_out_of_range(self, client, workspace):
        for bad in (0, 1441):
            resp = client.post(
                "/v1/routines",
                json=_create_payload(workspace, interval_minutes=bad),
                headers=_headers(workspace),
            )
            assert resp.status_code == 400, f"interval_minutes={bad} should be rejected"

    def test_list_includes_interval_field(self, client, workspace):
        client.post(
            "/v1/routines",
            json=_create_payload(workspace, interval_minutes=30),
            headers=_headers(workspace),
        )
        resp = client.get(
            f"/v1/routines?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        routines = resp.json()["data"]["routines"]
        assert len(routines) == 1
        assert routines[0]["schedule_interval_minutes"] == 30
