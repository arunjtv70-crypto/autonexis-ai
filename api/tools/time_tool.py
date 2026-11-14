"""
Time tool using Python zoneinfo (no external API calls).
Supports city-to-timezone mapping, current time formatting, and time difference calculations.
Resilient fallback to standard UTC offsets if OS lacks system tzdata.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .base import (
    ToolResult,
    current_iso_time,
    is_tool_enabled,
)

# Standard offsets for common timezones (used if OS lacks IANA tzdata package)
TIMEZONE_OFFSETS: Dict[str, Tuple[int, int]] = {
    "Asia/Kolkata": (5, 30),
    "Asia/Dhaka": (6, 0),
    "Asia/Kathmandu": (5, 45),
    "Asia/Colombo": (5, 30),
    "Asia/Karachi": (5, 0),
    "Asia/Kabul": (4, 30),
    "Asia/Dubai": (4, 0),
    "Asia/Qatar": (3, 0),
    "Asia/Riyadh": (3, 0),
    "Asia/Kuwait": (3, 0),
    "Asia/Muscat": (4, 0),
    "Asia/Bahrain": (3, 0),
    "Asia/Tehran": (3, 30),
    "Asia/Jerusalem": (2, 0),
    "Europe/London": (0, 0),
    "Europe/Paris": (1, 0),
    "Europe/Berlin": (1, 0),
    "Europe/Rome": (1, 0),
    "Europe/Madrid": (1, 0),
    "Europe/Amsterdam": (1, 0),
    "Europe/Brussels": (1, 0),
    "Europe/Zurich": (1, 0),
    "Europe/Vienna": (1, 0),
    "Europe/Moscow": (3, 0),
    "Europe/Stockholm": (1, 0),
    "Europe/Oslo": (1, 0),
    "Europe/Copenhagen": (1, 0),
    "Europe/Dublin": (0, 0),
    "Europe/Athens": (2, 0),
    "Europe/Istanbul": (3, 0),
    "America/New_York": (-5, 0),
    "America/Toronto": (-5, 0),
    "America/Chicago": (-6, 0),
    "America/Denver": (-7, 0),
    "America/Phoenix": (-7, 0),
    "America/Los_Angeles": (-8, 0),
    "America/Vancouver": (-8, 0),
    "America/Mexico_City": (-6, 0),
    "Asia/Singapore": (8, 0),
    "Asia/Kuala_Lumpur": (8, 0),
    "Asia/Bangkok": (7, 0),
    "Asia/Jakarta": (7, 0),
    "Asia/Tokyo": (9, 0),
    "Asia/Seoul": (9, 0),
    "Asia/Shanghai": (8, 0),
    "Asia/Hong_Kong": (8, 0),
    "Asia/Taipei": (8, 0),
    "Asia/Manila": (8, 0),
    "Australia/Sydney": (11, 0),
    "Australia/Melbourne": (11, 0),
    "Australia/Brisbane": (10, 0),
    "Australia/Perth": (8, 0),
    "Pacific/Auckland": (13, 0),
    "Africa/Cairo": (2, 0),
    "Africa/Johannesburg": (2, 0),
    "Africa/Nairobi": (3, 0),
    "America/Sao_Paulo": (-3, 0),
    "America/Argentina/Buenos_Aires": (-3, 0),
}

# Comprehensive city / country to standard IANA timezone mapping
CITY_TIMEZONE_MAP: Dict[str, str] = {
    # India (all cities in India use IST / Asia/Kolkata)
    "india": "Asia/Kolkata",
    "delhi": "Asia/Kolkata",
    "new delhi": "Asia/Kolkata",
    "mumbai": "Asia/Kolkata",
    "bombay": "Asia/Kolkata",
    "bengaluru": "Asia/Kolkata",
    "bangalore": "Asia/Kolkata",
    "kolkata": "Asia/Kolkata",
    "calcutta": "Asia/Kolkata",
    "chennai": "Asia/Kolkata",
    "madras": "Asia/Kolkata",
    "hyderabad": "Asia/Kolkata",
    "pune": "Asia/Kolkata",
    "ahmedabad": "Asia/Kolkata",
    "jaipur": "Asia/Kolkata",
    "bhopal": "Asia/Kolkata",
    "indore": "Asia/Kolkata",
    "lucknow": "Asia/Kolkata",
    "kanpur": "Asia/Kolkata",
    "nagpur": "Asia/Kolkata",
    "patna": "Asia/Kolkata",
    "chandigarh": "Asia/Kolkata",
    "surat": "Asia/Kolkata",
    "kochi": "Asia/Kolkata",
    "thiruvananthapuram": "Asia/Kolkata",
    "goa": "Asia/Kolkata",
    "varanasi": "Asia/Kolkata",
    "agra": "Asia/Kolkata",
    "amritsar": "Asia/Kolkata",
    "gwalior": "Asia/Kolkata",
    "jabalpur": "Asia/Kolkata",
    "ujjain": "Asia/Kolkata",
    "ranchi": "Asia/Kolkata",
    "dehradun": "Asia/Kolkata",
    "guwahati": "Asia/Kolkata",
    "shimla": "Asia/Kolkata",
    "srinagar": "Asia/Kolkata",
    # South Asia
    "dhaka": "Asia/Dhaka",
    "bangladesh": "Asia/Dhaka",
    "kathmandu": "Asia/Kathmandu",
    "nepal": "Asia/Kathmandu",
    "colombo": "Asia/Colombo",
    "sri lanka": "Asia/Colombo",
    "karachi": "Asia/Karachi",
    "lahore": "Asia/Karachi",
    "islamabad": "Asia/Karachi",
    "pakistan": "Asia/Karachi",
    "kabul": "Asia/Kabul",
    # Middle East
    "dubai": "Asia/Dubai",
    "abu dhabi": "Asia/Dubai",
    "uae": "Asia/Dubai",
    "doha": "Asia/Qatar",
    "qatar": "Asia/Qatar",
    "riyadh": "Asia/Riyadh",
    "saudi arabia": "Asia/Riyadh",
    "kuwait": "Asia/Kuwait",
    "muscat": "Asia/Muscat",
    "bahrain": "Asia/Bahrain",
    "tehran": "Asia/Tehran",
    "iran": "Asia/Tehran",
    "jerusalem": "Asia/Jerusalem",
    "tel aviv": "Asia/Jerusalem",
    # Europe
    "london": "Europe/London",
    "uk": "Europe/London",
    "manchester": "Europe/London",
    "paris": "Europe/Paris",
    "france": "Europe/Paris",
    "berlin": "Europe/Berlin",
    "germany": "Europe/Berlin",
    "frankfurt": "Europe/Berlin",
    "munich": "Europe/Berlin",
    "rome": "Europe/Rome",
    "italy": "Europe/Rome",
    "madrid": "Europe/Madrid",
    "spain": "Europe/Madrid",
    "barcelona": "Europe/Madrid",
    "amsterdam": "Europe/Amsterdam",
    "netherlands": "Europe/Amsterdam",
    "brussels": "Europe/Brussels",
    "belgium": "Europe/Brussels",
    "zurich": "Europe/Zurich",
    "switzerland": "Europe/Zurich",
    "geneva": "Europe/Zurich",
    "vienna": "Europe/Vienna",
    "austria": "Europe/Vienna",
    "moscow": "Europe/Moscow",
    "russia": "Europe/Moscow",
    "stockholm": "Europe/Stockholm",
    "sweden": "Europe/Stockholm",
    "oslo": "Europe/Oslo",
    "norway": "Europe/Oslo",
    "copenhagen": "Europe/Copenhagen",
    "denmark": "Europe/Copenhagen",
    "dublin": "Europe/Dublin",
    "ireland": "Europe/Dublin",
    "athens": "Europe/Athens",
    "greece": "Europe/Athens",
    "istanbul": "Europe/Istanbul",
    "turkey": "Europe/Istanbul",
    # North America
    "new york": "America/New_York",
    "new york city": "America/New_York",
    "nyc": "America/New_York",
    "boston": "America/New_York",
    "washington": "America/New_York",
    "dc": "America/New_York",
    "miami": "America/New_York",
    "atlanta": "America/New_York",
    "toronto": "America/Toronto",
    "montreal": "America/Toronto",
    "chicago": "America/Chicago",
    "houston": "America/Chicago",
    "dallas": "America/Chicago",
    "denver": "America/Denver",
    "phoenix": "America/Phoenix",
    "los angeles": "America/Los_Angeles",
    "la": "America/Los_Angeles",
    "san francisco": "America/Los_Angeles",
    "sf": "America/Los_Angeles",
    "seattle": "America/Los_Angeles",
    "vancouver": "America/Vancouver",
    "mexico city": "America/Mexico_City",
    # Asia Pacific
    "singapore": "Asia/Singapore",
    "kuala lumpur": "Asia/Kuala_Lumpur",
    "malaysia": "Asia/Kuala_Lumpur",
    "bangkok": "Asia/Bangkok",
    "thailand": "Asia/Bangkok",
    "jakarta": "Asia/Jakarta",
    "indonesia": "Asia/Jakarta",
    "tokyo": "Asia/Tokyo",
    "japan": "Asia/Tokyo",
    "seoul": "Asia/Seoul",
    "south korea": "Asia/Seoul",
    "beijing": "Asia/Shanghai",
    "shanghai": "Asia/Shanghai",
    "china": "Asia/Shanghai",
    "hong kong": "Asia/Hong_Kong",
    "taipei": "Asia/Taipei",
    "taiwan": "Asia/Taipei",
    "manila": "Asia/Manila",
    "philippines": "Asia/Manila",
    "sydney": "Australia/Sydney",
    "melbourne": "Australia/Sydney",
    "brisbane": "Australia/Brisbane",
    "perth": "Australia/Perth",
    "auckland": "Pacific/Auckland",
    "new zealand": "Pacific/Auckland",
    # Africa & South America
    "cairo": "Africa/Cairo",
    "egypt": "Africa/Cairo",
    "johannesburg": "Africa/Johannesburg",
    "south africa": "Africa/Johannesburg",
    "nairobi": "Africa/Nairobi",
    "kenya": "Africa/Nairobi",
    "sao paulo": "America/Sao_Paulo",
    "brazil": "America/Sao_Paulo",
    "buenos aires": "America/Argentina/Buenos_Aires",
    "argentina": "America/Argentina/Buenos_Aires",
}

DEFAULT_TIMEZONE = "Asia/Kolkata"


def resolve_timezone(name_or_zone: str) -> str:
    """Resolves a city name, region, or timezone string to a valid IANA timezone."""
    cleaned = (name_or_zone or "").strip().lower()
    if not cleaned:
        return DEFAULT_TIMEZONE

    # Check direct mapping
    if cleaned in CITY_TIMEZONE_MAP:
        return CITY_TIMEZONE_MAP[cleaned]

    # Partial city match in map
    for city, tz in CITY_TIMEZONE_MAP.items():
        if city in cleaned or cleaned in city:
            return tz

    # Check if cleaned is already a valid IANA timezone name
    try:
        ZoneInfo(name_or_zone.strip())
        return name_or_zone.strip()
    except Exception:
        pass

    return DEFAULT_TIMEZONE


def get_timezone_obj(tz_name: str) -> Any:
    """
    Returns a timezone object for datetime operations.
    Tries ZoneInfo first; if system tzdata is unavailable, falls back to timedelta timezone.
    """
    try:
        return ZoneInfo(tz_name)
    except Exception:
        pass

    if tz_name in TIMEZONE_OFFSETS:
        h, m = TIMEZONE_OFFSETS[tz_name]
        return timezone(timedelta(hours=h, minutes=m), name=tz_name)

    # Default to IST (+05:30)
    return timezone(timedelta(hours=5, minutes=30), name="Asia/Kolkata")


def get_city_time_data(city: str) -> Dict[str, Any]:
    """Generates exact current time information for a target city or timezone."""
    tz_name = resolve_timezone(city)
    tz_obj = get_timezone_obj(tz_name)

    now = datetime.now(tz_obj)
    offset = now.strftime("%z")
    formatted_offset = f"UTC{offset[:3]}:{offset[3:]}" if offset else "UTC+05:30"

    return {
        "query": city or "India (Default)",
        "resolved_city": city.title() if city else "India",
        "timezone": tz_name,
        "time_12h": now.strftime("%I:%M %p"),
        "time_24h": now.strftime("%H:%M:%S"),
        "date": now.strftime("%A, %B %d, %Y"),
        "day_of_week": now.strftime("%A"),
        "utc_offset": formatted_offset,
        "iso": now.isoformat(),
    }


def compute_time_difference(city1: str, city2: str) -> Dict[str, Any]:
    """Computes exact time difference between two cities or timezones."""
    tz1_name = resolve_timezone(city1)
    tz2_name = resolve_timezone(city2)

    tz1 = get_timezone_obj(tz1_name)
    tz2 = get_timezone_obj(tz2_name)

    now_utc = datetime.now(timezone.utc)
    dt1 = now_utc.astimezone(tz1)
    dt2 = now_utc.astimezone(tz2)

    # Offset difference in seconds
    offset1_sec = dt1.utcoffset().total_seconds() if dt1.utcoffset() else 0
    offset2_sec = dt2.utcoffset().total_seconds() if dt2.utcoffset() else 0
    diff_sec = offset2_sec - offset1_sec
    diff_hours = diff_sec / 3600.0

    abs_hours = int(abs(diff_hours))
    abs_minutes = int(round((abs(diff_hours) - abs_hours) * 60))

    time_str = f"{abs_hours} hour{'s' if abs_hours != 1 else ''}"
    if abs_minutes > 0:
        time_str += f" and {abs_minutes} minute{'s' if abs_minutes != 1 else ''}"

    if diff_sec > 0:
        relation = f"{city2.title()} is {time_str} ahead of {city1.title()}."
    elif diff_sec < 0:
        relation = f"{city2.title()} is {time_str} behind {city1.title()}."
    else:
        relation = f"{city1.title()} and {city2.title()} share the same time zone."

    return {
        "city1": get_city_time_data(city1),
        "city2": get_city_time_data(city2),
        "difference_hours": diff_hours,
        "relation_summary": relation,
    }


async def execute_time_tool(
    city: Optional[str] = None,
    compare_with: Optional[str] = None,
) -> ToolResult:
    """
    Main entry point for the Time Tool.
    Requires no external network calls; executes instantly with zero latency.
    """
    if not is_tool_enabled("time"):
        return ToolResult(
            ok=False,
            data=None,
            source="Python zoneinfo",
            fetched_at=current_iso_time(),
            ttl=0,
            error="Time tool is currently disabled by system configuration.",
        )

    try:
        if compare_with and compare_with.strip():
            city1 = city or "India"
            city2 = compare_with.strip()
            diff_data = compute_time_difference(city1, city2)
            return ToolResult(
                ok=True,
                data=diff_data,
                source="Python zoneinfo (local tzdata)",
                fetched_at=current_iso_time(),
                ttl=60,
                attribution="Computed locally using IANA Time Zone Database via Python zoneinfo",
            )
        else:
            time_data = get_city_time_data(city or "")
            return ToolResult(
                ok=True,
                data=time_data,
                source="Python zoneinfo (local tzdata)",
                fetched_at=current_iso_time(),
                ttl=60,
                attribution="Computed locally using IANA Time Zone Database via Python zoneinfo",
            )
    except Exception as e:
        return ToolResult(
            ok=False,
            data=None,
            source="Python zoneinfo",
            fetched_at=current_iso_time(),
            ttl=0,
            error=f"Time calculation failed: {type(e).__name__}",
        )
