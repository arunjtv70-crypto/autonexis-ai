import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAppNavigation } from "./navigation";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const BANNER_DISMISSED_KEY = "autonexis_pwa_banner_dismissed";
const BANNER_LAST_SHOWN_KEY = "autonexis_pwa_banner_last_shown";
const APP_INSTALLED_KEY = "autonexis_pwa_installed";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Capture early beforeinstallprompt before React mounts
let earlyDeferredPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    earlyDeferredPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent("autonexis:pwa-prompt-ready"));
  });
}

function checkIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const mq = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    const navStandalone = (window.navigator as any).standalone === true;
    return !!(mq || navStandalone);
  } catch {
    return false;
  }
}

function detectIosInfo(): { isIos: boolean; isIosNonSafari: boolean } {
  if (typeof navigator === "undefined") return { isIos: false, isIosNonSafari: false };
  const ua = navigator.userAgent || "";
  const isIosDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIosDevice) return { isIos: false, isIosNonSafari: false };

  // On iOS, Safari has "Safari" in UA without Chrome/Firefox/Edge/Opera/FB/IG markers
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line|MicroMessenger/i.test(ua);
  const hasSafari = /Safari/i.test(ua);
  return {
    isIos: true,
    isIosNonSafari: isOtherBrowser || !hasSafari,
  };
}

export interface PwaContextType {
  isStandalone: boolean;
  isInstalled: boolean;
  canPromptInstall: boolean;
  isIos: boolean;
  isIosNonSafari: boolean;
  isInstallSupported: boolean;
  showIosSheet: boolean;
  setShowIosSheet: (show: boolean) => void;
  triggerInstall: () => Promise<void>;
  shouldShowPostLoginBanner: (isLoggedIn: boolean, isGuest: boolean) => boolean;
  dismissPostLoginBanner: () => void;
  markBannerShownNow: () => void;
}

const PwaContext = createContext<PwaContextType | undefined>(undefined);

export const PwaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { hasOverlay, pushOverlay, closeOverlay } = useAppNavigation();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => earlyDeferredPrompt
  );
  const [isStandalone, setIsStandalone] = useState<boolean>(() => checkIsStandalone());
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    try {
      return checkIsStandalone() || localStorage.getItem(APP_INSTALLED_KEY) === "true";
    } catch {
      return checkIsStandalone();
    }
  });
  const showIosSheet = hasOverlay("iosInstall");
  const setShowIosSheet = useCallback(
    (show: boolean) => {
      if (show) {
        pushOverlay("iosInstall");
      } else {
        closeOverlay("iosInstall");
      }
    },
    [pushOverlay, closeOverlay]
  );
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BANNER_DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [sessionBannerMarked, setSessionBannerMarked] = useState(false);

  const { isIos, isIosNonSafari } = detectIosInfo();

  useEffect(() => {
    const syncEarly = () => {
      if (earlyDeferredPrompt) {
        setDeferredPrompt(earlyDeferredPrompt);
        setIsInstalled(false);
        try {
          localStorage.removeItem(APP_INSTALLED_KEY);
        } catch {}
      }
    };
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      earlyDeferredPrompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(earlyDeferredPrompt);
      setIsInstalled(false);
      try {
        localStorage.removeItem(APP_INSTALLED_KEY);
      } catch {}
    };
    const handleAppInstalled = () => {
      earlyDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
      try {
        localStorage.setItem(APP_INSTALLED_KEY, "true");
        localStorage.setItem(BANNER_DISMISSED_KEY, "true");
      } catch {}
    };

    const mql = window.matchMedia ? window.matchMedia("(display-mode: standalone)") : null;
    const handleDisplayChange = () => {
      setIsStandalone(checkIsStandalone());
    };

    window.addEventListener("autonexis:pwa-prompt-ready", syncEarly);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);
    mql?.addEventListener?.("change", handleDisplayChange);

    return () => {
      window.removeEventListener("autonexis:pwa-prompt-ready", syncEarly);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
      mql?.removeEventListener?.("change", handleDisplayChange);
    };
  }, []);

  const canPromptInstall = !!deferredPrompt && !isStandalone && !isInstalled && !isIos;
  const isInstallSupported = !isStandalone && !isInstalled && (canPromptInstall || isIos);

  const triggerInstall = useCallback(async () => {
    if (isStandalone || isInstalled) return;
    if (isIos) {
      setShowIosSheet(true);
      return;
    }
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        earlyDeferredPrompt = null;
        setDeferredPrompt(null);
        if (choice.outcome === "accepted") {
          setIsInstalled(true);
          try {
            localStorage.setItem(APP_INSTALLED_KEY, "true");
            localStorage.setItem(BANNER_DISMISSED_KEY, "true");
          } catch {}
        }
      } catch (err) {
        console.warn("[AUTONEXIS PWA] Prompt failed:", err);
      }
      return;
    }
  }, [deferredPrompt, isIos, isStandalone, isInstalled, setShowIosSheet]);

  const dismissPostLoginBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      localStorage.setItem(BANNER_DISMISSED_KEY, "true");
    } catch {}
  }, []);

  const markBannerShownNow = useCallback(() => {
    if (sessionBannerMarked) return;
    setSessionBannerMarked(true);
    try {
      localStorage.setItem(BANNER_LAST_SHOWN_KEY, String(Date.now()));
    } catch {}
  }, [sessionBannerMarked]);

  const shouldShowPostLoginBanner = useCallback(
    (isLoggedIn: boolean, isGuest: boolean): boolean => {
      if (!isLoggedIn || isGuest) return false;
      if (isStandalone || isInstalled || bannerDismissed) return false;
      try {
        if (!sessionBannerMarked) {
          const lastShownStr = localStorage.getItem(BANNER_LAST_SHOWN_KEY);
          if (lastShownStr) {
            const lastTs = parseInt(lastShownStr, 10);
            if (!isNaN(lastTs) && Date.now() - lastTs < ONE_WEEK_MS) {
              return false;
            }
          }
        }
      } catch {}
      return true;
    },
    [isStandalone, isInstalled, bannerDismissed, sessionBannerMarked]
  );

  return (
    <PwaContext.Provider
      value={{
        isStandalone,
        isInstalled,
        canPromptInstall,
        isIos,
        isIosNonSafari,
        isInstallSupported,
        showIosSheet,
        setShowIosSheet,
        triggerInstall,
        shouldShowPostLoginBanner,
        dismissPostLoginBanner,
        markBannerShownNow,
      }}
    >
      {children}
    </PwaContext.Provider>
  );
};

export const usePwa = (): PwaContextType => {
  const ctx = useContext(PwaContext);
  if (!ctx) throw new Error("usePwa must be used within PwaProvider");
  return ctx;
};
