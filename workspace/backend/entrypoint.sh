#!/bin/sh
set -e

# Run database migrations (skip with RUN_MIGRATIONS=false for existing databases)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
fi

# Start the application — Railway injects $PORT
# 2 replicas × 2 workers × (pool_size=20 + max_overflow=4) = 96 max DB
# connections, under Railway Postgres's max_connections=100. Fewer
# workers with larger per-worker pools gives each worker's FastAPI
# threadpool (40 threads) enough headroom for concurrent polls without
# queueing on the pool.
#
# We intentionally do NOT use --limit-concurrency: uvicorn's 503s for
# that limit are sent before the Starlette CORS middleware runs, so
# browsers see them as CORS errors instead of clean 503s. Back-pressure
# is handled by pool_timeout in database.py.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}"
