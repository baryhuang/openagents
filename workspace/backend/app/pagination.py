# -*- coding: utf-8 -*-
"""
Pagination utilities for the workspace API.
"""

from typing import Any, Optional, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select


class PaginationParams(BaseModel):
    page: int = 1
    page_size: int = 20


def create_pagination_params(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size)


def apply_database_pagination(
    query: Select,
    pagination: PaginationParams,
) -> Select:
    """Apply LIMIT/OFFSET to a SQLAlchemy query."""
    offset = (pagination.page - 1) * pagination.page_size
    return query.offset(offset).limit(pagination.page_size)


def create_paginated_response(
    items: list,
    total: Optional[int],
    pagination: PaginationParams,
) -> dict:
    """Create a paginated response envelope."""
    total_pages = None
    if total is not None:
        total_pages = max(1, (total + pagination.page_size - 1) // pagination.page_size)

    return {
        "items": items,
        "pagination": {
            "page": pagination.page,
            "page_size": pagination.page_size,
            "total": total,
            "total_pages": total_pages,
            "has_next": (total is not None and pagination.page * pagination.page_size < total),
            "has_prev": pagination.page > 1,
        },
    }
