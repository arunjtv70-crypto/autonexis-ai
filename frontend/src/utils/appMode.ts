/**
 * App Mode & Platform Detection Utilities
 * Kept in sync with pre-first-paint inline detection in frontend/index.html.
 */

export const APP_MODE_STORAGE_KEY = "autonexis_app_mode";

export function isAppMode(): boolean {
  if (typeof window === "undefined") return false;

  let detectedLive = false;

  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
      detectedLive = true;
    }
  } catch {
    // ignore matchMedia errors
  }

  try {
    if ((window.navigator as { standalone?: boolean }).standalone === true) {
      detectedLive = true;
    }
  } catch {
    // ignore navigator access errors
  }

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") === "app") {
      detectedLive = true;
    }
  } catch {
    // ignore URL parsing errors
  }

  try {
    if (typeof document !== "undefined" && document.referrer.startsWith("android-app://")) {
      detectedLive = true;
    }
  } catch {
    // ignore referrer access errors
  }

  if (detectedLive) {
    try {
      window.localStorage.setItem(APP_MODE_STORAGE_KEY, "1");
    } catch {
      // storage disabled / private browsing
    }
    try {
      document.documentElement.setAttribute("data-app-mode", "true");
    } catch {
      // ignore DOM error
    }
    return true;
  }

  try {
    if (typeof document !== "undefined" && document.documentElement.getAttribute("data-app-mode") === "true") {
      return true;
    }
  } catch {
    // ignore DOM error
  }

  try {
    if (window.localStorage.getItem(APP_MODE_STORAGE_KEY) === "1") {
      return true;
    }
  } catch {
    // storage disabled / private browsing
  }

  return false;
}

export function syncAppModeAttribute(): boolean {
  const app = isAppMode();
  if (typeof document !== "undefined") {
    try {
      document.documentElement.setAttribute("data-app-mode", app ? "true" : "false");
    } catch {
      // ignore DOM errors
    }
  }
  return app;
}

export type VisitorPlatform = "android" | "ios" | "desktop";

export function detectVisitorPlatform(): VisitorPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIos) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function isSameOriginPath(href: string): boolean {
  if (typeof window === "undefined") return false;
  if (!href) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  try {
    const resolved = new URL(href, window.location.origin);
    return resolved.origin === window.location.origin;
  } catch {
    return false;
  }
}

