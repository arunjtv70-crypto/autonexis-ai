import React, { useEffect, useRef, useState } from "react";
import {
  IconSettings,
  IconLogout,
  IconGlobe,
  IconHelpCircle,
  IconSmartphone,
  IconInfo,
  IconChevronRight,
  IconChevronDown,
  IconFileText,
  IconShield,
  IconKeyboard,
} from "./Icons";
import { translate } from "../i18n/translations";
import "./UserMenuDropdown.css";

export type SettingsTabId =
  | "account"
  | "appearance"
  | "personalization"
  | "capabilities"
  | "notifications"
  | "privacy"
  | "wellbeing"
  | "customize"
  | "language"
  | "help"
  | "about";

export type SettingsSubView =
  | "main"
  | "terms"
  | "privacy"
  | "shortcuts"
  | "support-resources";

interface UserMenuDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
  userEmail: string;
  interfaceLanguage?: string;
  onOpenSettings: (tab?: SettingsTabId, subView?: SettingsSubView) => void;
  onLogout: () => void | Promise<void>;
  showInstallOption?: boolean;
  onInstallPwa?: () => void;
}

export const UserMenuDropdown: React.FC<UserMenuDropdownProps> = ({
  isOpen,
  onClose,
  userName,
  userEmail,
  interfaceLanguage = "English",
  onOpenSettings,
  onLogout,
  showInstallOption = false,
  onInstallPwa,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);

  const t = (key: string) => translate(key, interfaceLanguage);

  useEffect(() => {
    if (!isOpen) {
      setLearnMoreOpen(false);
      return;
    }

    const focusTimer = window.setTimeout(() => {
      firstBtnRef.current?.focus();
    }, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const openTarget = (tab: SettingsTabId, subView: SettingsSubView = "main") => {
    onClose();
    onOpenSettings(tab, subView);
  };

  return (
    <>
      <div className="user-menu-mobile-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="user-menu-dropdown"
        ref={menuRef}
        role="menu"
        aria-label={t("secAccount")}
      >
        <div className="user-menu-sheet-handle" aria-hidden="true" />

        {/* Account identity header */}
        <div className="user-menu-header">
          {userName && <span className="user-menu-name">{userName}</span>}
          <span className="user-menu-email">{userEmail || "Signed in"}</span>
        </div>

        <div className="user-menu-items">
          <button
            ref={firstBtnRef}
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => openTarget("account")}
          >
            <span className="user-menu-item-left">
              <IconSettings size={17} />
              <span>{t("settings")}</span>
            </span>
            <span className="user-menu-shortcut">Ctrl+Shift+,</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => openTarget("language")}
          >
            <span className="user-menu-item-left">
              <IconGlobe size={17} />
              <span>{t("language")}</span>
            </span>
            <span className="user-menu-meta">{interfaceLanguage}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => openTarget("help")}
          >
            <span className="user-menu-item-left">
              <IconHelpCircle size={17} />
              <span>{t("getHelp")}</span>
            </span>
          </button>

          {showInstallOption && onInstallPwa && (
            <button
              type="button"
              role="menuitem"
              className="user-menu-item"
              onClick={() => {
                onClose();
                onInstallPwa();
              }}
            >
              <span className="user-menu-item-left">
                <IconSmartphone size={17} />
                <span>{t("installApp")}</span>
              </span>
            </button>
          )}

          {/* Expandable Learn more submenu */}
          <button
            type="button"
            role="menuitem"
            aria-expanded={learnMoreOpen}
            className="user-menu-item"
            onClick={() => setLearnMoreOpen((prev) => !prev)}
          >
            <span className="user-menu-item-left">
              <IconInfo size={17} />
              <span>{t("learnMore")}</span>
            </span>
            <span className="user-menu-arrow">
              {learnMoreOpen ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
            </span>
          </button>

          {learnMoreOpen && (
            <div className="user-menu-submenu" role="group" aria-label={t("learnMore")}>
              <button
                type="button"
                role="menuitem"
                className="user-menu-subitem"
                onClick={() => openTarget("about", "main")}
              >
                <IconInfo size={15} />
                <span>{t("about")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="user-menu-subitem"
                onClick={() => openTarget("about", "terms")}
              >
                <IconFileText size={15} />
                <span>{t("terms")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="user-menu-subitem"
                onClick={() => openTarget("about", "privacy")}
              >
                <IconShield size={15} />
                <span>{t("privacyPolicy")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="user-menu-subitem"
                onClick={() => openTarget("about", "shortcuts")}
              >
                <IconKeyboard size={15} />
                <span>{t("keyboardShortcuts")}</span>
              </button>
            </div>
          )}

          <div className="user-menu-divider" />

          <button
            type="button"
            role="menuitem"
            className="user-menu-item user-menu-logout"
            onClick={() => {
              onClose();
              onLogout();
            }}
          >
            <span className="user-menu-item-left">
              <IconLogout size={17} />
              <span>{t("logOut")}</span>
            </span>
          </button>
        </div>
      </div>
    </>
  );
};
