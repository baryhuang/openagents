#!/usr/bin/env python3
"""Start workspace backend locally with SQLite for development."""

import os
import sys

# Use SQLite for local dev
os.environ["DATABASE_URL"] = "sqlite:///workspace_local.db"

# Patch PostgreSQL types for SQLite before importing any models
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
SQLiteTypeCompiler.visit_JSONB = lambda self, type_, **kw: "JSON"
SQLiteTypeCompiler.visit_UUID = lambda self, type_, **kw: "TEXT"

# Now import app
from app.database import Base, engine
from app.main import app  # noqa: F401

# Create tables (new tables only — doesn't add columns to existing tables)
Base.metadata.create_all(bind=engine)

# Auto-migrate: add missing columns for SQLite dev databases
from sqlalchemy import inspect as sa_inspect, text as sa_text
with engine.connect() as conn:
    inspector = sa_inspect(engine)
    for table_name, table in Base.metadata.tables.items():
        if not inspector.has_table(table_name):
            continue
        existing = {c["name"] for c in inspector.get_columns(table_name)}
        for col in table.columns:
            if col.name not in existing:
                col_type = col.type.compile(engine.dialect)
                default = ""
                if col.default is not None:
                    default = f" DEFAULT {col.default.arg!r}" if callable(col.default.arg) is False else ""
                conn.execute(sa_text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}{default}"))
                print(f"  Added column {table_name}.{col.name} ({col_type})")
    conn.commit()

if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    print(f"Workspace backend running on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
