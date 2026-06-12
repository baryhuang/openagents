#!/bin/sh
set -e

# Migrations run via preDeployCommand in railway.toml (once, before replicas start).

# Start the application — Railway injects $PORT
# 2 replicas × 2 workers × (pool_size=40 + max_overflow=8) = 192 max DB
# connections steady-state; a rolling deploy briefly doubles that to 384,
# under Railway Postgres's max_connections=400 (raised via ALTER SYSTEM,
# 2026-06-12). Two workers per replica keep event-loop parallelism so
# /health stays responsive if the sibling worker is busy.
#
# We intentionally do NOT use --limit-concurrency: uvicorn's 503s for
# that limit are sent before the Starlette CORS middleware runs, so
# browsers see them as CORS errors instead of clean 503s. Back-pressure
# is handled by pool_timeout in database.py.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}"
