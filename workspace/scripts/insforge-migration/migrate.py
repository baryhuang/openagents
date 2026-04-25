#!/usr/bin/env python3
"""
One-shot migration of an OpenAgents workspace into the linked InsForge
project + an S3 bucket for file blobs.

Reads from the OpenAgents workspace API (X-Workspace-Token), writes rows via
the InsForge PostgREST API, uploads file blobs to S3 with the same key shape
the OpenAgents backend uses ('{workspace_id}/{file_id}/{filename}'), so after
cutover the backend can read them with no changes.

Idempotent: keyed by source IDs, safe to re-run. Captures a snapshot point
(newest event) at start and never crosses it, so live writes during the run
don't get partially copied.

Required env vars (or .env file in this directory):
    SOURCE_WORKSPACE         UUID of the source workspace
    SOURCE_TOKEN             X-Workspace-Token for the source workspace
    S3_BUCKET                Target S3 bucket name
Optional:
    SOURCE_API               default https://workspace-endpoint.openagents.org
    S3_REGION                default us-east-1
    INSFORGE_OSS_HOST        default: read from ../../.insforge/project.json
    INSFORGE_API_KEY         default: read from ../../.insforge/project.json
    DRY_RUN_CHANNEL          if set, migrate ONLY this channel's events + files

Usage:
    python3 migrate.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Iterable

import boto3
import requests

SCRIPT_DIR = Path(__file__).resolve().parent
STATE_FILE = SCRIPT_DIR / ".migration-state.json"
ENV_FILE = SCRIPT_DIR / ".env"
PROJECT_FILE = SCRIPT_DIR.parent.parent.parent / ".insforge" / "project.json"

EVENT_PAGE_SIZE = 200
INSERT_BATCH = 200


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------


def load_env() -> None:
    """Load .env into os.environ if present (simple KEY=VALUE per line)."""
    if not ENV_FILE.exists():
        return
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_insforge_defaults() -> None:
    """Populate INSFORGE_OSS_HOST / INSFORGE_API_KEY from .insforge/project.json."""
    if not PROJECT_FILE.exists():
        return
    cfg = json.loads(PROJECT_FILE.read_text())
    os.environ.setdefault("INSFORGE_OSS_HOST", cfg.get("oss_host", ""))
    os.environ.setdefault("INSFORGE_API_KEY", cfg.get("api_key", ""))


load_env()
load_insforge_defaults()


def need(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        sys.exit(f"missing required env var: {name}")
    return val


SOURCE_API = os.environ.get("SOURCE_API", "https://workspace-endpoint.openagents.org").rstrip("/")
SOURCE_WS = need("SOURCE_WORKSPACE")
SOURCE_TOKEN = need("SOURCE_TOKEN")
INSFORGE_HOST = need("INSFORGE_OSS_HOST").rstrip("/")
INSFORGE_KEY = need("INSFORGE_API_KEY")
S3_BUCKET = need("S3_BUCKET")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
DRY_RUN_CHANNEL = os.environ.get("DRY_RUN_CHANNEL") or None


# ---------------------------------------------------------------------------
# HTTP clients
# ---------------------------------------------------------------------------


src = requests.Session()
src.headers["X-Workspace-Token"] = SOURCE_TOKEN

ifs = requests.Session()
ifs.headers["Authorization"] = f"Bearer {INSFORGE_KEY}"
ifs.headers["Content-Type"] = "application/json"

s3 = boto3.client("s3", region_name=S3_REGION)


def src_get(path: str, allow_404: bool = False, **params: Any) -> Any:
    """GET to source API, return data field. With allow_404=True returns None on 404."""
    r = src.get(f"{SOURCE_API}{path}", params=params, timeout=60)
    if allow_404 and r.status_code == 404:
        return None
    r.raise_for_status()
    body = r.json()
    if body.get("code") != 0:
        raise RuntimeError(f"source error {path}: {body}")
    return body["data"]


def src_get_bytes(path: str) -> tuple[bytes, str]:
    """GET binary content, return (bytes, content-type)."""
    r = src.get(f"{SOURCE_API}{path}", timeout=300)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


def if_insert(table: str, rows: list[dict], on_conflict: str = "merge") -> None:
    """Bulk insert/upsert into InsForge via PostgREST. on_conflict: 'merge'|'ignore'."""
    if not rows:
        return
    pref = "resolution=merge-duplicates" if on_conflict == "merge" else "resolution=ignore-duplicates"
    headers = {"Prefer": pref}
    for i in range(0, len(rows), INSERT_BATCH):
        batch = rows[i : i + INSERT_BATCH]
        r = ifs.post(
            f"{INSFORGE_HOST}/api/database/records/{table}",
            data=json.dumps(batch),
            headers=headers,
            timeout=120,
        )
        if r.status_code >= 300:
            raise RuntimeError(
                f"InsForge insert into {table} failed [{r.status_code}]: {r.text[:1000]}\n"
                f"sample row: {json.dumps(batch[0])[:500]}"
            )


def if_count(table: str, **filters: str) -> int:
    """Count rows in InsForge table, optionally filtered."""
    headers = {"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"}
    params = dict(filters)
    params["select"] = "id" if table != "channel_members" else "agent_name"
    params["limit"] = "1"
    r = ifs.get(
        f"{INSFORGE_HOST}/api/database/records/{table}",
        params=params,
        headers=headers,
        timeout=60,
    )
    r.raise_for_status()
    cr = r.headers.get("Content-Range", "")
    if "/" in cr:
        return int(cr.split("/")[-1])
    return len(r.json())


# ---------------------------------------------------------------------------
# State (resume support)
# ---------------------------------------------------------------------------


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


# ---------------------------------------------------------------------------
# Transforms (camelCase / snake_case + workspace_id injection)
# ---------------------------------------------------------------------------


def transform_workspace(ws: dict) -> dict:
    return {
        "id": ws["workspaceId"],
        "slug": ws.get("slug"),
        "name": ws["name"],
        "creator_email": ws.get("creatorEmail"),
        "settings": ws.get("settings") or {},
        "status": ws.get("status", "active"),
        "created_at": ws.get("createdAt"),
        "last_activity_at": ws.get("lastActivityAt"),
    }


def transform_member(a: dict, workspace_id: str) -> dict:
    return {
        "workspace_id": workspace_id,
        "agent_name": a["agentName"],
        "role": a.get("role", "member"),
        "agent_type": a.get("agentType"),
        "working_dir": a.get("workingDir"),
        "description": a.get("description"),
        "status": a.get("status", "offline"),
        "last_heartbeat": a.get("lastHeartbeatAt"),
        "joined_at": a.get("joinedAt"),
    }


def transform_channel(c: dict) -> dict:
    return {
        "id": c["channelId"],
        "workspace_id": c["workspaceId"],
        "name": c["name"],
        "title": c.get("title"),
        "title_manually_set": bool(c.get("titleManuallySet", False)),
        "created_by": c.get("createdBy"),
        "master_agent": c.get("masterAgent"),
        "resume_from": c.get("resumeFrom"),
        "status": c.get("status", "active"),
        "starred": bool(c.get("starred", False)),
        "created_at": c.get("createdAt"),
    }


def transform_collab(c: dict, workspace_id: str) -> dict:
    return {
        "workspace_id": workspace_id,
        "email": c["email"].lower(),
        "role": c.get("role", "editor"),
        "added_by": c.get("addedBy"),
        "added_at": c.get("addedAt"),
    }


def transform_event(e: dict, workspace_id: str) -> dict:
    return {
        "id": e["id"],
        "network_id": workspace_id,
        "type": e["type"],
        "source": e["source"],
        "target": e["target"],
        "payload": e.get("payload"),
        "metadata": e.get("metadata") or {},
        "timestamp": e["timestamp"],
        "visibility": e.get("visibility", "channel"),
    }


def transform_file(f: dict, workspace_id: str, storage_key: str) -> dict:
    return {
        "id": f["id"],
        "workspace_id": workspace_id,
        "filename": f["filename"],
        "content_type": f.get("content_type", "application/octet-stream"),
        "size": int(f["size"]),
        "storage_key": storage_key,
        "uploaded_by": f["uploaded_by"],
        "channel_name": f.get("channel_name"),
        "status": f.get("status", "active"),
        "created_at": f.get("created_at"),
    }


# ---------------------------------------------------------------------------
# Migration phases
# ---------------------------------------------------------------------------


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def migrate_workspace_and_members() -> dict:
    log("fetching workspace + members")
    ws = src_get(f"/v1/workspaces/{SOURCE_WS}")
    if_insert("workspaces", [transform_workspace(ws)])
    members = [transform_member(a, ws["workspaceId"]) for a in ws.get("agents", [])]
    if_insert("workspace_members", members)
    log(f"workspace '{ws['name']}' + {len(members)} members")
    return ws


def migrate_collaborators(workspace_id: str) -> int:
    log("fetching collaborators")
    data = src_get(f"/v1/workspaces/{workspace_id}/collaborators")
    rows = [transform_collab(c, workspace_id) for c in data.get("collaborators", [])]
    if_insert("workspace_collaborators", rows)
    log(f"collaborators: {len(rows)}")
    return len(rows)


def migrate_channels(workspace_id: str) -> list[dict]:
    log("discovering channels via latest-per-channel")
    latest = src_get("/v1/events/latest-per-channel", network=workspace_id)
    channel_names = list(latest.get("channels", {}).keys())
    if DRY_RUN_CHANNEL:
        if DRY_RUN_CHANNEL not in channel_names:
            sys.exit(f"DRY_RUN_CHANNEL '{DRY_RUN_CHANNEL}' not found among {len(channel_names)} channels")
        channel_names = [DRY_RUN_CHANNEL]
        log(f"DRY RUN — restricting to channel '{DRY_RUN_CHANNEL}'")
    log(f"channels to migrate: {len(channel_names)}")

    channels: list[dict] = []
    skipped: list[str] = []
    for i, name in enumerate(channel_names, 1):
        ch = src_get(f"/v1/workspaces/{workspace_id}/channels/{name}", allow_404=True)
        if ch is None:
            skipped.append(name)
        else:
            channels.append(ch)
        if i % 25 == 0:
            log(f"  fetched {i}/{len(channel_names)} channels")
    if skipped:
        log(f"  skipped {len(skipped)} phantom channels (events exist but no detail row): {skipped[:5]}{'...' if len(skipped) > 5 else ''}")

    if_insert("channels", [transform_channel(c) for c in channels])

    members: list[dict] = []
    for c in channels:
        for agent in c.get("participants", []):
            members.append({"channel_id": c["channelId"], "agent_name": agent})
    if_insert("channel_members", members)
    log(f"channels: {len(channels)} (+ {len(members)} channel members)")
    return channels


def migrate_events(workspace_id: str, snapshot_id: str, snapshot_ts: int) -> int:
    log(f"snapshot point: event {snapshot_id} @ ts {snapshot_ts}")
    state = load_state()
    cursor = state.get("events_after")  # last successfully inserted event id
    total = state.get("events_total", 0)
    log(f"resuming from cursor: {cursor!r} (total so far: {total})")

    while True:
        params: dict[str, Any] = {
            "network": workspace_id,
            "limit": EVENT_PAGE_SIZE,
            "sort": "asc",
        }
        if cursor:
            params["after"] = cursor
        if DRY_RUN_CHANNEL:
            params["channel"] = DRY_RUN_CHANNEL
        page = src_get("/v1/events", **params)
        events = page.get("events", [])
        if not events:
            break

        # Stop at snapshot
        kept = [e for e in events if e["timestamp"] <= snapshot_ts]
        rows = [transform_event(e, workspace_id) for e in kept]
        if_insert("events", rows, on_conflict="ignore")
        total += len(rows)

        last = events[-1]
        cursor = last["id"]
        state["events_after"] = cursor
        state["events_total"] = total
        save_state(state)

        log(f"events migrated: {total} (last ts {last['timestamp']})")

        # Stop conditions
        if not page.get("has_more"):
            break
        if last["timestamp"] >= snapshot_ts:
            break

    return total


def s3_key_for(workspace_id: str, file_id: str, filename: str) -> str:
    """Match OpenAgents S3FileStore key format (storage.py:92-93)."""
    return f"{workspace_id}/{file_id}/{filename}"


def migrate_files(workspace_id: str) -> int:
    log("listing files")
    all_files: list[dict] = []
    offset = 0
    while True:
        page = src_get("/v1/files", network=workspace_id, limit=200, offset=offset)
        items = page.get("files", [])
        if not items:
            break
        all_files.extend(items)
        offset += len(items)
        if len(items) < 200:
            break
    if DRY_RUN_CHANNEL:
        all_files = [f for f in all_files if f.get("channel_name") == DRY_RUN_CHANNEL]
    log(f"files to migrate: {len(all_files)}")

    state = load_state()
    done = set(state.get("files_done", []))
    failed = list(state.get("files_failed", []))

    for i, f in enumerate(all_files, 1):
        fid = f["id"]
        if fid in done:
            continue
        key = s3_key_for(workspace_id, fid, f["filename"])

        # Skip download if already present in S3 with matching size
        try:
            head = s3.head_object(Bucket=S3_BUCKET, Key=key)
            if head["ContentLength"] == int(f["size"]):
                if_insert("files", [transform_file(f, workspace_id, key)])
                done.add(fid)
                state["files_done"] = sorted(done)
                save_state(state)
                if i % 10 == 0:
                    log(f"  files: {i}/{len(all_files)} (skipped, already in S3)")
                continue
        except Exception:
            pass  # not in S3, download

        try:
            body, ctype = src_get_bytes(f"/v1/files/{fid}?network={workspace_id}")
        except requests.HTTPError as e:
            log(f"  ! file {fid[:8]} ({f.get('filename','?')[:40]}) DOWNLOAD FAILED [{e.response.status_code}], skipping")
            failed.append({"id": fid, "filename": f.get("filename"), "status": e.response.status_code})
            state["files_failed"] = failed
            save_state(state)
            continue

        s3.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=body,
            ContentType=f.get("content_type") or ctype,
        )
        if_insert("files", [transform_file(f, workspace_id, key)])

        done.add(fid)
        state["files_done"] = sorted(done)
        save_state(state)
        if i % 10 == 0 or i == len(all_files):
            log(f"  files: {i}/{len(all_files)} (last {fid[:8]}, {len(body)} bytes)")

    if failed:
        log(f"WARNING: {len(failed)} files could not be downloaded from source — their metadata is NOT inserted")
        for x in failed[:10]:
            log(f"  failed: id={x['id']} status={x['status']} name={(x.get('filename') or '')[:60]}")
        if len(failed) > 10:
            log(f"  (... {len(failed) - 10} more)")
    return len(done)


def verify(workspace_id: str, expected_events: int, expected_files: int) -> None:
    log("verifying counts")
    target_events = if_count("events", network_id=f"eq.{workspace_id}")
    target_files = if_count("files", workspace_id=f"eq.{workspace_id}")
    log(f"  events: source-migrated={expected_events} target={target_events}")
    log(f"  files:  source-migrated={expected_files} target={target_files}")
    if DRY_RUN_CHANNEL:
        log("DRY RUN: skipping count assertions (target may include other channels)")
        return
    if target_events != expected_events:
        sys.exit(f"FAIL: event count mismatch ({expected_events} vs {target_events})")
    if target_files != expected_files:
        sys.exit(f"FAIL: file count mismatch ({expected_files} vs {target_files})")
    log("OK — counts match")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    log(f"source: {SOURCE_API} workspace={SOURCE_WS}")
    log(f"target: InsForge {INSFORGE_HOST} + S3 s3://{S3_BUCKET}/")
    if DRY_RUN_CHANNEL:
        log(f"DRY RUN: only channel {DRY_RUN_CHANNEL!r} will be migrated")

    ws = migrate_workspace_and_members()
    workspace_id = ws["workspaceId"]

    # Snapshot — capture newest event before pump starts
    newest_page = src_get("/v1/events", network=workspace_id, limit=1, sort="desc")
    newest = newest_page.get("events", [{}])[0]
    snapshot_id = newest.get("id", "")
    snapshot_ts = int(newest.get("timestamp", 0))
    state = load_state()
    state.setdefault("snapshot_id", snapshot_id)
    state.setdefault("snapshot_ts", snapshot_ts)
    save_state(state)

    migrate_collaborators(workspace_id)
    migrate_channels(workspace_id)
    n_events = migrate_events(workspace_id, state["snapshot_id"], state["snapshot_ts"])
    n_files = migrate_files(workspace_id)

    verify(workspace_id, n_events, n_files)
    log(f"DONE. events={n_events} files={n_files}")


if __name__ == "__main__":
    main()
