import React, { useEffect } from "react";
import "./Toast.css";

export interface ToastMessage {
  id: string;
  type?: "info" | "success" | "error";
  text: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss, duration = 3000 }) => {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, onDismiss, duration]);

  if (!toast) return null;

  return (
    <div className={`toast-bubble toast-${toast.type || "info"}`} role="alert">
      <span>{toast.text}</span>
    </div>
  );
};

