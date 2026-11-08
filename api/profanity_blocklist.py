# ==============================================================================
# AUTONEXIS Assistant - Profanity & Abusive Language Blocklist
# ==============================================================================
# This file contains the backend safeguard blocklist to ensure the assistant
# NEVER outputs profanity, slurs, or abusive words under any circumstances.
# Editable by the project owner.
# ==============================================================================

import re
import unicodedata

# 1. HINGLISH & ROMAN SCRIPT PROFANITY / ABUSIVE WORDS
ROMAN_PROFANITY_WORDS = [
    # Severe Hindi/Hinglish profanities and slurs
    "bhosdi", "bhosdike", "bhosdika", "bhosadike", "bhosadika", "bhosada", "bhosda",
    "bhenchod", "behenchod", "benchod", "bc", "bhen ke lode", "bhen ke laude",
    "madarchod", "madarchodh", "mc", "madar chod", "maadar chod", "madarchoddd",
    "chutiya", "chutiye", "chutya", "chtiya", "chootiya", "choot", "chut",
    "gaand", "gand", "gandu", "gaandu", "gandmasti", "gandfat", "gandfatu",
    "lauda", "laude", "lavda", "lavde", "loda", "lode", "lund", "lodu",
    "harami", "haraami", "haramkhor", "haramzada", "haramzade",
    "randi", "raandi", "randwa", "randwe",
    "saala", "saale", "sala", "sale", "kamina", "kamine", "kuttiya", "kutiya",
    "suar ke bacche", "tatte", "tatta", "mutth", "chinal",
    # English profanities and vulgar slurs
    "fuck", "fucking", "fucker", "motherfucker", "fuk", "fck",
    "bitch", "bitches", "bitching",
    "asshole", "assholes", "bastard", "bastards",
    "cunt", "cunts", "dick", "dicks", "dickhead",
    "pussy", "pussies", "whore", "whores", "slut", "sluts",
    "nigger", "nigga", "faggot", "fag",
]

# 2. DEVANAGARI SCRIPT PROFANITY / ABUSIVE WORDS
DEVANAGARI_PROFANITY_WORDS = [
    "भोसड़ी", "भोसड़ीके", "भोसडीके", "भोसड़ा", "भोसडा",
    "बहनचोद", "मादरचोद", "मादरचोद", "चूतिया", "चूतिये", "चूत",
    "गांड", "गांडू", "गाण्ड", "गाण्डू",
    "लौड़ा", "लौड़े", "लौडा", "लौडे", "लोड़ा", "लोड़े", "लंड", "लण्ड",
    "हरामी", "हरामज़ादा", "हरामजादा", "हरामजादे",
    "रंडी", "रण्डी", "रांड",
    "कमीना", "कमीने", "कुतिया", "साला", "साले", "छिनाल"
]

def _normalize_text(text: str) -> str:
    """Normalizes leet-speak, accents, and punctuation to detect obfuscated abuse."""
    # Decompose unicode characters
    normalized = unicodedata.normalize("NFKD", text)
    # Lowercase
    lower = normalized.lower()
    # Leet speak substitutions
    substitutions = {
        '@': 'a',
        '4': 'a',
        '$': 's',
        '0': 'o',
        '1': 'i',
        '!': 'i',
        '3': 'e',
        '7': 't',
        '+': 't',
        '*': '',
        '_': '',
        '-': ' ',
        '.': '',
    }
    for char, rep in substitutions.items():
        lower = lower.replace(char, rep)
    return lower

# Build compiled regex for exact word matching
_ROMAN_REGEX = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in ROMAN_PROFANITY_WORDS) + r")\b",
    re.IGNORECASE
)

_DEVANAGARI_REGEX = re.compile(
    r"(" + "|".join(re.escape(w) for w in DEVANAGARI_PROFANITY_WORDS) + r")"
)

def contains_profanity(text: str) -> bool:
    """
    Checks if the supplied text contains any profane, abusive, or vulgar words
    from the Roman or Devanagari blocklists.
    """
    if not text:
        return False

    # Check direct text first
    if _ROMAN_REGEX.search(text) or _DEVANAGARI_REGEX.search(text):
        return True

    # Check normalized text (catches f*ck, b.h.o.s.d.i, etc.)
    normalized = _normalize_text(text)
    if _ROMAN_REGEX.search(normalized) or _DEVANAGARI_REGEX.search(normalized):
        return True

    return False

def get_polite_fallback(user_text: str = "") -> str:
    """
    Returns a warm, polite, non-abusive fallback response matching user language.
    """
    clean = (user_text or "").strip()
    has_devanagari = any('\u0900' <= char <= '\u097f' for char in clean)
    if has_devanagari:
        return "मैं यहाँ आपकी सहायता के लिए उपस्थित हूँ। कृपया बताइए, आज मैं आपके किस काम में मदद कर सकता हूँ?"

    # Hinglish check
    hinglish_markers = {
        "kya", "kar", "rhe", "rahe", "ho", "hai", "hain", "hu", "hoon", "mera", "meri", "mere",
        "naam", "nam", "kaise", "kaisa", "batao", "bataiye", "bol", "bolo", "bhai", "yaar", "tu"
    }
    words = set(w.lower().strip(".,!?:;\"'()[]{}") for w in clean.split())
    if any(w in hinglish_markers for w in words):
        return "Main yahan aapki madad karne ke liye hoon. Aap batao, aaj kya kaam karna hai?"

    return "I'm here to help you out. Let me know what you'd like to work on and we'll get it solved."
