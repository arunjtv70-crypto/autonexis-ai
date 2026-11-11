import React from "react";
import { useAuth } from "./state/auth";
import { useAppNavigation } from "./state/navigation";
import { AuthScreen } from "./screens/AuthScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { Skeleton } from "./components/Skeleton";
import { NotFoundScreen } from "./components/NotFoundScreen";

export const AppContent: React.FC = () => {
  const { isAuthScreenVisible, isLoading, user, isGuest } = useAuth();
  const { route } = useAppNavigation();

  // Auth state resolution gate: do not render any chat until onAuthStateChanged has resolved
  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100vw",
          height: "100vh",
          backgroundColor: "var(--bg-primary, #0f1117)",
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

  // If Auth screen is requested or user is not logged in and not guest, show AuthScreen
  if (isAuthScreenVisible || (!user && !isGuest)) {
    return <AuthScreen />;
  }

  if (route.isNotFound) {
    return <NotFoundScreen />;
  }

  return <ChatScreen />;
};

export default AppContent;

