"""
Backend Image Generation Router (/api/image/generate).

Reuses the existing Firebase authentication check (get_current_user) verbatim.
All provider calls happen strictly server-side; keys and upstream URLs are
never exposed to the browser, logs, or error payloads.
"""

import base64
import json
import logging
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from auth_utils import get_current_user
from database import User
from image_router import detect_image_intent
from image_service import ImageServiceError, execute_image_generation

logger = logging.getLogger("autonexis.image.router_api")

router = APIRouter(tags=["Image Generation"])


class ImageGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1200)
    style: Optional[str] = Field(default=None, max_length=40)
    aspect: Optional[str] = Field(default=None, max_length=16)
    seed: Optional[int] = Field(default=None, ge=0, le=2_147_483_647)
    previous_prompt: Optional[str] = Field(default=None, max_length=800)
    is_edit: bool = False
    explicit_mode: bool = False


@router.post("/api/image/generate")
@router.post("/image/generate")
async def generate_image_endpoint(
    req: ImageGenerateRequest,
    format: Optional[str] = Query(default="json"),
    current_user: User = Depends(get_current_user),
):
    """
    Runs moderation (fail-closed) -> prompt enhancement -> backend provider call -> JPEG conversion.
    Returns JSON (with base64 JPEG data URL + parameters) when format=json, or raw image/jpeg bytes otherwise.
    """
    router_meta = (
        {
            "intent": "image_edit" if req.is_edit else "image",
            "confidence": 1.0,
            "reason": "explicit_mode",
        }
        if req.explicit_mode
        else await detect_image_intent(req.prompt, allow_classifier=False)
    )

    try:
        result = await execute_image_generation(
            uid=str(current_user.id),
            user_request=req.prompt,
            style=req.style,
            aspect=req.aspect,
            seed=req.seed,
            previous_prompt=req.previous_prompt,
            is_edit=req.is_edit,
        )
    except ImageServiceError as err:
        return JSONResponse(
            status_code=err.status_code,
            content={
                "ok": False,
                "blocked": err.blocked,
                "category": err.category,
                "rate_limited": err.rate_limited,
                "retry_after": err.retry_after,
                "message": err.message,
                "moderation_log": err.moderation_log,
                "router": {
                    "intent": router_meta.get("intent"),
                    "confidence": router_meta.get("confidence"),
                    "reason": router_meta.get("reason"),
                },
            },
            headers={"Cache-Control": "no-store"},
        )

    safe_router = {
        "intent": router_meta.get("intent"),
        "confidence": router_meta.get("confidence"),
        "reason": router_meta.get("reason"),
    }

    if (format or "").lower() == "raw":
        return Response(
            content=result["jpeg_bytes"],
            media_type="image/jpeg",
            headers={
                "Cache-Control": "no-store",
                "X-Image-Style": str(result["style"]),
                "X-Image-Aspect": str(result["aspect"]),
                "X-Image-Width": str(result["width"]),
                "X-Image-Height": str(result["height"]),
                "X-Image-Seed": str(result["seed"]),
                "X-Image-Caption": quote(result["caption"], safe=""),
                "X-Image-Prompt": quote(result["final_prompt"], safe=""),
                "X-Autonexis-Router": json.dumps(safe_router),
            },
        )

    b64 = base64.b64encode(result["jpeg_bytes"]).decode("ascii")
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "status": "ready",
            "image_data_url": f"data:image/jpeg;base64,{b64}",
            "caption": result["caption"],
            "original_request": result["original_request"],
            "subject": result["subject"],
            "final_prompt": result["final_prompt"],
            "style": result["style"],
            "aspect": result["aspect"],
            "width": result["width"],
            "height": result["height"],
            "seed": result["seed"],
            "model": result["model"],
            "anonymous_mode": result["anonymous_mode"],
            "warnings": result["warnings"],
            "router": safe_router,
        },
        headers={
            "Cache-Control": "no-store",
            "X-Autonexis-Router": json.dumps(safe_router),
        },
    )

