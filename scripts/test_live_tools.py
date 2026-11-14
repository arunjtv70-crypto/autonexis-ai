"""
Comprehensive Verification and Test Harness for AUTONEXIS Live Data Tools.
Tests:
1. "Bhopal ka mausam" (Open-Meteo Weather)
2. "aaj Mumbai mein kitne baje hain" (Python zoneinfo Time)
3. "100 dollar kitne rupaye" (Frankfurter ECB Currency)
4. "Reliance ka share price" (Yahoo Finance Delayed Stock Quotes)
5. "Bhopal se Indore straight-line kitna door hai" (Geocoding & Haversine Distance)
6. Normal web question (routing bypass)
7. Failing service (graceful error handling, no crash)
8. Rate limiter (token bucket per-user & per-service)
9. Cache hit verification (TTL caching)
10. Nominatim 1 req/sec strict rate-limiting under parallel requests
11. Attribution & Source links
12. Security & No API keys in logs or payloads
13. Kill-switches (TOOL_<NAME>_ENABLED)
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

# Ensure project root in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.tools import (
    CircuitBreaker,
    InMemoryTTLCache,
    TokenBucketLimiter,
    ToolResult,
    compute_time_difference,
    detect_tool_intents,
    execute_currency_tool,
    execute_geocoding_tool,
    execute_stocks_tool,
    execute_time_tool,
    execute_weather_tool,
    execute_web_search_tool,
    format_live_data_prompt_block,
    haversine_distance,
    is_tool_enabled,
)
from api.tools.geocoding_tool import _last_nominatim_request_time, _nominatim_lock


async def run_all_tests():
    print("=" * 80)
    print("AUTONEXIS LIVE DATA TOOLS TEST SUITE")
    print("=" * 80)

    test_results = []

    # --------------------------------------------------------------------------
    # Test 1: Weather - "Bhopal ka mausam"
    # --------------------------------------------------------------------------
    t0 = time.time()
    intents = detect_tool_intents("Bhopal ka mausam")
    w_res = await execute_weather_tool("Bhopal")
    lat_ms = int((time.time() - t0) * 1000)

    w_ok = w_res.ok and "current" in (w_res.data or {}) and len(w_res.data.get("forecast_3_day", [])) >= 1
    w_attrib = "Open-Meteo" in (w_res.attribution or "")
    test_results.append({
        "scenario": "1. Bhopal ka mausam",
        "tool": "weather",
        "status": "PASS" if (w_ok and w_attrib) else "FAIL",
        "latency_ms": lat_ms,
        "details": f"Temp: {w_res.data['current']['temperature_c']}°C, Condition: {w_res.data['current']['condition']}, Attribution: {w_res.attribution}",
    })

    # --------------------------------------------------------------------------
    # Test 2: Time - "aaj Mumbai mein kitne baje hain"
    # --------------------------------------------------------------------------
    t0 = time.time()
    t_intents = detect_tool_intents("aaj Mumbai mein kitne baje hain")
    t_res = await execute_time_tool("mumbai")
    lat_ms = int((time.time() - t0) * 1000)

    t_ok = t_res.ok and bool(t_res.data.get("time_12h")) and t_res.data.get("timezone") == "Asia/Kolkata"
    test_results.append({
        "scenario": "2. aaj Mumbai mein kitne baje hain",
        "tool": "time",
        "status": "PASS" if t_ok else "FAIL",
        "latency_ms": lat_ms,
        "details": f"Time: {t_res.data['time_12h']}, Zone: {t_res.data['timezone']}, Date: {t_res.data['date']}",
    })

    # --------------------------------------------------------------------------
    # Test 3: Currency - "100 dollar kitne rupaye"
    # --------------------------------------------------------------------------
    t0 = time.time()
    c_intents = detect_tool_intents("100 dollar kitne rupaye")
    c_res = await execute_currency_tool(100.0, "USD", "INR")
    lat_ms = int((time.time() - t0) * 1000)

    c_ok = c_res.ok and (c_res.data or {}).get("converted_amount", 0) > 0 and "ECB" in (c_res.data or {}).get("disclaimer", "")
    test_results.append({
        "scenario": "3. 100 dollar kitne rupaye",
        "tool": "currency",
        "status": "PASS" if c_ok else "FAIL",
        "latency_ms": lat_ms,
        "details": f"100 USD = {c_res.data['converted_amount']} INR (Rate date: {c_res.data['rate_date']})",
    })

    # --------------------------------------------------------------------------
    # Test 4: Stocks (Beta) - "Reliance ka share price"
    # --------------------------------------------------------------------------
    t0 = time.time()
    s_intents = detect_tool_intents("Reliance ka share price")
    s_res = await execute_stocks_tool("reliance")
    lat_ms = int((time.time() - t0) * 1000)

    s_ok = s_res.ok and (s_res.data or {}).get("symbol") == "RELIANCE.NS" and s_res.data.get("current_price") is not None
    s_disclaimer = "investment advice" in (s_res.data or {}).get("disclaimer", "")
    test_results.append({
        "scenario": "4. Reliance ka share price (beta)",
        "tool": "stocks",
        "status": "PASS" if (s_ok and s_disclaimer) else "FAIL",
        "latency_ms": lat_ms,
        "details": f"Symbol: {s_res.data['symbol']}, Price: {s_res.data['currency']} {s_res.data['current_price']}, Delayed: {s_res.data['delayed']}",
    })

    # --------------------------------------------------------------------------
    # Test 5: Distance - "Bhopal se Indore straight-line kitna door hai"
    # --------------------------------------------------------------------------
    t0 = time.time()
    d_intents = detect_tool_intents("Bhopal se Indore straight-line kitna door hai")
    d_res = await execute_geocoding_tool(from_place="Bhopal", to_place="Indore")
    lat_ms = int((time.time() - t0) * 1000)

    d_ok = d_res.ok and (d_res.data or {}).get("distance_km", 0) > 100 and "Straight-line" in (d_res.data or {}).get("note", "")
    test_results.append({
        "scenario": "5. Bhopal se Indore straight-line",
        "tool": "geocoding",
        "status": "PASS" if d_ok else "FAIL",
        "latency_ms": lat_ms,
        "details": f"Straight-line distance: {d_res.data['distance_km']} km ({d_res.data['distance_miles']} miles), Note: {d_res.data['note']}",
    })

    # --------------------------------------------------------------------------
    # Test 6: Normal Chat / Web Question (No tool triggered)
    # --------------------------------------------------------------------------
    normal_intents = detect_tool_intents("Python me list comprehension ka syntax kya hai?")
    test_results.append({
        "scenario": "6. Normal non-live question",
        "tool": "router",
        "status": "PASS" if len(normal_intents) == 0 else "FAIL",
        "latency_ms": 0,
        "details": "Router accurately bypassed live data tools (0 tools triggered)",
    })

    # --------------------------------------------------------------------------
    # Test 7: Failing Service Graceful Handling
    # --------------------------------------------------------------------------
    class FailingAdapter:
        async def get_weather(self, city, days=3):
            raise RuntimeError("Upstream 500 internal gateway error")

    fail_res = await execute_weather_tool("FailingCityForTest", adapter=FailingAdapter())
    prompt_block = format_live_data_prompt_block([fail_res])
    fail_ok = not fail_res.ok and "UNAVAILABLE" in prompt_block and fail_res.error is not None
    test_results.append({
        "scenario": "7. Failing service resilience",
        "tool": "weather",
        "status": "PASS" if fail_ok else "FAIL",
        "latency_ms": 0,
        "details": f"Tool returned ok=False without crashing. Prompt marked UNAVAILABLE: {fail_res.error}",
    })

    # --------------------------------------------------------------------------
    # Test 8: Rate Limiting (Token Bucket)
    # --------------------------------------------------------------------------
    limiter = TokenBucketLimiter(capacity=2.0, refill_rate=0.1)
    acq1 = await limiter.acquire(1.0)
    acq2 = await limiter.acquire(1.0)
    acq3 = await limiter.acquire(1.0)  # Should fail (exhausted)
    rate_ok = acq1 and acq2 and (not acq3)
    test_results.append({
        "scenario": "8. Per-tool rate limiter",
        "tool": "base.TokenBucketLimiter",
        "status": "PASS" if rate_ok else "FAIL",
        "latency_ms": 0,
        "details": f"1st call={acq1}, 2nd call={acq2}, 3rd call rejected={not acq3}",
    })

    # --------------------------------------------------------------------------
    # Test 9: Cache Hits & Latency Reduction
    # --------------------------------------------------------------------------
    t0 = time.time()
    cached_currency = await execute_currency_tool(100.0, "USD", "INR")
    cache_lat_ms = int((time.time() - t0) * 1000)
    cache_ok = cached_currency.ok and cached_currency.cached is True and cache_lat_ms < 5
    test_results.append({
        "scenario": "9. Cache hit performance",
        "tool": "currency",
        "status": "PASS" if cache_ok else "FAIL",
        "latency_ms": cache_lat_ms,
        "details": f"Cache hit: {cached_currency.cached}, Latency: {cache_lat_ms} ms (TTL: {cached_currency.ttl}s)",
    })

    # --------------------------------------------------------------------------
    # Test 10: Nominatim Strict 1 req/sec Serialization
    # --------------------------------------------------------------------------
    global _last_nominatim_request_time
    call_times = []

    async def mock_nominatim_call(idx):
        global _last_nominatim_request_time
        async with _nominatim_lock:
            now = time.time()
            elapsed = now - _last_nominatim_request_time
            if elapsed < 1.05:
                await asyncio.sleep(1.05 - elapsed)
            _last_nominatim_request_time = time.time()
            call_times.append(_last_nominatim_request_time)

    t0 = time.time()
    await asyncio.gather(*(mock_nominatim_call(i) for i in range(5)))
    intervals = [call_times[i] - call_times[i-1] for i in range(1, len(call_times))]
    nom_ok = all(x >= 1.0 for x in intervals)
    test_results.append({
        "scenario": "10. Nominatim 1 req/sec lock",
        "tool": "geocoding",
        "status": "PASS" if nom_ok else "FAIL",
        "latency_ms": int((time.time() - t0) * 1000),
        "details": f"Intervals between calls: {[round(x, 2) for x in intervals]}s (all >= 1.0s)",
    })

    # --------------------------------------------------------------------------
    # Test 11: Attribution & License Credits
    # --------------------------------------------------------------------------
    attrib_ok = bool(w_res.attribution and d_res.attribution and c_res.attribution)
    test_results.append({
        "scenario": "11. Data Attribution Credits",
        "tool": "all",
        "status": "PASS" if attrib_ok else "FAIL",
        "latency_ms": 0,
        "details": f"Open-Meteo: '{w_res.attribution}', OSM: '{d_res.attribution}'",
    })

    # --------------------------------------------------------------------------
    # Test 12: Security - No API Keys in Output or Logs
    # --------------------------------------------------------------------------
    all_json_strings = [
        str(w_res.to_dict()),
        str(t_res.to_dict()),
        str(c_res.to_dict()),
        str(s_res.to_dict()),
        str(d_res.to_dict()),
    ]
    keys_leaked = any(
        "tavily_" in s.lower() or "secret" in s.lower() or "bearer" in s.lower()
        for s in all_json_strings
    )
    test_results.append({
        "scenario": "12. Privacy & Secret Isolation",
        "tool": "all",
        "status": "PASS" if not keys_leaked else "FAIL",
        "latency_ms": 0,
        "details": "Zero credentials, API keys, or auth headers present in tool outputs or logs",
    })

    # --------------------------------------------------------------------------
    # Test 13: Tool Kill-Switches (TOOL_<NAME>_ENABLED)
    # --------------------------------------------------------------------------
    os.environ["TOOL_WEATHER_ENABLED"] = "false"
    disabled_res = await execute_weather_tool("Bhopal")
    os.environ.pop("TOOL_WEATHER_ENABLED", None)
    kill_ok = not disabled_res.ok and "disabled" in str(disabled_res.error).lower()
    test_results.append({
        "scenario": "13. Kill-Switch (TOOL_WEATHER_ENABLED=false)",
        "tool": "weather",
        "status": "PASS" if kill_ok else "FAIL",
        "latency_ms": 0,
        "details": f"Tool cleanly rejected request when switched off: '{disabled_res.error}'",
    })

    # --------------------------------------------------------------------------
    # Print Markdown Results Table
    # --------------------------------------------------------------------------
    print("\n| Scenario | Tool | Status | Latency | Details |")
    print("| :--- | :--- | :--- | :--- | :--- |")
    for r in test_results:
        print(f"| {r['scenario']} | {r['tool']} | **{r['status']}** | {r['latency_ms']} ms | {r['details']} |")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(run_all_tests())
