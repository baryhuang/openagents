# Deploying the Workspace Backend

**Active target: AWS ECS Fargate (us-east-1), behind an ALB.**

As of the 2026-06-10 rollback, the workspace backend runs on **AWS ECS Fargate** again. The
2026-06-04 InsForge Compute migration was reverted; the Compute service is **stopped** (see
"Rolled-back path" below). Full rollback record:
[`../scripts/insforge-migration/ROLLBACK_REPORT_2026-06-10.md`](../scripts/insforge-migration/ROLLBACK_REPORT_2026-06-10.md)
(reverses [`COMPUTE_MIGRATION_REPORT_2026-06-04.md`](../scripts/insforge-migration/COMPUTE_MIGRATION_REPORT_2026-06-04.md)).

---

## Live topology

```
client → https://agents-api.caremojo.app
       → Route53 (zone Z051823433JPD3W6X9JP7) A alias
       → ALB openagents-workspace-alb-1622897394.us-east-1.elb.amazonaws.com (zone Z35SXDOTRQ7X7K)
         · 443 HTTPS → ACM cert …/088f5a1e-… (agents-api.caremojo.app) → target group openagents-workspace-tg
         · 80 HTTP → redirect to 443
       → ECS Fargate service openagents-workspace/workspace-backend (task def :32, 2 vCPU / 4 GB)
       → InsForge Postgres (u8h7kgu8…insforge.app)  +  AWS S3 (openagents-files-peakmojo)
```

| Resource | Value |
|---|---|
| Region | `us-east-1` / account `905418170554` |
| Cluster / service | `openagents-workspace` / `workspace-backend` |
| Task definition | `openagents-workspace-backend` (current rev **32** — 2048 CPU / 4096 MB) |
| Launch type | Fargate, x86_64, platform `1.4.0`, container port `8000` |
| ECR image | `905418170554.dkr.ecr.us-east-1.amazonaws.com/openagents-workspace-backend:human-participants` |
| ALB | `openagents-workspace-alb-1622897394.us-east-1.elb.amazonaws.com` (zone `Z35SXDOTRQ7X7K`) |
| Target group | `openagents-workspace-tg` (`…/346c2371e98a253f`), container port 8000 |
| ACM cert (ALB 443) | `…/088f5a1e-6438-4709-9164-14c5e33d7272` (`agents-api.caremojo.app`, ISSUED) |
| Task role / exec role | `openagents-workspace-task-role` / `ecsTaskExecutionRole` |

> The task role `openagents-workspace-task-role` grants S3 access to
> `openagents-files-peakmojo` — so on ECS, **no `AWS_ACCESS_KEY_ID`/`SECRET` env vars are
> needed** (boto3 uses the task-role credential chain). This differs from Compute/Fly, which
> had no instance role and required static keys.

---

## Deploy a new version

The build is manual (no CI/CD): build `linux/amd64`, push to ECR, register a task-def
revision, update the service. Requires a local Docker daemon and `aws` CLI.

```bash
cd workspace/backend
ACCOUNT=905418170554; REGION=us-east-1
REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/openagents-workspace-backend
TAG=human-participants                 # the floating tag the task def references

# 1) Build + push (amd64 — Fargate is x86_64)
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
docker build --platform linux/amd64 -f backend.Dockerfile -t $REPO:$TAG .
docker push $REPO:$TAG

# 2) Force a new deployment (task def already points at :$TAG)
aws ecs update-service --cluster openagents-workspace --service workspace-backend \
  --force-new-deployment --region $REGION
```

> ⚠️ The task def references the **floating tag `:human-participants`** (a known footgun —
> two deploys can share a digest). For an auditable deploy, push an immutable tag and register
> a new task-def revision pointing at it instead of `--force-new-deployment`.

### Change the task spec (CPU / memory)

Register a new revision from the current one, changing only the sizing, then roll onto it.
Valid Fargate CPU/memory combos apply (e.g. 2048 CPU pairs with 4096–16384 MB).

```bash
REGION=us-east-1
aws ecs describe-task-definition --task-definition openagents-workspace-backend \
  --region $REGION --query 'taskDefinition' --output json > /tmp/td.json
python3 - <<'PY'
import json; d=json.load(open('/tmp/td.json'))
for k in ['taskDefinitionArn','revision','status','requiresAttributes','compatibilities','registeredAt','registeredBy','deregisteredAt']: d.pop(k,None)
d['cpu']="2048"; d['memory']="4096"            # <-- desired sizing
json.dump(d, open('/tmp/td_new.json','w'))
PY
NEWTD=$(aws ecs register-task-definition --cli-input-json file:///tmp/td_new.json \
  --region $REGION --query 'taskDefinition.taskDefinitionArn' --output text)
aws ecs update-service --cluster openagents-workspace --service workspace-backend \
  --task-definition "$NEWTD" --region $REGION
```

---

## Verify a deploy

```bash
BASE=https://agents-api.caremojo.app
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/health"                          # 200
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/v1/workspaces/<workspace-id>"     # 200 (DB)
curl -s -o /tmp/x -w '%{http_code} %{size_download}\n' \
  "$BASE/v1/files/<file-id>?network=<workspace-id>"                              # 200 (S3 via task role)
```

Operational checks:
```bash
# rollout state + counts
aws ecs describe-services --cluster openagents-workspace --services workspace-backend \
  --region us-east-1 --query 'services[0].{desired:desiredCount,running:runningCount,deployments:deployments[].{td:taskDefinition,state:rolloutState}}'
# ALB target health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:905418170554:targetgroup/openagents-workspace-tg/346c2371e98a253f \
  --region us-east-1 --query 'TargetHealthDescriptions[].TargetHealth.State'
npx @insforge/cli diagnose db --check connections   # InsForge Postgres conn usage (ceiling 60)
```

---

## Domain / TLS

- TLS terminates at the **ALB 443 listener** (ACM cert `…/088f5a1e-…`, `agents-api.caremojo.app`).
  Port 80 redirects to 443.
- Route53 `caremojo.app` (zone `Z051823433JPD3W6X9JP7`): `agents-api` **A alias → ALB**
  (alias zone `Z35SXDOTRQ7X7K`). No AAAA record (the ALB path is IPv4 alias only).
- A routine code deploy (`update-service`) touches neither DNS nor the ALB.

---

## Constraints / gotchas

- **Postgres connection ceiling = 60.** Pool is `pool_size=20 + overflow=4` (≈24/worker → 48
  for `WEB_CONCURRENCY=2`). One task fits; a second replica needs a pooler (the
  "max_connections=200" comment in `entrypoint.sh` is stale).
- **Floating image tag** `:human-participants` — see the deploy warning above.
- **Env vars are plaintext on the task def** (14 vars, incl. DB password / APNS key /
  BrowserFabric key). No Secrets Manager. Rotation recommended (migration report §7).

---

## Rolled-back path (InsForge Compute — currently stopped)

The 2026-06-04 migration to InsForge Compute (Fly.io) + CloudFront was reverted on 2026-06-10.
The Compute service and CloudFront/ACM are retained (idle) for fast re-cutover:

- Compute service `workspace-backend` (`bdf9e87c-aeb0-4dc8-a644-7b6f17658df3`) — **stopped**.
  Restart: `npx @insforge/cli compute start bdf9e87c-aeb0-4dc8-a644-7b6f17658df3`.
- CloudFront `E3UK7H1FRKJTDH` (`d35ixjfhn449jv.cloudfront.net`) + ACM cert `…/26eccb83-…` —
  idle, no traffic.

To re-migrate, see [`ROLLBACK_REPORT_2026-06-10.md`](../scripts/insforge-migration/ROLLBACK_REPORT_2026-06-10.md) §6.
The InsForge Compute deploy procedure (source mode, `compute deploy`, `.env.production` with
18 vars incl. static S3 keys) is documented in the migration report.

## Legacy

- **Railway** (`railway.toml`) — earlier target, superseded long ago. Do not use.
