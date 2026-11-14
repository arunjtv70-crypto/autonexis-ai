"""
Weather tool using Open-Meteo forecast and geocoding APIs.
Provides current conditions, 3-day forecast, metric units, attribution, and commercial API key support.
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

# Open-Meteo WMO weather code mapping to clear human-readable descriptions
WMO_WEATHER_CODES: Dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    62: "Moderate rain",
    63: "Heavy rain",
    65: "Very heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def describe_weather_code(code: Optional[int]) -> str:
    if code is None:
        return "Unknown"
    return WMO_WEATHER_CODES.get(code, f"Weather code {code}")


class BaseWeatherAdapter:
    async def get_weather(self, city: str, days: int = 3) -> Dict[str, Any]:
        raise NotImplementedError


class OpenMeteoWeatherAdapter(BaseWeatherAdapter):
    """
    Adapter for Open-Meteo API.
    Notice: The free API tier is strictly for NON-COMMERCIAL use.
    For commercial use, set OPEN_METEO_API_KEY (and optional OPEN_METEO_BASE_URL).
    """

    def __init__(self) -> None:
        self.api_key = (os.environ.get("OPEN_METEO_API_KEY") or "").strip()
        custom_base = (os.environ.get("OPEN_METEO_BASE_URL") or "").strip().rstrip("/")
        if custom_base:
            self.forecast_base_url = custom_base
        elif self.api_key:
            self.forecast_base_url = "https://customer-api.open-meteo.com/v1/forecast"
        else:
            self.forecast_base_url = "https://api.open-meteo.com/v1/forecast"
        self.geocoding_base_url = "https://geocoding-api.open-meteo.com/v1/search"

    async def get_weather(self, city: str, days: int = 3) -> Dict[str, Any]:
        headers = {"User-Agent": AUTONEXIS_USER_AGENT}
        clean_city = city.strip()

        async with httpx.AsyncClient(timeout=DEFAULT_TOOL_TIMEOUT, headers=headers) as client:
            # Step 1: Geocode city name to lat/lon
            geo_params: Dict[str, Any] = {
                "name": clean_city,
                "count": 1,
                "language": "en",
                "format": "json",
            }
            if self.api_key:
                geo_params["apikey"] = self.api_key

            geo_res = await client.get(self.geocoding_base_url, params=geo_params)
            if geo_res.status_code == 429:
                raise RuntimeError("Weather rate limit reached (HTTP 429)")
            if geo_res.status_code != 200:
                raise RuntimeError(f"Geocoding service returned HTTP {geo_res.status_code}")

            geo_data = geo_res.json()
            results = geo_data.get("results") or []
            if not results:
                raise ValueError(f"Could not locate city '{clean_city}' for weather forecast.")

            place = results[0]
            lat = place["latitude"]
            lon = place["longitude"]
            place_name = place.get("name", clean_city)
            country = place.get("country", "")
            admin1 = place.get("admin1", "")

            # Step 2: Fetch current conditions + 3-day daily forecast
            forecast_params: Dict[str, Any] = {
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
                "timezone": "auto",
                "forecast_days": min(max(days, 1), 7),
            }
            if self.api_key:
                forecast_params["apikey"] = self.api_key

            forecast_res = await client.get(self.forecast_base_url, params=forecast_params)
            if forecast_res.status_code == 429:
                raise RuntimeError("Weather forecast service rate limit reached (HTTP 429)")
            if forecast_res.status_code != 200:
                raise RuntimeError(f"Weather forecast service returned HTTP {forecast_res.status_code}")

            data = forecast_res.json()
            curr = data.get("current") or {}
            daily = data.get("daily") or {}

            # Format 3-day forecast
            forecast_days: List[Dict[str, Any]] = []
            dates = daily.get("time") or []
            max_temps = daily.get("temperature_2m_max") or []
            min_temps = daily.get("temperature_2m_min") or []
            codes = daily.get("weather_code") or []
            precip_probs = daily.get("precipitation_probability_max") or []

            for i in range(min(len(dates), days)):
                code_i = codes[i] if i < len(codes) else None
                forecast_days.append({
                    "date": dates[i],
                    "condition": describe_weather_code(code_i),
                    "max_temp_c": max_temps[i] if i < len(max_temps) else None,
                    "min_temp_c": min_temps[i] if i < len(min_temps) else None,
                    "precipitation_prob_percent": precip_probs[i] if i < len(precip_probs) else 0,
                })

            curr_code = curr.get("weather_code")
            return {
                "location": {
                    "city": place_name,
                    "admin1": admin1,
                    "country": country,
                    "latitude": lat,
                    "longitude": lon,
                    "timezone": data.get("timezone", "auto"),
                },
                "current": {
                    "temperature_c": curr.get("temperature_2m"),
                    "feels_like_c": curr.get("apparent_temperature"),
                    "condition": describe_weather_code(curr_code),
                    "humidity_percent": curr.get("relative_humidity_2m"),
                    "wind_speed_kmh": curr.get("wind_speed_10m"),
                    "wind_direction_deg": curr.get("wind_direction_10m"),
                    "precipitation_mm": curr.get("precipitation", 0.0),
                    "is_day": bool(curr.get("is_day", 1)),
                    "observed_time": curr.get("time"),
                },
                "forecast_3_day": forecast_days,
                "units": {
                    "temperature": "°C",
                    "wind_speed": "km/h",
                    "precipitation": "mm",
                },
                "commercial_tier": bool(self.api_key),
            }


# Module singletons
_weather_cache = InMemoryTTLCache()
_weather_limiter = TokenBucketLimiter(capacity=10.0, refill_rate=5.0)
_weather_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
_default_weather_adapter = OpenMeteoWeatherAdapter()


async def execute_weather_tool(
    city: str,
    days: int = 3,
    adapter: Optional[BaseWeatherAdapter] = None,
) -> ToolResult:
    """
    Main entry point for Weather Tool.
    Uses 10-minute caching, token-bucket limiter, and circuit breaker.
    """
    if not is_tool_enabled("weather"):
        return ToolResult(
            ok=False,
            data=None,
            source="Open-Meteo",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Weather tool is currently disabled by system configuration.",
        )

    clean_city = (city or "").strip()
    if not clean_city:
        return ToolResult(
            ok=False,
            data=None,
            source="Open-Meteo",
            fetched_at=current_iso_time(),
            ttl=0,
            error="City name is required for weather inquiry.",
        )

    cache_key = f"weather:{clean_city.lower()}:{days}"
    cached_val = await _weather_cache.get(cache_key)
    if cached_val is not None:
        return ToolResult(
            ok=True,
            data=cached_val,
            source="Open-Meteo",
            fetched_at=current_iso_time(),
            ttl=600,
            attribution="Weather data by Open-Meteo.com",
            attribution_url="https://open-meteo.com/",
            cached=True,
        )

    if not await _weather_breaker.is_available():
        return ToolResult(
            ok=False,
            data=None,
            source="Open-Meteo",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Weather service is temporarily unavailable (circuit open). Please try again shortly.",
        )

    if not await _weather_limiter.acquire(1.0):
        return ToolResult(
            ok=False,
            data=None,
            source="Open-Meteo",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Weather rate limit reached. Please wait a moment.",
        )

    active_adapter = adapter or _default_weather_adapter
    try:
        weather_data = await active_adapter.get_weather(clean_city, days=days)
        await _weather_breaker.record_success()
        await _weather_cache.set(cache_key, weather_data, ttl=600)  # 10 mins

        return ToolResult(
            ok=True,
            data=weather_data,
            source="Open-Meteo",
            fetched_at=current_iso_time(),
            ttl=600,
            attribution="Weather data by Open-Meteo.com",
            attribution_url="https://open-meteo.com/",
            cached=False,
        )
    except Exception as e:
        await _weather_breaker.record_failure()
        return ToolResult(
            ok=False,
            data=None,
            source="Open-Meteo",
            fetched_at=current_iso_time(),
            ttl=0,
            error=f"Weather lookup error: {str(e)}",
            attribution="Weather data by Open-Meteo.com",
            attribution_url="https://open-meteo.com/",
        )
