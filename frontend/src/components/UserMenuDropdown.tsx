import React, { useEffect, useRef } from "react";
import { IconSettings, IconLogout } from "./Icons";
import "./UserMenuDropdown.css";

export type SettingsTabId = "account" | "personalization" | "memory" | "appearance" | "data";

interface UserMenuDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  onOpenSettings: (tab?: SettingsTabId) => void;
  onLogout: () => void | Promise<void>;
  onInstallPwa?: () => void;
}

export const UserMenuDropdown: React.FC<UserMenuDropdownProps> = ({
  isOpen,
  onClose,
  userEmail,
  onOpenSettings,
  onLogout,
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
      {/* Header with user email */}
      <div className="user-menu-header">
        <span className="user-menu-email">{userEmail || "Signed in"}</span>
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
