import { API_BASE_URL } from "../config";
import { auth } from "../firebase";

export interface UserResponse {
  id: string;
  email?: string | null;
  phone?: string | null;
  display_name: string;
  theme_preference: "light" | "dark" | "auto";
  created_at?: string;
}

export async function apiGetMyProfile(): Promise<UserResponse | null> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    const token = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
  } catch {
    return null;
  }
}

export async function apiUpdateProfile(
  name?: string,
  theme?: string
): Promise<{ success: boolean; user?: UserResponse; error?: string }> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return { success: false, error: "Not authenticated" };
    const token = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        display_name: name,
        theme: theme,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.detail || "Failed to update profile." };
    }

    return {
      success: true,
      user: {
        id: currentUser.uid,
        email: currentUser.email,
        phone: currentUser.phoneNumber,
        display_name: data.display_name || name || "User",
        theme_preference: data.theme || (theme as any) || "auto",
      },
    };
  } catch {
    return { success: false, error: "Network error: Unable to connect to server." };
  }
}
