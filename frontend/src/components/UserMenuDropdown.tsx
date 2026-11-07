import React, { useEffect, useRef } from "react";
import {
  IconSettings,
  IconGlobe,
  IconHelpCircle,
  IconUpgrade,
  IconDevice,
  IconInfo,
  IconKey,
  IconLogout,
  IconChevronRight,
  IconExternalLink,
} from "./Icons";
import "./UserMenuDropdown.css";

export type SettingsTabId =
  | "account"
  | "billing"
  | "appearance"
  | "your_autonexis"
  | "capabilities"
  | "notifications"
  | "privacy"
  | "wellbeing"
  | "customize"
  | "code"
  | "language"
  | "apikeys"
  | "help";

interface UserMenuDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  onOpenSettings: (tab?: SettingsTabId) => void;
  onLogout: () => void;
  onInstallPwa?: () => void;
}

export const UserMenuDropdown: React.FC<UserMenuDropdownProps> = ({
  isOpen,
  onClose,
  userEmail,
  onOpenSettings,
  onLogout,
  onInstallPwa,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="user-menu-dropdown" ref={menuRef} role="menu">
      {/* Header with user email / account */}
      <div className="user-menu-header">
        <span className="user-menu-email">{userEmail || "user@autonexis.ai"}</span>
      </div>

      <div className="user-menu-items">
        {/* Settings */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            onClose();
            onOpenSettings("account");
          }}
        >
          <div className="user-menu-item-left">
            <IconSettings size={17} />
            <span>Settings</span>
          </div>
          <span className="user-menu-shortcut">Ctrl+Shift+,</span>
        </button>

        {/* Language */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            onClose();
            onOpenSettings("language");
          }}
        >
          <div className="user-menu-item-left">
            <IconGlobe size={17} />
            <span>Language</span>
          </div>
        </button>

        {/* Get Help */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            onClose();
            onOpenSettings("help");
          }}
        >
          <div className="user-menu-item-left">
            <IconHelpCircle size={17} />
            <span>Get help</span>
          </div>
        </button>

        {/* Upgrade Plan */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            onClose();
            onOpenSettings("billing");
          }}
        >
          <div className="user-menu-item-left">
            <IconUpgrade size={17} />
            <span>Upgrade plan</span>
          </div>
        </button>

        {/* Get apps and extensions */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            onClose();
            if (onInstallPwa) {
              onInstallPwa();
            } else {
              onOpenSettings("capabilities");
            }
          }}
        >
          <div className="user-menu-item-left">
            <IconDevice size={17} />
            <span>Get apps and extensions</span>
          </div>
        </button>

        {/* Learn more */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            onClose();
            onOpenSettings("customize");
          }}
        >
          <div className="user-menu-item-left">
            <IconInfo size={17} />
            <span>Learn more</span>
          </div>
          <IconChevronRight size={14} className="user-menu-arrow" />
        </button>

        <div className="user-menu-divider" />

        {/* Get API keys */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            onClose();
            onOpenSettings("apikeys");
          }}
        >
          <div className="user-menu-item-left">
            <IconKey size={17} />
            <span>Get API keys</span>
          </div>
          <IconExternalLink size={14} className="user-menu-arrow" />
        </button>

        <div className="user-menu-divider" />

        {/* Log out */}
        <button
          type="button"
          className="user-menu-item user-menu-logout"
          onClick={() => {
            onClose();
            onLogout();
          }}
        >
          <div className="user-menu-item-left">
            <IconLogout size={17} />
            <span>Log out</span>
          </div>
        </button>
      </div>
    </div>
  );
};

