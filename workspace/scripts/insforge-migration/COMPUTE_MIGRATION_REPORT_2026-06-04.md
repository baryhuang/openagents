# Workspace Backend Migration Report — AWS ECS Fargate → InsForge Compute

**Date:** 2026-06-04 (UTC; work performed across the 2026-06-03→04 boundary)
**Performed by:** Claude Code (agent) with AWS CLI + InsForge CLI, under interactive
direction from the repository owner.
**Service migrated:** `workspace/backend` (FastAPI / uvicorn — the OpenAgents Workspace API).
**Outcome:** Production traffic for `https://agents-api.caremojo.app` now served by
InsForge Compute (Fly.io) via CloudFront. The former ECS Fargate service is stopped
(scaled to 0) but retained for rollback.

> **Secret handling:** This report masks secret *values* (DB password, AWS secret key,
> APNS private key, API keys). It includes all non-secret identifiers (ARNs, resource
> IDs, access-key IDs, hostnames). Full secret values live only in the encrypted
> Compute env and the gitignored `workspace/backend/.env.production`.

---

## 1. What was requested (verbatim user prompts, in order)

1. "check how currently the openagent backend api is deployed to AWS ECS"
2. "use AWS cli to find out the exact env variables and how the code was deployed"
3. "insforge has a new capability compute, that can host this service, check how it works"
4. "go plan and migrate using the source code mode, so I don't have to build docker container locally anymore"
5. Plan-mode decisions (via questions): **symlink** `Dockerfile → backend.Dockerfile`;
   **full cutover** in this effort; **accept scale-to-zero** for now.
6. S3-credentials decision: **reuse an existing IAM user's keys**; proceed **through Phase 2** (stop before cutover).
7. "you have the key. check ~/.aws/credentials" → after inspection, chose **keep the `s3only` key I minted**.
8. "go ahead, you have insforge and aws cli, do the cut over, test api call" → cutover route: **CloudFront + ACM**.
9. "is ECS still running? you can stop it" → ECS scaled to 0.
10. "export a report … no bluff … no leaving details behind" → this document.

---

## 2. Environment / accounts

| Item | Value |
|---|---|
| AWS account | `905418170554` |
| AWS region | `us-east-1` |
| AWS caller (CLI) | `arn:aws:iam::905418170554:user/bary` |
| InsForge project | `caremojo-openagents` |
| InsForge project ID | `76c0ba3b-86bd-425a-bb60-101f82caf9b3` |
| InsForge app key / region | `u8h7kgu8` / `us-east` |
| InsForge OSS host | `https://u8h7kgu8.us-east.insforge.app` |
| InsForge org | `1d940add-d4a7-40cd-bce5-9b4041c5bbb5` (Peak Mojo, hello@peakmojo.ai) |

The ECS backend already depended on this same InsForge project for Postgres and on
AWS S3 for files — so the migration co-located the API with its database.

---

## 3. State BEFORE migration (discovered facts)

### 3.1 ECS deployment
| Item | Value |
|---|---|
| Cluster | `openagents-workspace` |
| Service | `workspace-backend` (ACTIVE, desired 1 / running 1) |
| Task definition | `openagents-workspace-backend:30` (30 revisions existed) |
| Launch type / platform | Fargate / `1.4.0` |
| CPU / memory | 512 / 1024 MB |
| Container port | 8000 |
| Load balancer | target group `openagents-workspace-tg`; ALB `openagents-workspace-alb-1622897394.us-east-1.elb.amazonaws.com` (alias hosted-zone `Z35SXDOTRQ7X7K`) |
| Networking | subnets `subnet-0313a853c4f0cf1a1`, `subnet-00db31f17babbadc3`; SG `sg-0959838d111752ed9`; `assignPublicIp=ENABLED` |
| Execution role | `ecsTaskExecutionRole` |
| Task role | `openagents-workspace-task-role` |

### 3.2 Task role S3 policy (inline `S3FileStoreAccess`)
```
s3:GetObject, s3:PutObject, s3:DeleteObject  on  arn:aws:s3:::openagents-files-peakmojo/*
s3:ListBucket                                on  arn:aws:s3:::openagents-files-peakmojo
```

### 3.3 Image & deploy method
- Image (rev 30): `905418170554.dkr.ecr.us-east-1.amazonaws.com/openagents-workspace-backend:human-participants`
  - digest `sha256:3a88e7d1bb3262dc797441105fd8fb5e7247ad1e57a239d55a50eee08c553401`
  - **same digest also tagged** `push-thinking-fix-6af4290` → git commit `6af42909` ("fix(push): stop pushing iOS notifications for bash/tool-call status messages")
  - pushed to ECR 2026-05-31; ECR image ~276 MB.
- **Deploy process was manual:** local `docker build --platform linux/amd64` → push to ECR → `register-task-definition` → `update-service`. No CI/CD. Task def referenced a **floating tag** (`:human-participants`), a known footgun.

### 3.4 Task env vars (rev 30 — 14 vars, all plaintext; no Secrets Manager)
| Name | Value (secrets masked) |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:****@u8h7kgu8.us-east.database.insforge.app:5432/insforge?sslmode=require` |
| `FILE_STORAGE_BACKEND` | `s3` |
| `S3_BUCKET` | `openagents-files-peakmojo` |
| `S3_REGION` | `us-east-1` |
| `AUTH_MODE` | `workspace_token` |
| `IDENTITY_MODE` | `standalone` |
| `WORKSPACE_ENDPOINT` | `https://agents-api.caremojo.app` |
| `CORS_ORIGINS` | `https://agents.caremojo.app,https://u8h7kgu8.insforge.site` |
| `BROWSERFABRIC_API_KEY` | `bf_****` (live key) |
| `APNS_ENVIRONMENT` | `production` |
| `APNS_BUNDLE_ID` | `org.openagents.workspace` |
| `APNS_KEY_ID` | `8QND59373J` |
| `APNS_TEAM_ID` | `AP69DBR725` |
| `APNS_AUTH_KEY` | `-----BEGIN PRIVATE KEY-----…****…-----END PRIVATE KEY-----` (EC P-256 PEM) |

> ⚠️ These secrets (DB password, APNS private key, BrowserFabric key) were stored as
> plaintext task-def env and were surfaced in the working session. Rotation recommended.

### 3.5 Relevant application code facts
- `workspace/backend/backend.Dockerfile` — `python:3.12-slim`, installs `requirements.txt`, `EXPOSE 8000`, `ENTRYPOINT ["./entrypoint.sh"]`.
- `entrypoint.sh` — runs `alembic upgrade head` when `RUN_MIGRATIONS!=false`, then `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-2}`. (Comment claims "max_connections=200" — **stale**, see §7.)
- `app/main.py:351` → `/health` returns `{"status":"ok"}` (static; no DB).
- `app/config.py:82` → `PORT` default 8000. `APNS_AUTH_KEY` read raw (PEM body).
- `app/services/apns_client.py:44` → passes `APNS_AUTH_KEY` contents to `aioapns.APNs(key=…)` (needs real PEM newlines).
- `app/storage.py:90` → `boto3.client("s3", region_name=region)` — **no explicit credentials** (relied on the ECS task-role credential chain).
- `app/database.py:47` → `pool_size=20, max_overflow=4, pool_timeout=2` (≈24 connections/worker).
- `app/routers/events.py:652` → SSE endpoint `GET /v1/events/stream` (`text/event-stream`), 30s keepalive that only emits when events flow; client falls back to polling if the stream drops.
- `workspace/backend/.dockerignore` originally did **not** exclude `.venv` (338 MB) or dev `*.db` files.

---

## 4. InsForge Compute — capability findings

- Runs Docker containers on **Fly.io**; managed only via `npx @insforge/cli compute …`
  (subcommands: `list, get, deploy, update, delete, start, stop, events`). Direct
  `flyctl` with user credentials is **forbidden** (InsForge owns the Fly org).
- **Source mode** (`compute deploy <dir>`): requires `flyctl` on PATH, **no local Docker
  daemon**; build runs on Fly's remote builder using a short-lived per-app token minted
  by InsForge cloud; image pushed to `registry.fly.io`. **This is the mode used.**
- **Image mode** (`compute deploy --image`): nothing needed locally (not used).
- Endpoints: `https://<name>-<projectId>.fly.dev`. **No custom-domain / TLS-cert
  command exists**, and the service object exposes no dedicated IP — this drove the
  CloudFront decision (§6.3).
- v1 limitations observed/known: **scale-to-zero** (cold start observed 14–16 s);
  **no container log streaming** (`events` shows machine lifecycle only); quota 5 services/project.
- Env vars are encrypted at rest (improvement over the plaintext ECS task def).
- The CLI resolves the linked project from `.insforge/project.json` in the **cwd only**
  (does not walk ancestors); `INSFORGE_PROJECT_ID` override was **not** honored by
  `compute deploy` — the link file had to exist in the build dir.

---

## 5. Actions performed (chronological, with results)

### Phase 0 — Prerequisites
1. **Installed flyctl** `v0.4.57` via `curl -L https://fly.io/install.sh | sh` → `~/.fly/bin/flyctl`.
2. **Edited `workspace/backend/.dockerignore`** — added `.venv`, `*.db`, `local.db`, `test_workspace.db`, `*.sqlite`, `*.sqlite3` (kept the build context small; image dropped to 147 MB vs ECR's 276 MB).
3. **Created symlink** `workspace/backend/Dockerfile → backend.Dockerfile` (flyctl auto-detects `./Dockerfile`; Railway still uses `backend.Dockerfile` via `railway.toml`).
4. **Generated `workspace/backend/.env.production`** programmatically from
   `aws ecs describe-task-definition … openagents-workspace-backend:30` (verbatim, never
   retyped). dotenv double-quoting; APNS PEM newlines escaped as `\n`. Confirmed gitignored.
   Test-phase overrides set: `RUN_MIGRATIONS=false`, `WEB_CONCURRENCY=1`.
5. **Linked build dir to project**: copied root `.insforge/` → `workspace/backend/.insforge/`
   (required because the CLI doesn't search ancestors). Contains `api_key` — untracked, must not be committed.

### Phase 1 — Parallel TEST deploy (ECS untouched)
- Command:
  ```
  npx @insforge/cli compute deploy . --name workspace-backend-test --port 8000 \
    --cpu shared-1x --memory 1024 --region iad --env-file ./.env.production
  ```
- Build ran on Fly remote builder; **image 147 MB**; pushed `registry.fly.io`; machine launched.
- Service id `ceb92693-0fc9-4767-b609-93ecc3333466`; endpoint
  `https://workspace-backend-test-76c0ba3b-86bd-425a-bb60-101f82caf9b3.fly.dev`.
- **Verification:**
  - `/health` → 200 (16 s cold start).
  - `GET /v1/workspaces/4e8162ec-4330-4fcb-bb04-d9be57e45c47` → **200** with full data
    (this workspace, "Peakmojo Team", has `password_hash=NULL` → public; 35 agents listed). Confirms Fly→InsForge Postgres.
  - bogus workspace id → 404 (DB query executed).
  - `/.well-known/openagents.json` → returned `WORKSPACE_ENDPOINT` (env injected).
  - `GET /v1/files/{id}/info` (DB metadata) → 200.
  - **`GET /v1/files/{id}` (S3 download) → 500** ← gap discovered.

### S3 gap diagnosis & fix
- **Root cause:** `app/storage.py:90` has no explicit AWS creds; on ECS these came from
  `openagents-workspace-task-role`. Fly has no IAM role and the task-def env carries no AWS keys.
  Bucket `openagents-files-peakmojo` is real AWS S3 (no `endpoint_url` override).
- Per user choice (**reuse existing IAM user**): existing user **`s3only`** found, which has
  inline `S3AndSTSAccess` (`s3:*` + `sts:GetFederationToken` on `*`), managed `AmazonS3FullAccess`,
  and `SQSScreenCaptureAccess`. It had one prior access key `AKIA5FTZA4C5MTORFTN2` (created 2025-09-30).
- **Minted a new access key** for `s3only`: `AKIA5FTZA4C5IWZSKT6U` (secret masked).
  Prior key left intact (`s3only` now has 2 keys — the IAM maximum).
- Added `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` to `.env.production` and applied to the
  test service via `compute update <id> --env-set …` (partial merge; machine restarted).
- **Re-test:** `GET /v1/files/{id}` → **200, 73,841 bytes**, correct transcript content. S3 fixed.
- User then asked to check `~/.aws/credentials`; the `s3only` key was **not** present there.
  Profiles `[default]` (=user/bary, admin) and `[hana]` (=user/hanaapp) both can reach the bucket.
  User chose to **keep the minted `s3only` key** (best-scoped of the options).

### Phase 2 — PROD service
- Pre-check: `diagnose db --check connections` → **45/60** (InsForge Postgres cap is 60). Pool math:
  `pool_size 20 + overflow 4 = 24/worker` → 48 for 2 workers. One 2-worker instance fits under 60
  with little headroom (no room for a second replica without a pooler).
- Flipped `.env.production` to prod values: `RUN_MIGRATIONS=true`, `WEB_CONCURRENCY=2` (18 vars total
  = 14 from task def + 2 overrides + 2 AWS keys).
- Deploy:
  ```
  npx @insforge/cli compute deploy . --name workspace-backend --port 8000 \
    --cpu shared-1x --memory 1024 --region iad --env-file ./.env.production
  ```
  - Service id `bdf9e87c-aeb0-4dc8-a644-7b6f17658df3`; fly app
    `workspace-backend-76c0ba3b-86bd-425a-bb60-101f82caf9b3`; machine `48eed0da7e3518`;
    image digest `sha256:1501d7dbd07cf58bccabb1be12d297e837274073b1e16890cbbb18f4684a7c69` (147 MB);
    endpoint `https://workspace-backend-76c0ba3b-86bd-425a-bb60-101f82caf9b3.fly.dev`.
  - `RUN_MIGRATIONS=true` ran `alembic upgrade head` (no-op; shared DB already at head).
- **Verification (prod endpoint):** `/health` 200 (14 s cold start), workspace (DB) 200,
  **file download (S3) 200 / 73,841 bytes**, manifest endpoint correct.
- **Deleted the test service** `ceb92693-…`. Connections after: **46/60**.

### API test on Compute endpoint (read-only)
| Endpoint | Result |
|---|---|
| `GET /health` | 200 |
| `GET /v1/workspaces/{id}` (DB) | 200 |
| `GET /v1/files?network={id}` (DB list) | 200 (2 files) |
| `GET /v1/files/{id}` (S3) | 200, 73,841 bytes |
| `GET /v1/events?network={id}` (DB) | 200 |
| `GET /.well-known/openagents.json` (env) | 200 |
| `GET /v1/events/stream` (SSE) | 200, `content-type: text/event-stream` |

### Phase 3 — Cutover (CloudFront + ACM)
Custom domain could not be attached on InsForge Compute (no CLI/API; flyctl forbidden), so the
hostname was preserved by fronting the fly.dev origin with CloudFront (user-selected route).
- Route53 zone for `caremojo.app`: `Z051823433JPD3W6X9JP7`. `agents-api.caremojo.app` was an
  A-alias to the ALB.
- **ACM cert** `arn:aws:acm:us-east-1:905418170554:certificate/26eccb83-6fa5-40da-8c48-b8bbfd51616a`
  for `agents-api.caremojo.app` (us-east-1, required for CloudFront). DNS-validation CNAME
  `_cc38859ff82ab00f7614bbdfa3741bd4.agents-api.caremojo.app` → `_0cea365546504d8a6f153ee3eadc85a3.jkddzztszm.acm-validations.aws`
  created in Route53; cert reached **ISSUED** within ~20 s.
- **CloudFront distribution** `E3UK7H1FRKJTDH` (`d35ixjfhn449jv.cloudfront.net`):
  - Origin: `workspace-backend-76c0ba3b-…fly.dev`, HTTPS-only, TLSv1.2, **OriginReadTimeout 60**, keepalive 60.
  - Cache policy **CachingDisabled** (`4135ea2d-6df8-44a3-9df3-4b5a84be39ad`).
  - Origin-request policy **AllViewerExceptHostHeader** (`b689b0a8-53d0-40ab-baf2-68738e2966ac`) — forwards all viewer headers/query/cookies except Host, so origin SNI/Host = the fly.dev name and matches Fly's cert.
  - Methods: `GET,HEAD,OPTIONS,PUT,POST,PATCH,DELETE`; `Compress=false`; PriceClass_All; http2and3; IPv6.
  - Viewer cert: the ACM cert, `sni-only`, `TLSv1.2_2021`; alias `agents-api.caremojo.app`.
  - Reached **Deployed** in ~210 s.
- **Pre-DNS test** via `https://d35ixjfhn449jv.cloudfront.net`: `/health` 200, workspace 200,
  S3 200/73,841, manifest 200; `via:` header = `fly.io … CloudFront`; `x-cache: Miss from cloudfront`.
- **DNS cutover:** Route53 UPSERT `agents-api.caremojo.app` A **and** AAAA aliases → CloudFront
  (`d35ixjfhn449jv.cloudfront.net`, CF alias zone `Z2FDTNDATAQYW2`). Change `/change/C014810136R01TGBDH5UW` → INSYNC.
- **Post-cutover verification** on `https://agents-api.caremojo.app`:
  - Resolves to `18.238.176.18/.51/.87/.92` (CloudFront).
  - TLS subject `CN=agents-api.caremojo.app`, issuer `Amazon RSA 2048 M01` (the ACM cert).
  - `/health` 200, workspace (DB) 200, file download (S3) 200/73,841.
  - `via:` header = `fly.io … CloudFront`.

### Phase 4 — ECS decommission (reversible)
- `aws ecs update-service --cluster openagents-workspace --service workspace-backend --desired-count 0`.
- Task drained to **running 0** within ~10 s. Service remains ACTIVE; **task def rev 30 retained**.
- Post-stop, `https://agents-api.caremojo.app` still served 200 (health + S3) from Compute.
- DB connections: **47/60**.

---

## 6. State AFTER migration

### 6.1 Traffic path
```
client → https://agents-api.caremojo.app
       → Route53 A/AAAA alias → CloudFront E3UK7H1FRKJTDH (ACM cert)
       → origin https://workspace-backend-76c0ba3b-…fly.dev (InsForge Compute / Fly)
       → InsForge Postgres (u8h7kgu8…insforge.app)  +  AWS S3 (openagents-files-peakmojo)
```

### 6.2 Live resources created/changed
| Resource | ID / value | State |
|---|---|---|
| Compute service | `workspace-backend` (`bdf9e87c-aeb0-4dc8-a644-7b6f17658df3`) | running |
| Fly app / machine | `workspace-backend-76c0ba3b-…` / `48eed0da7e3518` | running |
| ACM cert | `…/26eccb83-6fa5-40da-8c48-b8bbfd51616a` | ISSUED |
| CloudFront dist | `E3UK7H1FRKJTDH` (`d35ixjfhn449jv.cloudfront.net`) | Deployed |
| Route53 record | `agents-api.caremojo.app` A+AAAA | alias → CloudFront |
| IAM access key | `AKIA5FTZA4C5IWZSKT6U` on user `s3only` | active |
| ECS service | `openagents-workspace/workspace-backend` (task def rev 30) | desired 0 / running 0 (parked) |

### 6.3 Deploy method now
Single command, no local Docker daemon:
```
cd workspace/backend
npx @insforge/cli compute deploy . --name workspace-backend --port 8000 \
  --cpu shared-1x --memory 1024 --region iad --env-file ./.env.production
```

### 6.4 Local repository changes (UNCOMMITTED — nothing was committed or pushed)
| Path | Change | Notes |
|---|---|---|
| `workspace/backend/.dockerignore` | modified | excludes `.venv`, dev `*.db` |
| `workspace/backend/Dockerfile` | new (symlink → `backend.Dockerfile`) | for flyctl source build |
| `workspace/backend/.env.production` | new | 18 env vars incl. secrets; **gitignored** |
| `workspace/backend/.insforge/` | new (copied) | contains `api_key`; **must stay untracked** |

(Pre-existing untracked items unrelated to this work: root `.insforge/`, `packages/go/web/vercel.json`.)

---

## 7. Open items, risks, and caveats (no sugar-coating)

1. **`s3only` key is over-privileged & long-lived.** It grants `s3:*` on `*` (plus
   `AmazonS3FullAccess`), far broader than the ECS task role's bucket-scoped policy. It is a
   static key with no rotation. **Recommend:** scope to `openagents-files-peakmojo` and rotate.
2. **InsForge Postgres connection ceiling = 60.** A single 2-worker instance peaks ~48; **no
   headroom for a second Compute replica** without a connection pooler (pgbouncer) or lower
   `pool_size`. The `entrypoint.sh` comment referencing "max_connections=200" is **stale/incorrect**.
3. **SSE behind CloudFront.** Idle `/v1/events/stream` connections will hit CloudFront's 60s
   origin read timeout and drop; the client falls back to polling (supported by code). Active
   event-flowing streams (30s keepalive) are fine. Acceptable but a behavior change vs the ALB.
4. **Scale-to-zero cold starts** observed at 14–16 s on `shared-1x`. Under the 60s CloudFront
   timeout (so no failed requests), but adds first-request latency. No always-on flag in v1 —
   request from InsForge if needed for persistent-connection / APNS workloads.
5. **No container logs in Compute v1.** Crash debugging requires reproducing the image; only
   machine lifecycle events are available (`compute events <id>`).
6. **ECS not fully deleted.** Service is parked at desired 0; the **ALB, target group, ECR repo,
   and IAM task role still exist** (cost + surface area). Intentional, for rollback. Full teardown
   pending owner confirmation.
7. **Secrets exposure.** DB password, APNS private key, and BrowserFabric key existed as plaintext
   on the ECS task def and were surfaced during this session. Rotation recommended.
8. **No CI/CD yet** for Compute. The deploy is now a single scriptable command; a `deploy.sh`
   (build at current commit, `compute deploy … --env-file`) is a natural follow-up.

---

## 8. Rollback procedure (instant)

1. **Revert DNS:** Route53 zone `Z051823433JPD3W6X9JP7`, UPSERT `agents-api.caremojo.app` A (and
   remove/!revert AAAA) back to alias `openagents-workspace-alb-1622897394.us-east-1.elb.amazonaws.com`
   (alias hosted-zone `Z35SXDOTRQ7X7K`).
2. **Restart ECS:** `aws ecs update-service --cluster openagents-workspace --service workspace-backend --desired-count 1`.
   Task def rev 30 is unchanged. The previous image/tag is intact in ECR.

CloudFront and the ACM cert can remain in place (idle) during a rollback; delete only if abandoning Compute.

---

## 9. Appendix — final env var inventory on Compute `workspace-backend` (18 vars)

From ECS task def rev 30 (14): `DATABASE_URL`, `FILE_STORAGE_BACKEND`, `S3_BUCKET`, `S3_REGION`,
`AUTH_MODE`, `IDENTITY_MODE`, `WORKSPACE_ENDPOINT`, `CORS_ORIGINS`, `BROWSERFABRIC_API_KEY`,
`APNS_ENVIRONMENT`, `APNS_BUNDLE_ID`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY`.
Added for Compute (4): `RUN_MIGRATIONS=true`, `WEB_CONCURRENCY=2`,
`AWS_ACCESS_KEY_ID` (=`AKIA5FTZA4C5IWZSKT6U`), `AWS_SECRET_ACCESS_KEY` (masked).

Values are identical to ECS except the two AWS keys (new — replace the former IAM-role-based S3
auth) and the two operational overrides. Secret values are stored only in the encrypted Compute
env and the gitignored `workspace/backend/.env.production`.
