# Workspace Backend Rollback Report — InsForge Compute → AWS ECS Fargate

**Date:** 2026-06-10
**Service:** `workspace/backend` (FastAPI / uvicorn — the OpenAgents Workspace API).
**Outcome:** Production traffic for `https://agents-api.caremojo.app` is back on **AWS ECS
Fargate** behind the ALB. The InsForge Compute (Fly.io) service is **stopped**. While
reverting, the ECS task was scaled up twice — 0.5 vCPU/1 GB → 1 vCPU/2 GB → **2 vCPU / 4 GB**.

This reverses the 2026-06-04 migration recorded in
[`COMPUTE_MIGRATION_REPORT_2026-06-04.md`](./COMPUTE_MIGRATION_REPORT_2026-06-04.md). All
actions were performed with AWS CLI + InsForge CLI under interactive direction from the owner.

---

## 1. What was requested (in order)

1. "read the ecs-to-insforge migration. revert that, redeploy back to ecs and configure the
   domain using aws-cli."
2. "double the spec"
3. "stop the insforge compute instance"
4. "double the ecs spec again to 2x"

---

## 2. State before rollback (the migration end-state)

| Item | Value |
|---|---|
| Traffic path | Route53 → CloudFront `E3UK7H1FRKJTDH` → fly.dev origin (InsForge Compute) |
| `agents-api.caremojo.app` | A **and** AAAA alias → `d35ixjfhn449jv.cloudfront.net` |
| ECS service `workspace-backend` | ACTIVE, **desired 0 / running 0** (parked), task def rev 30 |
| ALB | `openagents-workspace-alb-1622897394.us-east-1.elb.amazonaws.com` (active) |
| Compute service | `workspace-backend` (`bdf9e87c-aeb0-4dc8-a644-7b6f17658df3`) running |

The ECS path was intact for rollback: ALB 443 HTTPS listener carried ACM cert
`…/088f5a1e-6438-4709-9164-14c5e33d7272` (`agents-api.caremojo.app`, ISSUED), forwarding to
target group `openagents-workspace-tg` (`…/346c2371e98a253f`); port 80 → 443 redirect.

---

## 3. Actions performed (chronological, with results)

### Step 1 — Bring ECS back up
- `aws ecs update-service --cluster openagents-workspace --service workspace-backend
  --desired-count 1 --region us-east-1`.
- Task started; registered **healthy** in `openagents-workspace-tg` within ~1 min.
- **Pre-cutover origin test** (curl `--resolve` to the ALB, Host `agents-api.caremojo.app`):
  `/health` 200, `/v1/workspaces/{id}` (DB) 200, valid TLS subject. ALB serves the hostname.

### Step 2 — Repoint DNS back to the ALB (revert CloudFront)
- Route53 zone `Z051823433JPD3W6X9JP7`, single atomic change batch:
  - **UPSERT** `agents-api.caremojo.app` **A** → alias ALB
    (`openagents-workspace-alb-1622897394.us-east-1.elb.amazonaws.com`, alias zone
    `Z35SXDOTRQ7X7K`, `EvaluateTargetHealth=true`).
  - **DELETE** the migration-added **AAAA** alias → CloudFront (pre-migration state was A-only).
- Change `C00221691ROE5L3OFCH7A` → **INSYNC**.
- **Post-cutover verification** on `https://agents-api.caremojo.app` (resolves to ALB IPs):
  `/health` 200 (`server: uvicorn`, **no CloudFront `via:` header**), workspace (DB) 200,
  **file download (S3 via `openagents-workspace-task-role`) 200 / 333,087 bytes**. The S3 path
  — which had to be re-credentialed on Fly during the migration — works natively again on ECS.

### Step 3 — Scale the task up (done in two rounds)
Each round took the prior task def verbatim, stripped read-only fields, changed only the
sizing, registered a new revision, and rolled the service onto it. Same image
(`…/openagents-workspace-backend:human-participants`), same 14 env vars, same task/execution
roles each time. Both rolling deploys completed cleanly (new task healthy → old task drained →
single deployment, `rolloutState=COMPLETED`).

| Revision | CPU | Memory | Trigger |
|---|---|---|---|
| `:30` (baseline) | 512 (0.5 vCPU) | 1024 MB (1 GB) | — |
| `:31` | 1024 (1 vCPU) | 2048 MB (2 GB) | "double the spec" |
| **`:32`** (current) | **2048 (2 vCPU)** | **4096 MB (4 GB)** | "double the ecs spec again to 2x" |

### Step 4 — Stop InsForge Compute
- `npx @insforge/cli compute stop bdf9e87c-aeb0-4dc8-a644-7b6f17658df3` → "Service
  \"workspace-backend\" stopped." `compute list` now shows status **stopped**.

### Final verification (live domain, post-everything)
| Check | Result |
|---|---|
| `GET /health` | 200 |
| `GET /v1/workspaces/{id}` (DB) | 200 |
| `GET /v1/files/{id}` (S3) | 200, 333,087 bytes |

---

## 4. State after rollback

```
client → https://agents-api.caremojo.app
       → Route53 A alias → ALB openagents-workspace-alb (ACM cert 088f5a1e-…, 443→TG, 80→443 redirect)
       → ECS Fargate workspace-backend (task def :32, 2 vCPU / 4 GB)
       → InsForge Postgres (u8h7kgu8…insforge.app)  +  AWS S3 (openagents-files-peakmojo)
```

| Resource | ID / value | State |
|---|---|---|
| ECS service | `openagents-workspace/workspace-backend`, task def **`:32`** | desired 1 / running 1 |
| Task spec | Fargate, x86_64, platform 1.4.0 | **2048 CPU / 4096 MB (2 vCPU / 4 GB)** |
| ALB | `openagents-workspace-alb-…` | active, serving |
| Route53 | `agents-api.caremojo.app` **A** alias → ALB (AAAA removed) | INSYNC |
| InsForge Compute | `workspace-backend` (`bdf9e87c-…`) | **stopped** |
| CloudFront | `E3UK7H1FRKJTDH` (`d35ixjfhn449jv.cloudfront.net`) | Deployed but **idle / no traffic** |
| ACM (CloudFront) cert | `…/26eccb83-6fa5-40da-8c48-b8bbfd51616a` | ISSUED, idle |

---

## 5. Left in place (not torn down)

- **InsForge Compute service** — stopped, not deleted. Restart with
  `npx @insforge/cli compute start bdf9e87c-aeb0-4dc8-a644-7b6f17658df3` if Compute is
  revisited.
- **CloudFront `E3UK7H1FRKJTDH` + its ACM cert `26eccb83-…`** — idle, no traffic. Delete only
  if abandoning the Compute route entirely.
- The `s3only` IAM access key minted for the migration (`AKIA5FTZA4C5IWZSKT6U`) is no longer
  on the ECS path (which uses the task role) but remains active — see the migration report §7.1.

---

## 6. Re-migrate procedure (if reversing again)

The Compute service still exists (stopped) and CloudFront/ACM are intact, so re-cutover is:
1. `npx @insforge/cli compute start bdf9e87c-aeb0-4dc8-a644-7b6f17658df3` (or `compute deploy`
   from `workspace/backend` to rebuild).
2. Route53 zone `Z051823433JPD3W6X9JP7`: UPSERT `agents-api.caremojo.app` A (and AAAA) alias →
   `d35ixjfhn449jv.cloudfront.net` (CF alias zone `Z2FDTNDATAQYW2`).
3. `aws ecs update-service --cluster openagents-workspace --service workspace-backend
   --desired-count 0`.
