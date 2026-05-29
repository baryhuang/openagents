#!/bin/sh
set -e

# Run database migrations (skip with RUN_MIGRATIONS=false for existing databases)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
fi

# Start the application — ECS / Railway inject $PORT.
# Default to 1 worker because we're now on InsForge Postgres nano
# (max_connections ~100 shared with InsForge's own auth/postgREST/dashboard).
# 1 worker × (pool_size=8 + max_overflow=2) = 10 DB conns from us. Raise
# WEB_CONCURRENCY only after upsizing the Postgres instance.
#
# We intentionally do NOT use --limit-concurrency: uvicorn's 503s for
# that limit are sent before the Starlette CORS middleware runs, so
# browsers see them as CORS errors instead of clean 503s. Back-pressure
# is handled by pool_timeout in database.py.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-1}"
