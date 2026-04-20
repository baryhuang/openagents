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
# --limit-concurrency caps simultaneous async requests per worker so
# they cannot queue past the pool size and pile up in idle-in-
# transaction (the LLM router call holds a DB session for ~1s and
# without this cap async requests outpace the pool).
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-8}" \
    --limit-concurrency "${UVICORN_LIMIT_CONCURRENCY:-14}"
