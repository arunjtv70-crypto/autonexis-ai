from typing import List, Optional
from fastapi import APIRouter, Depends, Request, HTTPException, status
from pydantic import BaseModel, Field

from database import User
from auth_utils import get_current_user
from firestore_service import (
    register_session,
    get_user_sessions,
    delete_user_session,
    revoke_all_user_sessions,
)

router = APIRouter(tags=["Sessions"])

class RegisterSessionRequest(BaseModel):
    session_id: str = Field(..., min_length=4, max_length=128)

@router.get("/sessions")
@router.get("/api/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user)
):
    """Retrieves all active session documents for the current user."""
    sessions = await get_user_sessions(current_user.id)
    return {"sessions": sessions}

@router.post("/sessions/register")
@router.post("/api/sessions/register")
async def register_user_session(
    req: RegisterSessionRequest,
    request: Request,
    current_user: User = Depends(get_current_user)
):
    """Registers or updates this device's session."""
    user_agent = request.headers.get("user-agent", "")
    headers = {
        "x-vercel-ip-city": request.headers.get("x-vercel-ip-city") or "",
        "x-vercel-ip-country-region": request.headers.get("x-vercel-ip-country-region") or "",
        "x-vercel-ip-country": request.headers.get("x-vercel-ip-country") or "",
    }
    client_ip = request.client.host if request.client else None

    session = await register_session(
        uid=current_user.id,
        session_id=req.session_id,
        user_agent=user_agent,
        headers=headers,
        client_ip=client_ip
    )
    return {"status": "success", "session": session}

@router.delete("/sessions/revoke-all")
@router.post("/sessions/revoke-all")
@router.post("/api/sessions/revoke-all")
async def revoke_all_sessions(
    current_user: User = Depends(get_current_user)
):
    """Deletes all session documents and revokes all refresh tokens in Firebase Auth."""
    await revoke_all_user_sessions(current_user.id)
    return {
        "status": "success",
        "message": "All sessions revoked successfully. You will be logged out on all devices."
    }

@router.delete("/sessions/{session_id}")
@router.delete("/api/sessions/{session_id}")
async def delete_single_session(
    session_id: str,
    current_user: User = Depends(get_current_user)
):
    """Deletes a specific session document."""
    await delete_user_session(current_user.id, session_id)
    return {"status": "success", "message": "Session deleted."}
