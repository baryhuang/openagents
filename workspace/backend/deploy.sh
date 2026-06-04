#!/usr/bin/env bash
#
# Deploy the workspace backend to InsForge Compute (Fly.io), source mode.
# Builds on Fly's remote builder — no local Docker daemon required.
# See DEPLOYMENT.md for the full procedure, env vars, domain, and rollback.
#
# Usage:
#   cd workspace/backend && ./deploy.sh
#
set -euo pipefail

NAME="workspace-backend"
PORT="8000"
CPU="shared-1x"
MEMORY="1024"
REGION="iad"
ENV_FILE="./.env.production"

cd "$(dirname "$0")"

# 1) flyctl on PATH (source-mode build client; no Docker daemon needed)
export FLYCTL_INSTALL="${FLYCTL_INSTALL:-$HOME/.fly}"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
if ! command -v flyctl >/dev/null 2>&1; then
  echo "ERROR: flyctl not found. Install it once:" >&2
  echo "  curl -L https://fly.io/install.sh | sh" >&2
  exit 1
fi

# 2) InsForge project link must exist in THIS dir (CLI does not search parents)
if [ ! -f ".insforge/project.json" ]; then
  if [ -d "../../.insforge" ]; then
    echo "Linking project from repo root (.insforge copied into build dir)…"
    cp -R ../../.insforge .insforge
  else
    echo "ERROR: no .insforge link here and none at repo root." >&2
    echo "  Run: npx @insforge/cli link   (project: caremojo-openagents)" >&2
    exit 1
  fi
fi

# 3) Env file (source of truth for the service env; gitignored — holds secrets)
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE missing. It holds the 18 required env vars (incl. secrets)." >&2
  echo "  See DEPLOYMENT.md > 'Environment variables'. Restore it from your secret store." >&2
  exit 1
fi

# 4) Deploy (same --name updates the running service in place)
echo "Deploying '$NAME' to InsForge Compute (source mode, remote build)…"
npx @insforge/cli compute deploy . \
  --name "$NAME" \
  --port "$PORT" \
  --cpu "$CPU" --memory "$MEMORY" \
  --region "$REGION" \
  --env-file "$ENV_FILE"

echo
echo "Done. Verify:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://agents-api.caremojo.app/health"
echo "  npx @insforge/cli compute list"
