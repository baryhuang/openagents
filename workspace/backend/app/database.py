# -*- coding: utf-8 -*-
"""
Database connection and session management.

Uses SQLAlchemy with any PostgreSQL database (not Supabase-specific).
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session, declarative_base
from sqlalchemy.pool import NullPool, QueuePool

from app.config import config

# Use NullPool for serverless (Vercel) or SQLite — no persistent connections.
# Use QueuePool for long-running servers (Docker/uvicorn) with PostgreSQL.
_is_serverless = os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
_is_sqlite = config.DATABASE_URL.startswith("sqlite")

# Register PostgreSQL type compilers for SQLite so JSONB/UUID columns work.
if _is_sqlite:
    from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
    if not hasattr(SQLiteTypeCompiler, "_orig_visit_JSONB"):
        SQLiteTypeCompiler.visit_JSONB = lambda self, type_, **kw: "JSON"
        SQLiteTypeCompiler.visit_UUID = lambda self, type_, **kw: "TEXT"

# PgBouncer (e.g. Supabase port 6543) maintains its own connection pool;
# app-level pooling is redundant and causes stale-connection failures
# ("SSL connection has been closed unexpectedly") because pgbouncer may
# rotate or idle-kill the TCP connection our app still thinks is fresh.
# Use NullPool in pgbouncer mode: each request opens a short-lived conn
# that goes straight to pgbouncer (local to Supabase, ~1-2ms overhead).
_is_pgbouncer = ":6543/" in config.DATABASE_URL

_pool_kwargs = (
    {"poolclass": NullPool}
    if _is_serverless or _is_sqlite or _is_pgbouncer
    # Direct-PG mode (port 5432): keep a bounded per-worker pool.
    # Sized for Railway Postgres max_connections=100 at 2 replicas × 1
    # worker (WEB_CONCURRENCY=1): 2 × (40 + 8) = 96 max DB conns, leaves
    # 4 for admin/migrations. Running a single worker per replica is
    # intentional — FastAPI async handlers calling sync SQLAlchemy hold
    # a DB connection for the duration of each request, so bursts of
    # concurrent polls saturated per-worker pools when multiple workers
    # competed for the same 100-conn budget.
    # pool_timeout is short (2s) because a longer queue wait would
    # stall the async event loop on /health and everything else.
    else {"pool_pre_ping": True, "pool_size": 40, "max_overflow": 8, "pool_recycle": 300, "pool_timeout": 2, "poolclass": QueuePool}
)

# Keep the TCP connection alive to survive NAT / firewall idle timeouts
# between Railway egress and Supabase. Without these, idle connections
# get silently FIN/RST'd and we see "SSL connection has been closed
# unexpectedly" mid-query.
# keepalives_idle=30: start probing after 30s of idle
# keepalives_interval=10: probe every 10s
# keepalives_count=3: drop the conn after 3 failed probes
_connect_args = {}
if not _is_sqlite:
    _connect_args.update({
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
        # TCP-level timeout for the initial connect.
        "connect_timeout": 10,
    })

# PgBouncer transaction mode doesn't support prepared statements or the
# 'options' startup parameter. Disable SQLAlchemy statement caching so
# no PREPARE/DEALLOCATE is issued.
_engine_kwargs = {**_pool_kwargs}
if _connect_args:
    _engine_kwargs["connect_args"] = _connect_args
if _is_pgbouncer:
    _engine_kwargs["execution_options"] = {"no_cache": True}

engine = create_engine(config.DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
