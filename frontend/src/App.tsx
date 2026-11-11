import React, { Suspense, useEffect, useState } from "react";
import { useAuth } from "./state/auth";
import { useAppNavigation } from "./state/navigation";
import { isAppMode } from "./utils/appMode";
import { AuthScreen } from "./screens/AuthScreen";
import { LandingScreen } from "./screens/LandingScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { Skeleton } from "./components/Skeleton";
import { NotFoundScreen } from "./components/NotFoundScreen";

const LegalPageScreen = React.lazy(() =>
  import("./screens/LegalPageScreen").then((m) => ({ default: m.LegalPageScreen }))
);

const SPLASH_SESSION_KEY = "autonexis_splash_done";

export const AppContent: React.FC = () => {
  const { isAuthScreenVisible, isLoading, user, isGuest } = useAuth();
  const { route } = useAppNavigation();

  // Presentational cold-start splash guard (does NOT affect or delay auth logic itself)
  const [minSplashElapsed, setMinSplashElapsed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SPLASH_SESSION_KEY) === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (minSplashElapsed) return;
    const t = window.setTimeout(() => setMinSplashElapsed(true), 620);
    return () => window.clearTimeout(t);
  }, [minSplashElapsed]);

  const showColdSplashOverlay =
    typeof window !== "undefined" &&
    (() => {
      try {
        return sessionStorage.getItem(SPLASH_SESSION_KEY) !== "1";
      } catch {
        return false;
      }
    })();

  // Hide the inline HTML Stage 1 splash smoothly once auth resolves and min visual floor completes
  useEffect(() => {
    if (isLoading || !minSplashElapsed) return;
    try {
      sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    } catch {}
    const splashEl = document.getElementById("autonexis-splash");
    if (splashEl && !splashEl.classList.contains("is-hidden")) {
      splashEl.classList.add("is-fading-out");
      window.setTimeout(() => {
        splashEl.classList.add("is-hidden");
        splashEl.style.display = "none";
      }, 320);
    }
    document.documentElement.classList.remove("splash-booting");
  }, [isLoading, minSplashElapsed]);

  // Auth state resolution gate: kept identical in logic
  if (isLoading) {
    if (showColdSplashOverlay) {
      return null;
    }
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100vw",
          height: "100vh",
          backgroundColor: "var(--bg)",
          padding: "24px",
          boxSizing: "border-box",
          gap: "16px",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: "680px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <Skeleton width="40px" height="40px" borderRadius="50%" />
            <Skeleton width="180px" height="24px" borderRadius="6px" />
          </div>
          <Skeleton width="100%" height="80px" borderRadius="12px" />
          <Skeleton width="85%" height="60px" borderRadius="12px" />
          <Skeleton width="90%" height="70px" borderRadius="12px" />
        </div>
      </div>
    );
  }

  // Legal & informational pages are accessible both logged in and logged out
  if (route.legalPage) {
    return (
      <Suspense fallback={null}>
        <LegalPageScreen page={route.legalPage} />
      </Suspense>
    );
  }

  // Logged-out visitor: wrap AuthScreen inside LandingScreen in browser mode; straight to AuthScreen in app mode
  if (!user && !isGuest) {
    const appMode = isAppMode();
    if (!appMode && route.isNotFound) {
      return <NotFoundScreen />;
    }
    if (!appMode) {
      return <LandingScreen />;
    }
    return <AuthScreen />;
  }

  // If Guest explicitly clicked Sign In inside Chat, show AuthScreen cleanly
  if (isAuthScreenVisible) {
    return <AuthScreen />;
  }

  if (route.isNotFound) {
    return <NotFoundScreen />;
  }

  return <ChatScreen />;
};

export default AppContent;

