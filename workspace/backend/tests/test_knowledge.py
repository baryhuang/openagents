# -*- coding: utf-8 -*-
"""
Tests for the knowledge base endpoints.
"""


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


class TestCreateKnowledge:
    def test_create_entry(self, client, workspace):
        resp = client.post(
            "/v1/knowledge",
            json={
                "network": workspace["id"],
                "title": "API Design Patterns",
                "content": "# API Design Patterns\n\nUse REST.",
                "description": "Common patterns",
                "source": "human:user",
            },
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["title"] == "API Design Patterns"
        assert data["slug"] == "api-design-patterns"
        assert data["description"] == "Common patterns"
        assert data["content"] == "# API Design Patterns\n\nUse REST."
        assert data["content_size"] > 0

    def test_slug_deduplication(self, client, workspace):
        for _ in range(2):
            client.post(
                "/v1/knowledge",
                json={"network": workspace["id"], "title": "Dupe", "content": "x"},
                headers=_headers(workspace),
            )
        resp = client.get(
            f"/v1/knowledge?network={workspace['id']}",
            headers=_headers(workspace),
        )
        slugs = [e["slug"] for e in resp.json()["data"]["entries"]]
        assert len(set(slugs)) == 2
        assert "dupe" in slugs
        assert "dupe-2" in slugs


class TestListKnowledge:
    def test_list_empty(self, client, workspace):
        resp = client.get(
            f"/v1/knowledge?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["entries"] == []
        assert data["total"] == 0

    def test_list_returns_entries(self, client, workspace):
        client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Entry A", "content": "a"},
            headers=_headers(workspace),
        )
        resp = client.get(
            f"/v1/knowledge?network={workspace['id']}",
            headers=_headers(workspace),
        )
        data = resp.json()["data"]
        assert data["total"] == 1
        assert data["entries"][0]["title"] == "Entry A"


class TestGetKnowledge:
    def test_get_by_id(self, client, workspace):
        create = client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Test", "content": "hello"},
            headers=_headers(workspace),
        )
        entry_id = create.json()["data"]["id"]
        resp = client.get(
            f"/v1/knowledge/{entry_id}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["content"] == "hello"

    def test_get_by_slug(self, client, workspace):
        client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Slug Test", "content": "by slug"},
            headers=_headers(workspace),
        )
        resp = client.get(
            f"/v1/knowledge/by-slug/slug-test?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["content"] == "by slug"

    def test_get_not_found(self, client, workspace):
        resp = client.get(
            "/v1/knowledge/nonexistent-id",
            headers=_headers(workspace),
        )
        assert resp.status_code == 404


class TestUpdateKnowledge:
    def test_update_content(self, client, workspace):
        create = client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Original", "content": "v1"},
            headers=_headers(workspace),
        )
        entry_id = create.json()["data"]["id"]
        resp = client.put(
            f"/v1/knowledge/{entry_id}",
            json={"network": workspace["id"], "content": "v2"},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["content"] == "v2"

    def test_update_title_changes_slug(self, client, workspace):
        create = client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "Old Title", "content": "x"},
            headers=_headers(workspace),
        )
        entry_id = create.json()["data"]["id"]
        resp = client.put(
            f"/v1/knowledge/{entry_id}",
            json={"network": workspace["id"], "title": "New Title"},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["slug"] == "new-title"


class TestDeleteKnowledge:
    def test_soft_delete(self, client, workspace):
        create = client.post(
            "/v1/knowledge",
            json={"network": workspace["id"], "title": "To Delete", "content": "bye"},
            headers=_headers(workspace),
        )
        entry_id = create.json()["data"]["id"]
        resp = client.delete(
            f"/v1/knowledge/{entry_id}?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "deleted"

        # Should not appear in list
        list_resp = client.get(
            f"/v1/knowledge?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert list_resp.json()["data"]["total"] == 0
