import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { ThemeProvider } from "./state/theme";
import { AuthProvider } from "./state/auth";
import { ChatsProvider } from "./state/chats";
import { PwaProvider } from "./state/pwa";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";

// Register Service Worker for offline PWA support and install prompt
if (typeof window !== "undefined" && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[AUTONEXIS PWA] SW registration skipped:", err);
    });
  });
}

// Guard against ChunkLoadError / stale asset hashes after deployments
function handleChunkError(errorLike: any) {
  const msg = String(errorLike?.message || errorLike?.reason?.message || errorLike || "");
  const isChunkError =
    msg.includes("Loading chunk") ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("error loading dynamically imported module");

  if (isChunkError) {
    const RELOAD_KEY = "autonexis_chunk_reload_lock";
    const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY);
    if (!alreadyReloaded) {
      sessionStorage.setItem(RELOAD_KEY, "true");
      // Clear cache and hard reload once
      if (typeof caches !== "undefined") {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .finally(() => {
            window.location.reload();
          });
      } else {
        window.location.reload();
      }
    }
  }
}

window.addEventListener("error", (event) => handleChunkError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => handleChunkError(event.reason));

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <ThemeProvider>
          <PwaProvider>
            <AuthProvider>
              <ChatsProvider>
                <App />
              </ChatsProvider>
            </AuthProvider>
          </PwaProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>
  );

  try {
    (window as any).__AUTONEXIS_MOUNTED__ = true;
  } catch {}
}
