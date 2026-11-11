"""
Provider-agnostic Backend Image Adapter.

Reads optional IMAGE_API_KEY and IMAGE_API_BASE_URL from environment/config.
Falls back to anonymous provider endpoint when key is absent (and reports
anonymous_mode=True so the caller/UI knows watermark & stricter limits apply).
Never exposes API keys, provider URLs, or third-party model names to callers.
"""

from dataclasses import dataclass
from io import BytesIO
import logging
import os
import time
from typing import Dict, List, Optional, Tuple
import urllib.parse

import httpx
from PIL import Image

from config import settings

logger = logging.getLogger("autonexis.image.adapter")

DEFAULT_AUTH_BASE_URL = "https://gen.pollinations.ai"
DEFAULT_ANON_BASE_URL = "https://image.pollinations.ai"
DEFAULT_MODEL_PREFERENCE = [
    "black-forest-labs/flux.1.1-pro",
    "black-forest-labs/flux.1-schnell",
    "flux",
    "tongyi-mai/z-image-turbo",
    "zimage",
    "microsoft/mai-image-2.6",
    "black-forest-labs/flux.2-klein-4b",
]
MODEL_CACHE_TTL_SEC = 3600.0
MAX_JPEG_RESPONSE_BYTES = 2_400_000  # Safely under Vercel's 4.5 MB limit


class ImageProviderError(Exception):
    def __init__(
        self,
        detail: str,
        status_code: int = 502,
        is_rate_limit: bool = False,
        is_timeout: bool = False,
        retry_after: Optional[int] = None,
    ):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.is_rate_limit = is_rate_limit
        self.is_timeout = is_timeout
        self.retry_after = retry_after


@dataclass
class ImageAdapterResult:
    jpeg_bytes: bytes
    width: int
    height: int
    seed: int
    model_id: str
    quality_tier: str
    anonymous_mode: bool
    provider_warning: Optional[str] = None


_MODEL_CACHE: Dict[str, object] = {
    "fetched_at": 0.0,
    "free_models": [],
    "all_models": [],
}


def _get_image_api_key() -> str:
    return (os.environ.get("IMAGE_API_KEY") or getattr(settings, "image_api_key", "") or "").strip()


def _get_auth_base_url() -> str:
    base = (
        os.environ.get("IMAGE_API_BASE_URL")
        or getattr(settings, "image_api_base_url", "")
        or DEFAULT_AUTH_BASE_URL
    ).strip().rstrip("/")
    return base or DEFAULT_AUTH_BASE_URL


def _get_anon_base_url() -> str:
    base = (
        os.environ.get("IMAGE_ANON_BASE_URL")
        or getattr(settings, "image_anon_base_url", "")
        or DEFAULT_ANON_BASE_URL
    ).strip().rstrip("/")
    return base or DEFAULT_ANON_BASE_URL


def _encode_jpeg_safe(raw_bytes: bytes, target_w: int, target_h: int) -> Tuple[bytes, int, int]:
    """
    Validates downloaded image bytes and ensures output is RGB JPEG
    safely under Vercel's 4.5 MB response limit.
    """
    try:
        with Image.open(BytesIO(raw_bytes)) as im:
            im.load()
            if im.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", im.size, (255, 255, 255))
                if im.mode == "P":
                    im = im.convert("RGBA")
                bg.paste(im, mask=im.split()[-1] if im.mode in ("RGBA", "LA") else None)
                rgb = bg
            elif im.mode != "RGB":
                rgb = im.convert("RGB")
            else:
                rgb = im.copy()

            w, h = rgb.size
            for q in (90, 82, 74, 65):
                buf = BytesIO()
                rgb.save(buf, format="JPEG", quality=q, optimize=True)
                out = buf.getvalue()
                if len(out) <= MAX_JPEG_RESPONSE_BYTES:
                    return out, w, h

            # If still huge, downscale proportionally once
            scale = 0.75
            resized = rgb.resize((max(256, int(w * scale)), max(256, int(h * scale))), Image.Resampling.LANCZOS)
            buf = BytesIO()
            resized.save(buf, format="JPEG", quality=75, optimize=True)
            rw, rh = resized.size
            return buf.getvalue(), rw, rh
    except Exception as exc:
        logger.warning("[AUTONEXIS IMAGE] Invalid image bytes received: %s", type(exc).__name__)
        raise ImageProviderError(
            "Unable to process the generated image right now. Please try again.",
            status_code=502,
        )


class PollinationsImageAdapter:
    """Adapter for official image generation endpoint + anonymous fallback."""

    async def get_available_models(self, has_key: bool) -> List[str]:
        now = time.time()
        cached_at = float(_MODEL_CACHE.get("fetched_at") or 0.0)
        if now - cached_at < MODEL_CACHE_TTL_SEC:
            cached = _MODEL_CACHE.get("free_models" if has_key else "anon_models")
            if isinstance(cached, list) and cached:
                return cached

        if not has_key:
            _MODEL_CACHE["anon_models"] = ["flux"]
            return ["flux"]

        models_url = f"{_get_auth_base_url()}/image/models"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(models_url, headers={"User-Agent": "autonexis-backend/1.0"})
                if res.status_code == 200:
                    payload = res.json()
                    if isinstance(payload, list):
                        free_names: List[str] = []
                        for item in payload:
                            if not isinstance(item, dict):
                                continue
                            name = str(item.get("name") or "").strip()
                            if not name:
                                continue
                            if not item.get("paid_only", False):
                                free_names.append(name)
                                for al in (item.get("aliases") or []):
                                    if isinstance(al, str) and al.strip():
                                        free_names.append(al.strip())
                        ordered = [m for m in DEFAULT_MODEL_PREFERENCE if m in free_names]
                        for m in free_names:
                            if m not in ordered:
                                ordered.append(m)
                        if ordered:
                            _MODEL_CACHE["fetched_at"] = now
                            _MODEL_CACHE["free_models"] = ordered
                            return ordered
        except Exception as exc:
            logger.info("[AUTONEXIS IMAGE] Model catalog fetch skipped: %s", type(exc).__name__)

        fallback = ["flux", "zimage"]
        _MODEL_CACHE["fetched_at"] = now - (MODEL_CACHE_TTL_SEC - 300)
        _MODEL_CACHE["free_models"] = fallback
        return fallback

    def choose_best_model(self, available: List[str], has_key: bool, needs_text: bool = False) -> Tuple[str, str]:
        if not has_key:
            return "flux", "standard"
        # Prefer FLUX 1.1 Pro / FLUX / Z-Image Turbo / MAI Image when available
        preferred = (
            [
                "microsoft/mai-image-2.6",
                "black-forest-labs/flux.1.1-pro",
                "tongyi-mai/z-image-turbo",
                "black-forest-labs/flux.1-schnell",
                "flux",
                "zimage",
            ]
            if needs_text
            else [
                "black-forest-labs/flux.1.1-pro",
                "black-forest-labs/flux.1-schnell",
                "tongyi-mai/z-image-turbo",
                "flux",
                "zimage",
                "microsoft/mai-image-2.6",
            ]
        )
        for cand in preferred:
            if cand in available:
                tier = "hd" if ("pro" in cand or "2.6" in cand) else "standard"
                return cand, tier
        return (available[0] if available else "flux"), "standard"

    async def generate(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        seed: int,
        needs_text: bool = False,
        timeout_sec: float = 42.0,
    ) -> ImageAdapterResult:
        api_key = _get_image_api_key()
        has_key = bool(api_key)
        available = await self.get_available_models(has_key)
        chosen_model, quality_tier = self.choose_best_model(available, has_key, needs_text=needs_text)

        encoded_prompt = urllib.parse.quote(prompt, safe="")
        query_params = {
            "width": str(int(width)),
            "height": str(int(height)),
            "seed": str(int(seed)),
            "nologo": "true",
            "private": "true",
            "safe": "true",
            "enhance": "false",
        }
        if negative_prompt:
            query_params["negative_prompt"] = negative_prompt[:450]
        if chosen_model and chosen_model != "default":
            query_params["model"] = chosen_model

        if has_key:
            base = _get_auth_base_url()
            url = f"{base}/image/{encoded_prompt}?{urllib.parse.urlencode(query_params)}"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Accept": "image/jpeg,image/png,image/*;q=0.8",
                "User-Agent": "autonexis-backend/1.0",
            }
            anon_warning = None
        else:
            base = _get_anon_base_url()
            url = f"{base}/prompt/{encoded_prompt}?{urllib.parse.urlencode(query_params)}"
            headers = {
                "Accept": "image/jpeg,image/png,image/*;q=0.8",
                "User-Agent": "Mozilla/5.0",
            }
            anon_warning = (
                "Generated in anonymous mode without an image API key: provider watermark "
                "and stricter rate limits may apply."
            )

        timeout = httpx.Timeout(connect=10.0, read=timeout_sec, write=10.0, pool=10.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.get(url, headers=headers)
                # Fallback once if model rejected
                if has_key and resp.status_code in (400, 402, 404) and chosen_model != "flux":
                    query_params["model"] = "flux"
                    fallback_url = f"{base}/image/{encoded_prompt}?{urllib.parse.urlencode(query_params)}"
                    resp = await client.get(fallback_url, headers=headers)
                    chosen_model = "flux"
                    quality_tier = "standard"
                elif not has_key and resp.status_code in (400, 404) and "model" in query_params:
                    query_params.pop("model", None)
                    fallback_url = f"{base}/prompt/{encoded_prompt}?{urllib.parse.urlencode(query_params)}"
                    resp = await client.get(fallback_url, headers=headers)
                    chosen_model = "default"

                if resp.status_code in (402, 429):
                    retry_after = None
                    try:
                        body_txt = resp.text[:300]
                        import re as _re
                        m = _re.search(r"Retry after\s+(\d+)s", body_txt, _re.I)
                        if m:
                            retry_after = int(m.group(1))
                    except Exception:
                        pass
                    raise ImageProviderError(
                        "Images are busy, please try again shortly",
                        status_code=429,
                        is_rate_limit=True,
                        retry_after=retry_after,
                    )

                if resp.status_code in (401, 403):
                    # Never leak key errors or upstream provider names
                    logger.warning("[AUTONEXIS IMAGE] Upstream auth rejected (%s)", resp.status_code)
                    raise ImageProviderError(
                        "Image service is temporarily unavailable. Please try again shortly.",
                        status_code=503,
                    )

                if resp.status_code >= 500:
                    raise ImageProviderError(
                        "Images are busy, please try again shortly",
                        status_code=503,
                        is_rate_limit=(resp.status_code == 503),
                    )

                if resp.status_code != 200:
                    raise ImageProviderError(
                        "Could not generate this image right now. Please try again.",
                        status_code=502,
                    )

                ctype = (resp.headers.get("content-type") or "").lower()
                if not ctype.startswith("image/") and len(resp.content) < 512:
                    raise ImageProviderError(
                        "Could not generate this image right now. Please try again.",
                        status_code=502,
                    )

                jpeg_bytes, out_w, out_h = _encode_jpeg_safe(resp.content, width, height)
                return ImageAdapterResult(
                    jpeg_bytes=jpeg_bytes,
                    width=out_w,
                    height=out_h,
                    seed=seed,
                    model_id=chosen_model,
                    quality_tier=quality_tier,
                    anonymous_mode=not has_key,
                    provider_warning=anon_warning,
                )

        except ImageProviderError:
            raise
        except httpx.TimeoutException:
            raise ImageProviderError(
                "Image creation took too long and timed out. Please try again.",
                status_code=504,
                is_timeout=True,
            )
        except Exception as exc:
            logger.warning("[AUTONEXIS IMAGE] Request error: %s", type(exc).__name__)
            raise ImageProviderError(
                "Unable to connect to the image service right now. Please try again.",
                status_code=502,
            )


image_adapter = PollinationsImageAdapter()
