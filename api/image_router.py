"""
Deterministic Multi-Script Image Intent Router (runs BEFORE the big chat model).

Layer A: Fast rules (zero LLM call) across English, Hinglish (including typos),
         Hindi Devanagari, negative exclusions, and image follow-ups.
Layer B: Fast tiny-token JSON classifier fallback ONLY when Layer A is unsure.
         Always degrades safely to 'chat' on failure so normal chat never blocks.
Never logs user message text.
"""

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx

from config import settings

logger = logging.getLogger("autonexis.image.router")


# Multi-script visual media nouns (English, Hinglish + typos, Devanagari)
_NOUN_PATTERN = (
    r"(?:"
    r"images?|imge|imgs?|imaj|photos?|fotos?|photto|pictures?|pics?|"
    r"tasveer(?:e|en)?|tasvir(?:e|en)?|taswir|tasweer|"
    r"chitra|chhavi|wallpapers?|walpapers?|logos?|posters?|"
    r"paintings?|sketches?|drawings?|drowings?|illustrations?|"
    r"artworks?|banners?|avatars?|dp|portraits?|"
    r"तस्वीर|तसवीर|इमेज|फोटो|फ़ोटो|चित्र|छवि|लोगो|पोस्टर|पेंटिंग|स्केच|वॉलपेपर"
    r")"
)

# Multi-script creation verbs & requests (English, Hinglish + typos, Devanagari)
_VERB_PATTERN = (
    r"(?:"
    r"bana(?:o|do|de)?|bna(?:o|do|de)?|banado|bnado|"
    r"bana\s+(?:do|de|sakte\s+ho|skte\s+ho|doge|dijiye|ke\s+do|ke\s+de)|"
    r"bna\s+(?:do|de|sakte\s+ho|skte\s+ho|doge|dijiye|ke\s+do|ke\s+de)|"
    r"dikha(?:o|do|de)?|chahiye|chahie|chaie|"
    r"generate|create|make|draw|drow|design|render|paint|sketch|visualize|show\s+me|"
    r"बना(?:ओ|ना)?|बना\s*(?:दो|दे|सकते\s*हो|दोगे|दीजिए|के\s*दो)|दिखाओ|दिखा\s*दो|चाहिए"
    r")"
)

_IMAGE_NOUN_RE = re.compile(rf"(?:^|\s|[^\w\u0900-\u097F]){_NOUN_PATTERN}(?:$|\s|[^\w\u0900-\u097F])", re.I)
_IMAGE_VERB_RE = re.compile(rf"(?:^|\s|[^\w\u0900-\u097F]){_VERB_PATTERN}(?:$|\s|[^\w\u0900-\u097F])", re.I)

# Direct drawing verbs without needing an explicit "image/photo" noun
_DIRECT_DRAW_RE = re.compile(
    r"^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:draw|drow|sketch|paint)\s+(?:me\s+)?(?:an?\s+|the\s+)?[a-z0-9\u0900-\u097F]",
    re.I,
)

# Capability questions like "kya tum kutte ki image bna sakte ho" -> create immediately
_CAPABILITY_RE = re.compile(
    r"(?:kya\s+(?:tum|aap)|can\s+you|could\s+you|are\s+you\s+able\s+to|क्या\s+(?:तुम|आप)).*"
    rf"(?:bna\s+s(?:a)?kte|bana\s+s(?:a)?kte|bna\s+doge|bana\s+doge|बना\s*सकते|create|generate|make|draw|drow|design)",
    re.I,
)

# Negative rules -> MUST stay normal chat
_EXPLICIT_ASCII_OR_MARKUP_RE = re.compile(
    r"\b(?:ascii\s*art|text\s*art|art\s+in\s+ascii|draw\s+with\s+(?:text|characters|symbols)|"
    r"svg\s*(?:code|icon|markup|example)?|html\s*(?:canvas|code)|css\s*(?:art|drawing)|"
    r"turtle\s+graphics|matplotlib|pillow|pil\b|opencv|cv2)\b",
    re.I,
)

_CODE_TUTORIAL_RE = re.compile(
    r"\b(?:code|script|program|function|snippet|library|api|endpoint|resize|crop|compress|"
    r"convert|upload|base64|download|fetch|python|javascript|typescript|react|java|c\+\+|html|css|sql)\b",
    re.I,
)

_INFO_QUESTION_RE = re.compile(
    r"(?:"
    r"\b(?:kaise\s+(?:generate|banta|banti|kaam|work|resize)|how\s+(?:do|does|are|is|to)|"
    r"ke\s+baare\s+mein|ke\s+bare\s+me|what\s+is|what\s+are|explain|describe|tell\s+me\s+about|"
    r"history\s+of|why\s+do|types\s+of|difference\s+between|facts\s+about|tutorial|guide)\b|"
    r"(?:कैसे\s*(?:बनाते|बनती|जनरेट)|के\s*बारे\s*में\s*बताओ)"
    r")",
    re.I,
)

_VISION_ASK_RE = re.compile(
    r"\b(?:isme\s+kya|is\s+image\s+mein|is\s+photo\s+mein|what\s+is\s+in|what's\s+in|"
    r"read\s+this|solve\s+this|transcribe|explain\s+this|summarize\s+this)\b|"
    r"(?:इसमें\s*क्या|यह\s*क्या\s*है|पढ़ो|बताओ)",
    re.I,
)

# Follow-up triggers when last assistant message was an image
_FOLLOWUP_ANOTHER_RE = re.compile(
    r"^\s*(?:ek\s+aur(?:\s+banao|\s+bana\s+do)?|aur\s+ek(?:\s+banao)?|another\s+one|one\s+more|"
    r"do\s+another|regenerate|dobara\s+banao|phir\s+se(?:\s+banao)?|variation|new\s+version|एक\s*और(?:\s*बनाओ)?)\s*[!?.]*\s*$",
    re.I,
)

_FOLLOWUP_EDIT_RE = re.compile(
    r"(?:"
    r"\b(?:isko|ise|isey|is\s+image\s+ko|make\s+it|change\s+(?:it|the|background|color)|"
    r"turn\s+it|switch\s+(?:to|it)|night\s+mein|dark\s+karo|aur\s+dark|brighter|darker|"
    r"wahi\s+par|same\s+but|add\s+(?:a|some)|remove\s+(?:the|a)|badlo|badal\s+do|"
    r"color\s+mein|style\s+mein|in\s+night|at\s+night|at\s+sunset|in\s+snow|cartoon\s+mein|"
    r"इसमें|इसको|रात\s*में\s*बदलो|और\s*डार्क)\b"
    r")",
    re.I,
)

_STIP_META_RE = re.compile(
    r"(?:kya\s+(?:tum|aap)|can\s+you|could\s+you|please|mujhe|mere\s+liye|bhai|yaar|bro|"
    r"bana(?:o|do|de|\s+sakte\s+ho|\s+doge|\s+ke\s+do)|bna(?:o|do|de|\s+sakte\s+ho|\s+doge)?|"
    r"generate|create|make|draw|design|dikhao|chahiye|chahie|"
    r"ki\s+(?:image|imge|photo|tasveer|pic)|ka\s+(?:image|photo|tasveer|pic)|"
    r"an?\s+(?:image|photo|picture|pic|drawing|sketch)\s+of)\s*",
    re.I,
)


def infer_style_and_aspect(text: str) -> tuple[Optional[str], Optional[str]]:
    low = (text or "").lower()
    style = None
    aspect = None

    if re.search(r"\b(minimal\s+logo|logo|emblem|brand\s*mark|monogram)\b|लोगो", low):
        style = "Minimal logo"
        aspect = "1:1"
    elif re.search(r"\b(anime|manga|chibi|studio\s+ghibli)\b", low):
        style = "Anime"
    elif re.search(r"\b(3d|three\s*-?\s*dimensional|pixar|blender|cgi|clay)\b", low):
        style = "3D render"
    elif re.search(r"\b(illustration|cartoon|sketch|drawing|draw|drow|painting|paint|watercolor|oil\s+paint|fantasy|art)\b|पेंटिंग|स्केच|चित्र", low):
        style = "Illustration"
    elif re.search(r"\b(cinematic|movie\s+still|poster|dramatic|cyberpunk|epic)\b|पोस्टर", low):
        style = "Cinematic"
    elif re.search(r"\b(photo|photograph|realistic|real|portrait|product|biryani|food|car|room|street|flower|lotus|bird|dog|kutte|billi|cat)\b|फोटो|तस्वीर", low):
        style = "Realistic photo"

    if re.search(r"\b(16:9|wallpaper|banner|landscape|wide|youtube\s+thumbnail|living\s+room|interior|city\s+street|sports\s+car)\b|वॉलपेपर", low) and "phone" not in low and "mobile" not in low:
        aspect = aspect or "16:9"
    elif re.search(r"\b(9:16|phone\s+wallpaper|mobile\s+wallpaper|reel|story|vertical|tall)\b", low):
        aspect = "9:16"
    elif re.search(r"\b(4:5|poster|portrait)\b|पोस्टर", low):
        aspect = "4:5"
    elif re.search(r"\b(1:1|square|logo|avatar|dp|icon)\b|लोगो", low):
        aspect = "1:1"

    return style, aspect


def _extract_last_image_context(recent_context: Optional[List[Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
    if not recent_context or not isinstance(recent_context, list):
        return None
    for msg in reversed(recent_context):
        if not isinstance(msg, dict):
            continue
        if msg.get("role") == "assistant":
            if msg.get("mediaType") == "image" or msg.get("mediaPrompt") or msg.get("finalPrompt"):
                return {
                    "prompt": msg.get("originalRequest") or msg.get("mediaPrompt") or msg.get("finalPrompt") or "",
                    "final_prompt": msg.get("finalPrompt") or msg.get("mediaPrompt") or "",
                    "seed": msg.get("seed"),
                    "style": msg.get("style"),
                    "aspect": msg.get("aspect"),
                }
            # Only look at the immediately preceding assistant message for follow-ups
            return None
    return None


def _rough_subject(text: str) -> str:
    cleaned = _STIP_META_RE.sub(" ", text or "")
    cleaned = re.sub(r"[?।!]+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or (text or "").strip()


async def _run_layer_b_classifier(user_message: str) -> Optional[Dict[str, Any]]:
    api_key = (os.environ.get("LLM_API_KEY") or getattr(settings, "llm_api_key", "") or "").strip()
    base_url = (os.environ.get("LLM_BASE_URL") or getattr(settings, "llm_base_url", "") or "").strip().rstrip("/")
    model = (os.environ.get("LLM_MODEL") or getattr(settings, "llm_model", "") or "").strip()
    if not api_key or not base_url or not model:
        return None

    system_msg = (
        "You classify whether a user message is asking the assistant to CREATE a new visual image now, "
        "or asking a regular text/code/explanation question. Reply ONLY strict JSON:\n"
        '{"intent":"image"|"chat","confidence":0.0,"subject":""}\n'
        "Rules:\n"
        "- Choose 'image' ONLY if user clearly wants a new picture/image/photo/logo/poster generated now "
        "(including Hinglish/Hindi requests like 'kutte ki pic bna de').\n"
        "- Choose 'chat' for questions ABOUT how images work, code/scripts/HTML/SVG/ASCII art requests, "
        "knowledge questions ('kutte ke baare mein batao'), or analyzing uploaded files."
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": (user_message or "")[:400]},
        ],
        "temperature": 0.0,
        "max_tokens": 450,
    }
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            res = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            if res.status_code != 200:
                return None
            raw = res.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            m = re.search(r"\{.*\}", raw, re.S)
            if m:
                raw = m.group(0)
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and parsed.get("intent") in ("image", "chat"):
                return {
                    "intent": parsed["intent"],
                    "confidence": float(parsed.get("confidence", 0.7)),
                    "subject": str(parsed.get("subject") or "").strip(),
                }
    except Exception as exc:
        logger.debug("[AUTONEXIS ROUTER] Layer B fallback skipped: %s", type(exc).__name__)
    return None


async def detect_image_intent(
    user_message: str,
    recent_context: Optional[List[Dict[str, Any]]] = None,
    has_uploaded_image: bool = False,
    allow_classifier: bool = True,
) -> Dict[str, Any]:
    """
    App-level router executed BEFORE the chat LLM.
    Returns {intent, confidence, subject, style, aspect, reason, previous_prompt, previous_seed, variation}.
    """
    text = (user_message or "").strip()
    inferred_style, inferred_aspect = infer_style_and_aspect(text)

    if not text:
        return {
            "intent": "chat",
            "confidence": 1.0,
            "subject": "",
            "style": None,
            "aspect": None,
            "reason": "rule:empty",
            "previous_prompt": None,
            "previous_seed": None,
            "variation": False,
        }

    # 1. Uploaded image + question -> vision chat, NEVER image generation
    if has_uploaded_image and (_VISION_ASK_RE.search(text) or not (_IMAGE_VERB_RE.search(text) and _IMAGE_NOUN_RE.search(text))):
        return {
            "intent": "chat",
            "confidence": 0.98,
            "subject": "",
            "style": None,
            "aspect": None,
            "reason": "rule:neg_uploaded_image_vision",
            "previous_prompt": None,
            "previous_seed": None,
            "variation": False,
        }

    # 2. Explicit ASCII art / SVG / HTML / code art requests -> stay chat
    if _EXPLICIT_ASCII_OR_MARKUP_RE.search(text):
        return {
            "intent": "chat",
            "confidence": 0.99,
            "subject": "",
            "style": None,
            "aspect": None,
            "reason": "rule:neg_ascii_or_code_art",
            "previous_prompt": None,
            "previous_seed": None,
            "variation": False,
        }

    # 3. Code / script / resize tutorial about images -> stay chat
    if _CODE_TUTORIAL_RE.search(text):
        return {
            "intent": "chat",
            "confidence": 0.96,
            "subject": "",
            "style": None,
            "aspect": None,
            "reason": "rule:neg_code_tutorial",
            "previous_prompt": None,
            "previous_seed": None,
            "variation": False,
        }

    has_noun = bool(_IMAGE_NOUN_RE.search(text))
    has_verb = bool(_IMAGE_VERB_RE.search(text))
    has_capability = bool(_CAPABILITY_RE.search(text))
    word_count = len(text.split())

    # 4. Informational questions ("image kaise generate hoti hai", "kutte ke baare mein batao") -> chat
    if _INFO_QUESTION_RE.search(text) and not has_capability:
        return {
            "intent": "chat",
            "confidence": 0.96,
            "subject": "",
            "style": None,
            "aspect": None,
            "reason": "rule:neg_info_question",
            "previous_prompt": None,
            "previous_seed": None,
            "variation": False,
        }

    # 5. Follow-up edits/variations when previous assistant turn was a generated image
    last_img = _extract_last_image_context(recent_context)
    if last_img and word_count <= 14:
        prev_prompt = last_img.get("final_prompt") or last_img.get("prompt") or ""
        prev_seed = last_img.get("seed")
        if _FOLLOWUP_ANOTHER_RE.search(text):
            return {
                "intent": "image_edit",
                "confidence": 0.96,
                "subject": last_img.get("prompt") or prev_prompt,
                "style": inferred_style or last_img.get("style"),
                "aspect": inferred_aspect or last_img.get("aspect"),
                "reason": "rule:followup_variation",
                "previous_prompt": prev_prompt,
                "previous_seed": None,  # new seed for another one
                "variation": True,
            }
        if _FOLLOWUP_EDIT_RE.search(text):
            return {
                "intent": "image_edit",
                "confidence": 0.92,
                "subject": f"{last_img.get('prompt') or prev_prompt}. Apply change: {text}",
                "style": inferred_style or last_img.get("style"),
                "aspect": inferred_aspect or last_img.get("aspect"),
                "reason": "rule:followup_edit",
                "previous_prompt": prev_prompt,
                "previous_seed": prev_seed,
                "variation": False,
            }

    # 6. Clear Layer A positive matches
    if has_capability and (has_noun or _DIRECT_DRAW_RE.search(text)):
        return {
            "intent": "image",
            "confidence": 0.95,
            "subject": _rough_subject(text),
            "style": inferred_style,
            "aspect": inferred_aspect,
            "reason": "rule:capability_image_request",
            "previous_prompt": None,
            "previous_seed": None,
            "variation": False,
        }

    if has_noun and has_verb:
        return {
            "intent": "image",
            "confidence": 0.96,
            "subject": _rough_subject(text),
            "style": inferred_style,
            "aspect": inferred_aspect,
            "reason": "rule:verb_plus_noun",
            "previous_prompt": None,
            "previous_seed": None,
            "variation": False,
        }

    if _DIRECT_DRAW_RE.search(text) and word_count <= 20:
        return {
            "intent": "image",
            "confidence": 0.92,
            "subject": _rough_subject(text),
            "style": inferred_style or "Illustration",
            "aspect": inferred_aspect,
            "reason": "rule:direct_draw_verb",
            "previous_prompt": None,
            "previous_seed": None,
            "variation": False,
        }

    # 7. Borderline? Trigger Layer B classifier ONLY if noun-only or creation-verb-only or short visual phrase
    is_unsure = (has_noun or has_verb) and word_count <= 16
    if is_unsure and allow_classifier:
        clf = await _run_layer_b_classifier(text)
        if clf:
            return {
                "intent": clf["intent"] if clf["confidence"] >= 0.72 else "chat",
                "confidence": clf["confidence"],
                "subject": clf["subject"] or _rough_subject(text),
                "style": inferred_style,
                "aspect": inferred_aspect,
                "reason": "classifier:layer_b_json",
                "previous_prompt": None,
                "previous_seed": None,
                "variation": False,
            }

    # Default normal chat (medium confidence hint preserved for client ASCII defense when noun exists)
    return {
        "intent": "chat",
        "confidence": 0.55 if is_unsure else 0.95,
        "subject": "",
        "style": inferred_style,
        "aspect": inferred_aspect,
        "reason": "rule:default_chat",
        "previous_prompt": None,
        "previous_seed": None,
        "variation": False,
    }
