# -*- coding: utf-8 -*-
"""
Shared browser manager using Playwright.

Manages a single Chromium browser instance with multiple tabs (pages).
Each tab is identified by a unique ID and can be controlled via async methods.
"""

import asyncio
import json
import os
from typing import Optional

MAX_BROWSER_TABS = int(os.environ.get("MAX_BROWSER_TABS", "10"))


class BrowserManager:
    """Singleton managing a shared Playwright browser instance."""

    _instance: Optional["BrowserManager"] = None

    def __init__(self):
        self._playwright = None
        self._browser = None
        self._pages: dict = {}        # tab_id -> Page
        self._locks: dict = {}        # tab_id -> asyncio.Lock
        self._global_lock = asyncio.Lock()

    @classmethod
    def get(cls) -> "BrowserManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def _ensure_browser(self):
        """Lazy-initialize Playwright + Chromium."""
        if self._browser and self._browser.is_connected():
            return
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )

    def _get_lock(self, tab_id: str) -> asyncio.Lock:
        if tab_id not in self._locks:
            self._locks[tab_id] = asyncio.Lock()
        return self._locks[tab_id]

    async def open_tab(self, tab_id: str, url: str = "about:blank") -> dict:
        """Create a new browser tab. Returns {url, title}."""
        async with self._global_lock:
            if len(self._pages) >= MAX_BROWSER_TABS:
                raise RuntimeError(f"Maximum browser tabs ({MAX_BROWSER_TABS}) reached")
            await self._ensure_browser()
            page = await self._browser.new_page()
            self._pages[tab_id] = page

        if url and url != "about:blank":
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                pass  # Page may still be usable even if load times out

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
        """Get the accessibility tree as formatted text."""
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            tree = await page.accessibility.snapshot()
            if not tree:
                return "(empty page)"
            return _format_a11y_tree(tree)

    async def close_tab(self, tab_id: str) -> None:
        """Close a browser tab."""
        page = self._pages.pop(tab_id, None)
        self._locks.pop(tab_id, None)
        if page:
            try:
                await page.close()
            except Exception:
                pass

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

    def _get_page(self, tab_id: str):
        page = self._pages.get(tab_id)
        if not page:
            raise KeyError(f"Browser tab not found: {tab_id}")
        return page

    def active_tab_count(self) -> int:
        return len(self._pages)


def _format_a11y_tree(node: dict, indent: int = 0) -> str:
    """Format an accessibility tree node into readable indented text."""
    lines = []
    role = node.get("role", "")
    name = node.get("name", "")
    value = node.get("value", "")

    parts = [role]
    if name:
        parts.append(f'"{name}"')
    if value:
        parts.append(f'value="{value}"')

    line = "  " * indent + " ".join(parts)
    lines.append(line)

    for child in node.get("children", []):
        lines.append(_format_a11y_tree(child, indent + 1))

    return "\n".join(lines)
