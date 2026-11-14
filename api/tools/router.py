"""
Deterministic Multi-Script Live Intent Router (Hindi, Hinglish, English + Typos).
Runs in the application layer BEFORE or ALONGSIDE model calls to route live data queries.
Extracts only minimum required entities (city, currency pair, ticker, places).
Privacy: Never forwards user identity or full conversation text to tools.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ToolIntent:
    tool: str  # "time", "weather", "currency", "geocoding", "stocks", "web_search"
    args: Dict[str, Any]
    confidence: float
    reason: str


# ------------------------------------------------------------------------------
# 1. TIME ROUTING PATTERNS
# ------------------------------------------------------------------------------
_TIME_WORDS = r"(?:time|samay|waqt|baje|ghadi|timezone|ghante|समय|वक्त|बजे|घड़ी)"
_TIME_DIFF_RE = re.compile(
    r"(?:time\s+difference|difference\s+between|kitna\s+farq|kitna\s+antar|samay\s+ka\s+antar)\s+(?:between\s+)?([a-zA-Z\s]+?)\s+(?:and|aur|se|to)\s+([a-zA-Z\s]+)",
    re.I,
)
_TIME_QUERY_RE = re.compile(
    rf"(?:aaj\s+)?(?:([a-zA-Z\u0900-\u097F\s]+?)\s+(?:mein|me|ka|ki)\s+)?(?:kitne\s+baje|kya\s+samay|kitna\s+time|aaj\s+ka\s+time|abhi\s+kitne\s+baje|kya\s+time|abhi\s+ka\s+time|current\s+time|what\s+time\s+is\s+it(?:\s+in\s+([a-zA-Z\s]+))?|time\s+in\s+([a-zA-Z\s]+))",
    re.I,
)

# ------------------------------------------------------------------------------
# 2. WEATHER ROUTING PATTERNS
# ------------------------------------------------------------------------------
_WEATHER_WORDS = r"(?:mausam|mosam|weather|barish|baarish|barsat|rain|precipitation|temperature|temp|tahpman|tapman|garmi|sardi|forecast|hawa|मौसम|बारिश|बरसात|तापमान)"
_WEATHER_CITY_RE = re.compile(
    rf"(?:([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+)?)\s+(?:ka|ki|ke|mein|me|se)?\s*{_WEATHER_WORDS}|{_WEATHER_WORDS}\s+(?:in|of|at|for|mein|me)?\s*([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+)?))",
    re.I,
)

# ------------------------------------------------------------------------------
# 3. CURRENCY ROUTING PATTERNS
# ------------------------------------------------------------------------------
_CURRENCY_CONVERT_RE = re.compile(
    r"(?:(\d+(?:\.\d+)?)\s*)?(dollar|usd|inr|rupaye|rupee|euro|eur|pound|gbp|yen|jpy|aud|cad)\s*(?:kitne\s+(?:rupaye|rupee|inr|dollar|usd)|to\s+([a-zA-Z]+)|in\s+([a-zA-Z]+)|rate|bhav)?",
    re.I,
)

# ------------------------------------------------------------------------------
# 4. GEOCODING & DISTANCE ROUTING PATTERNS
# ------------------------------------------------------------------------------
_DISTANCE_RE = re.compile(
    r"([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+)?)\s+(?:se|to|and)\s+([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+)?)\s+(?:straight-line|aerial|hawaai)?\s*(?:kitna\s+door|kitni\s+doori|distance|doori|faasla|fasla)",
    re.I,
)
_DISTANCE_ALT_RE = re.compile(
    r"(?:straight-line\s+)?distance\s+(?:between\s+)?([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+)?)\s+(?:and|to)\s+([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+)?)",
    re.I,
)
_PLACE_LOCATION_RE = re.compile(
    r"([a-zA-Z0-9\u0900-\u097F\s]{2,40}?)\s+(?:kahan\s+hai|kahan\s+par\s+hai|kidhar\s+hai|where\s+is|location|coordinates|address)",
    re.I,
)

# ------------------------------------------------------------------------------
# 5. STOCKS ROUTING PATTERNS
# ------------------------------------------------------------------------------
_STOCK_WORDS = r"(?:share\s+price|stock\s+price|share\s+rate|stock\s+rate|share|stock|nifty|sensex|शेयर)"
_STOCK_RE = re.compile(
    r"(?:([a-zA-Z0-9\s\.\&\-]+?)\s+(?:ka|ki|ke)?\s*(?:share\s+price|stock\s+price|share\s+rate|stock\s+rate|share\s+bhav)|(?:share\s+price|stock\s+price)\s+(?:of\s+)?([a-zA-Z0-9\s\.\&\-]+))",
    re.I,
)
_INDEX_RE = re.compile(r"\b(nifty(?:\s*50)?|sensex|bse\s+sensex)\b", re.I)


def _clean_entity(text: Optional[str]) -> str:
    """Removes noise words, prepositions, and punctuation."""
    if not text:
        return ""
    cleaned = text.strip()
    # Strip common Hindi / English prepositions
    cleaned = re.sub(
        r"^(?:mein|me|ka|ki|ke|se|in|at|of|the|aaj|aaj\s+ka|aaj\s+ki|current|live)\s+",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(
        r"\s+(?:mein|me|ka|ki|ke|se|in|at|of|hai|hain|tha|kya|batao|bataiye|plz|please)$",
        "",
        cleaned,
        flags=re.I,
    )
    return cleaned.strip()


def detect_tool_intents(user_text: str, max_intents: int = 3) -> List[ToolIntent]:
    """
    Analyzes user text across Hindi, Hinglish, and English to detect required live data tools.
    Returns up to `max_intents` independent intents.
    """
    clean_text = (user_text or "").strip()
    if not clean_text:
        return []

    intents: List[ToolIntent] = []

    # --------------------------------------------------------------------------
    # 1. TIME CHECK
    # --------------------------------------------------------------------------
    diff_match = _TIME_DIFF_RE.search(clean_text)
    if diff_match:
        c1 = _clean_entity(diff_match.group(1))
        c2 = _clean_entity(diff_match.group(2))
        if c1 and c2:
            intents.append(
                ToolIntent(
                    tool="time",
                    args={"city": c1, "compare_with": c2},
                    confidence=0.95,
                    reason="time_difference_rule",
                )
            )

    if not intents:
        time_match = _TIME_QUERY_RE.search(clean_text)
        if time_match:
            city = _clean_entity(time_match.group(1) or time_match.group(2) or time_match.group(3) or "")
            # If no specific city given, defaults to user's region (India)
            intents.append(
                ToolIntent(
                    tool="time",
                    args={"city": city or "India"},
                    confidence=0.92,
                    reason="time_query_rule",
                )
            )

    # --------------------------------------------------------------------------
    # 2. WEATHER CHECK
    # --------------------------------------------------------------------------
    weather_match = _WEATHER_CITY_RE.search(clean_text)
    if weather_match:
        city = _clean_entity(weather_match.group(1) or weather_match.group(2) or "")
        # Avoid false matching if city is a time or currency word
        if city and not re.search(r"\b(time|dollar|rupaye|share|stock)\b", city, re.I):
            intents.append(
                ToolIntent(
                    tool="weather",
                    args={"city": city, "days": 3},
                    confidence=0.95,
                    reason="weather_city_rule",
                )
            )

    # --------------------------------------------------------------------------
    # 3. CURRENCY CHECK
    # --------------------------------------------------------------------------
    if re.search(r"\b(dollar|rupaye|rupee|inr|usd|eur|euro|pound|gbp|currency|exchange\s+rate)\b", clean_text, re.I):
        curr_match = _CURRENCY_CONVERT_RE.search(clean_text)
        if curr_match:
            amt_str = curr_match.group(1)
            amount = float(amt_str) if amt_str else 1.0
            from_raw = curr_match.group(2) or "USD"
            to_raw = curr_match.group(3) or curr_match.group(4) or "INR"

            # Auto-infer target for common Indian queries
            from_upper = from_raw.upper()
            if "DOLLAR" in from_upper or "USD" in from_upper:
                from_c = "USD"
                to_c = "INR" if ("RUPAYE" in clean_text.lower() or "RUPEE" in clean_text.lower() or "INR" in clean_text.upper() or not to_raw) else to_raw.upper()
            elif "EURO" in from_upper or "EUR" in from_upper:
                from_c = "EUR"
                to_c = "INR" if ("RUPAYE" in clean_text.lower() or "RUPEE" in clean_text.lower() or "INR" in clean_text.upper() or not to_raw) else to_raw.upper()
            elif "POUND" in from_upper or "GBP" in from_upper:
                from_c = "GBP"
                to_c = "INR" if ("RUPAYE" in clean_text.lower() or "RUPEE" in clean_text.lower() or "INR" in clean_text.upper() or not to_raw) else to_raw.upper()
            else:
                from_c = from_raw.upper()
                to_c = to_raw.upper() if to_raw else "INR"

            intents.append(
                ToolIntent(
                    tool="currency",
                    args={"amount": amount, "from_currency": from_c, "to_currency": to_c},
                    confidence=0.94,
                    reason="currency_convert_rule",
                )
            )

    # --------------------------------------------------------------------------
    # 4. GEOCODING & DISTANCE CHECK
    # --------------------------------------------------------------------------
    dist_match = _DISTANCE_RE.search(clean_text) or _DISTANCE_ALT_RE.search(clean_text)
    if dist_match:
        from_p = _clean_entity(dist_match.group(1))
        to_p = _clean_entity(dist_match.group(2))
        if from_p and to_p:
            intents.append(
                ToolIntent(
                    tool="geocoding",
                    args={"from_place": from_p, "to_place": to_p},
                    confidence=0.96,
                    reason="distance_places_rule",
                )
            )
    else:
        place_match = _PLACE_LOCATION_RE.search(clean_text)
        if place_match:
            p = _clean_entity(place_match.group(1))
            # Don't trigger if place looks like a weather/time/currency query
            if p and not re.search(r"\b(time|mausam|weather|dollar|share|price)\b", p, re.I):
                intents.append(
                    ToolIntent(
                        tool="geocoding",
                        args={"place": p},
                        confidence=0.90,
                        reason="place_location_rule",
                    )
                )

    # --------------------------------------------------------------------------
    # 5. STOCKS CHECK
    # --------------------------------------------------------------------------
    stock_match = _STOCK_RE.search(clean_text)
    if stock_match:
        comp = _clean_entity(stock_match.group(1) or stock_match.group(2) or "")
        if comp and not re.search(r"\b(weather|time|dollar|kahan)\b", comp, re.I):
            intents.append(
                ToolIntent(
                    tool="stocks",
                    args={"ticker_or_company": comp},
                    confidence=0.93,
                    reason="stock_company_rule",
                )
            )
    else:
        index_match = _INDEX_RE.search(clean_text)
        if index_match:
            idx_name = index_match.group(1).strip()
            intents.append(
                ToolIntent(
                    tool="stocks",
                    args={"ticker_or_company": idx_name},
                    confidence=0.95,
                    reason="stock_index_rule",
                )
            )

    # Deduplicate and limit to at most max_intents independent tools
    seen_tools = set()
    deduped: List[ToolIntent] = []
    for it in intents:
        if it.tool not in seen_tools:
            seen_tools.add(it.tool)
            deduped.append(it)
        if len(deduped) >= max_intents:
            break

    return deduped
