import React from "react";
import "./Logo.css";

interface LogoProps {
  variant?: "mark" | "full";
  size?: "xs" | "sm" | "md" | "lg";
  layout?: "inline" | "stacked";
  tile?: "square" | "circle" | "none";
  showSubtitle?: boolean;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  variant = "full",
  size = "md",
  layout,
  tile = "square",
  showSubtitle = false,
  className = "",
}) => {
  const resolvedLayout = layout || (size === "lg" ? "stacked" : "inline");

  return (
    <div
      className={`autonexis-logo variant-${variant} size-${size} layout-${resolvedLayout} tile-${tile} ${className}`.trim()}
    >
      <div className="logo-mark-tile" aria-hidden={variant === "full"}>
        <img
          src="/brand/logo-mark.png"
          alt={variant === "mark" ? "AUTONEXIS" : ""}
          className="logo-mark-img"
        />
      </div>

      {variant === "full" && (
        <div className="logo-text-wrap">
          <span className="logo-title">AUTONEXIS</span>
          {showSubtitle && <span className="logo-subtitle">Your AI Assistant</span>}
        </div>
      )}
    </div>
  );
};
