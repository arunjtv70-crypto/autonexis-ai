import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
import firebase_admin
from firebase_admin import credentials, firestore, auth as admin_auth
from config import settings

logger = logging.getLogger("autonexis.firestore")

# -------------------------------------------------------------
# Firebase Admin App Initialization
# -------------------------------------------------------------
_firestore_db = None
_has_firebase_admin_initialized = False

def init_firebase_admin():
    global _firestore_db, _has_firebase_admin_initialized
    if _has_firebase_admin_initialized:
        return _firestore_db

    project_id = settings.firebase_project_id or "autonexis-ai"
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON") or settings.firebase_service_account_json

    if not firebase_admin._apps:
        if sa_json and sa_json.strip():
            try:
                cert_dict = json.loads(sa_json.strip())
                cred = credentials.Certificate(cert_dict)
                firebase_admin.initialize_app(cred, {"projectId": project_id})
                logger.info("Firebase Admin initialized with FIREBASE_SERVICE_ACCOUNT_JSON.")
            except Exception as e:
                logger.error(f"Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: {e}")
                try:
                    cred = credentials.ApplicationDefault()
                    firebase_admin.initialize_app(cred, {"projectId": project_id})
                except Exception:
                    firebase_admin.initialize_app(options={"projectId": project_id})
        else:
            try:
                cred = credentials.ApplicationDefault()
                firebase_admin.initialize_app(cred, {"projectId": project_id})
                logger.info("Firebase Admin initialized with ApplicationDefault credentials.")
            except Exception:
                try:
                    firebase_admin.initialize_app(options={"projectId": project_id})
                    logger.info("Firebase Admin initialized with default projectId options.")
                except Exception as exc:
                    logger.warning(f"Firebase Admin app init note: {exc}")

    # Initialize Firestore client if available
    try:
        _firestore_db = firestore.client()
        logger.info("Firestore client connected successfully.")
    except Exception as exc:
        logger.warning(f"Firestore client connection note: {exc}. Using local cache for offline/dev sessions.")
        _firestore_db = None

    _has_firebase_admin_initialized = True
    return _firestore_db

# Initialize on module load
init_firebase_admin()

# In-memory session & settings store for local offline testing if Firestore credentials aren't set locally
_local_sessions_store: Dict[str, Dict[str, Any]] = {}
_local_settings_store: Dict[str, Dict[str, Any]] = {}
_session_last_touch_cache: Dict[str, datetime] = {}

def parse_user_agent(ua_string: str) -> Dict[str, str]:
    """Parses a User-Agent string into friendly device and browser descriptions."""
    ua = ua_string or ""
    ua_lower = ua.lower()

    # Browser detection
    browser = "Browser"
    if "edg/" in ua_lower:
        browser = "Microsoft Edge"
    elif "opr/" in ua_lower or "opera" in ua_lower:
        browser = "Opera"
    elif "chrome/" in ua_lower and "safari/" in ua_lower:
        browser = "Chrome"
    elif "firefox/" in ua_lower:
        browser = "Firefox"
    elif "safari/" in ua_lower and "chrome/" not in ua_lower:
        browser = "Safari"
    elif "samsungbrowser/" in ua_lower:
        browser = "Samsung Internet"

    # OS / Device detection
    os_name = "Device"
    if "windows" in ua_lower:
        os_name = "Windows"
    elif "macintosh" in ua_lower or "mac os x" in ua_lower:
        os_name = "macOS"
    elif "iphone" in ua_lower:
        os_name = "iPhone"
    elif "ipad" in ua_lower:
        os_name = "iPad"
    elif "android" in ua_lower:
        os_name = "Android"
    elif "linux" in ua_lower:
        os_name = "Linux"

    return {
        "device": f"{browser} on {os_name}",
        "browser": browser,
        "os": os_name
    }

def parse_location(headers: Dict[str, str], client_ip: Optional[str] = None) -> str:
    """Extracts approximate location from Vercel edge IP headers."""
    city = headers.get("x-vercel-ip-city") or headers.get("x-real-ip-city")
    region = headers.get("x-vercel-ip-country-region") or headers.get("x-real-ip-region")
    country = headers.get("x-vercel-ip-country") or headers.get("x-real-ip-country")

    parts = [p.strip() for p in [city, region, country] if p and p.strip()]
    if parts:
        return ", ".join(parts)
    
    if client_ip in ("127.0.0.1", "::1", "localhost", None):
        return "Local Network"
    return "India (Standard)"

def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# -------------------------------------------------------------
# Firestore / Store Operations
# -------------------------------------------------------------
async def register_session(
    uid: str,
    session_id: str,
    user_agent: str,
    headers: Dict[str, str],
    client_ip: Optional[str] = None
) -> Dict[str, Any]:
    """Registers or updates a user session document."""
    db = init_firebase_admin()
    ua_info = parse_user_agent(user_agent)
    location = parse_location(headers, client_ip)
    now = utcnow_iso()

    session_data = {
        "session_id": session_id,
        "device": ua_info["device"],
        "browser": ua_info["browser"],
        "os": ua_info["os"],
        "user_agent": user_agent[:255] if user_agent else "Unknown",
        "location": location,
        "city": headers.get("x-vercel-ip-city") or "",
        "region": headers.get("x-vercel-ip-country-region") or "",
        "country": headers.get("x-vercel-ip-country") or "",
        "last_active": now,
    }

    if db:
        try:
            doc_ref = db.collection("users").document(uid).collection("sessions").document(session_id)
            existing = doc_ref.get()
            if existing.exists:
                doc_ref.update({
                    "last_active": now,
                    "location": location,
                    "device": ua_info["device"],
                })
                stored = existing.to_dict() or {}
                session_data["created_at"] = stored.get("created_at", now)
            else:
                session_data["created_at"] = now
                doc_ref.set(session_data)
            return session_data
        except Exception as e:
            logger.warning(f"Firestore session write note: {e}")

    # Fallback to local store
    key = f"{uid}:{session_id}"
    if key in _local_sessions_store:
        _local_sessions_store[key].update({
            "last_active": now,
            "location": location,
            "device": ua_info["device"]
        })
    else:
        session_data["created_at"] = now
        _local_sessions_store[key] = session_data

    return _local_sessions_store[key]

async def touch_session_activity(uid: str, session_id: Optional[str]):
    """Throttled touch: updates last_active at most once every 5 minutes."""
    if not session_id or not uid:
        return

    cache_key = f"{uid}:{session_id}"
    now_dt = datetime.now(timezone.utc)
    last_touch = _session_last_touch_cache.get(cache_key)

    if last_touch and (now_dt - last_touch).total_seconds() < 300:
        return  # Touched less than 5 minutes ago

    _session_last_touch_cache[cache_key] = now_dt
    now_iso = now_dt.isoformat()
    db = init_firebase_admin()

    if db:
        try:
            doc_ref = db.collection("users").document(uid).collection("sessions").document(session_id)
            doc_ref.update({"last_active": now_iso})
            return
        except Exception:
            pass

    if cache_key in _local_sessions_store:
        _local_sessions_store[cache_key]["last_active"] = now_iso

async def get_user_sessions(uid: str) -> List[Dict[str, Any]]:
    """Retrieves all active session documents for a user."""
    db = init_firebase_admin()
    if db:
        try:
            docs = db.collection("users").document(uid).collection("sessions").stream()
            sessions = []
            for doc in docs:
                data = doc.to_dict()
                if data:
                    data["session_id"] = doc.id
                    sessions.append(data)
            # Sort by last_active descending
            sessions.sort(key=lambda s: s.get("last_active", ""), reverse=True)
            return sessions
        except Exception as e:
            logger.warning(f"Firestore get_sessions note: {e}")

    # Local store fallback
    prefix = f"{uid}:"
    user_sessions = [
        val for key, val in _local_sessions_store.items()
        if key.startswith(prefix)
    ]
    user_sessions.sort(key=lambda s: s.get("last_active", ""), reverse=True)
    return user_sessions

async def delete_user_session(uid: str, session_id: str) -> bool:
    """Deletes a specific user session document."""
    db = init_firebase_admin()
    if db:
        try:
            db.collection("users").document(uid).collection("sessions").document(session_id).delete()
        except Exception as e:
            logger.warning(f"Firestore delete_session note: {e}")

    key = f"{uid}:{session_id}"
    _local_sessions_store.pop(key, None)
    _session_last_touch_cache.pop(key, None)
    return True

async def revoke_all_user_sessions(uid: str) -> bool:
    """
    Deletes all session docs and revokes all refresh tokens in Firebase Auth.
    """
    # 1. Revoke refresh tokens via Firebase Admin Auth
    try:
        admin_auth.revoke_refresh_tokens(uid)
        logger.info(f"Firebase refresh tokens revoked for user {uid}")
    except Exception as e:
        logger.warning(f"Firebase revoke_refresh_tokens note: {e}")

    # 2. Delete all Firestore session documents
    db = init_firebase_admin()
    if db:
        try:
            sessions_ref = db.collection("users").document(uid).collection("sessions")
            docs = sessions_ref.stream()
            for doc in docs:
                doc.reference.delete()
        except Exception as e:
            logger.warning(f"Firestore revoke_all_sessions note: {e}")

    # 3. Clear local store
    prefix = f"{uid}:"
    keys_to_remove = [k for k in _local_sessions_store if k.startswith(prefix)]
    for k in keys_to_remove:
        _local_sessions_store.pop(k, None)
        _session_last_touch_cache.pop(k, None)

    return True

async def get_user_settings_data(uid: str) -> Dict[str, Any]:
    """Retrieves user settings/preferences."""
    db = init_firebase_admin()
    if db:
        try:
            doc = db.collection("users").document(uid).collection("settings").document("preferences").get()
            if doc.exists:
                return doc.to_dict() or {}
        except Exception as e:
            logger.warning(f"Firestore get_settings note: {e}")

    return _local_settings_store.get(uid, {"theme": "auto"})

async def update_user_settings_data(uid: str, display_name: Optional[str] = None, theme: Optional[str] = None) -> Dict[str, Any]:
    """Updates user settings/preferences in Firestore."""
    db = init_firebase_admin()
    current = await get_user_settings_data(uid)
    if display_name is not None and display_name.strip():
        current["display_name"] = display_name.strip()
    if theme in ("light", "dark", "auto"):
        current["theme"] = theme
    current["updated_at"] = utcnow_iso()

    if db:
        try:
            doc_ref = db.collection("users").document(uid).collection("settings").document("preferences")
            doc_ref.set(current, merge=True)
        except Exception as e:
            logger.warning(f"Firestore update_settings note: {e}")

    _local_settings_store[uid] = current
    return current

async def delete_entire_account(uid: str) -> bool:
    """
    Deletes all user sessions, settings, and deletes user from Firebase Auth.
    """
    # 1. Delete Firestore collections
    db = init_firebase_admin()
    if db:
        try:
            # Delete sessions
            for doc in db.collection("users").document(uid).collection("sessions").stream():
                doc.reference.delete()
            # Delete settings
            for doc in db.collection("users").document(uid).collection("settings").stream():
                doc.reference.delete()
            # Delete user root doc if present
            db.collection("users").document(uid).delete()
        except Exception as e:
            logger.warning(f"Firestore delete account collections note: {e}")

    # 2. Delete user in Firebase Authentication
    try:
        admin_auth.delete_user(uid)
        logger.info(f"Firebase user {uid} deleted successfully.")
    except Exception as e:
        logger.warning(f"Firebase Admin delete_user note: {e}")

    # 3. Clear local caches
    prefix = f"{uid}:"
    keys_to_remove = [k for k in _local_sessions_store if k.startswith(prefix)]
    for k in keys_to_remove:
        _local_sessions_store.pop(k, None)
        _session_last_touch_cache.pop(k, None)
    _local_settings_store.pop(uid, None)

    return True
