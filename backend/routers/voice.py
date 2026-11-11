"""
Voice Call Endpoints: Speech-to-Text (/voice/transcribe) & Optional English TTS (/voice/speak).

Reuses the existing Firebase authentication dependency (get_current_user) verbatim.
Never stores audio anywhere and never logs user transcripts.
"""

from datetime import datetime, timezone
import logging
import os
import re
import time
from typing import Dict, List, Optional, Tuple
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from auth_utils import get_current_user
from config import settings
from database import User
from speech_adapter import SpeechProviderError, speech_adapter

logger = logging.getLogger("autonexis.voice")

router = APIRouter(tags=["Voice Call"])

MAX_AUDIO_BYTES = 3_800_000  # Safely under Vercel's 4.5 MB request body limit
MIN_AUDIO_BYTES = 120
MAX_AUDIO_DURATION_SEC = 35.0
MAX_TTS_CHARS = 300
UPSTREAM_TTS_SAFE_CHARS = 200

ALLOWED_AUDIO_MIME_TYPES = {
    "audio/webm",
    "video/webm",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/mpeg",
    "audio/mp3",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
}
ALLOWED_AUDIO_EXTENSIONS = (".webm", ".mp4", ".m4a", ".aac", ".mp3", ".mpeg", ".ogg", ".wav")
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")

# Best-effort per-instance rate limiting & daily audio budget tracking (zero transcripts logged)
_USER_VOICE_TIMESTAMPS: Dict[str, List[float]] = {}
_USER_DAILY_AUDIO_SEC: Dict[str, Tuple[str, float]] = {}

# Global soft circuit breakers protecting free-tier quotas (independent from text chat)
_STT_RATE_STRIKES: List[float] = []
_STT_CIRCUIT_OPEN_UNTIL: float = 0.0
_TTS_CIRCUIT_OPEN_UNTIL: float = 0.0


def _get_rpm_limit() -> int:
    try:
        return max(1, int(os.environ.get("VOICE_RPM_LIMIT") or getattr(settings, "voice_rpm_limit", 10)))
    except Exception:
        return 10


def _get_daily_seconds_limit() -> float:
    try:
        mins = float(
            os.environ.get("VOICE_DAILY_MINUTES_LIMIT")
            or getattr(settings, "voice_daily_minutes_limit", 15.0)
        )
        return max(60.0, mins * 60.0)
    except Exception:
        return 900.0


def _is_cloud_tts_enabled() -> bool:
    raw = os.environ.get("VOICE_CLOUD_TTS_ENABLED")
    if raw is not None:
        return raw.strip().lower() not in ("0", "false", "no", "off")
    return bool(getattr(settings, "voice_cloud_tts_enabled", True))


def _check_user_limits(uid: str, add_seconds: float = 0.0) -> None:
    now = time.time()
    rpm_limit = _get_rpm_limit()
    daily_limit_sec = _get_daily_seconds_limit()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    ts_list = [t for t in _USER_VOICE_TIMESTAMPS.get(uid, []) if now - t < 60.0]
    if len(ts_list) >= rpm_limit:
        raise HTTPException(
            status_code=429,
            detail="Voice rate limit reached. Please pause for a moment and try again.",
        )

    day_key, used_sec = _USER_DAILY_AUDIO_SEC.get(uid, (today, 0.0))
    if day_key != today:
        day_key, used_sec = today, 0.0

    if used_sec + add_seconds > daily_limit_sec:
        raise HTTPException(
            status_code=429,
            detail="Daily voice call limit reached. You can continue by typing in chat anytime.",
        )

    ts_list.append(now)
    _USER_VOICE_TIMESTAMPS[uid] = ts_list
    _USER_DAILY_AUDIO_SEC[uid] = (day_key, used_sec + max(0.0, add_seconds))


def _record_stt_rate_limit_strike() -> None:
    global _STT_RATE_STRIKES, _STT_CIRCUIT_OPEN_UNTIL
    now = time.time()
    _STT_RATE_STRIKES = [t for t in _STT_RATE_STRIKES if now - t < 45.0]
    _STT_RATE_STRIKES.append(now)
    if len(_STT_RATE_STRIKES) >= 2:
        _STT_CIRCUIT_OPEN_UNTIL = max(_STT_CIRCUIT_OPEN_UNTIL, now + 60.0)
        logger.warning("[AUTONEXIS VOICE] STT circuit breaker opened for 60s due to repeated 429s.")


def _check_stt_circuit() -> None:
    if time.time() < _STT_CIRCUIT_OPEN_UNTIL:
        raise HTTPException(
            status_code=503,
            detail="Voice is busy, please try again shortly",
        )


def _check_tts_circuit() -> None:
    if time.time() < _TTS_CIRCUIT_OPEN_UNTIL:
        raise HTTPException(
            status_code=503,
            detail="Voice is busy, please try again shortly",
        )


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TTS_CHARS)
    voice: Optional[str] = Field(default="autumn", max_length=40)
    language: Optional[str] = Field(default="en-IN", max_length=24)


@router.post("/api/voice/transcribe")
@router.post("/voice/transcribe")
async def transcribe_voice_turn(
    file: UploadFile = File(...),
    language: str = Form(default="en-IN"),
    duration_sec: Optional[float] = Form(default=None),
    current_user: User = Depends(get_current_user),
):
    """
    Transcribes a single spoken audio turn (<= 30s, <= 3.8 MB) and returns plain text.
    Audio stays strictly in memory and transcripts are never logged.
    """
    _check_stt_circuit()

    raw_ctype = (file.content_type or "").split(";")[0].strip().lower()
    fname = (file.filename or "speech.webm").strip()
    ext_ok = any(fname.lower().endswith(ext) for ext in ALLOWED_AUDIO_EXTENSIONS)
    if raw_ctype not in ALLOWED_AUDIO_MIME_TYPES and not (
        raw_ctype in ("", "application/octet-stream") and ext_ok
    ):
        raise HTTPException(status_code=400, detail="Unsupported audio format for voice input.")

    audio_bytes = await file.read(MAX_AUDIO_BYTES + 1)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Voice clip is too large. Please keep each spoken turn under 30 seconds.",
        )
    if len(audio_bytes) < MIN_AUDIO_BYTES:
        return PlainTextResponse("", status_code=200, headers={"Cache-Control": "no-store"})

    if duration_sec is not None and duration_sec > MAX_AUDIO_DURATION_SEC:
        raise HTTPException(
            status_code=400,
            detail="Please keep each spoken turn under 30 seconds.",
        )

    # Estimate spoken duration conservatively so spoofed 0s values cannot bypass daily cap
    min_est_by_size = min(30.0, max(0.5, len(audio_bytes) / 16000.0))
    reported_dur = float(duration_sec) if (duration_sec is not None and duration_sec > 0) else min_est_by_size
    charged_seconds = min(MAX_AUDIO_DURATION_SEC, max(0.5, reported_dur, min_est_by_size))

    _check_user_limits(current_user.id, add_seconds=charged_seconds)

    bilingual_hint = (
        "Spoken conversation where Hindi and English (Hinglish) may be mixed naturally."
    )

    try:
        transcript = await speech_adapter.transcribe(
            audio_bytes=audio_bytes,
            filename=fname,
            content_type=raw_ctype or "audio/webm",
            language_hint=language or "en-IN",
            prompt_hint=bilingual_hint,
        )
        return PlainTextResponse(
            transcript,
            status_code=200,
            headers={"Cache-Control": "no-store"},
        )
    except SpeechProviderError as err:
        if err.is_rate_limit:
            _record_stt_rate_limit_strike()
            raise HTTPException(status_code=429, detail="Voice is busy, please try again shortly")
        raise HTTPException(status_code=err.status_code, detail=err.detail)


@router.post("/api/voice/speak")
@router.post("/voice/speak")
async def speak_voice_chunk(
    req: SpeakRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Optional English-only cloud TTS synthesis (<= 300 chars).
    Hindi and any transient error fall back cleanly to the browser's built-in voice.
    """
    global _TTS_CIRCUIT_OPEN_UNTIL

    if not _is_cloud_tts_enabled():
        raise HTTPException(status_code=503, detail="Cloud voice is disabled.")

    _check_tts_circuit()

    lang_norm = (req.language or "en-IN").strip().lower()
    clean_text = req.text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text is required.")
    if lang_norm.startswith("hi") or DEVANAGARI_RE.search(clean_text):
        raise HTTPException(
            status_code=400,
            detail="Cloud speech synthesis is enabled for English replies only.",
        )
    if len(clean_text) > UPSTREAM_TTS_SAFE_CHARS:
        raise HTTPException(
            status_code=422,
            detail="Sentence exceeds cloud voice length; use browser voice.",
        )

    est_sec = max(1.0, len(clean_text) / 14.0)
    _check_user_limits(current_user.id, add_seconds=est_sec)

    try:
        audio_bytes, mime_type = await speech_adapter.synthesize(
            text=clean_text,
            voice=(req.voice or "autumn").strip().lower(),
            response_format="wav",
        )
        return Response(
            content=audio_bytes,
            media_type=mime_type,
            headers={"Cache-Control": "no-store"},
        )
    except SpeechProviderError as err:
        now = time.time()
        if err.needs_terms_acceptance:
            _TTS_CIRCUIT_OPEN_UNTIL = max(_TTS_CIRCUIT_OPEN_UNTIL, now + 600.0)
        elif err.is_rate_limit:
            _TTS_CIRCUIT_OPEN_UNTIL = max(_TTS_CIRCUIT_OPEN_UNTIL, now + 60.0)
            raise HTTPException(status_code=429, detail="Voice is busy, please try again shortly")
        raise HTTPException(status_code=err.status_code, detail=err.detail)
