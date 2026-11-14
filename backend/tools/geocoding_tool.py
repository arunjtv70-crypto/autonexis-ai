"""
Geocoding, Places, and Distance tool using Open-Meteo and OpenStreetMap Nominatim.
Strictly respects Nominatim's 1 req/sec policy via a global async lock and 30-day caching.
Computes straight-line distance locally via the Haversine formula.
"""

from __future__ import annotations

import asyncio
import math
import os
import time
from typing import Any, Dict, Optional, Tuple
import httpx

from .base import (
    AUTONEXIS_USER_AGENT,
    DEFAULT_TOOL_TIMEOUT,
    InMemoryTTLCache,
    ToolResult,
    current_iso_time,
    is_tool_enabled,
)

# OpenStreetMap Nominatim compliance:
# Max 1 request per second per client. Global lock across all concurrent requests.
_nominatim_lock = asyncio.Lock()
_last_nominatim_request_time = 0.0

# 30-day cache (2,592,000 seconds)
_geo_cache = InMemoryTTLCache()


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> Tuple[float, float]:
    """
    Computes straight-line (great-circle) distance in kilometers and miles.
    """
    r_km = 6371.0  # Earth's radius in kilometers
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    km = r_km * c
    miles = km * 0.621371
    return round(km, 2), round(miles, 2)


class BaseGeocodingAdapter:
    async def geocode(self, query: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError


class OpenMeteoAndNominatimAdapter(BaseGeocodingAdapter):
    """
    Hybrid Geocoder:
    1. Checks Open-Meteo geocoding first (fast, reliable for city names).
    2. Falls back to Nominatim for specific landmarks, streets, and places.
    Enforces strict 1 req/sec rate limit with global lock on Nominatim.
    """

    def __init__(self) -> None:
        self.open_meteo_url = "https://geocoding-api.open-meteo.com/v1/search"
        self.nominatim_url = "https://nominatim.openstreetmap.org/search"

    async def _geocode_open_meteo(self, name: str) -> Optional[Dict[str, Any]]:
        headers = {"User-Agent": AUTONEXIS_USER_AGENT}
        async with httpx.AsyncClient(timeout=DEFAULT_TOOL_TIMEOUT, headers=headers) as client:
            resp = await client.get(
                self.open_meteo_url,
                params={"name": name.strip(), "count": 1, "language": "en", "format": "json"},
            )
            if resp.status_code == 200:
                results = resp.json().get("results")
                if results:
                    p = results[0]
                    lat = float(p["latitude"])
                    lon = float(p["longitude"])
                    place_name = p.get("name", name.strip())
                    country = p.get("country", "")
                    admin1 = p.get("admin1", "")
                    addr = f"{place_name}, {admin1}, {country}".strip(", ")
                    return {
                        "name": place_name,
                        "latitude": lat,
                        "longitude": lon,
                        "display_address": addr,
                        "osm_url": f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=13/{lat}/{lon}",
                        "source": "Open-Meteo Geocoding",
                    }
        return None

    async def _geocode_nominatim(self, query: str) -> Optional[Dict[str, Any]]:
        if not is_tool_enabled("nominatim"):
            return None

        global _last_nominatim_request_time
        headers = {"User-Agent": AUTONEXIS_USER_AGENT}

        # Strictly enforce maximum 1 request per second
        async with _nominatim_lock:
            now = time.time()
            elapsed = now - _last_nominatim_request_time
            if elapsed < 1.05:
                await asyncio.sleep(1.05 - elapsed)

            try:
                async with httpx.AsyncClient(timeout=DEFAULT_TOOL_TIMEOUT, headers=headers) as client:
                    resp = await client.get(
                        self.nominatim_url,
                        params={"q": query.strip(), "format": "json", "limit": 1},
                    )
                    _last_nominatim_request_time = time.time()
                    if resp.status_code == 200:
                        data = resp.json()
                        if data and isinstance(data, list):
                            first = data[0]
                            lat = float(first["lat"])
                            lon = float(first["lon"])
                            display_name = first.get("display_name", query.strip())
                            return {
                                "name": display_name.split(",")[0].strip(),
                                "latitude": lat,
                                "longitude": lon,
                                "display_address": display_name,
                                "osm_url": f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=15/{lat}/{lon}",
                                "source": "Nominatim (OpenStreetMap)",
                            }
            except Exception:
                _last_nominatim_request_time = time.time()
                return None
        return None

    async def geocode(self, query: str) -> Optional[Dict[str, Any]]:
        # Fast path: try Open-Meteo first for city-level queries
        result = await self._geocode_open_meteo(query)
        if result:
            return result
        # Full path: try Nominatim for addresses and places
        return await self._geocode_nominatim(query)


_default_geo_adapter = OpenMeteoAndNominatimAdapter()


async def execute_geocoding_tool(
    place: Optional[str] = None,
    from_place: Optional[str] = None,
    to_place: Optional[str] = None,
    adapter: Optional[BaseGeocodingAdapter] = None,
) -> ToolResult:
    """
    Main entry point for Geocoding and Distance calculations.
    Computes straight-line distance locally between two places, or looks up place coordinates.
    """
    if not is_tool_enabled("geocoding"):
        return ToolResult(
            ok=False,
            data=None,
            source="OpenStreetMap",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Geocoding tool is currently disabled by system configuration.",
        )

    active_adapter = adapter or _default_geo_adapter

    # Mode 1: Distance calculation between two places
    if from_place and to_place and from_place.strip() and to_place.strip():
        f_clean = from_place.strip()
        t_clean = to_place.strip()
        cache_key = f"distance:{f_clean.lower()}:{t_clean.lower()}"

        cached_dist = await _geo_cache.get(cache_key)
        if cached_dist is not None:
            return ToolResult(
                ok=True,
                data=cached_dist,
                source="OpenStreetMap & Local Haversine",
                fetched_at=current_iso_time(),
                ttl=2592000,
                attribution="© OpenStreetMap contributors",
                attribution_url="https://www.openstreetmap.org/copyright",
                cached=True,
            )

        geo1 = await active_adapter.geocode(f_clean)
        if not geo1:
            return ToolResult(
                ok=False,
                data=None,
                source="OpenStreetMap",
                fetched_at=current_iso_time(),
                ttl=0,
                error=f"Could not locate starting place '{f_clean}'.",
                attribution="© OpenStreetMap contributors",
                attribution_url="https://www.openstreetmap.org/copyright",
            )

        geo2 = await active_adapter.geocode(t_clean)
        if not geo2:
            return ToolResult(
                ok=False,
                data=None,
                source="OpenStreetMap",
                fetched_at=current_iso_time(),
                ttl=0,
                error=f"Could not locate destination place '{t_clean}'.",
                attribution="© OpenStreetMap contributors",
                attribution_url="https://www.openstreetmap.org/copyright",
            )

        km, miles = haversine_distance(
            geo1["latitude"], geo1["longitude"], geo2["latitude"], geo2["longitude"]
        )

        dist_data = {
            "mode": "straight_line_distance",
            "from_place": geo1,
            "to_place": geo2,
            "distance_km": km,
            "distance_miles": miles,
            "note": "Straight-line distance (aerial / direct line; not road distance or travel time).",
        }

        await _geo_cache.set(cache_key, dist_data, ttl=2592000)  # 30 days
        return ToolResult(
            ok=True,
            data=dist_data,
            source="OpenStreetMap & Local Haversine",
            fetched_at=current_iso_time(),
            ttl=2592000,
            attribution="© OpenStreetMap contributors",
            attribution_url="https://www.openstreetmap.org/copyright",
            cached=False,
        )

    # Mode 2: Place lookup
    target_place = (place or "").strip()
    if not target_place:
        return ToolResult(
            ok=False,
            data=None,
            source="OpenStreetMap",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Place or address query is required.",
            attribution="© OpenStreetMap contributors",
            attribution_url="https://www.openstreetmap.org/copyright",
        )

    cache_key = f"geo:{target_place.lower()}"
    cached_geo = await _geo_cache.get(cache_key)
    if cached_geo is not None:
        return ToolResult(
            ok=True,
            data=cached_geo,
            source="OpenStreetMap",
            fetched_at=current_iso_time(),
            ttl=2592000,
            attribution="© OpenStreetMap contributors",
            attribution_url="https://www.openstreetmap.org/copyright",
            cached=True,
        )

    geo_res = await active_adapter.geocode(target_place)
    if not geo_res:
        return ToolResult(
            ok=False,
            data=None,
            source="OpenStreetMap",
            fetched_at=current_iso_time(),
            ttl=0,
            error=f"Could not locate place or address '{target_place}'.",
            attribution="© OpenStreetMap contributors",
            attribution_url="https://www.openstreetmap.org/copyright",
        )

    await _geo_cache.set(cache_key, geo_res, ttl=2592000)  # 30 days
    return ToolResult(
        ok=True,
        data=geo_res,
        source=geo_res.get("source", "OpenStreetMap"),
        fetched_at=current_iso_time(),
        ttl=2592000,
        attribution="© OpenStreetMap contributors",
        attribution_url="https://www.openstreetmap.org/copyright",
        cached=False,
    )
