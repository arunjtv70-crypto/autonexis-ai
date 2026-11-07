from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import User, Chat, get_db
from auth_utils import get_current_user
from firestore_service import (
    get_user_settings_data,
    update_user_settings_data,
    delete_entire_account,
)

router = APIRouter(tags=["Settings & Account"])

class UpdateSettingsRequest(BaseModel):
    display_name: Optional[str] = Field(None, max_length=100)
    theme: Optional[str] = Field(None, pattern="^(light|dark|auto)$")

@router.get("/settings")
@router.get("/api/settings")
async def get_settings(
    current_user: User = Depends(get_current_user)
):
    """Retrieves user settings & profile preferences from Firestore."""
    data = await get_user_settings_data(current_user.id)
    return {
        "display_name": data.get("display_name") or current_user.display_name,
        "email": current_user.email,
        "theme": data.get("theme") or current_user.theme_preference or "auto",
        "updated_at": data.get("updated_at")
    }

@router.put("/settings")
@router.put("/api/settings")
async def update_settings(
    req: UpdateSettingsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates user display name and theme preferences in Firestore and local DB."""
    # 1. Update Firestore
    fs_data = await update_user_settings_data(
        uid=current_user.id,
        display_name=req.display_name,
        theme=req.theme
    )

    # 2. Sync to local DB
    if req.display_name and req.display_name.strip():
        current_user.display_name = req.display_name.strip()
    if req.theme in ("light", "dark", "auto"):
        current_user.theme_preference = req.theme

    try:
        await db.commit()
        await db.refresh(current_user)
    except Exception:
        await db.rollback()

    return {
        "status": "success",
        "settings": {
            "display_name": current_user.display_name,
            "email": current_user.email,
            "theme": current_user.theme_preference or "auto",
            "updated_at": fs_data.get("updated_at")
        }
    }

@router.delete("/account")
@router.delete("/api/account")
async def delete_user_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Permanently deletes user's chats, sessions, settings, and Firebase user profile.
    """
    uid = current_user.id

    # 1. Delete all user chats from database
    stmt = select(Chat).where(Chat.user_id == uid)
    result = await db.execute(stmt)
    chats = result.scalars().all()
    for c in chats:
        await db.delete(c)

    # 2. Delete user record
    await db.delete(current_user)
    try:
        await db.commit()
    except Exception:
        await db.rollback()

    # 3. Delete Firestore collections & Firebase Auth user
    await delete_entire_account(uid)

    return {
        "status": "success",
        "message": "Account, conversations, and all session data have been permanently deleted."
    }
