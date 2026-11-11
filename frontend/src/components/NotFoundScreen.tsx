import React from "react";
import { Logo } from "./Logo";
import { useAppNavigation } from "../state/navigation";
import { Button } from "./Button";

export const NotFoundScreen: React.FC = () => {
  const { route, goHome } = useAppNavigation();

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        boxSizing: "border-box",
        backgroundColor: "var(--bg)",
        color: "var(--text-primary)",
      }}
    >
      <div
        style={{
          maxWidth: "420px",
          width: "100%",
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "36px 28px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
          boxShadow: "var(--shadow-subtle)",
        }}
      >
        <Logo size="md" showSubtitle={false} />
        <h1
          style={{
            fontSize: "1.35rem",
            fontWeight: 500,
            margin: 0,
            color: "var(--text-primary)",
          }}
        >
          Page not found
        </h1>
        <p
          style={{
            fontSize: "0.92rem",
            lineHeight: 1.55,
            color: "var(--text-secondary)",
            margin: 0,
          }}
        >
          The page <code style={{ fontFamily: "var(--font-mono)" }}>{route.pathname}</code> does not exist or may have moved.
        </p>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            goHome(true);
          }}
          style={{ textDecoration: "none", width: "100%", marginTop: "6px" }}
        >
          <Button variant="primary" size="md" fullWidth>
            Back to Chat
          </Button>
        </a>
      </div>
    </div>
  );
};

