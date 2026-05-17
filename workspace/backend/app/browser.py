# -*- coding: utf-8 -*-
"""
Shared browser manager — Browser Fabric (cloud) or local Playwright.

When BROWSERFABRIC_API_KEY is set, all browser operations are proxied to
the Browser Fabric REST API.  No local Playwright/Chromium is needed.
Otherwise, a local Chromium instance is launched (dev/testing only).
"""

import asyncio
import base64
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

MAX_BROWSER_TABS = int(os.environ.get("MAX_BROWSER_TABS", "10"))

BROWSERFABRIC_API_KEY = os.environ.get("BROWSERFABRIC_API_KEY", "")
BROWSERFABRIC_URL = os.environ.get("BROWSERFABRIC_URL", "https://api.browserfabric.com")


class BrowserManager:
    """Singleton managing shared browser tabs via Browser Fabric or local Playwright."""

    _instance: Optional["BrowserManager"] = None

    def __init__(self):
        self._playwright = None
        self._browser = None            # Only used for local mode
        self._pages: dict = {}           # tab_id -> Page (local mode only)
        self._locks: dict = {}           # tab_id -> asyncio.Lock (local mode only)
        self._global_lock = asyncio.Lock()
        self._sessions: dict = {}        # tab_id -> Browser Fabric session id

    @classmethod
    def get(cls) -> "BrowserManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_cloud(self) -> bool:
        return bool(BROWSERFABRIC_API_KEY)

    # ------------------------------------------------------------------
    # Browser Fabric REST helpers
    # ------------------------------------------------------------------

    async def _bf_call(self, tool_name: str, arguments: dict = None, session_id: str = None) -> dict:
        """Call a Browser Fabric tool via REST API."""
        payload: dict = {"tool_name": tool_name}
        if arguments:
            payload["arguments"] = arguments
        if session_id:
            payload["session_id"] = session_id
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{BROWSERFABRIC_URL}/api/v1/services/browseruse/call",
                json=payload,
                headers={"Authorization": f"Bearer {BROWSERFABRIC_API_KEY}"},
            )
            resp.raise_for_status()
            data = resp.json()
            if not data.get("success"):
                raise RuntimeError(f"Browser Fabric error: {data.get('error', 'unknown')}")
            return data

    # ------------------------------------------------------------------
    # Playwright init (local mode only)
    # ------------------------------------------------------------------

    async def _ensure_playwright(self):
        if self._playwright:
            return
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()

    async def _ensure_local_browser(self):
        if self._browser and self._browser.is_connected():
            return
        await self._ensure_playwright()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def open_tab(self, tab_id: str, url: str = "about:blank", bb_context_id: str = None) -> dict:
        """Create a new browser tab. Returns {url, title}."""
        async with self._global_lock:
            active_count = len(self._sessions) if self.is_cloud else len(self._pages)
            if active_count >= MAX_BROWSER_TABS:
                raise RuntimeError(f"Maximum browser tabs ({MAX_BROWSER_TABS}) reached")

        if self.is_cloud:
            args: dict = {"headless": True}
            if bb_context_id:
                args["context_id"] = bb_context_id
                args["persist"] = True

            result = await self._bf_call("create_session", args)
            session_id = result["result"]["session_id"]
            self._sessions[tab_id] = session_id

            if url and url != "about:blank":
                try:
                    await self._bf_call("navigate", {"url": url, "wait_until": "domcontentloaded"}, session_id)
                except Exception:
                    pass

            info = await self._bf_call("get_page_info", {}, session_id)
            page_info = info.get("result", {})
            return {"url": page_info.get("url", url), "title": page_info.get("title", "")}
        else:
            # Local mode
            async with self._global_lock:
                await self._ensure_local_browser()
                page = await self._browser.new_page()
                self._pages[tab_id] = page

            if url and url != "about:blank":
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception:
                    pass

            title = await page.title()
            return {"url": page.url, "title": title}

    async def navigate(self, tab_id: str, url: str) -> dict:
        """Navigate a tab to a URL. Returns {url, title}."""
        if self.is_cloud:
            session_id = self._get_session(tab_id)
            try:
                await self._bf_call("navigate", {"url": url, "wait_until": "domcontentloaded"}, session_id)
            except Exception:
                pass
            info = await self._bf_call("get_page_info", {}, session_id)
            page_info = info.get("result", {})
            return {"url": page_info.get("url", url), "title": page_info.get("title", "")}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception:
                    pass
                title = await page.title()
                return {"url": page.url, "title": title}

    async def click(self, tab_id: str, selector: str) -> dict:
        """Click an element by CSS selector."""
        if self.is_cloud:
            session_id = self._get_session(tab_id)
            await self._bf_call("click_element", {"selector": selector}, session_id)
            info = await self._bf_call("get_page_info", {}, session_id)
            page_info = info.get("result", {})
            return {"clicked": selector, "url": page_info.get("url", ""), "title": page_info.get("title", "")}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                await page.click(selector, timeout=10000)
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
                return {"clicked": selector, "url": page.url, "title": await page.title()}

    async def type_text(self, tab_id: str, selector: str, text: str, append: bool = False) -> dict:
        """Type text into an element."""
        if self.is_cloud:
            session_id = self._get_session(tab_id)
            await self._bf_call("type_text", {"selector": selector, "text": text}, session_id)
            return {"filled": selector, "text": text}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                try:
                    if append:
                        raise Exception("skip fill for append mode")
                    await page.fill(selector, text, timeout=5000)
                except Exception:
                    await page.click(selector, timeout=5000)
                    if append:
                        await page.keyboard.press("End")
                        await page.keyboard.press("Control+End")
                    chunk_size = 200
                    for i in range(0, len(text), chunk_size):
                        chunk = text[i:i + chunk_size]
                        await page.keyboard.type(chunk, delay=15)
                        await asyncio.sleep(0.1)
                return {"filled": selector, "text": text}

    async def press_key(self, tab_id: str, key: str) -> dict:
        """Press a keyboard key."""
        if self.is_cloud:
            session_id = self._get_session(tab_id)
            await self._bf_call("press_key", {"key": key}, session_id)
            return {"pressed": key}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                await page.keyboard.press(key)
                return {"pressed": key}

    async def evaluate(self, tab_id: str, expression: str) -> dict:
        """Execute JavaScript in the page context."""
        if self.is_cloud:
            session_id = self._get_session(tab_id)
            result = await self._bf_call("evaluate_js", {"expression": expression}, session_id)
            return {"result": result.get("result", {}).get("result")}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                result = await page.evaluate(expression)
                return {"result": result}

    async def screenshot(self, tab_id: str) -> bytes:
        """Take a PNG screenshot of the tab."""
        if self.is_cloud:
            session_id = self._get_session(tab_id)
            result = await self._bf_call("take_screenshot", {"full_page": False}, session_id)
            b64_data = result.get("result", {}).get("screenshot", "")
            if b64_data.startswith("data:"):
                b64_data = b64_data.split(",", 1)[1]
            return base64.b64decode(b64_data)
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                return await page.screenshot(type="png", full_page=False)

    async def snapshot(self, tab_id: str) -> str:
        """Get page content as a readable text snapshot."""
        if self.is_cloud:
            session_id = self._get_session(tab_id)
            result = await self._bf_call("snapshot", {}, session_id)
            return result.get("result", {}).get("snapshot", "(empty page)")
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                try:
                    tree = await page.locator("body").aria_snapshot()
                    return tree or "(empty page)"
                except (AttributeError, Exception):
                    pass
                try:
                    text = await page.inner_text("body", timeout=5000)
                    title = await page.title()
                    url = page.url
                    return f"URL: {url}\nTitle: {title}\n\n{text[:5000]}"
                except Exception:
                    return "(empty page)"

    async def close_tab(self, tab_id: str, session_id_hint: str = None) -> None:
        """Close a browser tab."""
        if self.is_cloud:
            session_id = self._sessions.pop(tab_id, None) or session_id_hint
            if session_id:
                try:
                    await self._bf_call("close_session", {}, session_id)
                except Exception as e:
                    logger.warning("Failed to close BF session %s: %s", session_id, e)
        else:
            page = self._pages.pop(tab_id, None)
            self._locks.pop(tab_id, None)
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    async def shutdown(self) -> None:
        """Close all tabs and the browser."""
        for tab_id in list(self._sessions.keys()) + list(self._pages.keys()):
            await self.close_tab(tab_id)
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    # ------------------------------------------------------------------
    # Reconnection (serverless / cold-start recovery)
    # ------------------------------------------------------------------

    async def reconnect(self, tab_id: str, session_id: str) -> None:
        """Reconnect to an existing Browser Fabric session.

        In REST-only mode, we just store the session_id mapping.
        The next operation will use it to call the BF API.
        """
        if self.is_cloud:
            if tab_id in self._sessions:
                return
            self._sessions[tab_id] = session_id
        else:
            raise KeyError(f"Cannot reconnect to local tab: {tab_id}")

    # ------------------------------------------------------------------
    # Persistent contexts
    # ------------------------------------------------------------------

    def create_bb_context(self) -> str:
        """Create a new persistent context. Returns the context ID.

        Browser Fabric creates contexts on-the-fly when create_session
        is called with context_id + persist=True. We generate a unique
        ID here that will be used later.
        """
        import uuid
        return f"ctx-{uuid.uuid4().hex[:16]}"

    def delete_bb_context(self, bb_context_id: str) -> None:
        """Delete a persistent context (fire-and-forget)."""
        if not self.is_cloud:
            return
        try:
            with httpx.Client(timeout=10.0) as client:
                client.delete(
                    f"{BROWSERFABRIC_URL}/api/v1/contexts/{bb_context_id}",
                    headers={"Authorization": f"Bearer {BROWSERFABRIC_API_KEY}"},
                )
        except Exception as e:
            logger.warning("Failed to delete BF context %s: %s", bb_context_id, e)

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------

    def _get_session(self, tab_id: str) -> str:
        session_id = self._sessions.get(tab_id)
        if not session_id:
            raise KeyError(f"Browser tab not found: {tab_id}")
        return session_id

    def _get_page(self, tab_id: str):
        page = self._pages.get(tab_id)
        if not page:
            raise KeyError(f"Browser tab not found: {tab_id}")
        return page

    def _get_lock(self, tab_id: str) -> asyncio.Lock:
        if tab_id not in self._locks:
            self._locks[tab_id] = asyncio.Lock()
        return self._locks[tab_id]

    def get_live_url(self, tab_id: str) -> Optional[str]:
        """Return the live view URL if available. Not supported with Browser Fabric."""
        return None

    def get_session_id(self, tab_id: str) -> Optional[str]:
        """Return the Browser Fabric session ID for a tab."""
        return self._sessions.get(tab_id)

    async def get_current_url(self, tab_id: str) -> Optional[dict]:
        """Return the current {url, title} from the live page."""
        if self.is_cloud:
            session_id = self._sessions.get(tab_id)
            if not session_id:
                return None
            try:
                info = await self._bf_call("get_page_info", {}, session_id)
                page_info = info.get("result", {})
                return {"url": page_info.get("url", ""), "title": page_info.get("title", "")}
            except Exception:
                return None
        else:
            page = self._pages.get(tab_id)
            if not page:
                return None
            try:
                url = page.url
                title = await page.title()
                return {"url": url, "title": title}
            except Exception:
                return None

    def active_tab_count(self) -> int:
        if self.is_cloud:
            return len(self._sessions)
        return len(self._pages)
