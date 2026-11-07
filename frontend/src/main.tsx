import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { ThemeProvider } from "./state/theme";
import { AuthProvider } from "./state/auth";
import { ChatsProvider } from "./state/chats";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ChatsProvider>
          <App />
        </ChatsProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
);

// Register PWA service worker
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.log("SW registration notice:", err));
  });
}
