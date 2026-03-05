# -*- coding: utf-8 -*-
"""
Shared browser manager — Browserbase (cloud) or local Playwright.

When BROWSERBASE_API_KEY is set, tabs are opened as Browserbase sessions
and controlled via Playwright connected over CDP.  Otherwise, a local
Chromium instance is launched (dev/testing only).
"""

import asyncio
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

MAX_BROWSER_TABS = int(os.environ.get("MAX_BROWSER_TABS", "10"))

BROWSERBASE_API_KEY = os.environ.get("BROWSERBASE_API_KEY", "")
BROWSERBASE_PROJECT_ID = os.environ.get("BROWSERBASE_PROJECT_ID", "")


class BrowserManager:
    """Singleton managing shared browser tabs via Browserbase or local Playwright."""

    _instance: Optional["BrowserManager"] = None

    def __init__(self):
        self._playwright = None
        self._browser = None            # Only used for local mode
        self._pages: dict = {}           # tab_id -> Page
        self._locks: dict = {}           # tab_id -> asyncio.Lock
        self._global_lock = asyncio.Lock()
        self._sessions: dict = {}        # tab_id -> browserbase session id
        self._live_urls: dict = {}       # tab_id -> live view URL
        self._browsers_cdp: dict = {}    # tab_id -> CDP Browser (Browserbase)

    @classmethod
    def get(cls) -> "BrowserManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_cloud(self) -> bool:
        return bool(BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID)

    # ------------------------------------------------------------------
    # Playwright init
    # ------------------------------------------------------------------

    async def _ensure_playwright(self):
        """Start the Playwright driver if not already running."""
        if self._playwright:
            return
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()

    async def _ensure_local_browser(self):
        """Lazy-init a local Chromium (dev mode only)."""
        if self._browser and self._browser.is_connected():
            return
        await self._ensure_playwright()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )

    # ------------------------------------------------------------------
    # Browserbase helpers
    # ------------------------------------------------------------------

    def _bb_client(self):
        from browserbase import Browserbase
        return Browserbase(api_key=BROWSERBASE_API_KEY)

    async def _create_bb_session(self, tab_id: str) -> str:
        """Create a Browserbase session and return its connect URL."""
        bb = self._bb_client()
        session = bb.sessions.create(project_id=BROWSERBASE_PROJECT_ID)
        self._sessions[tab_id] = session.id

        # Get live debug URLs
        try:
            debug = bb.sessions.debug(session.id)
            if debug.debugger_fullscreen_url:
                self._live_urls[tab_id] = debug.debugger_fullscreen_url
        except Exception as e:
            logger.warning("Failed to get live URL for session %s: %s", session.id, e)

        return session.connect_url

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def open_tab(self, tab_id: str, url: str = "about:blank") -> dict:
        """Create a new browser tab. Returns {url, title}."""
        async with self._global_lock:
            if len(self._pages) >= MAX_BROWSER_TABS:
                raise RuntimeError(f"Maximum browser tabs ({MAX_BROWSER_TABS}) reached")

            await self._ensure_playwright()

            if self.is_cloud:
                connect_url = await self._create_bb_session(tab_id)
                browser = await self._playwright.chromium.connect_over_cdp(connect_url)
                self._browsers_cdp[tab_id] = browser
                # Browserbase gives us one default page
                contexts = browser.contexts
                if contexts and contexts[0].pages:
                    page = contexts[0].pages[0]
                else:
                    ctx = contexts[0] if contexts else await browser.new_context()
                    page = await ctx.new_page()
            else:
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
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            await page.click(selector, timeout=10000)
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
            return {"clicked": selector, "url": page.url, "title": await page.title()}

    async def type_text(self, tab_id: str, selector: str, text: str) -> dict:
        """Type text into an element."""
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            await page.fill(selector, text, timeout=10000)
            return {"filled": selector, "text": text}

    async def screenshot(self, tab_id: str) -> bytes:
        """Take a PNG screenshot of the tab."""
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            return await page.screenshot(type="png", full_page=False)

    async def snapshot(self, tab_id: str) -> str:
        """Get page content as a readable text snapshot."""
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

    async def close_tab(self, tab_id: str) -> None:
        """Close a browser tab."""
        page = self._pages.pop(tab_id, None)
        self._locks.pop(tab_id, None)
        session_id = self._sessions.pop(tab_id, None)
        self._live_urls.pop(tab_id, None)
        cdp_browser = self._browsers_cdp.pop(tab_id, None)

        if page:
            try:
                await page.close()
            except Exception:
                pass

        if cdp_browser:
            try:
                await cdp_browser.close()
            except Exception:
                pass

        # Stop Browserbase session
        if session_id and self.is_cloud:
            try:
                bb = self._bb_client()
                bb.sessions.update(session_id, status="REQUEST_RELEASE")
            except Exception as e:
                logger.warning("Failed to release BB session %s: %s", session_id, e)

    async def shutdown(self) -> None:
        """Close all tabs and the browser."""
        for tab_id in list(self._pages.keys()):
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
    # Accessors
    # ------------------------------------------------------------------

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
        """Return the Browserbase live view URL if available."""
        return self._live_urls.get(tab_id)

    def get_session_id(self, tab_id: str) -> Optional[str]:
        """Return the Browserbase session ID for a tab."""
        return self._sessions.get(tab_id)

    def active_tab_count(self) -> int:
        return len(self._pages)
