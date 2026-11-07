from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import User, get_db
from auth_utils import get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentication & Profile"])

class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(None, max_length=100)
    theme_preference: Optional[str] = Field(None, pattern="^(light|dark|auto)$")

def format_user_payload(user: User):
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "theme_preference": user.theme_preference or "auto",
        "created_at": user.created_at.isoformat() if user.created_at else None
    }

@router.get("/me")
async def get_my_profile(current_user: User = Depends(get_current_user)):
    """Returns the verified Firebase user profile."""
    return {"user": format_user_payload(current_user)}

@router.put("/profile")
async def update_my_profile(
    req: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates the user profile preferences (display name, theme)."""
    if req.display_name is not None and req.display_name.strip():
        current_user.display_name = req.display_name.strip()
    if req.theme_preference is not None:
        current_user.theme_preference = req.theme_preference
    
    await db.commit()
    await db.refresh(current_user)
    return {
        "status": "success",
        "user": format_user_payload(current_user)
    }
