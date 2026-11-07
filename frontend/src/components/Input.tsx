import React, { useState } from "react";
import { IconEye, IconEyeOff } from "./Icons";
import "./Input.css";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  isPassword?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  hint,
  isPassword = false,
  type = "text",
  disabled,
  className = "",
  id,
  ...props
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  const effectiveType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className={`input-wrapper ${error ? "has-error" : ""} ${disabled ? "is-disabled" : ""} ${className}`}>
      {label && (
        <label htmlFor={inputId} className="input-label">
          {label}
        </label>
      )}

      <div className="input-field-container">
        <input
          id={inputId}
          type={effectiveType}
          disabled={disabled}
          className="input-element"
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            className="input-action-btn"
            onClick={() => setShowPassword(!showPassword)}
            tabIndex={-1}
            aria-label={showPassword ? "पासवर्ड छुपाएं" : "पासवर्ड दिखाएं"}
          >
            {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </button>
        )}
      </div>

      {error ? (
        <span className="input-error-msg">{error}</span>
      ) : hint ? (
        <span className="input-hint-msg">{hint}</span>
      ) : null}
    </div>
  );
};

