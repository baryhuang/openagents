# -*- coding: utf-8 -*-
"""
OpenAgents Workspace Backend — FastAPI entry point.

A workspace is an ONM network with workspace-specific mods loaded.
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import config
from app.routers import events, files, network, workspaces

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="OpenAgents Workspace",
    description="Managed agent collaboration environment built on the OpenAgents Network Model",
    version="0.1.0",
)

# CORS
origins = [o.strip() for o in config.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(events.router)
app.include_router(files.router)
app.include_router(network.router)
app.include_router(workspaces.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
