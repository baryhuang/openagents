#!/bin/sh
set -e

# Run database migrations (skip with RUN_MIGRATIONS=false for existing databases)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
fi

# Start the application — Railway injects $PORT
# Multiple workers to handle concurrent polling from frontend.
# 8 workers × pool_size=6 + max_overflow=8 = 112 max DB connections
# under Supabase's 120 limit with a small headroom.
#
# We intentionally do NOT use --limit-concurrency: uvicorn's 503s for
# that limit are sent before the Starlette CORS middleware runs, so
# browsers see them as CORS errors instead of clean 503s. Back-pressure
# is handled by pool_timeout (10s) in database.py, which raises a
# proper Python exception → FastAPI returns a CORS-wrapped 500.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-8}"
