import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  anchorRef?: React.RefObject<HTMLElement | null>;
  userName?: string;
  userEmail: string;
  interfaceLanguage?: string;
  onOpenSettings: (tab?: SettingsTabId | null, subView?: SettingsSubView) => void;
  onLogout: () => void | Promise<void>;
  showInstallOption?: boolean;
  onInstallPwa?: () => void;
}

export const UserMenuDropdown: React.FC<UserMenuDropdownProps> = ({
  isOpen,
  onClose,
  anchorRef,
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
  const [desktopPos, setDesktopPos] = useState<{ left: number; bottom: number }>({
    left: 12,
    bottom: 68,
  });

  const t = (key: string) => translate(key, interfaceLanguage);

  useEffect(() => {
    if (!isOpen) {
      setLearnMoreOpen(false);
      return;
    }

    const updatePosition = () => {
      if (anchorRef?.current && window.innerWidth > 640) {
        const rect = anchorRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setDesktopPos({
            left: Math.max(8, rect.left),
            bottom: Math.max(12, window.innerHeight - rect.top + 8),
          });
        }
      }
    };
    updatePosition();

    const focusTimer = window.setTimeout(() => {
      firstBtnRef.current?.focus();
    }, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    const handleOutsidePointerDown = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (anchorRef?.current && anchorRef.current.contains(target)) return;
      onClose();
    };

    window.addEventListener("resize", updatePosition);
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen || typeof document === "undefined") return null;

  const openTarget = (tab?: SettingsTabId | null, subView: SettingsSubView = "main") => {
    onOpenSettings(tab, subView);
  };

  const content = (
    <div className="user-menu-portal-root" role="presentation">
      <div
        className="user-menu-mobile-backdrop"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-hidden="true"
      />
      <div
        className="user-menu-dropdown"
        ref={menuRef}
        role="menu"
        aria-label={t("secAccount")}
        style={
          {
            "--menu-left": `${desktopPos.left}px`,
            "--menu-bottom": `${desktopPos.bottom}px`,
          } as React.CSSProperties
        }
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
            onClick={() => openTarget(null, "main")}
          >
            <span className="user-menu-item-left">
              <IconSettings size={17} />
              <span>{t("settings")}</span>
            </span>
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
              onClick={() => onInstallPwa()}
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
            </div>
          )}

          <div className="user-menu-divider" />

          <button
            type="button"
            role="menuitem"
            className="user-menu-item user-menu-logout"
            onClick={() => {
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
    </div>
  );

  return createPortal(content, document.body);
};
