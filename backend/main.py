import sys
import os
import time

backend_dir = os.path.abspath(os.path.dirname(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from contextlib import asynccontextmanager
from typing import List, Optional, Union, Dict, Any
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from config import settings
from database import init_db, User, Chat, get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from auth_utils import get_current_user, security
from llm_client import llm_client
from routers import auth, chat

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

# Include Authentication & Chat Routers
app.include_router(auth.router)
app.include_router(chat.router)

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

class StyleCreateRequest(BaseModel):
    sample: str = Field(..., min_length=10, max_length=2000)

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
    result = await llm_client.chat_non_stream(
        messages_payload,
        req.user_memory,
        user_context=req.user_context,
        project_context=req.project_context,
        relevant_past_chats=req.relevant_past_chats if not is_guest else None,
        custom_style=req.custom_style if not is_guest else None,
        is_guest=is_guest
    )
    return result

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
    return StreamingResponse(
        llm_client.chat_stream(
            messages_payload,
            req.user_memory,
            user_context=req.user_context,
            project_context=req.project_context,
            relevant_past_chats=req.relevant_past_chats if not is_guest else None,
            custom_style=req.custom_style if not is_guest else None,
            is_guest=is_guest
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
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
