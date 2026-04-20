#!/bin/sh
set -e

# Run database migrations (skip with RUN_MIGRATIONS=false for existing databases)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
fi

# Start the application — Railway injects $PORT
# Multiple workers to handle concurrent polling from frontend.
# 6 workers × pool_size=4 + max_overflow=6 = 60 max DB connections
# leaves headroom in Supabase's 120 limit for other clients/admin.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers "${WEB_CONCURRENCY:-6}"
