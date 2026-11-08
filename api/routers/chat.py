import json
from datetime import datetime, timezone
from typing import List, Optional, Union, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import User, Chat, Message, get_db
from auth_utils import get_current_user
from llm_client import llm_client

router = APIRouter(prefix="/api/chats", tags=["Chat History"])

class CreateChatRequest(BaseModel):
    title: Optional[str] = "नई बातचीत"

class SendMessageRequest(BaseModel):
    content: Union[str, List[Dict[str, Any]]] = Field(..., description="मैसेज सामग्री")

def extract_text(content: Union[str, List[Dict[str, Any]]]) -> str:
    if isinstance(content, str):
        return content.strip()
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            return item.get("text", "").strip()
    return "[Attachment]"

def generate_clean_title(content: Union[str, List[Dict[str, Any]]]) -> str:
    """Generates a brief 4-6 word title from first user message."""
    text = extract_text(content)
    words = text.split()
    if not words:
        return "नई बातचीत"
    if len(words) <= 6:
        return " ".join(words)
    return " ".join(words[:6]) + "..."

# 1. List user's chats
@router.get("")
async def list_user_chats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(Chat)
        .where(Chat.user_id == current_user.id)
        .order_by(Chat.updated_at.desc())
    )
    result = await db.execute(stmt)
    chats = result.scalars().all()
    
    return [
        {
            "id": c.id,
            "title": c.title,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None
        }
        for c in chats
    ]

# 2. Create new chat
@router.post("")
async def create_new_chat(
    req: CreateChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    chat = Chat(
        user_id=current_user.id,
        title=req.title or "नई बातचीत"
    )
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at.isoformat() if chat.created_at else None,
        "updated_at": chat.updated_at.isoformat() if chat.updated_at else None,
        "messages": []
    }

# 3. Get chat details & message history
@router.get("/{chat_id}")
async def get_chat_details(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(Chat)
        .options(selectinload(Chat.messages))
        .where(Chat.id == chat_id, Chat.user_id == current_user.id)
    )
    result = await db.execute(stmt)
    chat = result.scalars().first()

    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="चैट नहीं मिली।")

    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at.isoformat() if chat.created_at else None,
        "updated_at": chat.updated_at.isoformat() if chat.updated_at else None,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None
            }
            for m in chat.messages
        ]
    }

# 4. Delete single chat
@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Chat).where(Chat.id == chat_id, Chat.user_id == current_user.id)
    result = await db.execute(stmt)
    chat = result.scalars().first()

    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="चैट नहीं मिली।")

    await db.delete(chat)
    await db.commit()

    return {"status": "success", "message": "बातचीत सफलतापूर्वक हटा दी गई।"}

# 4b. Delete all chats of this user
@router.delete("")
async def delete_all_user_chats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Permanently deletes all chats and messages belonging to this user."""
    stmt = select(Chat).where(Chat.user_id == current_user.id)
    result = await db.execute(stmt)
    chats = result.scalars().all()
    for c in chats:
        await db.delete(c)
    await db.commit()

    return {"status": "success", "message": "All conversations have been deleted."}

# 5. Send message & get LLM response (with complete past conversation context)
@router.post("/{chat_id}/message")
async def send_chat_message(
    chat_id: str,
    req: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(Chat)
        .options(selectinload(Chat.messages))
        .where(Chat.id == chat_id, Chat.user_id == current_user.id)
    )
    result = await db.execute(stmt)
    chat = result.scalars().first()

    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="चैट नहीं मिली।")

    # If first message, auto-title
    if not chat.messages or chat.title == "नई बातचीत":
        chat.title = generate_clean_title(req.content)

    # Save User message
    user_msg_text = extract_text(req.content)
    user_msg = Message(
        chat_id=chat.id,
        role="user",
        content=user_msg_text
    )
    db.add(user_msg)
    chat.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # Build context from previous messages + new user message
    history = [{"role": m.role, "content": m.content} for m in chat.messages]
    history.append({"role": "user", "content": req.content})

    # Call LLM
    llm_resp = await llm_client.chat_non_stream(history)
    assistant_reply = llm_resp.get("reply", "")

    # Save Assistant message
    assistant_msg = Message(
        chat_id=chat.id,
        role="assistant",
        content=assistant_reply
    )
    db.add(assistant_msg)
    chat.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return {
        "status": "success",
        "chat_id": chat.id,
        "title": chat.title,
        "user_message": {
            "id": user_msg.id,
            "role": user_msg.role,
            "content": user_msg.content,
        },
        "assistant_message": {
            "id": assistant_msg.id,
            "role": assistant_msg.role,
            "content": assistant_msg.content,
        }
    }

# 6. Stream message with context & auto-save to database upon completion
@router.post("/{chat_id}/message/stream")
async def stream_chat_message(
    chat_id: str,
    req: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(Chat)
        .options(selectinload(Chat.messages))
        .where(Chat.id == chat_id, Chat.user_id == current_user.id)
    )
    result = await db.execute(stmt)
    chat = result.scalars().first()

    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="चैट नहीं मिली।")

    if not chat.messages or chat.title == "नई बातचीत":
        chat.title = generate_clean_title(req.content)

    user_msg_text = extract_text(req.content)
    user_msg = Message(
        chat_id=chat.id,
        role="user",
        content=user_msg_text
    )
    db.add(user_msg)
    chat.updated_at = datetime.now(timezone.utc)
    await db.commit()

    history = [{"role": m.role, "content": m.content} for m in chat.messages]
    history.append({"role": "user", "content": req.content})

    async def event_generator():
        collected_tokens = []
        async for chunk in llm_client.chat_stream(history):
            if chunk.startswith("data: "):
                data_str = chunk[6:].strip()
                if data_str == "[DONE]":
                    full_reply = "".join(collected_tokens)
                    # Persist assistant reply in database
                    async with AsyncSession(db.bind) as save_session:
                        assist_msg = Message(
                            chat_id=chat_id,
                            role="assistant",
                            content=full_reply
                        )
                        save_session.add(assist_msg)
                        stmt_up = select(Chat).where(Chat.id == chat_id)
                        res = await save_session.execute(stmt_up)
                        c = res.scalars().first()
                        if c:
                            c.updated_at = datetime.now(timezone.utc)
                        await save_session.commit()

                    yield "data: [DONE]\n\n"
                    break
                try:
                    data_obj = json.loads(data_str)
                    if "content" in data_obj:
                        collected_tokens.append(data_obj["content"])
                except Exception:
                    pass
            yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

