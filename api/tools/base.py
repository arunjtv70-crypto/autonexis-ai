"""
Base definitions, caching, rate limiting, circuit breaker, and result structures
for AUTONEXIS live data tools.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import httpx

# User-Agent strictly compliant with Nominatim, Open-Meteo, and public service policies
AUTONEXIS_USER_AGENT = os.environ.get(
    "TOOL_USER_AGENT", "AUTONEXISAssistant/1.0 (contact: support@autonexis.com)"
)

DEFAULT_TOOL_TIMEOUT = 4.0  # seconds


@dataclass
class ToolResult:
    """Standardized response from any AUTONEXIS tool."""
    ok: bool
    data: Any
    source: str
    fetched_at: str
    ttl: int
    error: Optional[str] = None
    attribution: Optional[str] = None
    attribution_url: Optional[str] = None
    cached: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class InMemoryTTLCache:
    """
    In-memory TTL cache with optional shared Upstash Redis REST fallback.
    Thread-safe and async-safe.
    """

    def __init__(self) -> None:
        self._store: Dict[str, Tuple[Any, float]] = {}
        self._lock = asyncio.Lock()
        self._upstash_url = (os.environ.get("UPSTASH_REDIS_REST_URL") or "").strip().rstrip("/")
        self._upstash_token = (os.environ.get("UPSTASH_REDIS_REST_TOKEN") or "").strip()

    async def get(self, key: str) -> Optional[Any]:
        now = time.time()
        # 1. Check local in-memory store
        async with self._lock:
            if key in self._store:
                val, exp = self._store[key]
                if now < exp:
                    return val
                else:
                    del self._store[key]

        # 2. Check Upstash Redis REST if configured
        if self._upstash_url and self._upstash_token:
            try:
                async with httpx.AsyncClient(timeout=1.5) as client:
                    resp = await client.get(
                        f"{self._upstash_url}/get/{key}",
                        headers={"Authorization": f"Bearer {self._upstash_token}"},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        result = data.get("result")
                        if result is not None:
                            # Cache locally for 30s
                            async with self._lock:
                                self._store[key] = (result, now + 30)
                            return result
            except Exception:
                pass  # Graceful fallback: do not break tool if Upstash unreachable

        return None

    async def set(self, key: str, value: Any, ttl: int) -> None:
        now = time.time()
        exp = now + max(1, ttl)
        async with self._lock:
            self._store[key] = (value, exp)

        # Write through to Upstash Redis REST if configured
        if self._upstash_url and self._upstash_token:
            try:
                import json
                serialized = json.dumps(value) if not isinstance(value, str) else value
                async with httpx.AsyncClient(timeout=1.5) as client:
                    await client.post(
                        f"{self._upstash_url}/set/{key}?ex={max(1, ttl)}",
                        headers={"Authorization": f"Bearer {self._upstash_token}"},
                        content=serialized,
                    )
            except Exception:
                pass

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._store.clear()


class TokenBucketLimiter:
    """
    Per-service / per-user token bucket rate limiter.
    """

    def __init__(self, capacity: float, refill_rate: float) -> None:
        self.capacity = float(capacity)
        self.refill_rate = float(refill_rate)  # tokens per second
        self.tokens = float(capacity)
        self.last_refill = time.time()
        self._lock = asyncio.Lock()

    async def acquire(self, cost: float = 1.0) -> bool:
        async with self._lock:
            now = time.time()
            elapsed = now - self.last_refill
            self.last_refill = now
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)

            if self.tokens >= cost:
                self.tokens -= cost
                return True
            return False


class CircuitBreaker:
    """
    Stops pounding upstream public APIs when consecutive failures occur.
    Transitions: CLOSED -> OPEN (cooldown) -> HALF_OPEN (test request) -> CLOSED.
    """

    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 30.0) -> None:
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.consecutive_failures = 0
        self.state = "CLOSED"  # "CLOSED", "OPEN", "HALF_OPEN"
        self.opened_at = 0.0
        self._lock = asyncio.Lock()

    async def is_available(self) -> bool:
        async with self._lock:
            if self.state == "CLOSED":
                return True
            now = time.time()
            if self.state == "OPEN":
                if now - self.opened_at >= self.recovery_timeout:
                    self.state = "HALF_OPEN"
                    return True
                return False
            # HALF_OPEN allows one test probe
            return True

    async def record_success(self) -> None:
        async with self._lock:
            self.consecutive_failures = 0
            self.state = "CLOSED"

    async def record_failure(self, retry_after: Optional[float] = None) -> None:
        async with self._lock:
            self.consecutive_failures += 1
            if self.consecutive_failures >= self.failure_threshold or retry_after:
                self.state = "OPEN"
                self.opened_at = time.time()
                if retry_after and retry_after > 0:
                    self.recovery_timeout = max(self.recovery_timeout, float(retry_after))


def is_tool_enabled(tool_name: str) -> bool:
    """
    Checks kill-switch TOOL_<NAME>_ENABLED from environment.
    Defaults to True (enabled). Set TOOL_<NAME>_ENABLED=false to shut off without code change.
    """
    env_var = f"TOOL_{tool_name.strip().upper()}_ENABLED"
    val = os.environ.get(env_var)
    if val is None:
        return True
    return val.strip().lower() in ("1", "true", "yes", "on")


def current_iso_time() -> str:
    """Current UTC timestamp in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()
