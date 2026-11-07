import { API_BASE_URL } from "../config";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

export interface SessionItem {
  session_id: string;
  device?: string;
  browser?: string;
  os?: string;
  location?: string;
  city?: string;
  region?: string;
  country?: string;
  created_at?: string;
  last_active?: string;
}

export interface UserSettings {
  display_name: string;
  email?: string | null;
  theme: "light" | "dark" | "auto";
  updated_at?: string;
}

const SESSION_STORAGE_KEY = "autonexis_session_id";

export function getOrCreateSessionId(): string {
  try {
    let sid = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!sid) {
      sid = "sess_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
      localStorage.setItem(SESSION_STORAGE_KEY, sid);
    }
    return sid;
  } catch {
    return "sess_default_" + Date.now().toString(36);
  }
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Session-Id": getOrCreateSessionId(),
  };
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken();
      headers["Authorization"] = `Bearer ${token}`;
    } catch (err) {
      console.error("[AUTONEXIS] Failed to get ID token:", err);
    }
  }
  return headers;
}

async function handleResponseStatus(res: Response): Promise<void> {
  if (res.status === 401) {
    try {
      await signOut(auth);
    } catch {}
    window.dispatchEvent(new CustomEvent("autonexis:unauthorized"));
    throw new Error("Session expired. Please log in again.");
  }
}

export async function apiRegisterSession(): Promise<void> {
  const sessionId = getOrCreateSessionId();
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE_URL}/sessions/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: sessionId }),
    });
    await handleResponseStatus(res);
  } catch (err) {
    console.warn("[AUTONEXIS] Session register note:", err);
  }
}

export async function apiListSessions(): Promise<SessionItem[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/sessions`, { headers });
  await handleResponseStatus(res);
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions || [];
}

export async function apiDeleteSession(sessionId: string): Promise<boolean> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
    method: "DELETE",
    headers,
  });
  await handleResponseStatus(res);
  return res.ok;
}

export async function apiRevokeAllSessions(): Promise<boolean> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/sessions/revoke-all`, {
    method: "POST",
    headers,
  });
  await handleResponseStatus(res);
  return res.ok;
}

export async function apiGetSettings(): Promise<UserSettings | null> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE_URL}/settings`, { headers });
    await handleResponseStatus(res);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiUpdateSettings(displayName?: string, theme?: string): Promise<boolean> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE_URL}/settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        display_name: displayName,
        theme,
      }),
    });
    await handleResponseStatus(res);
    return res.ok;
  } catch {
    return false;
  }
}

export async function apiDeleteAllUserChats(): Promise<boolean> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/chats`, {
    method: "DELETE",
    headers,
  });
  await handleResponseStatus(res);
  return res.ok;
}

export async function apiDeleteAccount(): Promise<boolean> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/account`, {
    method: "DELETE",
    headers,
  });
  await handleResponseStatus(res);
  return res.ok;
}
