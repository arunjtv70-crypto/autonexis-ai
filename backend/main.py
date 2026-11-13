import json
import sys
import os
import time
import logging

logger = logging.getLogger("autonexis.backend")

backend_dir = os.path.abspath(os.path.dirname(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from contextlib import asynccontextmanager
from typing import List, Optional, Union, Dict, Any
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from config import settings
from database import init_db, User, Chat, get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from auth_utils import get_current_user, security
from llm_client import llm_client, get_last_user_text, has_image_content
from image_router import detect_image_intent
from routers import auth, chat, voice, image

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and tables on startup
    await init_db()
    yield

app = FastAPI(
    title=settings.app_name,
    description="AUTONEXIS Assistant Official API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration for Frontend/PWA communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Authentication, Chat, Voice Call & Image Generation Routers
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(image.router)

class MessageItem(BaseModel):
    role: str = Field(..., description="Role of the sender (user, assistant)")
    content: Union[str, List[Dict[str, Any]]] = Field(..., description="Message text or multimodal content")

class DirectChatRequest(BaseModel):
    messages: List[MessageItem]
    chat_id: Optional[str] = None
    user_memory: Optional[str] = None
    user_context: Optional[Dict[str, Any]] = None
    project_context: Optional[Dict[str, Any]] = None
    relevant_past_chats: Optional[List[Dict[str, Any]]] = None
    custom_style: Optional[Dict[str, Any]] = None
    chat_context: Optional[str] = None
    client_time: Optional[str] = None
    timezone: Optional[str] = None
    voice: bool = False
    recent_context: Optional[List[Dict[str, Any]]] = None
    force_image_mode: bool = False
    image_style: Optional[str] = None
    image_aspect: Optional[str] = None
    image_seed: Optional[int] = None
    debug: bool = False

class StyleCreateRequest(BaseModel):
    sample: str = Field(..., min_length=10, max_length=2000)

class ChatSummarizeRequest(BaseModel):
    chat_id: str
    old_state: Optional[Dict[str, Any]] = None
    new_messages: List[Dict[str, Any]] = Field(default_factory=list)
    client_time: Optional[str] = None
    timezone: Optional[str] = None

class MemoryExtractMessage(BaseModel):
    role: str
    content: Union[str, List[Dict[str, Any]]]

class ExistingMemoryItem(BaseModel):
    id: Optional[str] = None
    text: str

class MemoryExtractRequest(BaseModel):
    messages: List[MemoryExtractMessage]
    existing_memories: Optional[List[ExistingMemoryItem]] = None

# Soft in-memory rate limiting for guest sessions.
# Note: In a serverless/stateless environment (such as Vercel) without a shared database/cache,
# this in-memory dictionary is per-instance and serves as a soft, best-effort rate limit.
GUEST_IP_REQUESTS: Dict[str, List[float]] = {}
GUEST_RATE_LIMIT_WINDOW = 3600.0  # 1 hour
GUEST_RATE_LIMIT_MAX = 30         # Max 30 requests per hour per IP

STYLE_USER_REQUESTS: Dict[str, List[float]] = {}
STYLE_RATE_LIMIT_WINDOW = 3600.0
STYLE_RATE_LIMIT_MAX = 15

SUMMARIZE_USER_REQUESTS: Dict[str, List[float]] = {}
SUMMARIZE_RATE_LIMIT_WINDOW = 3600.0
SUMMARIZE_RATE_LIMIT_MAX = 15

def check_style_rate_limit(uid: str) -> None:
    now = time.time()
    timestamps = STYLE_USER_REQUESTS.get(uid, [])
    timestamps = [t for t in timestamps if now - t < STYLE_RATE_LIMIT_WINDOW]
    if len(timestamps) >= STYLE_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Too many custom style requests. Please wait a bit before creating another style."
        )
    timestamps.append(now)
    STYLE_USER_REQUESTS[uid] = timestamps

def check_summarize_rate_limit(uid: str) -> None:
    now = time.time()
    timestamps = SUMMARIZE_USER_REQUESTS.get(uid, [])
    timestamps = [t for t in timestamps if now - t < SUMMARIZE_RATE_LIMIT_WINDOW]
    if len(timestamps) >= SUMMARIZE_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Too many chat summary requests. Please wait a bit."
        )
    timestamps.append(now)
    SUMMARIZE_USER_REQUESTS[uid] = timestamps

def check_guest_rate_limit(client_ip: str) -> None:
    now = time.time()
    timestamps = GUEST_IP_REQUESTS.get(client_ip, [])
    timestamps = [t for t in timestamps if now - t < GUEST_RATE_LIMIT_WINDOW]
    if len(timestamps) >= GUEST_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Guest rate limit reached. Please log in to continue chatting with AUTONEXIS Assistant."
        )
    timestamps.append(now)
    GUEST_IP_REQUESTS[client_ip] = timestamps

@app.get("/api/health")
async def health_check():
    """Health check endpoint returning system status under pure AUTONEXIS branding."""
    return {
        "status": "online",
        "app": settings.app_name,
        "mode": "production-ready"
    }

@app.post("/api/chat")
async def chat_direct(
    req: DirectChatRequest,
    request: Request,
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
):
    """Direct chat endpoint supporting both Authenticated Users and Guest sessions."""
    is_guest = request.headers.get("x-guest") == "1"
    if is_guest:
        if req.voice:
            raise HTTPException(
                status_code=403,
                detail="Log in to use voice calls."
            )
        client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
        check_guest_rate_limit(client_ip)

        if req.chat_id:
            res_chk = await db.execute(select(Chat).where(Chat.id == req.chat_id))
            if res_chk.scalars().first():
                raise HTTPException(status_code=404, detail="चैट नहीं मिली।")

        for m in req.messages:
            if m.role == "user":
                if isinstance(m.content, list):
                    raise HTTPException(
                        status_code=403,
                        detail="Image and file attachments are only available for registered users. Please log in to continue."
                    )
                if len(str(m.content)) > 1000:
                    raise HTTPException(
                        status_code=400,
                        detail="Guest messages are limited to 1,000 characters. Please log in for unlimited messages."
                    )
    else:
        current_user = await get_current_user(request, auth, db)
        if req.chat_id:
            stmt = select(Chat).where(Chat.id == req.chat_id, Chat.user_id == current_user.id)
            res_chk = await db.execute(stmt)
            if not res_chk.scalars().first():
                raise HTTPException(status_code=404, detail="चैट नहीं मिली।")

    if not req.messages:
        raise HTTPException(status_code=400, detail="कम से कम एक संदेश आवश्यक है।")
    
    messages_payload = [m.model_dump() for m in req.messages]
    last_text = get_last_user_text(messages_payload)
    last_has_upload = has_image_content(messages_payload[-1:]) if messages_payload else False
    if req.voice:
        router_result = {"intent": "chat", "confidence": 1.0, "reason": "voice_mode"}
    elif req.force_image_mode:
        router_result = {"intent": "image", "confidence": 1.0, "subject": last_text, "style": req.image_style, "aspect": req.image_aspect, "reason": "explicit_mode"}
    else:
        router_result = await detect_image_intent(last_text, recent_context=req.recent_context, has_uploaded_image=last_has_upload)
    safe_router = {"intent": router_result.get("intent", "chat"), "confidence": router_result.get("confidence", 0.95), "reason": router_result.get("reason", "rule")}
    uid_str = "guest" if is_guest else str(current_user.id)
    is_debug = bool(req.debug or request.query_params.get("debug") == "1")

    try:
        result = await llm_client.chat_non_stream(
            messages_payload,
            req.user_memory,
            user_context=req.user_context,
            project_context=req.project_context,
            relevant_past_chats=req.relevant_past_chats if not is_guest else None,
            custom_style=req.custom_style if not is_guest else None,
            chat_context=req.chat_context,
            is_guest=is_guest,
            voice=bool(req.voice),
            uid=uid_str,
            router_result=router_result,
            debug=is_debug,
        )
        return JSONResponse(content=result, headers={"X-Autonexis-Router": json.dumps(safe_router)})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[AUTONEXIS CHAT DIRECT EXCEPTION] {exc}")
        safe_fallback = "Voice is busy, please try again shortly" if req.voice else "I am having trouble connecting right now. Please try again in a moment."
        return JSONResponse(
            content={"reply": safe_fallback},
            headers={"X-Autonexis-Router": json.dumps(safe_router)}
        )

@app.post("/api/chat/stream")
async def chat_stream_endpoint(
    req: DirectChatRequest,
    request: Request,
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
):
    """Real-time streaming chat endpoint supporting both Authenticated Users and Guest sessions."""
    is_guest = request.headers.get("x-guest") == "1"
    if is_guest:
        if req.voice:
            raise HTTPException(
                status_code=403,
                detail="Log in to use voice calls."
            )
        client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
        check_guest_rate_limit(client_ip)

        if req.chat_id:
            res_chk = await db.execute(select(Chat).where(Chat.id == req.chat_id))
            if res_chk.scalars().first():
                raise HTTPException(status_code=404, detail="चैट नहीं मिली।")

        for m in req.messages:
            if m.role == "user":
                if isinstance(m.content, list):
                    raise HTTPException(
                        status_code=403,
                        detail="Image and file attachments are only available for registered users. Please log in to continue."
                    )
                if len(str(m.content)) > 1000:
                    raise HTTPException(
                        status_code=400,
                        detail="Guest messages are limited to 1,000 characters. Please log in for unlimited messages."
                    )
    else:
        current_user = await get_current_user(request, auth, db)
        if req.chat_id:
            stmt = select(Chat).where(Chat.id == req.chat_id, Chat.user_id == current_user.id)
            res_chk = await db.execute(stmt)
            if not res_chk.scalars().first():
                raise HTTPException(status_code=404, detail="चैट नहीं मिली।")

    if not req.messages:
        raise HTTPException(status_code=400, detail="कम से कम एक संदेश आवश्यक है।")

    max_vision_body_bytes = int(3.2 * 1024 * 1024)
    content_length_hdr = request.headers.get("content-length")
    if content_length_hdr and content_length_hdr.isdigit() and int(content_length_hdr) > max_vision_body_bytes:
        raise HTTPException(
            status_code=413,
            detail="Request size is above the 3 MB vision budget. Please crop or attach fewer images.",
        )

    messages_payload = [m.model_dump() for m in req.messages]
    last_text = get_last_user_text(messages_payload)
    last_has_upload = has_image_content(messages_payload[-1:]) if messages_payload else False
    if req.voice:
        router_result = {"intent": "chat", "confidence": 1.0, "reason": "voice_mode"}
    elif req.force_image_mode:
        router_result = {"intent": "image", "confidence": 1.0, "subject": last_text, "style": req.image_style, "aspect": req.image_aspect, "reason": "explicit_mode"}
    else:
        router_result = await detect_image_intent(last_text, recent_context=req.recent_context, has_uploaded_image=last_has_upload)
    safe_router = {"intent": router_result.get("intent", "chat"), "confidence": router_result.get("confidence", 0.95), "reason": router_result.get("reason", "rule")}
    uid_str = "guest" if is_guest else str(current_user.id)
    is_debug = bool(req.debug or request.query_params.get("debug") == "1")

    async def safe_stream_generator():
        try:
            async for chunk in llm_client.chat_stream(
                messages_payload,
                req.user_memory,
                user_context=req.user_context,
                project_context=req.project_context,
                relevant_past_chats=req.relevant_past_chats if not is_guest else None,
                custom_style=req.custom_style if not is_guest else None,
                chat_context=req.chat_context,
                is_guest=is_guest,
                voice=bool(req.voice),
                uid=uid_str,
                router_result=router_result,
                image_style=req.image_style,
                image_aspect=req.image_aspect,
                image_seed=req.image_seed,
                debug=is_debug,
            ):
                yield chunk
        except Exception as exc:
            logger.exception(f"[AUTONEXIS CHAT STREAM UNHANDLED EXCEPTION] {exc}")
            err_msg = (
                "Voice is busy, please try again shortly"
                if req.voice
                else "I am having trouble connecting right now. Please try again in a moment."
            )
            yield f"data: {json.dumps({'error': True, 'content': err_msg}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        safe_stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Autonexis-Router": json.dumps(safe_router),
        }
    )

@app.post("/api/memory/extract")
@app.post("/memory/extract")
async def extract_memory_endpoint(
    req: MemoryExtractRequest,
    request: Request,
):
    """
    Extracts durable user facts from recent messages using strict JSON format.
    Safely handles rate limits and sensitive data omission.
    """
    messages_payload = [m.model_dump() for m in req.messages]
    existing_payload = [m.model_dump() for m in (req.existing_memories or [])]
    return await llm_client.extract_memories(messages_payload, existing_payload)

@app.post("/api/style/create")
@app.post("/style/create")
async def create_custom_style_endpoint(
    req: StyleCreateRequest,
    request: Request,
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
):
    """
    Analyzes a pasted writing sample (<= 2000 chars) and returns a <= 300 char writing style description.
    Requires authenticated Firebase token and enforces per-user rate limit.
    """
    current_user = await get_current_user(request, auth, db)
    check_style_rate_limit(current_user.id)
    return await llm_client.analyze_writing_style(req.sample)

@app.post("/api/chat/summarize")
@app.post("/chat/summarize")
async def summarize_chat_endpoint(
    req: ChatSummarizeRequest,
    request: Request,
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
):
    """
    Refreshes in-chat memory (summary, key facts, timeline, open threads).
    Requires authenticated Firebase token and enforces per-user rate limit.
    """
    current_user = await get_current_user(request, auth, db)
    check_summarize_rate_limit(str(current_user.id))
    return await llm_client.summarize_chat_memory(
        old_state=req.old_state,
        new_messages=req.new_messages,
        client_time=req.client_time,
        timezone=req.timezone,
    )

# -------------------------------------------------------------
# UNIFIED FRONTEND SERVING (SINGLE WORKING LINK: http://localhost:8000)
# -------------------------------------------------------------
frontend_dist = os.path.abspath(os.path.join(backend_dir, "..", "frontend", "dist"))

if os.path.exists(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    async def serve_index():
        index_file = os.path.join(frontend_dist, "index.html")
        if os.path.exists(index_file):
            return FileResponse(
                index_file,
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )
        return {"status": "online", "app": settings.app_name}

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        
        # NEVER return index.html for missing assets or javascript
        if full_path.startswith("assets/"):
            raise HTTPException(status_code=404, detail="Asset not found")

        file_path = os.path.join(frontend_dist, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        
        index_file = os.path.join(frontend_dist, "index.html")
        if os.path.exists(index_file):
            return FileResponse(
                index_file,
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )
        
        raise HTTPException(status_code=404, detail="File not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
