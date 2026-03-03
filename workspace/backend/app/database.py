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

# Use NullPool for serverless (Vercel) — no persistent connections.
# Use QueuePool for long-running servers (Docker/uvicorn).
_is_serverless = os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")

_pool_kwargs = (
    {"poolclass": NullPool}
    if _is_serverless
    else {"pool_pre_ping": True, "pool_size": 10, "max_overflow": 20, "poolclass": QueuePool}
)

engine = create_engine(config.DATABASE_URL, **_pool_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
