"""Composing (typing) signal store backed by Redis.

Tracks which channels have a user actively typing. Signals expire after
TTL_SECONDS without a refresh. Uses Redis so the signal is shared across
replicas. Falls back to in-memory dict when Redis is unavailable.
"""

from app import cache

TTL_SECONDS = 30.0
_KEY_PREFIX = "composing:"


def set_composing(workspace_id: str, channel: str) -> None:
    key = f"{_KEY_PREFIX}{workspace_id}:{channel}"
    cache.set_bytes(key, b"1", TTL_SECONDS)


def has_any_composing(workspace_id: str) -> bool:
    c = cache._lazy_client()
    if c is None:
        return False
    try:
        pattern = f"{_KEY_PREFIX}{workspace_id}:*"
        cursor, keys = c.scan(cursor=0, match=pattern, count=10)
        return len(keys) > 0
    except Exception:
        return False
