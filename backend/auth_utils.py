import logging
from typing import Optional, Dict, Any
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import auth as admin_auth
import google.oauth2.id_token
import google.auth.transport.requests
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import User, get_db
from firestore_service import touch_session_activity, init_firebase_admin

logger = logging.getLogger("autonexis.auth")
security = HTTPBearer(auto_error=False)
http_request = google.auth.transport.requests.Request()

def verify_firebase_id_token(token: str) -> Dict[str, Any]:
    """
    Verifies a Firebase ID token.
    First tries Firebase Admin SDK with check_revoked=True to ensure revoked tokens are rejected.
    Falls back to Google oauth2 id_token verifier.
    """
    init_firebase_admin()
    if firebase_admin._apps:
        try:
            decoded = admin_auth.verify_id_token(token, check_revoked=True)
            if decoded and (decoded.get("uid") or decoded.get("user_id") or decoded.get("sub")):
                return decoded
        except admin_auth.RevokedIdTokenError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your session has been revoked. Please log in again."
            )
        except admin_auth.UserNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account no longer exists."
            )
        except Exception as exc:
            logger.debug(f"Admin auth check note: {exc}")

    # Fallback / standard verification
    try:
        decoded = google.oauth2.id_token.verify_firebase_token(
            token,
            http_request,
            audience=settings.firebase_project_id
        )
        if not decoded or not (decoded.get("uid") or decoded.get("user_id") or decoded.get("sub")):
            raise ValueError("Token missing uid claim.")
        return decoded
    except Exception as exc:
        logger.warning(f"Firebase token verification failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, expired, or unauthorized authentication token. Please log in again."
        )

async def get_current_user(
    request: Request,
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    FastAPI dependency that validates Firebase ID token from Authorization: Bearer <token>.
    Guarantees user.id is the verified Firebase UID.
    Auto-provisions the user record in SQLite if not yet present.
    Also touches session activity if X-Session-Id header is present.
    """
    if not auth or not auth.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is missing. Please log in."
        )

    token = auth.credentials.strip()
    decoded = verify_firebase_id_token(token)

    uid: str = decoded.get("uid") or decoded.get("user_id") or decoded.get("sub")
    email: Optional[str] = decoded.get("email")
    raw_name = decoded.get("name")
    if raw_name:
        display_name = raw_name
    elif email:
        display_name = email.split("@")[0].replace(".", " ").title()
    else:
        display_name = "AUTONEXIS User"

    # Throttled session activity update on normal authenticated requests
    session_id = request.headers.get("x-session-id")
    if session_id:
        try:
            await touch_session_activity(uid, session_id)
        except Exception:
            pass

    # Query existing user by verified Firebase UID
    stmt = select(User).where(User.id == uid)
    result = await db.execute(stmt)
    user = result.scalars().first()

    if not user:
        user = User(
            id=uid,
            email=email,
            display_name=display_name,
            theme_preference="auto"
        )
        db.add(user)
        try:
            await db.commit()
            await db.refresh(user)
        except Exception:
            await db.rollback()
            res2 = await db.execute(stmt)
            user = res2.scalars().first()
    else:
        updated = False
        if email and user.email != email:
            user.email = email
            updated = True
        if raw_name and user.display_name != raw_name:
            user.display_name = raw_name
            updated = True
        if updated:
            try:
                await db.commit()
                await db.refresh(user)
            except Exception:
                await db.rollback()

    return user

async def get_optional_user(
    request: Request,
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    """Optional user dependency that returns None instead of raising 401."""
    if not auth or not auth.credentials:
        return None
    try:
        return await get_current_user(request, auth, db)
    except HTTPException:
        return None
