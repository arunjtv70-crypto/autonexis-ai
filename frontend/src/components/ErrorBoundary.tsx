import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Technical details logged only to developer console, never shown to user
    console.error("[AUTONEXIS] Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  private handleReload = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      }
    } catch (e) {
      console.warn("[AUTONEXIS] Cache purge during reload failed:", e);
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: "100vh",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            boxSizing: "border-box",
            backgroundColor: "var(--bg-app, #0C0C0E)",
            color: "var(--text-primary, #ffffff)",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: "420px",
              width: "100%",
              backgroundColor: "var(--bg-card, #141416)",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
              borderRadius: "16px",
              padding: "36px 28px",
              textAlign: "center",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                margin: "0 auto 20px",
                borderRadius: "50%",
                overflow: "hidden",
                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src="/logo_circle.png?v=20261107"
                alt="AUTONEXIS"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>

            <h1
              style={{
                fontSize: "1.25rem",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                margin: "0 0 10px 0",
                color: "var(--text-primary, #ffffff)",
              }}
            >
              Something went wrong
            </h1>

            <p
              style={{
                fontSize: "0.9rem",
                lineHeight: "1.55",
                color: "var(--text-secondary, #94a3b8)",
                margin: "0 0 28px 0",
              }}
            >
              An unexpected issue occurred while rendering the page. Reloading will refresh your session and clear any temporary state.
            </p>

            <button
              type="button"
              onClick={this.handleReload}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                padding: "12px 24px",
                fontSize: "0.95rem",
                fontWeight: 500,
                color: "var(--btn-primary-text, #000000)",
                backgroundColor: "var(--btn-primary-bg, #ffffff)",
                border: "none",
                borderRadius: "9999px",
                cursor: "pointer",
                transition: "opacity 0.15s ease",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
