import React from "react";
import { useAuth } from "./state/auth";
import { AuthScreen } from "./screens/AuthScreen";
import { ChatScreen } from "./screens/ChatScreen";

export const AppContent: React.FC = () => {
  const { isAuthScreenVisible } = useAuth();

  // If Auth screen is requested or user is not logged in, show AuthScreen
  if (isAuthScreenVisible) {
    return <AuthScreen />;
  }

  return <ChatScreen />;
};

export default AppContent;
