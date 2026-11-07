import { API_BASE_URL } from "../config";

export interface UserResponse {
  id: string;
  email?: string | null;
  phone?: string | null;
  display_name: string;
  theme_preference: "light" | "dark" | "auto";
  created_at?: string;
}

export interface AuthSuccessResult {
  success: true;
  token: string;
  user: UserResponse;
}

export interface AuthErrorResult {
  success: false;
  error: string;
}

export type AuthResult = AuthSuccessResult | AuthErrorResult;

export async function apiRegisterEmail(
  email: string,
  pass: string,
  name?: string
): Promise<AuthResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/register-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password: pass,
        display_name: name?.trim() || "User",
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.detail || "Registration failed." };
    }

    return {
      success: true,
      token: data.token,
      user: data.user,
    };
  } catch (err: any) {
    return { success: false, error: "Network error: Unable to connect to server." };
  }
}

export async function apiLoginEmail(
  email: string,
  pass: string
): Promise<AuthResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/login-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password: pass,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.detail || "Invalid email or password." };
    }

    return {
      success: true,
      token: data.token,
      user: data.user,
    };
  } catch (err: any) {
    return { success: false, error: "Network error: Unable to connect to server." };
  }
}

export async function apiLoginGoogle(mockEmail?: string): Promise<AuthResult> {
  try {
    const email = mockEmail || "user@autonexis.com";
    const rawName = email.split("@")[0].replace(/[0-9._-]+/g, " ").trim();
    const cleanName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : "Friend";
    const res = await fetch(`${API_BASE_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_token: "mock_google_id_token",
        email: email,
        display_name: cleanName,
        sub: `google_${Date.now()}`,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.detail || "Google authentication failed." };
    }

    return {
      success: true,
      token: data.token,
      user: data.user,
    };
  } catch (err: any) {
    return { success: false, error: "Network error: Unable to connect to server." };
  }
}

export async function apiSendOtp(phone: string): Promise<{ success: boolean; error?: string; devOtp?: string }> {
  try {
    const cleanPhone = phone.trim().replace(/[^0-9]/g, "");
    const res = await fetch(`${API_BASE_URL}/auth/phone/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: cleanPhone.startsWith("91") ? `+${cleanPhone}` : `+91${cleanPhone}`,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.detail || "Failed to send OTP." };
    }

    return {
      success: true,
      devOtp: data.dev_otp,
    };
  } catch (err: any) {
    return { success: false, error: "Network error: Unable to connect to server." };
  }
}

export async function apiVerifyOtp(phone: string, otp: string): Promise<AuthResult> {
  try {
    const cleanPhone = phone.trim().replace(/[^0-9]/g, "");
    const res = await fetch(`${API_BASE_URL}/auth/phone/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: cleanPhone.startsWith("91") ? `+${cleanPhone}` : `+91${cleanPhone}`,
        otp: otp.trim(),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.detail || "Invalid OTP code." };
    }

    return {
      success: true,
      token: data.token,
      user: data.user,
    };
  } catch (err: any) {
    return { success: false, error: "Network error: Unable to connect to server." };
  }
}

export async function apiUpdateProfile(
  token: string,
  name?: string,
  theme?: string
): Promise<{ success: boolean; user?: UserResponse; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        display_name: name,
        theme_preference: theme,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.detail || "Failed to update profile." };
    }

    return { success: true, user: data.user };
  } catch (err: any) {
    return { success: false, error: "Network error." };
  }
}

