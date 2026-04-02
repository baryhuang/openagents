#!/bin/sh
set -e

# Run database migrations
alembic upgrade head

# Start the application — Railway injects $PORT
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
