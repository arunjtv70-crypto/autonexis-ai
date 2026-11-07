import React from "react";
import "./Logo.css";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showSubtitle?: boolean;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  size = "md",
  showSubtitle = false,
  className = "",
}) => {
  return (
    <div className={`autonexis-logo size-${size} ${className}`}>
      <div className="logo-circle-frame" aria-hidden="true">
        <img
          src="/logo_circle.png"
          alt="AUTONEXIS"
          className="logo-circle-img"
        />
      </div>

      <div className="logo-text-wrap">
        <span className="logo-title">AUTONEXIS</span>
        {showSubtitle && <span className="logo-subtitle">Your AI Assistant</span>}
      </div>
    </div>
  );
};
