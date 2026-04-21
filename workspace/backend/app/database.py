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

_pool_kwargs = (
    {"poolclass": NullPool}
    if _is_serverless or _is_sqlite
    # 4 workers × (20 + 5) = 100 max DB connections, under Supabase's
    # ~120 limit with headroom for admin/migrations/one-off queries.
    # Previous config was 8 workers × 14 conns = 112; but per-worker
    # pools of 14 were saturating under poll load (40+ agents × 2s poll
    # interval), causing "QueuePool limit reached" and 502s. Fewer workers
    # with bigger per-worker pools gives each worker enough connections
    # to cover its FastAPI threadpool (40 threads default) concurrency.
    # pool_recycle=300s cycles stuck idle-in-transaction connections.
    # pool_timeout=30s absorbs short bursts without failing the request.
    else {"pool_pre_ping": True, "pool_size": 20, "max_overflow": 5, "pool_recycle": 300, "pool_timeout": 30, "poolclass": QueuePool}
)

# PgBouncer (e.g. Supabase port 6543) doesn't support prepared statements
# or the 'options' startup parameter.  Use execution_options to disable
# implicit statement caching so SQLAlchemy never issues PREPARE/DEALLOCATE.
_is_pgbouncer = ":6543/" in config.DATABASE_URL
_engine_kwargs = {**_pool_kwargs}
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
