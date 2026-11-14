"""
Stocks (Beta) Tool behind a provider adapter.
Supports NSE/BSE tickers (.NS, .BO), delayed quotes, basic metrics, lazy import,
and strict non-advisory compliance ("delayed, not investment advice").
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional
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

# Common Indian companies and indices to standard Yahoo Finance symbols
INDIAN_COMPANY_TICKERS: Dict[str, str] = {
    "reliance": "RELIANCE.NS",
    "ril": "RELIANCE.NS",
    "tcs": "TCS.NS",
    "tata consultancy": "TCS.NS",
    "infosys": "INFY.NS",
    "infy": "INFY.NS",
    "tata motors": "TATAMOTORS.NS",
    "hdfc": "HDFCBANK.NS",
    "hdfc bank": "HDFCBANK.NS",
    "icici": "ICICIBANK.NS",
    "icici bank": "ICICIBANK.NS",
    "sbi": "SBIN.NS",
    "state bank of india": "SBIN.NS",
    "nifty": "^NSEI",
    "nifty 50": "^NSEI",
    "sensex": "^BSESN",
    "bse sensex": "^BSESN",
    "itc": "ITC.NS",
    "wipro": "WIPRO.NS",
    "airtel": "BHARTIARTL.NS",
    "bharti airtel": "BHARTIARTL.NS",
    "l&t": "LT.NS",
    "larsen & toubro": "LT.NS",
    "adani enterprises": "ADANIENT.NS",
    "adani ports": "ADANIPORTS.NS",
    "maruti": "MARUTI.NS",
    "maruti suzuki": "MARUTI.NS",
    "bajaj finance": "BAJFINANCE.NS",
    "zomato": "ZOMATO.NS",
    "paytm": "PAYTM.NS",
    "tata steel": "TATASTEEL.NS",
    # Global Tech
    "apple": "AAPL",
    "microsoft": "MSFT",
    "google": "GOOGL",
    "alphabet": "GOOGL",
    "amazon": "AMZN",
    "tesla": "TSLA",
    "meta": "META",
    "facebook": "META",
    "nvidia": "NVDA",
}


def resolve_stock_symbol(query: str) -> str:
    cleaned = (query or "").strip().lower()
    # Check alias dictionary
    if cleaned in INDIAN_COMPANY_TICKERS:
        return INDIAN_COMPANY_TICKERS[cleaned]

    for name, sym in INDIAN_COMPANY_TICKERS.items():
        if name in cleaned or cleaned in name:
            return sym

    upper = query.strip().upper()
    # If already formatted with exchange suffix (e.g. .NS, .BO) or index prefix (^)
    if upper.endswith(".NS") or upper.endswith(".BO") or upper.startswith("^"):
        return upper

    # Default Indian equities to .NS if purely alphabetic and not recognized as US ticker
    us_majors = {"AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "NFLX", "AMD", "INTC"}
    if upper in us_majors:
        return upper

    return f"{upper}.NS"


class BaseStocksAdapter:
    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        raise NotImplementedError


class DirectYahooStocksAdapter(BaseStocksAdapter):
    """
    Lightweight HTTP adapter querying Yahoo Finance chart API directly.
    Zero pandas/numpy dependencies, ~200ms latency, zero cold-start bundle penalty.
    """

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        params = {"interval": "1d", "range": "5d"}

        async with httpx.AsyncClient(timeout=DEFAULT_TOOL_TIMEOUT, headers=headers) as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 429:
                raise RuntimeError("Stock service rate limit reached (HTTP 429)")
            if resp.status_code != 200:
                raise RuntimeError(f"Stock quote service returned HTTP {resp.status_code}")

            data = resp.json()
            chart = data.get("chart") or {}
            results = chart.get("result") or []
            if not results:
                err = chart.get("error") or {}
                raise ValueError(err.get("description", f"Symbol '{symbol}' not found."))

            meta = results[0].get("meta") or {}
            curr_price = meta.get("regularMarketPrice")
            prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
            currency = meta.get("currency", "INR" if symbol.endswith(".NS") or symbol.endswith(".BO") else "USD")

            change = None
            change_percent = None
            if curr_price is not None and prev_close is not None and prev_close > 0:
                change = round(curr_price - prev_close, 2)
                change_percent = round((change / prev_close) * 100.0, 2)

            return {
                "symbol": symbol,
                "company_name": meta.get("shortName") or symbol,
                "current_price": curr_price,
                "currency": currency,
                "change": change,
                "change_percent": change_percent,
                "previous_close": prev_close,
                "day_high": meta.get("regularMarketDayHigh"),
                "day_low": meta.get("regularMarketDayLow"),
                "52_week_high": meta.get("fiftyTwoWeekHigh"),
                "52_week_low": meta.get("fiftyTwoWeekLow"),
                "exchange": meta.get("exchangeName"),
                "delayed": True,
                "disclaimer": "Delayed data (approx. 15 mins). For informational purposes only, not investment advice. Never give buy or sell recommendations.",
            }


class YFinanceStocksAdapter(BaseStocksAdapter):
    """
    Adapter using yfinance library (imported lazily inside get_quote only).
    Note: yfinance brings in pandas & numpy (~75MB bundle).
    """

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        try:
            import yfinance as yf
        except ImportError:
            # Fall back to lightweight DirectYahoo adapter if yfinance not installed
            direct = DirectYahooStocksAdapter()
            return await direct.get_quote(symbol)

        import asyncio

        def _sync_fetch() -> Dict[str, Any]:
            ticker = yf.Ticker(symbol)
            fast_info = getattr(ticker, "fast_info", None)
            if fast_info:
                curr_price = getattr(fast_info, "last_price", None)
                prev_close = getattr(fast_info, "previous_close", None)
                currency = getattr(fast_info, "currency", "INR")
                day_high = getattr(fast_info, "day_high", None)
                day_low = getattr(fast_info, "day_low", None)
                year_high = getattr(fast_info, "year_high", None)
                year_low = getattr(fast_info, "year_low", None)
            else:
                info = ticker.info or {}
                curr_price = info.get("regularMarketPrice") or info.get("currentPrice")
                prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")
                currency = info.get("currency", "INR")
                day_high = info.get("regularMarketDayHigh")
                day_low = info.get("regularMarketDayLow")
                year_high = info.get("fiftyTwoWeekHigh")
                year_low = info.get("fiftyTwoWeekLow")

            change = None
            change_percent = None
            if curr_price is not None and prev_close is not None and prev_close > 0:
                change = round(curr_price - prev_close, 2)
                change_percent = round((change / prev_close) * 100.0, 2)

            return {
                "symbol": symbol,
                "company_name": symbol,
                "current_price": curr_price,
                "currency": currency,
                "change": change,
                "change_percent": change_percent,
                "previous_close": prev_close,
                "day_high": day_high,
                "day_low": day_low,
                "52_week_high": year_high,
                "52_week_low": year_low,
                "delayed": True,
                "disclaimer": "Delayed data (approx. 15 mins). For informational purposes only, not investment advice. Never give buy or sell recommendations.",
            }

        return await asyncio.to_thread(_sync_fetch)


# Module singletons
_stocks_cache = InMemoryTTLCache()
_stocks_limiter = TokenBucketLimiter(capacity=5.0, refill_rate=2.0)
_stocks_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
# Default adapter: lightweight HTTP adapter for fast execution and zero cold-start penalty
_default_stocks_adapter = DirectYahooStocksAdapter()


async def execute_stocks_tool(
    ticker_or_company: str,
    adapter: Optional[BaseStocksAdapter] = None,
) -> ToolResult:
    """
    Main entry point for Stocks (Beta) Tool.
    Uses 5-minute caching and strict non-advisory disclaimer.
    """
    if not is_tool_enabled("stocks"):
        return ToolResult(
            ok=False,
            data=None,
            source="Yahoo Finance (Unofficial/Beta)",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Stocks tool is currently disabled by system configuration.",
        )

    clean_query = (ticker_or_company or "").strip()
    if not clean_query:
        return ToolResult(
            ok=False,
            data=None,
            source="Yahoo Finance (Unofficial/Beta)",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Stock symbol or company name is required.",
        )

    symbol = resolve_stock_symbol(clean_query)
    cache_key = f"stock:{symbol.lower()}"
    cached_val = await _stocks_cache.get(cache_key)
    if cached_val is not None:
        return ToolResult(
            ok=True,
            data=cached_val,
            source="Yahoo Finance (Unofficial/Beta)",
            fetched_at=current_iso_time(),
            ttl=300,
            attribution="Market data via Yahoo Finance (delayed 15 mins)",
            cached=True,
        )

    if not await _stocks_breaker.is_available():
        return ToolResult(
            ok=False,
            data=None,
            source="Yahoo Finance (Unofficial/Beta)",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Stock data service is temporarily unavailable (circuit open). Please try again shortly.",
        )

    if not await _stocks_limiter.acquire(1.0):
        return ToolResult(
            ok=False,
            data=None,
            source="Yahoo Finance (Unofficial/Beta)",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Stock quote rate limit reached. Please wait a moment.",
        )

    active_adapter = adapter or _default_stocks_adapter
    try:
        quote = await active_adapter.get_quote(symbol)
        await _stocks_breaker.record_success()
        await _stocks_cache.set(cache_key, quote, ttl=300)  # 5 mins

        return ToolResult(
            ok=True,
            data=quote,
            source="Yahoo Finance (Unofficial/Beta)",
            fetched_at=current_iso_time(),
            ttl=300,
            attribution="Market data via Yahoo Finance (delayed 15 mins)",
            cached=False,
        )
    except Exception as e:
        await _stocks_breaker.record_failure()
        return ToolResult(
            ok=False,
            data=None,
            source="Yahoo Finance (Unofficial/Beta)",
            fetched_at=current_iso_time(),
            ttl=0,
            error=f"Stock quote lookup failed for '{symbol}': {str(e)}",
            attribution="Market data via Yahoo Finance (delayed 15 mins)",
        )
