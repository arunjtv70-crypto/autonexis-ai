import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useTheme, type ThemeChoice } from "../state/theme";
import { useAuth } from "../state/auth";
import type { SettingsTabId } from "./UserMenuDropdown";
import "./SettingsModal.css";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTabId;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { theme, setTheme } = useTheme();
  const { user, firebaseUser, logout, updateProfileName } = useAuth();

  const [fullName, setFullName] = useState(
    user?.display_name || firebaseUser?.displayName || "User"
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (user?.display_name) {
      setFullName(user.display_name);
    } else if (firebaseUser?.displayName) {
      setFullName(firebaseUser.displayName);
    }
  }, [user?.display_name, firebaseUser?.displayName]);

  const handleSaveName = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = fullName.trim();
    if (clean) {
      await updateProfileName(clean);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleLogout = async () => {
    onClose();
    await logout();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="560px">
      <div className="settings-simple-dialog">
        <h2 className="settings-pane-title">Settings</h2>

        {/* Profile Section */}
        <div className="settings-section">
          <h3 className="settings-section-subtitle">Profile</h3>

          {/* Full Name */}
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-item-title">Name</span>
              <span className="settings-item-desc">Your display name from Firebase.</span>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="text"
                className="settings-input-control"
                style={{ maxWidth: "220px" }}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
              />
              <Button variant="secondary" size="sm" onClick={() => handleSaveName()}>
                {saved ? "Saved" : "Save"}
              </Button>
            </div>
          </div>

          {/* Email Address */}
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-item-title">Email</span>
              <span className="settings-item-desc">Your verified account email.</span>
            </div>
            <input
              type="text"
              className="settings-input-control"
              style={{ maxWidth: "260px", opacity: 0.75, cursor: "not-allowed" }}
              value={user?.email || firebaseUser?.email || "Signed in"}
              disabled
            />
          </div>
        </div>

        {/* Appearance Section */}
        <div className="settings-section">
          <h3 className="settings-section-subtitle">Appearance</h3>

          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-item-title">Theme</span>
              <span className="settings-item-desc">Select Light, Dark, or System theme.</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["light", "dark", "auto"] as ThemeChoice[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`settings-avatar-upload-btn ${theme === t ? "active" : ""}`}
                  style={
                    theme === t
                      ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 500 }
                      : {}
                  }
                  onClick={() => setTheme(t)}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Account Section */}
        <div className="settings-section" style={{ borderBottom: "none", paddingTop: "0.5rem" }}>
          <div className="settings-row" style={{ borderBottom: "none" }}>
            <div className="settings-row-info">
              <span className="settings-item-title">Session</span>
              <span className="settings-item-desc">Sign out of this device.</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              style={{
                color: "var(--danger, #ef4444)",
                borderColor: "rgba(239, 68, 68, 0.4)",
              }}
            >
              Log out
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
