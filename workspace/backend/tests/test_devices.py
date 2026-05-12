# -*- coding: utf-8 -*-
"""Tests for `/v1/devices/register` and `/v1/devices/register` (DELETE)."""


class TestRegisterDevice:
    def test_register_creates_row(self, client, workspace):
        resp = client.post("/v1/devices/register", json={
            "network": workspace["id"],
            "fcm_token": "TOKEN-A",
            "device_type": "ios",
            "bundle_id": "com.openagents.go",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert "id" in data

    def test_register_idempotent_same_token(self, client, workspace):
        body = {
            "network": workspace["id"],
            "fcm_token": "TOKEN-DUP",
            "device_type": "ios",
            "bundle_id": "com.openagents.go",
        }
        h = {"X-Workspace-Token": workspace["token"]}
        r1 = client.post("/v1/devices/register", json=body, headers=h)
        r2 = client.post("/v1/devices/register", json=body, headers=h)
        assert r1.status_code == 200 and r2.status_code == 200
        # Same row updated, not duplicated.
        assert r1.json()["data"]["id"] == r2.json()["data"]["id"]

    def test_register_different_tokens_create_separate_rows(self, client, workspace):
        h = {"X-Workspace-Token": workspace["token"]}
        r1 = client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-X",
            "device_type": "ios", "bundle_id": "com.openagents.go",
        }, headers=h)
        r2 = client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-Y",
            "device_type": "ios", "bundle_id": "com.openagents.go",
        }, headers=h)
        assert r1.json()["data"]["id"] != r2.json()["data"]["id"]

    def test_register_rejects_missing_token(self, client, workspace):
        resp = client.post("/v1/devices/register", json={
            "network": workspace["id"],
            "fcm_token": "TOKEN-A",
        })
        assert resp.status_code == 401

    def test_register_rejects_wrong_token(self, client, workspace):
        resp = client.post("/v1/devices/register", json={
            "network": workspace["id"],
            "fcm_token": "TOKEN-A",
        }, headers={"X-Workspace-Token": "wrong"})
        assert resp.status_code == 401

    def test_register_404_on_unknown_network(self, client, workspace):
        resp = client.post("/v1/devices/register", json={
            "network": "does-not-exist",
            "fcm_token": "TOKEN-A",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 404


class TestDeregisterDevice:
    def test_deregister_removes_row(self, client, workspace):
        h = {"X-Workspace-Token": workspace["token"]}
        client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-D",
            "device_type": "ios",
        }, headers=h)
        resp = client.request("DELETE", "/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-D",
        }, headers=h)
        assert resp.status_code == 200
        assert resp.json()["data"]["deleted"] == 1

    def test_deregister_unknown_token_no_op(self, client, workspace):
        h = {"X-Workspace-Token": workspace["token"]}
        resp = client.request("DELETE", "/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "NEVER-REGISTERED",
        }, headers=h)
        assert resp.status_code == 200
        assert resp.json()["data"]["deleted"] == 0

    def test_deregister_requires_auth(self, client, workspace):
        resp = client.request("DELETE", "/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN",
        })
        assert resp.status_code == 401
