# Deploying the Workspace Backend

**Default target: InsForge Compute (Fly.io under the hood), source mode.**

As of the 2026-06-04 migration, the workspace backend runs on **InsForge Compute**.
Deploys build on Fly's remote builder — **no local Docker daemon, no ECR, no manual
task-definition edits**. The former AWS ECS Fargate path is retired (see "Legacy" below).

Full migration record: [`../scripts/insforge-migration/COMPUTE_MIGRATION_REPORT_2026-06-04.md`](../scripts/insforge-migration/COMPUTE_MIGRATION_REPORT_2026-06-04.md).

---

## TL;DR

```bash
cd workspace/backend
./deploy.sh                 # builds on Fly remote builder, updates the running service
```

That wraps:

```bash
npx @insforge/cli compute deploy . \
  --name workspace-backend --port 8000 \
  --cpu shared-1x --memory 1024 --region iad \
  --env-file ./.env.production
```

Re-running `compute deploy` with the same `--name` updates the existing service in place.

---

## Prerequisites (one-time per machine)

1. **flyctl** on PATH (used only as a remote-build client — no Docker daemon needed):
   ```bash
   curl -L https://fly.io/install.sh | sh
   export FLYCTL_INSTALL="$HOME/.fly"; export PATH="$FLYCTL_INSTALL/bin:$PATH"
   ```
2. **InsForge auth + project link.** The CLI resolves the linked project from
   `.insforge/project.json` in the **current directory** (it does not search parents),
   so the link must exist in `workspace/backend/`. `deploy.sh` copies it from the repo
   root automatically; otherwise:
   ```bash
   cp -R ../../.insforge .insforge       # or: npx @insforge/cli link
   ```
   Project: `caremojo-openagents` (`76c0ba3b-86bd-425a-bb60-101f82caf9b3`).
   > `.insforge/` contains the admin `api_key` — it is gitignored and must never be committed.
3. **`.env.production`** present in `workspace/backend/` (see next section).

---

## Environment variables (`.env.production`)

`./.env.production` is the **source of truth** for the service's env. It is **gitignored**
(holds live secrets) — keep it safe locally / in your team secret store; it is not in git.

Required keys (18 total):

| Group | Keys |
|---|---|
| Database | `DATABASE_URL` (InsForge Postgres, `sslmode=require`) |
| Storage (S3) | `FILE_STORAGE_BACKEND=s3`, `S3_BUCKET=openagents-files-peakmojo`, `S3_REGION=us-east-1`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| Auth/identity | `AUTH_MODE=workspace_token`, `IDENTITY_MODE=standalone` |
| Public URL / CORS | `WORKSPACE_ENDPOINT=https://agents-api.caremojo.app`, `CORS_ORIGINS=…` |
| Browser | `BROWSERFABRIC_API_KEY` |
| APNs (push) | `APNS_ENVIRONMENT=production`, `APNS_BUNDLE_ID`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY` (PEM body) |
| Runtime | `RUN_MIGRATIONS=true`, `WEB_CONCURRENCY=2` |

Notes:
- **`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are required on Compute.** Unlike ECS
  (which used the `openagents-workspace-task-role` IAM role), Fly has no instance role —
  `boto3` reads creds from these env vars. They belong to IAM user **`s3only`**.
- `APNS_AUTH_KEY` holds the raw PEM. In `.env.production` keep it double-quoted with
  `\n` escapes (dotenv expands them); the container must receive real newlines.
- `RUN_MIGRATIONS=true` runs `alembic upgrade head` on boot (no-op when already at head).

### Rotating a single secret without a full redeploy
`compute get` never returns secret values, so don't reconstruct env from memory. To
change one key on the running service (merges, leaves others intact):

```bash
SID=$(npx @insforge/cli compute list --json | python3 -c 'import json,sys;print([s["id"] for s in json.load(sys.stdin) if s["name"]=="workspace-backend"][0])')
npx @insforge/cli compute update "$SID" --env-set DATABASE_URL="postgresql://…"
```
Keep `.env.production` in sync when you do this.

---

## Verify a deploy

```bash
BASE=https://agents-api.caremojo.app          # or the fly.dev endpoint from `compute list`
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/health"                       # 200
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v1/workspaces/<workspace-id>" # 200 (DB)
curl -s -o /tmp/x -w '%{http_code} %{size_download}\n' \
  "$BASE/v1/files/<file-id>?network=<workspace-id>"                           # 200 (S3)
```

Operational checks:
```bash
npx @insforge/cli compute list                       # status + endpoint
npx @insforge/cli compute events <service-id>        # machine lifecycle (no stdout logs in v1)
npx @insforge/cli diagnose db --check connections    # Postgres conn usage (ceiling is 60)
```

---

## Domain / TLS

- Compute serves only `https://workspace-backend-<projectId>.fly.dev` and has **no
  custom-domain/cert feature** (and direct `flyctl` against InsForge's org is forbidden).
- The public hostname `agents-api.caremojo.app` is preserved by **AWS CloudFront + ACM**
  in front of the fly.dev origin:
  - ACM cert `…/26eccb83-…` (us-east-1), CloudFront dist `E3UK7H1FRKJTDH`
    (`d35ixjfhn449jv.cloudfront.net`): caching disabled, all methods, AllViewerExceptHostHeader,
    60s origin timeout.
  - Route53 (`caremojo.app`, zone `Z051823433JPD3W6X9JP7`): `agents-api` A/AAAA alias → CloudFront.
- A normal `compute deploy` (same `--name`) **does not change** the endpoint, CloudFront,
  or DNS — they keep pointing at the updated service. No DNS work on routine deploys.

---

## Constraints / gotchas

- **Postgres connection ceiling = 60.** Pool is `pool_size=20 + overflow=4` (≈24/worker →
  48 for `WEB_CONCURRENCY=2`). One instance fits; **a second replica needs a pooler**
  (the "max_connections=200" comment in `entrypoint.sh` is stale).
- **Scale-to-zero (v1):** first request after idle cold-starts ~14–16 s (under CloudFront's
  60 s origin timeout, so no failed requests — just latency).
- **SSE `/v1/events/stream`:** idle streams drop at CloudFront's 60 s origin timeout; the
  client falls back to polling (supported).
- **No container logs in Compute v1** — debug crashes by reproducing the image; `compute
  events` shows lifecycle only.

---

## Rollback to ECS (retained, parked)

The ECS service is scaled to 0 but intact (task def `openagents-workspace-backend:30`):

```bash
# 1) DNS: Route53 zone Z051823433JPD3W6X9JP7, point agents-api A/AAAA back to the ALB
#    alias openagents-workspace-alb-1622897394.us-east-1.elb.amazonaws.com (zone Z35SXDOTRQ7X7K)
# 2) ECS: bring the task back
aws ecs update-service --cluster openagents-workspace --service workspace-backend --desired-count 1 --region us-east-1
```

---

## Legacy paths (do not use for new deploys)

- **AWS ECS Fargate** — retired 2026-06-04 (service parked at desired 0). Required local
  `docker build --platform linux/amd64` + ECR push + manual task-def registration.
- **Railway** (`railway.toml`) — earlier target; superseded by InsForge Compute.
