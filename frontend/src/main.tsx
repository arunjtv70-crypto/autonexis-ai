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

// Clean up any existing Service Worker to prevent stale caching issues
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}
