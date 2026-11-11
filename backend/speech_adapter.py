"""
AUTONEXIS Speech Provider Adapter Interface.

Isolates speech-to-text (STT) and text-to-speech (TTS) provider calls behind a single
interface so providers can be swapped in one file without changing routes or client logic.
Privacy guarantee: never writes audio to disk and never logs spoken transcripts.
"""

from abc import ABC, abstractmethod
import logging
import os
from typing import Optional, Tuple
import httpx

from config import settings

logger = logging.getLogger("autonexis.speech")

ENGLISH_TTS_VOICES = ("autumn", "diana", "hannah", "austin", "daniel", "troy")


class SpeechProviderError(Exception):
    """Structured upstream speech provider error with safe user-facing detail."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        *,
        is_rate_limit: bool = False,
        needs_terms_acceptance: bool = False,
        terms_url: Optional[str] = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.is_rate_limit = is_rate_limit
        self.needs_terms_acceptance = needs_terms_acceptance
        self.terms_url = terms_url


class SpeechAdapter(ABC):
    """Pluggable interface for STT and TTS backends."""

    @abstractmethod
    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        language_hint: str = "en",
        prompt_hint: str = "",
    ) -> str:
        """Convert spoken audio bytes into plain text."""

    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: str = "autumn",
        response_format: str = "wav",
    ) -> Tuple[bytes, str]:
        """Convert short English text into audio bytes and MIME content-type."""


class OpenAICompatibleSpeechAdapter(SpeechAdapter):
    """
    Default speech adapter reusing existing LLM_API_KEY and LLM_BASE_URL configuration.
    """

    def _get_credentials(self) -> Tuple[str, str]:
        api_key = os.environ.get("LLM_API_KEY") or getattr(settings, "llm_api_key", "")
        base_url = os.environ.get("LLM_BASE_URL") or getattr(
            settings, "llm_base_url", "https://api.groq.com/openai/v1"
        )
        return (api_key or "").strip(), (base_url or "https://api.groq.com/openai/v1").rstrip("/")

    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        language_hint: str = "en",
        prompt_hint: str = "",
    ) -> str:
        api_key, base_url = self._get_credentials()
        if not api_key:
            raise SpeechProviderError(
                503,
                "Voice transcription is not configured right now.",
            )

        stt_model = os.environ.get("VOICE_STT_MODEL") or getattr(
            settings, "voice_stt_model", "whisper-large-v3-turbo"
        )
        endpoint = f"{base_url}/audio/transcriptions"

        lang_code = "hi" if (language_hint or "").lower().startswith("hi") else "en"
        data_fields = {
            "model": stt_model,
            "language": lang_code,
            "response_format": "json",
            "temperature": "0",
        }
        if prompt_hint:
            data_fields["prompt"] = prompt_hint

        headers = {"Authorization": f"Bearer {api_key}"}
        files = {
            "file": (filename or "speech.webm", audio_bytes, content_type or "audio/webm")
        }

        try:
            timeout = httpx.Timeout(connect=10.0, read=25.0, write=20.0, pool=10.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(endpoint, headers=headers, data=data_fields, files=files)
        except httpx.TimeoutException:
            logger.warning("[AUTONEXIS VOICE STT] Request timed out.")
            raise SpeechProviderError(504, "Voice recognition timed out. Please try again.")
        except Exception as exc:
            logger.warning("[AUTONEXIS VOICE STT] Network failure: %s", type(exc).__name__)
            raise SpeechProviderError(502, "Could not reach voice recognition right now.")

        if res.status_code == 429:
            logger.warning("[AUTONEXIS VOICE STT] Upstream rate limit reached (429).")
            raise SpeechProviderError(
                429,
                "Voice is busy, please try again shortly",
                is_rate_limit=True,
            )

        if res.status_code != 200:
            logger.warning("[AUTONEXIS VOICE STT] Upstream error status=%s", res.status_code)
            raise SpeechProviderError(
                502,
                "Could not understand audio right now. Please try speaking again.",
            )

        try:
            payload = res.json()
            text = str(payload.get("text") or "").strip()
        except Exception:
            text = (res.text or "").strip()
        return text

    async def synthesize(
        self,
        text: str,
        voice: str = "autumn",
        response_format: str = "wav",
    ) -> Tuple[bytes, str]:
        api_key, base_url = self._get_credentials()
        if not api_key:
            raise SpeechProviderError(503, "Cloud voice is unavailable.")

        tts_model = os.environ.get("VOICE_TTS_MODEL") or getattr(
            settings, "voice_tts_model", "canopylabs/orpheus-v1-english"
        )
        default_voice = os.environ.get("VOICE_TTS_VOICE") or getattr(
            settings, "voice_tts_voice", "autumn"
        )
        selected_voice = voice if voice in ENGLISH_TTS_VOICES else default_voice
        if selected_voice not in ENGLISH_TTS_VOICES:
            selected_voice = "autumn"

        fmt = "wav" if response_format not in ("wav",) else response_format
        endpoint = f"{base_url}/audio/speech"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": tts_model,
            "voice": selected_voice,
            "input": text,
            "response_format": fmt,
        }

        try:
            timeout = httpx.Timeout(connect=8.0, read=15.0, write=8.0, pool=8.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(endpoint, headers=headers, json=payload)
        except httpx.TimeoutException:
            logger.warning("[AUTONEXIS VOICE TTS] Request timed out.")
            raise SpeechProviderError(504, "Cloud voice timed out.")
        except Exception as exc:
            logger.warning("[AUTONEXIS VOICE TTS] Network failure: %s", type(exc).__name__)
            raise SpeechProviderError(502, "Cloud voice unavailable.")

        if res.status_code == 429:
            logger.warning("[AUTONEXIS VOICE TTS] Upstream rate limit reached (429).")
            raise SpeechProviderError(
                429,
                "Voice is busy, please try again shortly",
                is_rate_limit=True,
            )

        if res.status_code != 200:
            body_lower = ""
            try:
                body_lower = (res.text or "").lower()
            except Exception:
                pass
            needs_terms = "terms" in body_lower or "accept" in body_lower
            logger.warning(
                "[AUTONEXIS VOICE TTS] Upstream error status=%s terms_required=%s",
                res.status_code,
                needs_terms,
            )
            raise SpeechProviderError(
                503,
                "Cloud voice is currently unavailable. Using device voice.",
                needs_terms_acceptance=needs_terms,
            )

        return res.content, "audio/wav"


speech_adapter: SpeechAdapter = OpenAICompatibleSpeechAdapter()
