# -*- coding: utf-8 -*-
"""
Workspace backend configuration.

All settings are loaded from environment variables.
"""

import os


class Config:
    """Application configuration loaded from environment variables."""

    # Database
    DATABASE_URL: str = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:dev@localhost:5432/openagents_workspace",
    )

    # Auth mode: "workspace_token" (self-hosted) or "firebase" (hosted)
    AUTH_MODE: str = os.environ.get("AUTH_MODE", "workspace_token")

    # Firebase (used for user login on workspace.openagents.org)
    FIREBASE_PROJECT_ID: str = os.environ.get("FIREBASE_PROJECT_ID", "openagentsweb")

    # Optional: Firebase service account credentials as JSON string
    FIREBASE_CREDENTIALS_JSON: str = os.environ.get("FIREBASE_CREDENTIALS_JSON", "")

    # Identity mode: "standalone" (own agent table) or "shared" (external agent_ids)
    IDENTITY_MODE: str = os.environ.get("IDENTITY_MODE", "standalone")

    # Agent offline timeout in seconds
    AGENT_TIMEOUT_SECONDS: int = int(os.environ.get("AGENT_TIMEOUT_SECONDS", "60"))

    # CORS origins (comma-separated)
    CORS_ORIGINS: str = os.environ.get("CORS_ORIGINS", "*")

    # Server
    HOST: str = os.environ.get("HOST", "0.0.0.0")
    PORT: int = int(os.environ.get("PORT", "8000"))


config = Config()
