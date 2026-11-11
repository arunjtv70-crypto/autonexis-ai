/**
 * AUTONEXIS Assistant - Central Frontend Configuration
 * All API routes and environment values are centralized here.
 * To change backend endpoints, edit this single file without touching UI components.
 */

export const APP_NAME = "AUTONEXIS Assistant";
export const APP_SHORT_NAME = "AUTONEXIS";
export const APP_TAGLINE = "Your AI Assistant";
export const APP_VERSION = "v2.5.0";
export const SUPPORT_EMAIL = "";
export const BRAND_FONT_EVERYWHERE = false;
export const LEGAL_DRAFT_NOTICE = "Draft, to be reviewed before launch";

export const FEATURE_FLAGS = {
  chat: true,
  images: true,
  voice: true,
  files: true,
} as const;

// Base URL from environment or relative /api for unified single-origin serving
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "/api"
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

