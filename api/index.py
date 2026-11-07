import sys
import os

api_dir = os.path.abspath(os.path.dirname(__file__))
if api_dir not in sys.path:
    sys.path.insert(0, api_dir)

from contextlib import asynccontextmanager
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import settings
from database import init_db, User, get_db
from sqlalchemy.ext.asyncio import AsyncSession
from auth_utils import get_current_user
from llm_client import llm_client
from routers import auth, chat, sessions, account

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and tables on startup
    await init_db()
    yield

# Top-level FastAPI app instance expected by Vercel & local server
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

# Include Authentication, Chat, Sessions & Account Routers
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(sessions.router)
app.include_router(account.router)

@app.delete("/chats")
async def delete_chats_top_level(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import select
    from database import Chat
    stmt = select(Chat).where(Chat.user_id == current_user.id)
    result = await db.execute(stmt)
    chats = result.scalars().all()
    for c in chats:
        await db.delete(c)
    await db.commit()
    return {"status": "success", "message": "All conversations have been deleted."}

class MessageItem(BaseModel):
    role: str = Field(..., description="Role of the sender (user, assistant)")
    content: str = Field(..., description="Message text content")

class DirectChatRequest(BaseModel):
    messages: List[MessageItem]
    chat_id: Optional[str] = None
    user_memory: Optional[str] = None

@app.get("/api")
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
    current_user: User = Depends(get_current_user)
):
    """Direct chat endpoint protected with Firebase Auth."""
    if not req.messages:
        raise HTTPException(status_code=400, detail="कम से कम एक संदेश आवश्यक है।")
    
    messages_payload = [m.model_dump() for m in req.messages]
    result = await llm_client.chat_non_stream(messages_payload, req.user_memory)
    return result

@app.post("/api/chat/stream")
async def chat_stream_endpoint(
    req: DirectChatRequest,
    current_user: User = Depends(get_current_user)
):
    """Real-time streaming chat endpoint protected with Firebase Auth."""
    if not req.messages:
        raise HTTPException(status_code=400, detail="कम से कम एक संदेश आवश्यक है।")

    messages_payload = [m.model_dump() for m in req.messages]
    return StreamingResponse(
        llm_client.chat_stream(messages_payload, req.user_memory),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

# -------------------------------------------------------------
# UNIFIED FRONTEND SERVING (SINGLE WORKING LINK: http://localhost:8000)
# -------------------------------------------------------------
frontend_dist = os.path.abspath(os.path.join(api_dir, "..", "frontend", "dist"))

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
