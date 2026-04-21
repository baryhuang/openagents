#!/bin/sh
set -e

# Run database migrations (skip with RUN_MIGRATIONS=false for existing databases)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
fi

# Start the application — Railway injects $PORT
# Multiple workers to handle concurrent polling from frontend.
# 4 workers × (pool_size=20 + max_overflow=5) = 100 max DB connections,
# under Supabase's ~120 limit with headroom for admin/migrations/oneoffs.
# Previously used 8 workers × 14 conns each; per-worker pools were
# saturating under poll load (40+ agents × 2s poll interval) and causing
# 502s because /health couldn't be served while all workers waited on
# QueuePool. Fewer workers with bigger pools covers each worker's
# FastAPI threadpool (40 threads default) concurrency better.
#
# We intentionally do NOT use --limit-concurrency: uvicorn's 503s for
# that limit are sent before the Starlette CORS middleware runs, so
# browsers see them as CORS errors instead of clean 503s. Back-pressure
# is handled by pool_timeout (30s) in database.py.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-4}"
