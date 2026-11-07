/**
 * AUTONEXIS Assistant - Central Frontend Configuration
 * All API routes and environment values are centralized here.
 * To change backend endpoints, edit this single file without touching UI components.
 */

export const APP_NAME = "AUTONEXIS Assistant";
export const APP_SHORT_NAME = "AUTONEXIS";

// Base URL from environment (auto-detects production / Vercel vs local development)
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
    ? "/api"
    : "http://localhost:8000/api")
).replace(/\/+$/, "");

// Google OAuth Client ID (Public client ID only, never secret keys)
export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

// Centralized Endpoint Contract
export const ENDPOINTS = {
  // Authentication
  AUTH_SIGNUP: "/auth/register-email",
  AUTH_LOGIN: "/auth/login-email",
  AUTH_GOOGLE: "/auth/google",
  AUTH_OTP_SEND: "/auth/phone/send-otp",
  AUTH_OTP_VERIFY: "/auth/phone/verify-otp",
  AUTH_LOGOUT: "/auth/logout",
  AUTH_ME: "/auth/me",
  
  // Settings & Profile
  SETTINGS: "/auth/profile",

  // Chats & Conversations
  CHATS: "/chats",
  CHAT_DETAIL: (id: string) => `/chats/${id}`,
  CHAT_DELETE: (id: string) => `/chats/${id}`,
  CHAT_RENAME: (id: string) => `/chats/${id}`,
  CHAT_MESSAGES: (id: string) => `/chats/${id}`,
  CHAT_SEND_MESSAGE: (id: string) => `/chats/${id}/message`,
  CHAT_STREAM_MESSAGE: (id: string) => `/chats/${id}/message/stream`,
} as const;

