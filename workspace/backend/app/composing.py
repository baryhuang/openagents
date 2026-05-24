"""In-memory composing (typing) signal store.

Tracks which channels have a user actively typing. Signals expire after
TTL_SECONDS without a refresh. No database, no persistence — ephemeral
by design.
"""

import time
from typing import Dict

TTL_SECONDS = 30.0

# {workspace_id: {channel_name: last_signal_timestamp}}
_composing: Dict[str, Dict[str, float]] = {}


def set_composing(workspace_id: str, channel: str) -> None:
    ws = _composing.get(workspace_id)
    if ws is None:
        ws = {}
        _composing[workspace_id] = ws
    ws[channel] = time.monotonic()


def has_any_composing(workspace_id: str) -> bool:
    ws = _composing.get(workspace_id)
    if not ws:
        return False
    now = time.monotonic()
    expired = [ch for ch, ts in ws.items() if now - ts > TTL_SECONDS]
    for ch in expired:
        del ws[ch]
    if not ws:
        _composing.pop(workspace_id, None)
        return False
    return True
