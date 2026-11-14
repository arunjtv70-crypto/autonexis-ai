"""
Currency conversion tool using Frankfurter API (ECB reference rates).
Converts amounts, handles fallbacks, enforces 1-hour caching, and states honest limitations (no crypto/unsupported fiat).
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional, Set
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

# Standard European Central Bank tracked currency codes
ECB_SUPPORTED_CURRENCIES: Set[str] = {
    "EUR", "USD", "JPY", "BGN", "CZK", "DKK", "GBP", "HUF", "PLN",
    "RON", "SEK", "CHF", "ISK", "NOK", "TRY", "AUD", "BRL", "CAD",
    "CNY", "HKD", "IDR", "ILS", "INR", "KRW", "MXN", "MYR", "NZD",
    "PHP", "SGD", "THB", "ZAR",
}

# Common currency synonyms and colloquial symbols
CURRENCY_ALIASES: Dict[str, str] = {
    "$": "USD",
    "dollar": "USD",
    "dollars": "USD",
    "us dollar": "USD",
    "usd": "USD",
    "₹": "INR",
    "rupee": "INR",
    "rupees": "INR",
    "rupaye": "INR",
    "rupayee": "INR",
    "inr": "INR",
    "€": "EUR",
    "euro": "EUR",
    "euros": "EUR",
    "eur": "EUR",
    "£": "GBP",
    "pound": "GBP",
    "pounds": "GBP",
    "gbp": "GBP",
    "yen": "JPY",
    "jpy": "JPY",
    "aud": "AUD",
    "cad": "CAD",
    "chf": "CHF",
    "cny": "CNY",
    "yuan": "CNY",
    "sgd": "SGD",
    "aed": "AED",
    "dirham": "AED",
    "sar": "SAR",
    "riyal": "SAR",
}

# Cryptocurrencies explicitly unsupported by ECB daily reference rates
KNOWN_CRYPTOCURRENCIES: Set[str] = {
    "BTC", "BITCOIN", "ETH", "ETHEREUM", "SOL", "SOLANA", "USDT", "TETHER",
    "DOGE", "DOGECOIN", "BNB", "XRP", "RIPPLE", "ADA", "CARDANO", "LTC", "SHIB",
}


def normalize_currency_code(code_or_name: str) -> str:
    cleaned = (code_or_name or "").strip().lower()
    if cleaned in CURRENCY_ALIASES:
        return CURRENCY_ALIASES[cleaned]
    return cleaned.upper()


class BaseCurrencyAdapter:
    async def convert(self, amount: float, from_curr: str, to_curr: str) -> Dict[str, Any]:
        raise NotImplementedError


class FrankfurterCurrencyAdapter(BaseCurrencyAdapter):
    """
    Adapter for Frankfurter API.
    Uses https://api.frankfurter.dev/v1 with https://api.frankfurter.app fallback.
    """

    def __init__(self) -> None:
        self.primary_base_url = "https://api.frankfurter.dev/v1"
        self.fallback_base_url = "https://api.frankfurter.app"

    async def _fetch_from_endpoint(
        self, base_url: str, amount: float, from_curr: str, to_curr: str
    ) -> Dict[str, Any]:
        url = f"{base_url}/latest"
        headers = {"User-Agent": AUTONEXIS_USER_AGENT}
        params = {"amount": amount, "from": from_curr, "to": to_curr}

        async with httpx.AsyncClient(timeout=DEFAULT_TOOL_TIMEOUT, headers=headers) as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 429:
                raise RuntimeError("Currency service rate limit reached (HTTP 429)")
            if resp.status_code != 200:
                raise RuntimeError(f"Currency endpoint {base_url} returned HTTP {resp.status_code}")
            return resp.json()

    async def convert(self, amount: float, from_curr: str, to_curr: str) -> Dict[str, Any]:
        # Try primary endpoint first
        try:
            return await self._fetch_from_endpoint(self.primary_base_url, amount, from_curr, to_curr)
        except Exception:
            # Fall back to backup endpoint
            return await self._fetch_from_endpoint(self.fallback_base_url, amount, from_curr, to_curr)


# Module singletons
_currency_cache = InMemoryTTLCache()
_currency_limiter = TokenBucketLimiter(capacity=10.0, refill_rate=5.0)
_currency_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
_default_currency_adapter = FrankfurterCurrencyAdapter()


async def execute_currency_tool(
    amount: float = 1.0,
    from_currency: str = "USD",
    to_currency: str = "INR",
    adapter: Optional[BaseCurrencyAdapter] = None,
) -> ToolResult:
    """
    Main entry point for Currency Conversion Tool.
    Converts amounts using official ECB reference rates with 1-hour caching.
    """
    if not is_tool_enabled("currency"):
        return ToolResult(
            ok=False,
            data=None,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Currency tool is currently disabled by system configuration.",
        )

    norm_from = normalize_currency_code(from_currency)
    norm_to = normalize_currency_code(to_currency)

    # 1. Honest reporting for cryptocurrencies
    if norm_from in KNOWN_CRYPTOCURRENCIES or norm_to in KNOWN_CRYPTOCURRENCIES:
        return ToolResult(
            ok=False,
            data=None,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=0,
            error=(
                f"Cryptocurrency rates ({norm_from if norm_from in KNOWN_CRYPTOCURRENCIES else norm_to}) "
                "are not tracked by European Central Bank daily reference rates."
            ),
            attribution="Reference rates from European Central Bank via Frankfurter",
            attribution_url="https://www.frankfurter.app",
        )

    # 2. Honest reporting for unsupported fiat currencies
    if norm_from not in ECB_SUPPORTED_CURRENCIES:
        return ToolResult(
            ok=False,
            data=None,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=0,
            error=f"Currency '{norm_from}' is not published in European Central Bank reference tables.",
            attribution="Reference rates from European Central Bank via Frankfurter",
            attribution_url="https://www.frankfurter.app",
        )

    if norm_to not in ECB_SUPPORTED_CURRENCIES:
        return ToolResult(
            ok=False,
            data=None,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=0,
            error=f"Currency '{norm_to}' is not published in European Central Bank reference tables.",
            attribution="Reference rates from European Central Bank via Frankfurter",
            attribution_url="https://www.frankfurter.app",
        )

    # Self-conversion identity
    if norm_from == norm_to:
        return ToolResult(
            ok=True,
            data={
                "amount": amount,
                "from_currency": norm_from,
                "to_currency": norm_to,
                "rate": 1.0,
                "converted_amount": float(amount),
                "rate_date": current_iso_time()[:10],
                "disclaimer": "Identical currency conversion.",
            },
            source="Identity",
            fetched_at=current_iso_time(),
            ttl=86400,
        )

    cache_key = f"currency:{norm_from}:{norm_to}:{amount}"
    cached_val = await _currency_cache.get(cache_key)
    if cached_val is not None:
        return ToolResult(
            ok=True,
            data=cached_val,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=3600,
            attribution="Reference rates from European Central Bank via Frankfurter",
            attribution_url="https://www.frankfurter.app",
            cached=True,
        )

    if not await _currency_breaker.is_available():
        return ToolResult(
            ok=False,
            data=None,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Currency reference service is temporarily unavailable (circuit open). Please try again shortly.",
        )

    if not await _currency_limiter.acquire(1.0):
        return ToolResult(
            ok=False,
            data=None,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Currency rate limit reached. Please wait a moment.",
        )

    active_adapter = adapter or _default_currency_adapter
    try:
        raw_res = await active_adapter.convert(amount, norm_from, norm_to)
        rates = raw_res.get("rates") or {}
        converted_amt = rates.get(norm_to)
        unit_rate = (converted_amt / amount) if amount else converted_amt
        rate_date = raw_res.get("date") or current_iso_time()[:10]

        result_data = {
            "amount": amount,
            "from_currency": norm_from,
            "to_currency": norm_to,
            "rate": unit_rate,
            "converted_amount": converted_amt,
            "rate_date": rate_date,
            "disclaimer": "Daily reference rates published by the European Central Bank (ECB), not live trading rates.",
        }

        await _currency_breaker.record_success()
        await _currency_cache.set(cache_key, result_data, ttl=3600)  # 1 hour

        return ToolResult(
            ok=True,
            data=result_data,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=3600,
            attribution="Reference rates from European Central Bank via Frankfurter",
            attribution_url="https://www.frankfurter.app",
            cached=False,
        )
    except Exception as e:
        await _currency_breaker.record_failure()
        return ToolResult(
            ok=False,
            data=None,
            source="Frankfurter (ECB)",
            fetched_at=current_iso_time(),
            ttl=0,
            error=f"Currency conversion failed: {str(e)}",
            attribution="Reference rates from European Central Bank via Frankfurter",
            attribution_url="https://www.frankfurter.app",
        )
