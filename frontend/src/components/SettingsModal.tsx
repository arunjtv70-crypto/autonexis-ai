import React, { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Input } from "./Input";
import { useTheme, type ThemeChoice } from "../state/theme";
import { useAuth } from "../state/auth";
import { APP_NAME } from "../config";
import "./SettingsModal.css";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { theme, setTheme } = useTheme();
  const { user, logout, updateProfileName } = useAuth();

  const [name, setName] = useState(user?.display_name || "");
  const [savedName, setSavedName] = useState(false);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      updateProfileName(name.trim());
      setSavedName(true);
      setTimeout(() => setSavedName(false), 2000);
    }
  };

  const accountType = user?.email
    ? `Email: ${user.email}`
    : user?.phone
    ? `Phone: +91 ${user.phone}`
    : "Guest Session";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <div className="settings-content">
        {/* Profile Section */}
        <section className="settings-section">
          <label className="settings-label">Profile Name</label>
          <form onSubmit={handleSaveName} className="settings-name-form">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
            <Button type="submit" variant="secondary" size="md">
              {savedName ? "Saved!" : "Save"}
            </Button>
          </form>
        </section>

        {/* Theme Section */}
        <section className="settings-section">
          <label className="settings-label">Theme Preference</label>
          <div className="settings-theme-group">
            {(["light", "dark", "auto"] as ThemeChoice[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`settings-theme-btn ${theme === t ? "active" : ""}`}
                onClick={() => setTheme(t)}
              >
                {t === "light" && "Light"}
                {t === "dark" && "Dark"}
                {t === "auto" && "Auto"}
              </button>
            ))}
          </div>
        </section>

        {/* Account Info */}
        <section className="settings-section">
          <label className="settings-label">Account</label>
          <div className="settings-account-badge">
            <span className="badge-dot"></span>
            <span>{accountType}</span>
          </div>
        </section>

        {/* Actions */}
        <div className="settings-actions">
          <Button
            type="button"
            variant="outline"
            size="md"
            fullWidth
            onClick={() => {
              logout();
              onClose();
            }}
            className="settings-logout-btn"
          >
            Log Out
          </Button>
        </div>

        {/* Footer info (pure Autonexis branding) */}
        <div className="settings-footer">
          <span>{APP_NAME} • v1.0.0</span>
          <span className="settings-tagline">Thoughtful, private and independent AI</span>
        </div>
      </div>
    </Modal>
  );
};
