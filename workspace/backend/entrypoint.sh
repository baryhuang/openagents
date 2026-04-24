#!/bin/sh
set -e

# Run database migrations (skip with RUN_MIGRATIONS=false for existing databases)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
fi

# Start the application — Railway injects $PORT
# 2 replicas × 1 worker × (pool_size=40 + max_overflow=8) = 96 max DB
# connections, under Railway Postgres's max_connections=100. One worker
# per replica keeps the per-worker pool large enough to survive
# bursty async polls — multiple workers per replica split the 100-conn
# budget into per-worker pools that saturate under concurrent load.
#
# We intentionally do NOT use --limit-concurrency: uvicorn's 503s for
# that limit are sent before the Starlette CORS middleware runs, so
# browsers see them as CORS errors instead of clean 503s. Back-pressure
# is handled by pool_timeout in database.py.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-1}"
