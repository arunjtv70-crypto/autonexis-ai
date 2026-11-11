"""
Unified Backend Image Service:
- Fail-closed dual-stage safety moderation (request + enhanced prompt)
- Repeated-violation cooldown tracking (3 strikes in 10 min -> 10-min block)
- Subject-agnostic Hinglish/Hindi/English prompt enhancer -> strict JSON
- Per-user concurrency, 15s cooldown, hourly/daily quotas, global circuit breaker
- Calls swappable image_adapter and returns JPEG + natural caption
Never exposes provider names, model IDs, or keys to the caller.
"""

from datetime import datetime, timezone
import json
import logging
import os
import random
import re
import time
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx

from config import settings
from image_adapter import ImageProviderError, image_adapter
from image_blocklist import check_blocklist, detect_script_language, get_calm_refusal_message
from image_router import _rough_subject, infer_style_and_aspect
from prompts import IMAGE_ENHANCER_SYSTEM_PROMPT, IMAGE_MODERATION_SYSTEM_PROMPT

logger = logging.getLogger("autonexis.image.service")

VALID_STYLES = (
    "Realistic photo",
    "Cinematic",
    "Illustration",
    "Anime",
    "3D render",
    "Minimal logo",
)

ASPECT_DIMENSIONS: Dict[str, Tuple[int, int]] = {
    "1:1": (1024, 1024),
    "4:5": (896, 1120),
    "16:9": (1280, 720),
    "9:16": (720, 1280),
}

BASE_NEGATIVE = (
    "blurry, low quality, pixelated, distorted, deformed anatomy, "
    "extra fingers, mutated hands, ugly, watermark, signature, logo overlay, cropped, out of frame"
)

# Per-user safety violation tracking: uid -> [timestamps] & cooldown_until
_VIOLATION_TIMESTAMPS: Dict[str, List[float]] = {}
_VIOLATION_COOLDOWN_UNTIL: Dict[str, float] = {}

# Per-user image rate & concurrency state
_ACTIVE_USER_GENERATIONS: Set[str] = set()
_USER_LAST_REQUEST_TS: Dict[str, float] = {}
_USER_HOURLY_TIMESTAMPS: Dict[str, List[float]] = {}
_USER_DAILY_COUNTS: Dict[str, Tuple[str, int]] = {}

# Global circuit breaker protecting image quota cleanly (independent from text chat)
_PROVIDER_STRIKES: List[float] = []
_IMAGE_CIRCUIT_OPEN_UNTIL: float = 0.0


class ImageServiceError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400,
        blocked: bool = False,
        category: Optional[str] = None,
        rate_limited: bool = False,
        retry_after: Optional[int] = None,
        moderation_log: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.blocked = blocked
        self.category = category
        self.rate_limited = rate_limited
        self.retry_after = retry_after
        self.moderation_log = moderation_log


def _cfg_int(env_key: str, setting_attr: str, default: int) -> int:
    try:
        raw = os.environ.get(env_key)
        if raw is not None and raw.strip():
            return max(1, int(raw))
        return max(1, int(getattr(settings, setting_attr, default)))
    except Exception:
        return default


def _get_llm_credentials() -> Tuple[str, str, str]:
    api_key = (os.environ.get("LLM_API_KEY") or getattr(settings, "llm_api_key", "") or "").strip()
    base_url = (os.environ.get("LLM_BASE_URL") or getattr(settings, "llm_base_url", "") or "").strip().rstrip("/")
    model = (os.environ.get("LLM_MODEL") or getattr(settings, "llm_model", "") or "").strip()
    return api_key, base_url, model


def _normalize_prompt_ascii(text: str) -> str:
    rep = {
        "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-",
        "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u00a0": " ",
    }
    out = (text or "")
    for k, v in rep.items():
        out = out.replace(k, v)
    return re.sub(r"\s+", " ", out).strip()


def _strip_json_fences(raw: str) -> str:
    txt = (raw or "").strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```[a-zA-Z]*\n?", "", txt)
        txt = re.sub(r"\n?```$", "", txt).strip()
    m = re.search(r"\{.*\}", txt, re.S)
    return m.group(0) if m else txt


def check_violation_cooldown(uid: str, user_text: str) -> None:
    now = time.time()
    until = _VIOLATION_COOLDOWN_UNTIL.get(uid, 0.0)
    if now < until:
        lang = detect_script_language(user_text)
        wait_min = max(1, int((until - now + 59) // 60))
        if lang == "hi":
            msg = f"सुरक्षा कारणों से इमेज निर्माण लगभग {wait_min} मिनट के लिए रोका गया है। कृपया सामान्य चैट जारी रखें।"
        elif lang == "hinglish":
            msg = f"Safety checks ke kaaran image creation lagbhag {wait_min} minute ke liye pause hai. Aap normal chat continue kar sakte hain."
        else:
            msg = f"Image creation is paused for about {wait_min} minute(s) after repeated safety blocks. Text chat still works normally."
        raise ImageServiceError(
            msg,
            status_code=429,
            blocked=True,
            category="violation_cooldown",
            rate_limited=True,
            retry_after=int(until - now),
        )


def record_violation(uid: str, category: str) -> Dict[str, Any]:
    now = time.time()
    recent = [t for t in _VIOLATION_TIMESTAMPS.get(uid, []) if now - t < 600.0]
    recent.append(now)
    _VIOLATION_TIMESTAMPS[uid] = recent
    cooldown_triggered = False
    if len(recent) >= 3:
        _VIOLATION_COOLDOWN_UNTIL[uid] = now + 600.0
        cooldown_triggered = True
    logger.info("[AUTONEXIS IMAGE MODERATION] Blocked request category=%s cooldown=%s", category, cooldown_triggered)
    return {
        "uid": uid,
        "category": category,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cooldownTriggered": cooldown_triggered,
    }


async def moderate_image_text(text: str) -> Tuple[bool, str]:
    """
    Fail-closed two-step moderation:
    1) Deterministic multi-script blocklist
    2) Fast LLM JSON safety classifier
    Returns (allowed, category).
    """
    allowed_bl, bl_cat = check_blocklist(text)
    if not allowed_bl:
        return False, bl_cat or "unsafe"

    api_key, base_url, model = _get_llm_credentials()
    if not api_key or not base_url or not model:
        # Strict fail-closed policy
        return False, "moderation_unavailable"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": IMAGE_MODERATION_SYSTEM_PROMPT},
            {"role": "user", "content": (text or "")[:800]},
        ],
        "temperature": 0.0,
        "max_tokens": 450,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            if res.status_code != 200:
                return False, "moderation_unavailable"
            raw = res.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            parsed = json.loads(_strip_json_fences(raw))
            if not isinstance(parsed, dict) or "allowed" not in parsed:
                return False, "moderation_uncertain"
            if parsed.get("allowed") is True:
                return True, "safe"
            cat = str(parsed.get("category") or "unsafe").strip()
            return False, cat
    except Exception:
        return False, "moderation_unavailable"


async def enhance_image_request(
    user_request: str,
    requested_style: Optional[str] = None,
    requested_aspect: Optional[str] = None,
    previous_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Converts Hindi/Hinglish/English request into strict JSON and produces one
    high-quality subject-agnostic English visual prompt with matched preset/aspect.
    """
    inferred_style, inferred_aspect = infer_style_and_aspect(user_request)
    chosen_style = requested_style if requested_style in VALID_STYLES else None
    chosen_aspect = requested_aspect if requested_aspect in ASPECT_DIMENSIONS else None

    api_key, base_url, model = _get_llm_credentials()
    user_payload = f"USER REQUEST: {user_request.strip()[:600]}"
    if previous_prompt:
        user_payload += f"\nPREVIOUS IMAGE PROMPT TO MODIFY/EXTEND: {previous_prompt.strip()[:500]}"
    if chosen_style:
        user_payload += f"\nREQUESTED STYLE PRESET: {chosen_style}"
    elif inferred_style:
        user_payload += f"\nHINTED STYLE: {inferred_style}"
    if chosen_aspect:
        user_payload += f"\nREQUESTED ASPECT: {chosen_aspect}"
    elif inferred_aspect:
        user_payload += f"\nHINTED ASPECT: {inferred_aspect}"

    if api_key and base_url and model:
        import asyncio as _asyncio
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=14.0) as client:
                    res = await client.post(
                        f"{base_url}/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={
                            "model": model,
                            "messages": [
                                {"role": "system", "content": IMAGE_ENHANCER_SYSTEM_PROMPT},
                                {"role": "user", "content": user_payload},
                            ],
                            "temperature": 0.25,
                            "max_tokens": 900,
                        },
                    )
                    if res.status_code == 200:
                        raw = res.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                        parsed = json.loads(_strip_json_fences(raw))
                        if isinstance(parsed, dict) and parsed.get("enhanced_prompt"):
                            final_style = chosen_style or (
                                parsed.get("style") if parsed.get("style") in VALID_STYLES else (inferred_style or "Realistic photo")
                            )
                            final_aspect = chosen_aspect or (
                                parsed.get("aspect") if parsed.get("aspect") in ASPECT_DIMENSIONS else (inferred_aspect or "1:1")
                            )
                            has_text = bool(parsed.get("has_text_overlay"))
                            text_overlay = str(parsed.get("text_overlay") or "").strip()[:80]
                            subject = _normalize_prompt_ascii(str(parsed.get("subject") or _rough_subject(user_request)))[:160]
                            enhanced = _normalize_prompt_ascii(str(parsed.get("enhanced_prompt") or ""))[:600]
                            neg = _normalize_prompt_ascii(str(parsed.get("negative") or ""))[:400]
                            if not neg:
                                neg = BASE_NEGATIVE if has_text else f"{BASE_NEGATIVE}, text, letters, words"
                            elif not has_text and "text" not in neg.lower():
                                neg = f"{neg}, text, words, letters"
                            w, h = ASPECT_DIMENSIONS.get(final_aspect, (1024, 1024))
                            return {
                                "subject": subject or _rough_subject(user_request),
                                "style": final_style,
                                "aspect": final_aspect,
                                "width": w,
                                "height": h,
                                "enhanced_prompt": enhanced,
                                "negative": neg,
                                "has_text_overlay": has_text,
                                "text_overlay": text_overlay,
                            }
                    elif res.status_code in (429, 503) and attempt == 0:
                        await _asyncio.sleep(1.4)
                        continue
            except Exception as exc:
                logger.debug("[AUTONEXIS IMAGE] Enhancer LLM attempt %d skipped: %s", attempt + 1, type(exc).__name__)
                if attempt == 0:
                    await _asyncio.sleep(1.0)
                    continue

    # Neutral lighting-aware rule-based fallback
    subject = _rough_subject(user_request)
    if previous_prompt:
        subject = f"{previous_prompt}, {user_request}".strip()
    final_style = chosen_style or inferred_style or "Realistic photo"
    final_aspect = chosen_aspect or inferred_aspect or "1:1"
    w, h = ASPECT_DIMENSIONS.get(final_aspect, (1024, 1024))

    low_req = user_request.lower()
    is_night = any(tok in low_req for tok in ("night", "neon", "midnight", "evening", "sunset"))
    is_white_studio = "white background" in low_req or "product" in low_req
    photo_desc = (
        "moody evening ambient lighting, glowing wet reflections, crisp detail, 35mm lens, balanced composition"
        if is_night
        else "pure seamless white studio cyclorama backdrop, soft commercial softbox lighting, crisp product silhouette, no people"
        if is_white_studio
        else "natural photography lighting, sharp focus, authentic textures, 50mm lens, balanced composition"
    )
    style_suffix = {
        "Realistic photo": photo_desc,
        "Cinematic": "cinematic lighting, dramatic atmosphere, rich depth, filmic composition, crisp detail",
        "Illustration": "detailed clean digital illustration, crisp linework, balanced color palette, studio composition",
        "Anime": "refined anime artwork, expressive clean shading, crisp edges, vibrant harmonious palette",
        "3D render": "clean 3D studio render, soft global illumination, tactile smooth materials, sharp detail",
        "Minimal logo": "minimal flat vector logo mark, clean geometric silhouette, centered on solid neutral backdrop, crisp edges",
    }.get(final_style, photo_desc)

    has_text = bool(re.search(r"\b(poster|logo|banner|text|typography)\b|पोस्टर|लोगो", user_request, re.I))
    neg = BASE_NEGATIVE if has_text else f"{BASE_NEGATIVE}, text, letters, words"
    return {
        "subject": subject[:160],
        "style": final_style,
        "aspect": final_aspect,
        "width": w,
        "height": h,
        "enhanced_prompt": f"{subject}, {style_suffix}"[:600],
        "negative": neg,
        "has_text_overlay": has_text,
        "text_overlay": "",
    }


def build_natural_caption(user_request: str, subject: str, style: str, is_edit: bool = False) -> str:
    """Builds a natural, non-heading caption in the user's script without calling the big LLM."""
    lang = detect_script_language(user_request)
    short_subj = (subject or "your image").strip().rstrip(".")
    if len(short_subj) > 60:
        short_subj = short_subj[:57].rsplit(" ", 1)[0] + "..."

    if lang == "hi":
        if is_edit:
            return f"यह रहा अपडेटेड वर्ज़न ({short_subj})। और कोई बदलाव चाहिए तो बताइए।"
        return f"यह रही {short_subj} की तस्वीर। अगर स्टाइल या रंग बदलना हो तो बताइए।"

    if lang == "hinglish":
        if is_edit:
            return f"Ye lo, naya version ({short_subj}) taiyaar hai. Kuch aur badalna ho toh bataiye."
        return f"Ye lo, {short_subj} ki image taiyaar hai. Style ya kuch badalna ho toh bata dijiye."

    if is_edit:
        return f"Updated visual ready ({short_subj}). Let me know if you want to refine anything else."
    return f"Here is your visual of {short_subj}. Let me know if you want any adjustments or a variation."


def _check_circuit_breaker() -> None:
    if time.time() < _IMAGE_CIRCUIT_OPEN_UNTIL:
        raise ImageServiceError(
            "Images are busy, please try again shortly",
            status_code=503,
            rate_limited=True,
            retry_after=max(5, int(_IMAGE_CIRCUIT_OPEN_UNTIL - time.time())),
        )


def _record_provider_strike() -> None:
    global _PROVIDER_STRIKES, _IMAGE_CIRCUIT_OPEN_UNTIL
    now = time.time()
    _PROVIDER_STRIKES = [t for t in _PROVIDER_STRIKES if now - t < 60.0]
    _PROVIDER_STRIKES.append(now)
    if len(_PROVIDER_STRIKES) >= 2:
        _IMAGE_CIRCUIT_OPEN_UNTIL = max(_IMAGE_CIRCUIT_OPEN_UNTIL, now + 45.0)
        logger.warning("[AUTONEXIS IMAGE] Circuit breaker opened for 45s after repeated rate limits.")


def _check_and_reserve_user_quota(uid: str, user_request: str) -> None:
    now = time.time()
    lang = detect_script_language(user_request)

    if uid in _ACTIVE_USER_GENERATIONS:
        msg = (
            "आपकी एक इमेज अभी बन रही है। कृपया उसके पूरा होने की प्रतीक्षा करें।"
            if lang == "hi"
            else "Abhi aapki ek image ban rahi hai. Uske complete hone ka wait kijiye."
            if lang == "hinglish"
            else "One image is already generating for your account. Please wait a moment."
        )
        raise ImageServiceError(msg, status_code=429, rate_limited=True, retry_after=5)

    cooldown = _cfg_int("IMAGE_COOLDOWN_SECONDS", "image_cooldown_seconds", 15)
    last_ts = _USER_LAST_REQUEST_TS.get(uid, 0.0)
    if last_ts and (now - last_ts < cooldown):
        rem = max(1, int(cooldown - (now - last_ts)))
        msg = (
            f"कृपया अगली इमेज बनाने से पहले {rem} सेकंड रुकें।"
            if lang == "hi"
            else f"Agli image ke liye {rem} second wait kijiye."
            if lang == "hinglish"
            else f"Please wait {rem} second(s) before creating another image."
        )
        raise ImageServiceError(msg, status_code=429, rate_limited=True, retry_after=rem)

    hourly_limit = _cfg_int("IMAGE_HOURLY_LIMIT", "image_hourly_limit", 10)
    recent_hour = [t for t in _USER_HOURLY_TIMESTAMPS.get(uid, []) if now - t < 3600.0]
    if len(recent_hour) >= hourly_limit:
        msg = (
            "घंटे की इमेज सीमा पूरी हो गई है। आप सामान्य चैट जारी रख सकते हैं या थोड़ी देर बाद प्रयास कर सकते हैं।"
            if lang == "hi"
            else "Hourly image limit poori ho gayi hai. Normal chat chalti rahegi; thodi der baad try karein."
            if lang == "hinglish"
            else f"Hourly limit of {hourly_limit} images reached. Normal text chat still works; please try again later."
        )
        raise ImageServiceError(msg, status_code=429, rate_limited=True, retry_after=300)

    daily_limit = _cfg_int("IMAGE_DAILY_LIMIT", "image_daily_limit", 30)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day_key, day_count = _USER_DAILY_COUNTS.get(uid, (today, 0))
    if day_key != today:
        day_key, day_count = today, 0
    if day_count >= daily_limit:
        msg = (
            "आज की इमेज सीमा पूरी हो गई है। आप सामान्य टेक्स्ट चैट जारी रख सकते हैं।"
            if lang == "hi"
            else "Aaj ki image limit poori ho gayi hai. Aap normal chat continue kar sakte hain."
            if lang == "hinglish"
            else f"Daily limit of {daily_limit} images reached. You can continue chatting normally anytime."
        )
        raise ImageServiceError(msg, status_code=429, rate_limited=True, retry_after=3600)

    _ACTIVE_USER_GENERATIONS.add(uid)
    _USER_LAST_REQUEST_TS[uid] = now
    recent_hour.append(now)
    _USER_HOURLY_TIMESTAMPS[uid] = recent_hour
    _USER_DAILY_COUNTS[uid] = (day_key, day_count + 1)


async def execute_image_generation(
    uid: str,
    user_request: str,
    style: Optional[str] = None,
    aspect: Optional[str] = None,
    seed: Optional[int] = None,
    previous_prompt: Optional[str] = None,
    is_edit: bool = False,
    bypass_quota: bool = False,
) -> Dict[str, Any]:
    """
    Executes full image pipeline:
    1) Violation cooldown check
    2) Moderation Stage 1 (raw request, fail-closed)
    3) Quota & circuit-breaker checks
    4) Prompt enhancement (Hinglish/Hindi/English -> detailed English JSON)
    5) Moderation Stage 2 (enhanced prompt, fail-closed)
    6) Provider adapter call -> JPEG bytes + sanitized metadata
    """
    clean_req = (user_request or "").strip()[:1200]
    if not clean_req:
        raise ImageServiceError("Please describe what image you want to create.", status_code=400)

    check_violation_cooldown(uid, clean_req)

    # Moderation check #1 (fail closed) BEFORE reserving image quota
    allowed_1, cat_1 = await moderate_image_text(clean_req)
    if not allowed_1:
        mod_log = record_violation(uid, cat_1)
        raise ImageServiceError(
            get_calm_refusal_message(clean_req, cat_1),
            status_code=400,
            blocked=True,
            category=cat_1,
            moderation_log=mod_log,
        )

    _check_circuit_breaker()

    if not bypass_quota:
        _check_and_reserve_user_quota(uid, clean_req)
    else:
        _ACTIVE_USER_GENERATIONS.add(uid)

    try:
        enhanced = await enhance_image_request(
            clean_req,
            requested_style=style,
            requested_aspect=aspect,
            previous_prompt=previous_prompt,
        )

        # Moderation check #2 on enhanced English prompt (fail closed)
        allowed_2, cat_2 = await moderate_image_text(enhanced["enhanced_prompt"])
        if not allowed_2:
            mod_log = record_violation(uid, cat_2)
            raise ImageServiceError(
                get_calm_refusal_message(clean_req, cat_2),
                status_code=400,
                blocked=True,
                category=cat_2,
                moderation_log=mod_log,
            )

        chosen_seed = int(seed) if (seed is not None and 0 <= int(seed) <= 2_147_483_647) else random.randint(100000, 9999999)

        adapter_res = await image_adapter.generate(
            prompt=enhanced["enhanced_prompt"],
            negative_prompt=enhanced["negative"],
            width=enhanced["width"],
            height=enhanced["height"],
            seed=chosen_seed,
            needs_text=bool(enhanced.get("has_text_overlay")),
        )

        caption = build_natural_caption(
            clean_req,
            enhanced["subject"],
            enhanced["style"],
            is_edit=is_edit,
        )

        warnings: List[str] = []
        if enhanced.get("has_text_overlay"):
            warnings.append("Text inside generated images may need minor adjustments if wording looks slightly off.")
        if adapter_res.provider_warning:
            warnings.append(adapter_res.provider_warning)

        return {
            "jpeg_bytes": adapter_res.jpeg_bytes,
            "original_request": clean_req,
            "subject": enhanced["subject"],
            "final_prompt": enhanced["enhanced_prompt"],
            "negative_prompt": enhanced["negative"],
            "style": enhanced["style"],
            "aspect": enhanced["aspect"],
            "width": adapter_res.width,
            "height": adapter_res.height,
            "seed": adapter_res.seed,
            "model": adapter_res.quality_tier,  # Never expose third-party provider/model name
            "caption": caption,
            "anonymous_mode": adapter_res.anonymous_mode,
            "warnings": warnings,
        }

    except ImageProviderError as perr:
        if perr.is_rate_limit:
            _record_provider_strike()
        raise ImageServiceError(
            perr.detail,
            status_code=perr.status_code,
            rate_limited=perr.is_rate_limit,
            retry_after=perr.retry_after,
        )
    finally:
        _ACTIVE_USER_GENERATIONS.discard(uid)
