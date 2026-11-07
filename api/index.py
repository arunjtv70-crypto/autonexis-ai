import sys
import os

# Ensure current api/ folder is at the beginning of sys.path
api_dir = os.path.abspath(os.path.dirname(__file__))
if api_dir not in sys.path:
    sys.path.insert(0, api_dir)

from contextlib import asynccontextmanager
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from config import settings
from database import init_db
from llm_client import llm_client
from routers import auth, chat

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and tables on startup
    await init_db()
    yield

# Top-level FastAPI app instance expected by Vercel
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
async def chat_direct(req: DirectChatRequest):
    """Direct chat endpoint."""
    if not req.messages:
        raise HTTPException(status_code=400, detail="कम से कम एक संदेश आवश्यक है।")
    
    messages_payload = [m.model_dump() for m in req.messages]
    result = await llm_client.chat_non_stream(messages_payload, req.user_memory)
    return result

@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: DirectChatRequest):
    """Real-time streaming chat endpoint using SSE."""
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
