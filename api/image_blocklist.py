"""
Editable Image Safety Blocklist (English, Hinglish Roman, and Hindi Devanagari).

Owner can add or refine entries freely. Used BEFORE any image generation
alongside the fail-closed LLM moderation classifier.
"""

import re
import unicodedata
from typing import Optional, Tuple


# Categories aligned with platform policy
CATEGORIES = (
    "csam_minor_sexual",
    "sexual_explicit",
    "real_person_deepfake",
    "gore_violence",
    "hate_symbols",
    "self_harm",
    "weapons_illegal",
    "deceptive_docs",
)


MINOR_TERMS = [
    "child", "children", "kid", "kids", "minor", "minors", "underage", "toddler",
    "baby", "infant", "schoolgirl", "schoolboy", "teen", "teenager", "loli", "shota",
    "bachcha", "bachche", "baccha", "bacche", "bacchi", "bachi", "chhoti ladki",
    "chhota ladka", "nabalig", "naabalig", "balak",
    "बच्चा", "बच्ची", "बच्चे", "नाबालिग", "किशोर", "बालक",
]

SEXUAL_TERMS = [
    "nude", "nudes", "naked", "porn", "porno", "pornography", "nsfw", "xxx",
    "erotic", "erotica", "hentai", "ecchi", "fetish", "bdsm", "lingerie",
    "bikini model", "topless", "bottomless", "explicit", "sexual", "sex",
    "intercourse", "orgasm", "genitals", "breasts", "boobs", "nipples", "buttocks",
    "cleavage", "seductive pose", "strip", "stripping", "uncensored",
    "nangi", "nanga", "nange", "ashleel", "ashlil", "chudai", "chodna",
    "gandi tasveer", "sexy", "hot girl", "bold pose", "kamuk",
    "नंगी", "नंगा", "नग्न", "अश्लील", "कामुक", "सेक्स", "पोर्न",
]

# Standalone sexual keywords always blocked for image generation
ALWAYS_BLOCKED_SEXUAL = [
    "nude", "nudes", "naked", "porn", "porno", "pornography", "nsfw", "xxx",
    "hentai", "ecchi", "fetish", "bdsm", "topless", "bottomless", "erotica",
    "erotic", "sex", "intercourse", "orgasm", "genitals", "boobs", "nipples",
    "lingerie", "uncensored", "nangi", "nanga", "nange", "ashleel", "ashlil",
    "chudai", "chodna", "gandi tasveer", "kamuk",
    "नंगी", "नंगा", "नग्न", "अश्लील", "कामुक", "सेक्स", "पोर्न",
]

CSAM_DIRECT_TERMS = [
    "csam", "cp", "lolicon", "shotacon", "jailbait", "child porn", "kiddie porn",
    "underage nude", "minor nude", "kid nude", "child sex", "bachchi nangi",
]

REAL_PERSON_NAMES_AND_DEEPFAKE = [
    "deepfake", "face swap", "faceswap", "real person photo", "fake selfie of",
    "narendra modi", "modi ji", "rahul gandhi", "amit shah", "yogi adityanath",
    "virat kohli", "rohit sharma", "ms dhoni", "sachin tendulkar",
    "salman khan", "shah rukh khan", "srk", "aamir khan", "deepika padukone",
    "alia bhatt", "priyanka chopra", "katrina kaif", "rashmika mandanna",
    "donald trump", "joe biden", "barack obama", "elon musk", "taylor swift",
    "selena gomez", "cristiano ronaldo", "lionel messi", "kim kardashian",
    "ariana grande", "scarlett johansson", "emma watson", "mrbeast",
    "नरेंद्र मोदी", "राहुल गांधी", "विराट कोहली", "सलमान खान", "शाहरुख खान", "एलन मस्क",
]

GORE_VIOLENCE_TERMS = [
    "gore", "gory", "decapitated", "decapitation", "beheaded", "dismembered",
    "severed head", "entrails", "organs spilling", "bloodbath", "mutilated",
    "corpse", "dead body bleeding", "torture chamber", "brutal murder",
    "खून से लथपथ", "कटा हुआ सिर", "लाश", "बेरहम हत्या", "खून खराबा",
]

HATE_SYMBOL_TERMS = [
    "nazi", "swastika flag", "hitler salute", "kkk robe", "ku klux klan",
    "white supremacy", "lynching", "genocide propaganda", "hate symbol",
]

SELF_HARM_TERMS = [
    "suicide", "self harm", "self-harm", "cutting wrists", "slit wrist",
    "hanging from rope", "noose around neck", "आत्महत्या", "खुद को काटना",
]

WEAPONS_ILLEGAL_TERMS = [
    "how to make a bomb", "ied blueprint", "pipe bomb", "bomb assembly diagram",
    "3d printed gun blueprint", "meth lab", "cocaine bricks", "terrorist attack",
    "बम बनाने", "अवैध हथियार",
]

DECEPTIVE_DOC_TERMS = [
    "fake id", "fake passport", "fake aadhaar", "fake aadhar", "fake pan card",
    "fake driving license", "forged certificate", "counterfeit currency",
    "fake bank statement", "fake breaking news", "forged signature",
    "नकली आधार", "नकली पासपोर्ट", "नकली पैन कार्ड", "नकली नोट", "जाली दस्तावेज",
]


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text or "")
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    lower = stripped.lower()
    for a, b in (
        ("@", "a"), ("$", "s"), ("0", "o"), ("1", "i"), ("!", "i"),
        ("3", "e"), ("4", "a"), ("*", ""), ("_", " "), ("-", " "),
    ):
        lower = lower.replace(a, b)
    return re.sub(r"\s+", " ", lower).strip()


def _contains_any(norm_text: str, raw_text: str, terms: list[str]) -> bool:
    raw_lower = (raw_text or "").lower()
    for term in terms:
        t_low = term.lower()
        is_ascii = all(ord(c) < 128 for c in t_low)
        if is_ascii:
            pattern = r"\b" + re.escape(_normalize(t_low)) + r"\b"
            if re.search(pattern, norm_text):
                return True
        else:
            if t_low in raw_lower:
                return True
    return False


def check_blocklist(text: str) -> Tuple[bool, Optional[str]]:
    """
    Checks user prompt or enhanced prompt against editable blocklists.
    Returns (allowed, category_if_blocked).
    """
    if not text or not text.strip():
        return False, "invalid_empty"

    norm = _normalize(text)

    if _contains_any(norm, text, CSAM_DIRECT_TERMS):
        return False, "csam_minor_sexual"

    has_minor = _contains_any(norm, text, MINOR_TERMS)
    has_sexual = _contains_any(norm, text, SEXUAL_TERMS)
    if has_minor and has_sexual:
        return False, "csam_minor_sexual"

    if _contains_any(norm, text, ALWAYS_BLOCKED_SEXUAL):
        return False, "sexual_explicit"

    if _contains_any(norm, text, DECEPTIVE_DOC_TERMS):
        return False, "deceptive_docs"

    if _contains_any(norm, text, WEAPONS_ILLEGAL_TERMS):
        return False, "weapons_illegal"

    if _contains_any(norm, text, SELF_HARM_TERMS):
        return False, "self_harm"

    if _contains_any(norm, text, HATE_SYMBOL_TERMS):
        return False, "hate_symbols"

    if _contains_any(norm, text, GORE_VIOLENCE_TERMS):
        return False, "gore_violence"

    if _contains_any(norm, text, REAL_PERSON_NAMES_AND_DEEPFAKE):
        return False, "real_person_deepfake"

    return True, None


def detect_script_language(text: str) -> str:
    """Detects 'hi' (Devanagari), 'hinglish' (Roman Hindi markers), or 'en'."""
    if re.search(r"[\u0900-\u097F]", text or ""):
        return "hi"
    hinglish_markers = re.compile(
        r"\b(kya|tum|aap|mujhe|mera|meri|mere|bna|bnao|bana|banao|karo|dikhao|chahiye|"
        r"ek|isko|wahi|aur|mein|me|ka|ki|ke|ko|se|ho|hai|hain|nhi|nahi|yaar|bhai|"
        r"tasveer|sundar|raat|subah|kutte|billi|phool)\b",
        re.I,
    )
    if hinglish_markers.search(text or ""):
        return "hinglish"
    return "en"


def get_calm_refusal_message(user_text: str, category: str) -> str:
    """
    Returns a calm, polite refusal with safe alternatives, never lecturing
    and never repeating explicit/harmful words.
    """
    lang = detect_script_language(user_text)
    if lang == "hi":
        return (
            "मैं यह तस्वीर नहीं बना सकता। आप कोई और सुरक्षित आइडिया बताइए, "
            "जैसे सूर्यास्त के समय पहाड़ों का दृश्य या एक प्यारा सा पपी पोर्ट्रेट।"
        )
    if lang == "hinglish":
        return (
            "Main ye image nahi bana sakta. Aap koi aur idea batayein, "
            "jaise sunset ke waqt pahadon ka scene ya ek cute puppy portrait."
        )
    return (
        "I can't create that image. Try another idea, such as a peaceful "
        "mountain landscape at sunset or a studio product shot."
    )

