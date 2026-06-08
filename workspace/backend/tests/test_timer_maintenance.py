# -*- coding: utf-8 -*-
"""Smoke + behaviour tests for the refactored background timer loop.

`_timer_loop` was split (commit on branch fix/timer-loop-pool-exhaustion)
into `_fire_due` (every cycle, short-lived session) and `_run_maintenance`
(every ~5 min, off the event loop via asyncio.to_thread). These tests run
both functions against an isolated SQLite DB to guard against import/session
regressions and verify the auto-archive sweep still works.

Both functions use `app.database.SessionLocal` directly (not the request
get_db dependency), so we monkeypatch it onto a dedicated engine.
"""

import asyncio
import time

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.database as database
import app.main as main
import app.models  # noqa: F401 — register models on Base
from app.database import Base
from app.models import Channel, Workspace


@pytest.fixture
def session_factory(monkeypatch):
    """Isolated in-memory DB with app.database.SessionLocal pointed at it."""
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(eng, "before_cursor_execute", retval=True)
    def _rewrite_pg_to_sqlite(conn, cursor, statement, parameters, context, executemany):
        if "DEFAULT NOW()" in statement:
            statement = statement.replace("DEFAULT NOW()", "DEFAULT CURRENT_TIMESTAMP")
        if "DEFAULT gen_random_uuid()" in statement:
            statement = statement.replace("DEFAULT gen_random_uuid()", "")
        return statement, parameters

    Base.metadata.create_all(bind=eng)
    sl = sessionmaker(autocommit=False, autoflush=False, bind=eng)
    # _run_maintenance/_fire_due do `from app.database import SessionLocal`
    # at call time, which reads this attribute — so patching it is enough.
    monkeypatch.setattr(database, "SessionLocal", sl)
    yield sl
    Base.metadata.drop_all(bind=eng)


def test_run_maintenance_empty_db_ok(session_factory):
    # All three sweeps must run cleanly against empty tables (no firing path).
    main._run_maintenance()


def test_fire_due_empty_db_ok(session_factory):
    # No due timers/routines: runs the SELECTs, commits, closes — no pipeline.
    asyncio.run(main._fire_due())


def test_run_maintenance_archives_stale_thread(session_factory):
    s = session_factory()
    ws = Workspace(name="t", slug="t")
    s.add(ws)
    s.flush()
    stale_ms = int((time.time() - 40 * 86400) * 1000)  # 40 days ago
    s.add(Channel(workspace_id=ws.id, name="stale", status="active", last_event_at=stale_ms))
    s.add(Channel(workspace_id=ws.id, name="fresh", status="active",
                  last_event_at=int(time.time() * 1000)))
    s.commit()
    s.close()

    main._run_maintenance()

    s = session_factory()
    stale = s.execute(
        Channel.__table__.select().where(Channel.name == "stale")
    ).first()
    fresh = s.execute(
        Channel.__table__.select().where(Channel.name == "fresh")
    ).first()
    s.close()
    assert stale.status == "archived"
    assert fresh.status == "active"
