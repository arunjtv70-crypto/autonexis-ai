"""
Web search tool wrapping Tavily as primary and optional DuckDuckGo (ddgs) as fallback.
Strictly respects TOOL_DDGS_FALLBACK_ENABLED (default OFF) due to unofficial status.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional
import httpx

from .base import (
    AUTONEXIS_USER_AGENT,
    CircuitBreaker,
    DEFAULT_TOOL_TIMEOUT,
    InMemoryTTLCache,
    TokenBucketLimiter,
    ToolResult,
    current_iso_time,
    is_tool_enabled,
)


class BaseWebSearchAdapter:
    async def search(self, query: str, max_results: int = 4) -> Dict[str, Any]:
        raise NotImplementedError


class TavilySearchAdapter(BaseWebSearchAdapter):
    """Primary commercial web search adapter via Tavily API."""

    def __init__(self) -> None:
        self.api_key = (
            os.environ.get("TAVILY_API_KEY")
            or os.environ.get("SEARCH_API_KEY")
            or ""
        ).strip()

    async def search(self, query: str, max_results: int = 4) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("Tavily API key is not configured.")

        clean_q = (query or "").strip()[:300]
        if not clean_q:
            raise ValueError("Search query cannot be empty.")

        async with httpx.AsyncClient(timeout=DEFAULT_TOOL_TIMEOUT) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": self.api_key,
                    "query": clean_q,
                    "search_depth": "basic",
                    "max_results": max_results,
                    "include_answer": True,
                },
            )
            if resp.status_code == 429:
                raise RuntimeError("Tavily search rate limit reached (HTTP 429)")
            if resp.status_code != 200:
                raise RuntimeError(f"Tavily returned HTTP {resp.status_code}")

            data = resp.json()
            answer = (data.get("answer") or "").strip()
            results = data.get("results") or []
            snippets: List[Dict[str, str]] = []
            for r in results[:max_results]:
                snippets.append({
                    "title": str(r.get("title") or "").strip(),
                    "url": str(r.get("url") or "").strip(),
                    "content": str(r.get("content") or "").strip()[:350],
                })

            return {
                "query": clean_q,
                "answer": answer,
                "results": snippets,
                "provider": "Tavily",
            }


class DuckDuckGoSearchAdapter(BaseWebSearchAdapter):
    """
    Unofficial DuckDuckGo search fallback.
    OFF by default. Enabled only if TOOL_DDGS_FALLBACK_ENABLED=true.
    Warning: Unofficial scraper subject to IP blocking on cloud infrastructure.
    """

    async def search(self, query: str, max_results: int = 4) -> Dict[str, Any]:
        flag = os.environ.get("TOOL_DDGS_FALLBACK_ENABLED", "false").strip().lower()
        if flag not in ("1", "true", "yes", "on"):
            raise ValueError("DuckDuckGo fallback search is disabled by system policy.")

        try:
            from duckduckgo_search import DDGS
        except ImportError:
            raise ValueError("duckduckgo_search library is not installed.")

        import asyncio

        def _sync_ddgs() -> Dict[str, Any]:
            with DDGS() as ddgs:
                results = list(ddgs.text(query.strip()[:300], max_results=max_results))
                snippets: List[Dict[str, str]] = []
                for r in results:
                    snippets.append({
                        "title": str(r.get("title") or "").strip(),
                        "url": str(r.get("href") or "").strip(),
                        "content": str(r.get("body") or "").strip()[:350],
                    })
                return {
                    "query": query.strip(),
                    "answer": "",
                    "results": snippets,
                    "provider": "DuckDuckGo (Unofficial)",
                }

        return await asyncio.to_thread(_sync_ddgs)


# Module singletons
_search_cache = InMemoryTTLCache()
_search_limiter = TokenBucketLimiter(capacity=10.0, refill_rate=5.0)
_search_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
_default_tavily_adapter = TavilySearchAdapter()
_default_ddgs_adapter = DuckDuckGoSearchAdapter()


async def execute_web_search_tool(
    query: str,
    max_results: int = 4,
    adapter: Optional[BaseWebSearchAdapter] = None,
) -> ToolResult:
    """
    Main entry point for Web Search Tool.
    Uses Tavily as primary, optional DDGS as fallback when enabled.
    """
    if not is_tool_enabled("web_search"):
        return ToolResult(
            ok=False,
            data=None,
            source="Web Search",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Web search tool is currently disabled by system configuration.",
        )

    clean_query = (query or "").strip()
    if not clean_query:
        return ToolResult(
            ok=False,
            data=None,
            source="Web Search",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Search query cannot be empty.",
        )

    cache_key = f"search:{clean_query.lower()}:{max_results}"
    cached_val = await _search_cache.get(cache_key)
    if cached_val is not None:
        return ToolResult(
            ok=True,
            data=cached_val,
            source=cached_val.get("provider", "Tavily"),
            fetched_at=current_iso_time(),
            ttl=900,
            attribution="Web search results via Tavily",
            cached=True,
        )

    if not await _search_breaker.is_available():
        return ToolResult(
            ok=False,
            data=None,
            source="Web Search",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Web search service is temporarily unavailable (circuit open).",
        )

    if not await _search_limiter.acquire(1.0):
        return ToolResult(
            ok=False,
            data=None,
            source="Web Search",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Web search rate limit reached. Please wait a moment.",
        )

    # 1. Try Primary Adapter (Tavily)
    active_adapter = adapter or _default_tavily_adapter
    try:
        data = await active_adapter.search(clean_query, max_results=max_results)
        await _search_breaker.record_success()
        await _search_cache.set(cache_key, data, ttl=900)  # 15 mins
        return ToolResult(
            ok=True,
            data=data,
            source="Tavily",
            fetched_at=current_iso_time(),
            ttl=900,
            attribution="Web search results via Tavily",
            cached=False,
        )
    except Exception as primary_err:
        # 2. Try Fallback Adapter if DDGS fallback enabled
        ddgs_enabled = os.environ.get("TOOL_DDGS_FALLBACK_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
        if ddgs_enabled:
            try:
                data = await _default_ddgs_adapter.search(clean_query, max_results=max_results)
                await _search_breaker.record_success()
                await _search_cache.set(cache_key, data, ttl=900)
                return ToolResult(
                    ok=True,
                    data=data,
                    source="DuckDuckGo (Unofficial)",
                    fetched_at=current_iso_time(),
                    ttl=900,
                    attribution="Web search results via DuckDuckGo (Unofficial)",
                    cached=False,
                )
            except Exception as ddgs_err:
                await _search_breaker.record_failure()
                return ToolResult(
                    ok=False,
                    data=None,
                    source="Web Search",
                    fetched_at=current_iso_time(),
                    ttl=0,
                    error=f"Web search unavailable: {str(primary_err)}; fallback error: {str(ddgs_err)}",
                )

        await _search_breaker.record_failure()
        return ToolResult(
            ok=False,
            data=None,
            source="Web Search",
            fetched_at=current_iso_time(),
            ttl=0,
            error=f"Web search unavailable: {str(primary_err)}",
        )
