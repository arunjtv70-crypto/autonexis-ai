import React, { useState, useEffect, useMemo, useRef } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useTheme, type ThemeChoice } from "../state/theme";
import { useAuth } from "../state/auth";
import { useChats } from "../state/chats";
import { usePwa } from "../state/pwa";
import { APP_VERSION, SUPPORT_EMAIL } from "../config";
import { translate } from "../i18n/translations";
import { speakTextWithPreferences } from "./CreationCards";
import type { SettingsTabId, SettingsSubView } from "./UserMenuDropdown";
import {
  IconUser,
  IconPalette,
  IconSliders,
  IconZap,
  IconBell,
  IconShield,
  IconHeart,
  IconSparkles,
  IconGlobe,
  IconHelpCircle,
  IconInfo,
  IconSearch,
  IconTrash,
  IconEdit,
  IconCheck,
  IconPlus,
  IconDownload,
  IconLogout,
  IconSmartphone,
  IconKeyboard,
  IconFileText,
  IconChevronRight,
  IconVolume,
} from "./Icons";
import "./SettingsModal.css";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTabId;
  initialSubView?: SettingsSubView;
  onTabChange?: (tab: SettingsTabId, subView?: SettingsSubView) => void;
}

interface SectionConfig {
  id: SettingsTabId;
  labelKey: string;
  keywords: string;
  icon: React.ReactNode;
  group: "main" | "extra";
}

const SECTIONS: SectionConfig[] = [
  { id: "account", labelKey: "secAccount", keywords: "profile name email login date logout", icon: <IconUser size={16} />, group: "main" },
  { id: "appearance", labelKey: "secAppearance", keywords: "theme dark light auto text size font density compact motion animation code wrap", icon: <IconPalette size={16} />, group: "main" },
  { id: "personalization", labelKey: "secPersonalization", keywords: "nickname role instructions about style hinglish hindi english reply language", icon: <IconSliders size={16} />, group: "main" },
  { id: "capabilities", labelKey: "secCapabilities", keywords: "memory past chats web search voice speech mic enter scroll starter prompts", icon: <IconZap size={16} />, group: "main" },
  { id: "notifications", labelKey: "secNotifications", keywords: "alert background sound chime permission", icon: <IconBell size={16} />, group: "main" },
  { id: "privacy", labelKey: "secPrivacy", keywords: "data export delete chats memory temporary clear device storage", icon: <IconShield size={16} />, group: "main" },
  { id: "wellbeing", labelKey: "secWellbeing", keywords: "break reminder health helpline support india telemanas kiran icall nimhans", icon: <IconHeart size={16} />, group: "main" },
  { id: "customize", labelKey: "secCustomize", keywords: "custom styles tone writing sample analyze", icon: <IconSparkles size={16} />, group: "extra" },
  { id: "language", labelKey: "secLanguage", keywords: "app interface language english hindi hinglish ui", icon: <IconGlobe size={16} />, group: "extra" },
  { id: "help", labelKey: "secHelp", keywords: "faq support report bug problem contact", icon: <IconHelpCircle size={16} />, group: "extra" },
  { id: "about", labelKey: "secAbout", keywords: "version terms privacy policy keyboard shortcuts install pwa", icon: <IconInfo size={16} />, group: "extra" },
];

const FAQ_ITEMS = [
  {
    q: "What is the difference between a normal chat and a Temporary Chat?",
    a: "Normal chats are saved to your account so you can continue them later across devices. Temporary Chats are not saved to your history, cannot trigger new memories, and do not reference past chats.",
  },
  {
    q: "How does Memory work?",
    a: "When Memory is on, AUTONEXIS Assistant remembers key facts you share (like your preferences or role) in your private Memory list. You can inspect, edit, or delete any saved memory anytime under Capabilities or Privacy.",
  },
  {
    q: "What does Reference past chats do?",
    a: "When enabled, AUTONEXIS Assistant looks for up to 3 keyword-matched snippets from your recent chats so follow-up questions feel continuous without repeating yourself. It is always disabled in Temporary Chat and Guest mode.",
  },
  {
    q: "How do Custom Styles work?",
    a: "Under Customize, you can paste a short writing sample (up to 2000 characters). AUTONEXIS Assistant extracts a brief style summary (such as tone, pacing, and sentence structure) that you can turn on whenever you want replies written in that voice.",
  },
  {
    q: "What happens if I change App Language vs Reply Language?",
    a: "Language (in the left sidebar) translates app buttons, menus, and settings screens immediately. Reply Language (under Personalization) guides the language the assistant uses in its replies.",
  },
  {
    q: "Why do Voice controls only show certain options?",
    a: "Read-aloud (Text-to-Speech) and Voice Input (Speech-to-Text) use your browser's built-in speech capabilities. If a browser doesn't expose those voices or microphone speech APIs, those controls are hidden rather than showing broken buttons.",
  },
  {
    q: "How do Background Notifications work?",
    a: "When turned on, AUTONEXIS Assistant asks your browser for notification permission so it can alert you if a reply finishes while you switched to another tab. It does not send emails or mobile push alerts when the app is closed.",
  },
  {
    q: "How can I export or erase my data?",
    a: "Go to Privacy to download all chats as JSON, delete all chats, delete all memories, or clear all cached data stored on this browser.",
  },
  {
    q: "Which keyboard shortcuts can I use?",
    a: "Use Ctrl+K to search chats, Ctrl+Shift+O for a new chat, Ctrl+Shift+, to open Settings, and Esc to close dialogs. You can also toggle whether Enter sends or inserts a new line under Capabilities.",
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = "account",
  initialSubView = "main",
  onTabChange,
}) => {
  const { theme, setTheme } = useTheme();
  const { user, firebaseUser, isGuest, logout } = useAuth();
  const {
    isStandalone,
    isInstalled,
    isInstallSupported,
    canPromptInstall,
    triggerInstall,
  } = usePwa();
  const {
    preferences,
    memories,
    prefSaveStatus,
    updatePreferences,
    flushPreferencesNow,
    createCustomStyle,
    updateCustomStyle,
    deleteCustomStyle,
    setActiveCustomStyle,
    submitProblemReport,
    clearLocalDeviceData,
    addMemoryManual,
    editMemory,
    deleteMemory,
    clearAllMemories,
    clearAllChats,
    exportMyChats,
  } = useChats();

  const t = (key: string) => translate(key, preferences.interfaceLanguage);

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [subView, setSubView] = useState<SettingsSubView>(initialSubView);
  const [mobileStage, setMobileStage] = useState<"list" | "detail">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Account & Personalization local controlled values (kept in sync on open/change)
  const [displayName, setDisplayName] = useState("");
  const [nickname, setNickname] = useState("");
  const [userRole, setUserRole] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");

  // Capabilities / Memory / Voice
  const [newMemoryText, setNewMemoryText] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryText, setEditingMemoryText] = useState("");
  const [confirmDeleteAllMemories, setConfirmDeleteAllMemories] = useState(false);
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);

  // Notifications
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  // Privacy confirms & notice
  const [confirmDeleteAllChats, setConfirmDeleteAllChats] = useState(false);
  const [confirmClearDevice, setConfirmClearDevice] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Custom styles state
  const [newStyleName, setNewStyleName] = useState("");
  const [newStyleSample, setNewStyleSample] = useState("");
  const [isCreatingStyle, setIsCreatingStyle] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const [editingStyleName, setEditingStyleName] = useState("");
  const [editingStyleDesc, setEditingStyleDesc] = useState("");

  // Help / Report problem state
  const [reportCategory, setReportCategory] = useState("Bug");
  const [reportMessage, setReportMessage] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportStatus, setReportStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Check speech & notification capabilities once modal opens
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasTts = "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
    setTtsSupported(hasTts);
    if (hasTts) {
      const refreshVoices = () => {
        try {
          setAvailableVoices(window.speechSynthesis.getVoices() || []);
        } catch {
          setAvailableVoices([]);
        }
      };
      refreshVoices();
      window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
    }
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSttSupported(!!SpeechRec);

    if ("Notification" in window) {
      setNotifPermission(Notification.permission);
    } else {
      setNotifPermission("unsupported");
    }
  }, [isOpen]);

  // Sync open state & deep-linked section/subView
  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab || "account");
    setSubView(initialSubView || "main");

    // On mobile phones, if caller navigated to a specific section or subView (like Language, Help, Privacy, deep URL), jump straight to detail view; otherwise start at list
    const openedExplicitSection =
      initialSubView !== "main" ||
      (initialTab && initialTab !== "account") ||
      (typeof window !== "undefined" && window.location.pathname.startsWith("/settings/"));
    setMobileStage(openedExplicitSection ? "detail" : "list");

    setDisplayName(preferences.displayName || user?.display_name || firebaseUser?.displayName || "");
    setNickname(preferences.nickname || "");
    setUserRole(preferences.userRole || "");
    setCustomInstructions(preferences.customInstructions || "");
    setConfirmDeleteAllMemories(false);
    setConfirmDeleteAllChats(false);
    setConfirmClearDevice(false);
    setActionNotice(null);
    setStyleError(null);
    setReportStatus(null);
    setSearchQuery("");
  }, [isOpen, initialTab, initialSubView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap within settings modal for keyboard users
  useEffect(() => {
    if (!isOpen) return;
    const handleTabTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleTabTrap);
    return () => document.removeEventListener("keydown", handleTabTrap);
  }, [isOpen, mobileStage, activeTab, subView]);

  const navigateSection = (tab: SettingsTabId, nextSubView: SettingsSubView = "main") => {
    setActiveTab(tab);
    setSubView(nextSubView);
    setMobileStage("detail");
    setConfirmDeleteAllMemories(false);
    setConfirmDeleteAllChats(false);
    setConfirmClearDevice(false);
    setActionNotice(null);
    onTabChange?.(tab, nextSubView);
  };

  const handleClose = () => {
    flushPreferencesNow();
    onClose();
  };

  const showTempNotice = (msg: string) => {
    setActionNotice(msg);
    window.setTimeout(() => setActionNotice(null), 3500);
  };

  // Account derived metadata
  const accountSignInMethod = useMemo(() => {
    if (isGuest) return "Guest Mode";
    const providerId = firebaseUser?.providerData?.[0]?.providerId;
    if (providerId === "google.com") return "Google";
    if (providerId === "password") return "Email & Password";
    if (providerId === "phone") return "Phone";
    return providerId || "Email & Password";
  }, [isGuest, firebaseUser]);

  const accountCreatedFormatted = useMemo(() => {
    const raw = firebaseUser?.metadata?.creationTime;
    if (!raw) return isGuest ? "Temporary session" : "Available once synced";
    try {
      return new Date(raw).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return raw;
    }
  }, [firebaseUser?.metadata?.creationTime, isGuest]);

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => {
      const label = t(s.labelKey).toLowerCase();
      return label.includes(q) || s.keywords.includes(q) || s.id.includes(q);
    });
  }, [searchQuery, preferences.interfaceLanguage]); // eslint-disable-line react-hooks/exhaustive-deps

  const mainNav = filteredSections.filter((s) => s.group === "main");
  const extraNav = filteredSections.filter((s) => s.group === "extra");

  // Handlers
  const handleDisplayNameChange = (val: string) => {
    setDisplayName(val);
    updatePreferences({ displayName: val.slice(0, 80) });
  };

  const handleNicknameChange = (val: string) => {
    setNickname(val);
    updatePreferences({ nickname: val.slice(0, 60) });
  };

  const handleRoleChange = (val: string) => {
    setUserRole(val);
    updatePreferences({ userRole: val.slice(0, 120) });
  };

  const handleCustomInstructionsChange = (val: string) => {
    const capped = val.slice(0, 1500);
    setCustomInstructions(capped);
    updatePreferences({ customInstructions: capped });
  };

  const handleThemeSelect = (choice: ThemeChoice) => {
    setTheme(choice);
    updatePreferences({ theme: choice });
  };

  const handleToggleBackgroundNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifPermission("unsupported");
      return;
    }
    if (preferences.notifyInBackground) {
      updatePreferences({ notifyInBackground: false });
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = "denied";
      }
    }
    setNotifPermission(perm);
    if (perm === "granted") {
      updatePreferences({ notifyInBackground: true });
    } else {
      updatePreferences({ notifyInBackground: false });
    }
  };

  const handleCreateStyle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingStyle) return;
    setStyleError(null);
    setIsCreatingStyle(true);
    try {
      const res = await createCustomStyle(newStyleName, newStyleSample);
      if (!res.ok) {
        setStyleError(res.error || "Could not create custom style.");
      } else {
        setNewStyleName("");
        setNewStyleSample("");
        showTempNotice("Custom style created and activated.");
      }
    } finally {
      setIsCreatingStyle(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingReport) return;
    setReportStatus(null);
    setIsSubmittingReport(true);
    try {
      const res = await submitProblemReport(reportCategory, reportMessage);
      if (res.ok) {
        setReportMessage("");
        setReportStatus({ ok: true, msg: "Report submitted cleanly. Thank you for the feedback." });
      } else {
        setReportStatus({ ok: false, msg: res.error || "Could not send report right now." });
      }
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportMyChats();
      showTempNotice("Your chat export has started downloading.");
    } finally {
      setIsExporting(false);
    }
  };

  const handlePreviewVoice = () => {
    speakTextWithPreferences(
      "Hello! This is a preview of how AUTONEXIS Assistant sounds with your selected voice settings.",
      {
        voiceName: preferences.voiceName,
        voiceSpeed: preferences.voiceSpeed,
        voiceLanguage: preferences.voiceLanguage,
      }
    );
  };

  const currentSectionObj = SECTIONS.find((s) => s.id === activeTab);
  const currentTitle = currentSectionObj ? t(currentSectionObj.labelKey) : t("settingsTitle");
  const showInstallCard = !isStandalone && !isInstalled && (isInstallSupported || canPromptInstall);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("settingsTitle")}
      maxWidth="880px"
      className="settings-modal-fullscreen"
    >
      <div
        ref={dialogRef}
        className={`settings-modal-dialog ${mobileStage === "detail" ? "mobile-stage-detail" : "mobile-stage-list"}`}
      >
        {/* Left Navigation Panel (Sidebar on Desktop, Full Section List on Phone) */}
        <aside className="settings-sidebar" aria-label={t("settingsTitle")}>
          <div className="settings-search-box">
            <IconSearch size={15} className="settings-search-icon" />
            <input
              type="search"
              className="settings-search-input"
              placeholder={t("searchSettingsPlaceholder")}
              aria-label={t("searchSettingsPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="settings-nav-group">
            {mainNav.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-btn ${activeTab === item.id ? "active" : ""}`}
                onClick={() => navigateSection(item.id, "main")}
                aria-current={activeTab === item.id ? "page" : undefined}
              >
                <span className="settings-nav-btn-left">
                  {item.icon}
                  <span>{t(item.labelKey)}</span>
                </span>
                <IconChevronRight size={14} className="settings-mobile-nav-chevron" />
              </button>
            ))}
          </div>

          {extraNav.length > 0 && (
            <>
              <div className="settings-nav-divider" />
              <div className="settings-nav-group">
                {extraNav.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-nav-btn ${activeTab === item.id ? "active" : ""}`}
                    onClick={() => navigateSection(item.id, "main")}
                    aria-current={activeTab === item.id ? "page" : undefined}
                  >
                    <span className="settings-nav-btn-left">
                      {item.icon}
                      <span>{t(item.labelKey)}</span>
                    </span>
                    <IconChevronRight size={14} className="settings-mobile-nav-chevron" />
                  </button>
                ))}
              </div>
            </>
          )}

          {filteredSections.length === 0 && (
            <div className="settings-nav-empty">No matching settings found.</div>
          )}

          <div className="settings-sidebar-bottom">
            <div className="settings-save-status-pill" aria-live="polite">
              {prefSaveStatus === "saving" && <span>{t("savingStatus")}</span>}
              {prefSaveStatus === "saved" && (
                <span className="saved-ok">
                  <IconCheck size={13} /> {t("savedStatus")}
                </span>
              )}
              {prefSaveStatus === "idle" && (
                <span className="saved-muted">{APP_VERSION}</span>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content Panel */}
        <main className="settings-main">
          {/* Mobile Back Header + Desktop Save Indicator */}
          <div className="settings-pane-topbar">
            <button
              type="button"
              className="settings-mobile-back-btn"
              onClick={() => {
                if (subView !== "main") {
                  navigateSection(activeTab, "main");
                } else {
                  setMobileStage("list");
                }
              }}
            >
              <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                <IconChevronRight size={16} />
              </span>
              <span>{t("back")}</span>
            </button>

            <h3 className="settings-pane-title">{currentTitle}</h3>

            <div className="settings-inline-save-badge" aria-live="polite">
              {prefSaveStatus === "saving" && <span>{t("savingStatus")}</span>}
              {prefSaveStatus === "saved" && (
                <span className="saved-ok">
                  <IconCheck size={13} /> {t("savedStatus")}
                </span>
              )}
            </div>
          </div>

          {actionNotice && (
            <div className="settings-toast-banner" role="status">
              <IconCheck size={15} />
              <span>{actionNotice}</span>
            </div>
          )}

          {/* 1. ACCOUNT */}
          {activeTab === "account" && (
            <div className="settings-tab-pane">
              <div className="settings-row">
                <div className="settings-row-info">
                  <label htmlFor="settings-display-name" className="settings-item-title">
                    {t("displayName")}
                  </label>
                  <span className="settings-item-desc">Shown in your account menu and profile.</span>
                </div>
                <input
                  id="settings-display-name"
                  type="text"
                  className="settings-input-control"
                  value={displayName}
                  maxLength={80}
                  onChange={(e) => handleDisplayNameChange(e.target.value)}
                  onBlur={() => flushPreferencesNow()}
                  placeholder="Your name"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("emailAddress")}</span>
                  <span className="settings-item-desc">Read-only account identifier.</span>
                </div>
                <input
                  type="text"
                  className="settings-input-control readonly"
                  value={user?.email || (isGuest ? "Guest session (not signed in)" : "Not set")}
                  readOnly
                  aria-readonly="true"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("signInMethod")}</span>
                  <span className="settings-item-desc">Authentication method used for this session.</span>
                </div>
                <span className="settings-provider-badge">{accountSignInMethod}</span>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("memberSince")}</span>
                  <span className="settings-item-desc">When your account was created.</span>
                </div>
                <span className="settings-readonly-value">{accountCreatedFormatted}</span>
              </div>

              {!isGuest && (
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-item-title">{t("logOut")}</span>
                    <span className="settings-item-desc">Sign out on this browser without deleting your saved chats.</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      handleClose();
                      logout();
                    }}
                  >
                    <IconLogout size={14} /> {t("logOut")}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* 2. APPEARANCE */}
          {activeTab === "appearance" && (
            <div className="settings-tab-pane">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("theme")}</span>
                  <span className="settings-item-desc">Choose light, dark, or match your device theme.</span>
                </div>
                <div className="settings-pill-group" role="group" aria-label={t("theme")}>
                  {(["light", "dark", "auto"] as ThemeChoice[]).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className={`settings-pill-btn ${theme === choice ? "active" : ""}`}
                      onClick={() => handleThemeSelect(choice)}
                    >
                      {choice === "auto" ? "Auto" : choice === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("textSize")}</span>
                  <span className="settings-item-desc">Adjust reading comfort across chats and menus.</span>
                </div>
                <div className="settings-pill-group" role="group" aria-label={t("textSize")}>
                  {(["Small", "Medium", "Large"] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      className={`settings-pill-btn ${(preferences.textSize || "Medium") === sz ? "active" : ""}`}
                      onClick={() => updatePreferences({ textSize: sz })}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("density")}</span>
                  <span className="settings-item-desc">Switch between airy spacing or compact messages.</span>
                </div>
                <div className="settings-pill-group" role="group" aria-label={t("density")}>
                  {(["Comfortable", "Compact"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`settings-pill-btn ${(preferences.density || "Comfortable") === d ? "active" : ""}`}
                      onClick={() => updatePreferences({ density: d })}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("reduceMotion")}</span>
                  <span className="settings-item-desc">Minimize animations and render streamed text directly.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!preferences.reduceMotion}
                  aria-label={t("reduceMotion")}
                  className={`settings-toggle-btn ${preferences.reduceMotion ? "active" : ""}`}
                  onClick={() => updatePreferences({ reduceMotion: !preferences.reduceMotion })}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("codeBlocksWrap")}</span>
                  <span className="settings-item-desc">Choose whether long lines in code blocks scroll or wrap.</span>
                </div>
                <div className="settings-pill-group" role="group" aria-label={t("codeBlocksWrap")}>
                  <button
                    type="button"
                    className={`settings-pill-btn ${(preferences.codeBlockWrap || "scroll") === "scroll" ? "active" : ""}`}
                    onClick={() => updatePreferences({ codeBlockWrap: "scroll" })}
                  >
                    Scroll horizontally
                  </button>
                  <button
                    type="button"
                    className={`settings-pill-btn ${preferences.codeBlockWrap === "wrap" ? "active" : ""}`}
                    onClick={() => updatePreferences({ codeBlockWrap: "wrap" })}
                  >
                    Wrap lines
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3. PERSONALIZATION */}
          {activeTab === "personalization" && (
            <div className="settings-tab-pane">
              <div className="settings-row">
                <div className="settings-row-info">
                  <label htmlFor="settings-nickname" className="settings-item-title">
                    {t("nickname")}
                  </label>
                  <span className="settings-item-desc">What should AUTONEXIS Assistant call you?</span>
                </div>
                <input
                  id="settings-nickname"
                  type="text"
                  className="settings-input-control"
                  value={nickname}
                  maxLength={60}
                  onChange={(e) => handleNicknameChange(e.target.value)}
                  onBlur={() => flushPreferencesNow()}
                  placeholder="e.g., Rahul, Buddy"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <label htmlFor="settings-user-role" className="settings-item-title">
                    {t("whatYouDo")}
                  </label>
                  <span className="settings-item-desc">Your role or background for tailored examples.</span>
                </div>
                <input
                  id="settings-user-role"
                  type="text"
                  className="settings-input-control"
                  value={userRole}
                  maxLength={120}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  onBlur={() => flushPreferencesNow()}
                  placeholder="e.g., Full-stack developer, Medical student"
                />
              </div>

              <div className="settings-row-col">
                <div className="settings-row-header-between">
                  <label htmlFor="settings-custom-instructions" className="settings-item-title">
                    {t("aboutYouPrompt")}
                  </label>
                  <span className="settings-char-counter">{customInstructions.length} / 1500</span>
                </div>
                <span className="settings-item-desc">
                  Share topics you care about, your preferred structure, or tone expectations.
                </span>
                <textarea
                  id="settings-custom-instructions"
                  className="settings-textarea-control"
                  value={customInstructions}
                  maxLength={1500}
                  onChange={(e) => handleCustomInstructionsChange(e.target.value)}
                  onBlur={() => flushPreferencesNow()}
                  rows={4}
                  placeholder="e.g., Give practical examples first, keep code modular, skip long introductions..."
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("responseStyle")}</span>
                  <span className="settings-item-desc">Default pacing and tone for assistant answers.</span>
                </div>
                <select
                  aria-label={t("responseStyle")}
                  className="settings-select-control"
                  value={preferences.responseStyle || "Default"}
                  onChange={(e) =>
                    updatePreferences({
                      responseStyle: e.target.value as any,
                    })
                  }
                >
                  <option value="Default">Default</option>
                  <option value="Short and direct">Short and direct</option>
                  <option value="Detailed">Detailed</option>
                  <option value="Casual Hinglish">Casual Hinglish</option>
                  <option value="Formal">Formal</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("replyLanguage")}</span>
                  <span className="settings-item-desc">Language used inside assistant replies (Auto matches your message).</span>
                </div>
                <select
                  aria-label={t("replyLanguage")}
                  className="settings-select-control"
                  value={preferences.language || "Auto"}
                  onChange={(e) =>
                    updatePreferences({
                      language: e.target.value as any,
                    })
                  }
                >
                  <option value="Auto">Auto (match my language)</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Hinglish">Hinglish</option>
                  <option value="English">English</option>
                </select>
              </div>
            </div>
          )}

          {/* 4. CAPABILITIES */}
          {activeTab === "capabilities" && (
            <div className="settings-tab-pane">
              <div className="settings-subsection-title">Memory</div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("memoryToggle")}</span>
                  <span className="settings-item-desc">
                    Automatically save key facts across sessions. Paused in Temporary Chats.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.memoryEnabled !== false}
                  aria-label={t("memoryToggle")}
                  className={`settings-toggle-btn ${preferences.memoryEnabled !== false ? "active" : ""}`}
                  onClick={() => updatePreferences({ memoryEnabled: preferences.memoryEnabled === false })}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("manageMemory")} ({memories.length})</span>
                  <span className="settings-item-desc">Add, edit, or delete facts AUTONEXIS Assistant remembers.</span>
                </div>
                <div className="settings-row-action">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowMemoryManager((prev) => !prev)}
                  >
                    {showMemoryManager ? "Hide" : t("manageMemory")}
                  </Button>
                  {memories.length > 0 && !confirmDeleteAllMemories && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteAllMemories(true)}
                    >
                      {t("deleteAllMemory")}
                    </Button>
                  )}
                  {confirmDeleteAllMemories && (
                    <div className="settings-confirm-inline">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={async () => {
                          await clearAllMemories();
                          setConfirmDeleteAllMemories(false);
                          showTempNotice("All memories cleared.");
                        }}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteAllMemories(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {showMemoryManager && (
                <div className="settings-memory-drawer">
                  <div className="settings-add-memory-row">
                    <input
                      type="text"
                      className="settings-input-control"
                      placeholder="Add something to remember..."
                      value={newMemoryText}
                      onChange={(e) => setNewMemoryText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newMemoryText.trim()) {
                          addMemoryManual(newMemoryText.trim());
                          setNewMemoryText("");
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!newMemoryText.trim()}
                      onClick={() => {
                        if (newMemoryText.trim()) {
                          addMemoryManual(newMemoryText.trim());
                          setNewMemoryText("");
                        }
                      }}
                    >
                      <IconPlus size={14} /> Add
                    </Button>
                  </div>

                  {memories.length === 0 ? (
                    <div className="settings-empty-memories">No saved memories yet.</div>
                  ) : (
                    <div className="settings-memories-list">
                      {memories.map((mem) => (
                        <div key={mem.id} className="settings-memory-card">
                          {editingMemoryId === mem.id ? (
                            <div className="settings-memory-edit-box">
                              <input
                                type="text"
                                className="settings-input-control"
                                value={editingMemoryText}
                                onChange={(e) => setEditingMemoryText(e.target.value)}
                              />
                              <div className="settings-memory-edit-actions">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (editingMemoryText.trim()) {
                                      editMemory(mem.id, editingMemoryText.trim());
                                      setEditingMemoryId(null);
                                    }
                                  }}
                                >
                                  Save
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingMemoryId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="settings-memory-text-col">
                                <span className="settings-memory-text">{mem.text}</span>
                              </div>
                              <div className="settings-memory-actions">
                                <button
                                  type="button"
                                  className="settings-icon-action-btn"
                                  aria-label="Edit memory"
                                  onClick={() => {
                                    setEditingMemoryId(mem.id);
                                    setEditingMemoryText(mem.text);
                                  }}
                                >
                                  <IconEdit size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="settings-icon-action-btn danger"
                                  aria-label="Delete memory"
                                  onClick={() => deleteMemory(mem.id)}
                                >
                                  <IconTrash size={14} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("referencePastChats")}</span>
                  <span className="settings-item-desc">
                    Use up to 3 keyword-matched snippets from recent chats for continuity (off for Temporary Chats and guests).
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.referencePastChats !== false}
                  aria-label={t("referencePastChats")}
                  className={`settings-toggle-btn ${preferences.referencePastChats !== false ? "active" : ""}`}
                  onClick={() =>
                    updatePreferences({ referencePastChats: preferences.referencePastChats === false })
                  }
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              <div className="settings-subsection-title">Search</div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("webSearchDefault")}</span>
                  <span className="settings-item-desc">Enable real-time web lookup by default for new messages.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!preferences.webSearchDefault}
                  aria-label={t("webSearchDefault")}
                  className={`settings-toggle-btn ${preferences.webSearchDefault ? "active" : ""}`}
                  onClick={() => updatePreferences({ webSearchDefault: !preferences.webSearchDefault })}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              <div className="settings-subsection-title">Voice</div>
              {ttsSupported ? (
                <>
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-item-title">{t("voiceReadAloud")}</span>
                      <span className="settings-item-desc">Browser voice used for Read Aloud buttons.</span>
                    </div>
                    <select
                      aria-label={t("voiceReadAloud")}
                      className="settings-select-control"
                      value={preferences.voiceName || ""}
                      onChange={(e) => updatePreferences({ voiceName: e.target.value })}
                    >
                      <option value="">System default voice</option>
                      {availableVoices.slice(0, 30).map((v) => (
                        <option key={`${v.name}_${v.lang}`} value={v.name}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-item-title">{t("voiceLanguage")}</span>
                      <span className="settings-item-desc">Preferred speech output locale.</span>
                    </div>
                    <select
                      aria-label={t("voiceLanguage")}
                      className="settings-select-control"
                      value={preferences.voiceLanguage || "en-IN"}
                      onChange={(e) => updatePreferences({ voiceLanguage: e.target.value })}
                    >
                      <option value="en-IN">English (India)</option>
                      <option value="hi-IN">Hindi (India)</option>
                      <option value="en-US">English (US)</option>
                      <option value="en-GB">English (UK)</option>
                    </select>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-item-title">{t("voiceSpeed")}</span>
                      <span className="settings-item-desc">Adjust playback speed and preview the voice.</span>
                    </div>
                    <div className="settings-row-action">
                      <div className="settings-pill-group" role="group" aria-label={t("voiceSpeed")}>
                        {[0.85, 1.0, 1.15, 1.3].map((spd) => (
                          <button
                            key={spd}
                            type="button"
                            className={`settings-pill-btn ${(preferences.voiceSpeed || 1.0) === spd ? "active" : ""}`}
                            onClick={() => updatePreferences({ voiceSpeed: spd })}
                          >
                            {spd}x
                          </button>
                        ))}
                      </div>
                      <Button variant="secondary" size="sm" onClick={handlePreviewVoice}>
                        <IconVolume size={14} /> {t("voicePreview")}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="settings-info-note">
                  Read-aloud voice synthesis is not supported by your current browser.
                </div>
              )}

              {sttSupported ? (
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-item-title">{t("micLanguage")}</span>
                    <span className="settings-item-desc">Language recognized when you dictate using the microphone.</span>
                  </div>
                  <select
                    aria-label={t("micLanguage")}
                    className="settings-select-control"
                    value={preferences.micLanguage || "en-IN"}
                    onChange={(e) => updatePreferences({ micLanguage: e.target.value })}
                  >
                    <option value="en-IN">English (India)</option>
                    <option value="hi-IN">Hindi (India)</option>
                    <option value="en-US">English (US)</option>
                    <option value="en-GB">English (UK)</option>
                  </select>
                </div>
              ) : (
                <div className="settings-info-note">
                  Voice dictation (microphone speech-to-text) is not supported in this browser.
                </div>
              )}

              <div className="settings-subsection-title">Input</div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("enterToSendLabel")}</span>
                  <span className="settings-item-desc">
                    When on, Enter sends and Shift+Enter adds a newline. Turn off to send with Ctrl+Enter.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.enterToSend !== false}
                  aria-label={t("enterToSendLabel")}
                  className={`settings-toggle-btn ${preferences.enterToSend !== false ? "active" : ""}`}
                  onClick={() => updatePreferences({ enterToSend: preferences.enterToSend === false })}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("autoScrollLabel")}</span>
                  <span className="settings-item-desc">Follow the bottom of the chat automatically while replies stream.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.autoScroll !== false}
                  aria-label={t("autoScrollLabel")}
                  className={`settings-toggle-btn ${preferences.autoScroll !== false ? "active" : ""}`}
                  onClick={() => updatePreferences({ autoScroll: preferences.autoScroll === false })}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("starterPromptsLabel")}</span>
                  <span className="settings-item-desc">Show suggested prompts and studio presets on the empty home view.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.showStarterPrompts !== false}
                  aria-label={t("starterPromptsLabel")}
                  className={`settings-toggle-btn ${preferences.showStarterPrompts !== false ? "active" : ""}`}
                  onClick={() =>
                    updatePreferences({ showStarterPrompts: preferences.showStarterPrompts === false })
                  }
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>
            </div>
          )}

          {/* 5. NOTIFICATIONS */}
          {activeTab === "notifications" && (
            <div className="settings-tab-pane">
              <div className="settings-privacy-callout">
                <span className="settings-privacy-title">In-app browser alerts</span>
                <p>
                  Alerts appear only when a response completes while this tab is hidden in the background. Email and mobile push notifications when the app is closed are not enabled.
                </p>
              </div>

              {notifPermission === "unsupported" ? (
                <div className="settings-info-note">
                  Desktop browser notifications are not supported by your current browser.
                </div>
              ) : (
                <>
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-item-title">{t("notifyBackground")}</span>
                      <span className="settings-item-desc">
                        Show a browser notification when a long reply completes while you are on another tab.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!preferences.notifyInBackground && notifPermission === "granted"}
                      aria-label={t("notifyBackground")}
                      className={`settings-toggle-btn ${
                        preferences.notifyInBackground && notifPermission === "granted" ? "active" : ""
                      }`}
                      onClick={handleToggleBackgroundNotifications}
                    >
                      <span className="settings-toggle-knob" />
                    </button>
                  </div>

                  {notifPermission === "denied" && (
                    <div className="settings-warning-note" role="status">
                      Browser notifications are blocked for this site. Click the site-info icon next to the address bar, set Notifications to &ldquo;Allow&rdquo;, then try enabling again.
                    </div>
                  )}
                </>
              )}

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("notifySound")}</span>
                  <span className="settings-item-desc">Play a soft two-tone chime when a background reply finishes.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!preferences.notifySound}
                  aria-label={t("notifySound")}
                  className={`settings-toggle-btn ${preferences.notifySound ? "active" : ""}`}
                  onClick={() => updatePreferences({ notifySound: !preferences.notifySound })}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>
            </div>
          )}

          {/* 6. PRIVACY */}
          {activeTab === "privacy" && (
            <div className="settings-tab-pane">
              <div className="settings-privacy-callout">
                <span className="settings-privacy-title">How your data is stored</span>
                <p>
                  For signed-in accounts, your chats, preferences, saved memories, custom styles, and projects are stored per-user under your private account path. Temporary Chats are never saved to cloud history and never generate or read memories.
                </p>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("defaultTempLabel")}</span>
                  <span className="settings-item-desc">Open every new chat as a Temporary Chat automatically.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!preferences.defaultTemporaryChat}
                  aria-label={t("defaultTempLabel")}
                  className={`settings-toggle-btn ${preferences.defaultTemporaryChat ? "active" : ""}`}
                  onClick={() =>
                    updatePreferences({ defaultTemporaryChat: !preferences.defaultTemporaryChat })
                  }
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("exportChats")}</span>
                  <span className="settings-item-desc">Download a full JSON copy of your saved chats.</span>
                </div>
                <Button variant="secondary" size="sm" onClick={handleExport} disabled={isExporting}>
                  <IconDownload size={14} /> {isExporting ? "Exporting..." : "Export JSON"}
                </Button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("deleteAllChats")}</span>
                  <span className="settings-item-desc">Permanently erase your conversation history.</span>
                </div>
                {!confirmDeleteAllChats ? (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteAllChats(true)}>
                    <IconTrash size={14} /> {t("deleteAllChats")}
                  </Button>
                ) : (
                  <div className="settings-confirm-inline">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        clearAllChats();
                        setConfirmDeleteAllChats(false);
                        showTempNotice("All chats deleted.");
                      }}
                    >
                      Confirm Delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteAllChats(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("deleteAllMemory")}</span>
                  <span className="settings-item-desc">Clear all saved personal facts ({memories.length} items).</span>
                </div>
                {!confirmDeleteAllMemories ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={memories.length === 0}
                    onClick={() => setConfirmDeleteAllMemories(true)}
                  >
                    <IconTrash size={14} /> {t("deleteAllMemory")}
                  </Button>
                ) : (
                  <div className="settings-confirm-inline">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={async () => {
                        await clearAllMemories();
                        setConfirmDeleteAllMemories(false);
                        showTempNotice("All saved memories deleted.");
                      }}
                    >
                      Confirm Delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteAllMemories(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("clearDeviceData")}</span>
                  <span className="settings-item-desc">
                    Remove local browser cache, local session keys, and sign out on this device.
                  </span>
                </div>
                {!confirmClearDevice ? (
                  <Button variant="secondary" size="sm" onClick={() => setConfirmClearDevice(true)}>
                    Clear Device Data
                  </Button>
                ) : (
                  <div className="settings-confirm-inline">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        handleClose();
                        clearLocalDeviceData();
                      }}
                    >
                      Clear & Log out
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmClearDevice(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("privacyPolicy")}</span>
                  <span className="settings-item-desc">Read the full privacy overview and data retention summary.</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigateSection("about", "privacy")}>
                  {t("privacyPolicy")} <IconChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {/* 7. WELLBEING */}
          {activeTab === "wellbeing" && subView !== "support-resources" && (
            <div className="settings-tab-pane">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("breakReminderSwitch")}</span>
                  <span className="settings-item-desc">
                    Display a calm, non-blocking pill reminding you to rest after continuous chatting.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!preferences.breakReminderEnabled}
                  aria-label={t("breakReminderSwitch")}
                  className={`settings-toggle-btn ${preferences.breakReminderEnabled ? "active" : ""}`}
                  onClick={() =>
                    updatePreferences({ breakReminderEnabled: !preferences.breakReminderEnabled })
                  }
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("breakIntervalLabel")}</span>
                  <span className="settings-item-desc">Choose how long before showing a gentle reminder.</span>
                </div>
                <div className="settings-pill-group" role="group" aria-label={t("breakIntervalLabel")}>
                  {([60, 90, 120] as const).map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      disabled={!preferences.breakReminderEnabled}
                      className={`settings-pill-btn ${(preferences.breakReminderMinutes || 60) === mins ? "active" : ""}`}
                      onClick={() => updatePreferences({ breakReminderMinutes: mins })}
                    >
                      {mins} min
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("supportResourcesTitle")}</span>
                  <span className="settings-item-desc">
                    Verified official free mental health and crisis helplines in India.
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateSection("wellbeing", "support-resources")}
                >
                  View Resources <IconChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {activeTab === "wellbeing" && subView === "support-resources" && (
            <div className="settings-tab-pane">
              <div className="settings-subview-header">
                <Button variant="ghost" size="sm" onClick={() => navigateSection("wellbeing", "main")}>
                  <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                    <IconChevronRight size={14} />
                  </span>
                  Back to Wellbeing
                </Button>
                <span className="settings-subview-title">{t("supportResourcesTitle")}</span>
              </div>

              <p className="settings-tab-desc">
                If you or someone you know is going through a difficult time, reaching out to a trained human counselor can help. These services are verified public helplines in India:
              </p>

              <div className="settings-resource-list">
                <div className="settings-resource-card">
                  <div className="settings-resource-name">Tele-MANAS (National Tele-Mental Health Programme)</div>
                  <div className="settings-resource-meta">24x7 free helpline across India</div>
                  <div className="settings-resource-links">
                    <a href="tel:14416" className="settings-resource-link">Call 14416</a>
                    <a href="tel:18008914416" className="settings-resource-link">Call 1800-891-4416</a>
                    <a href="https://telemanas.mohfw.gov.in" target="_blank" rel="noopener noreferrer" className="settings-resource-link">
                      telemanas.mohfw.gov.in
                    </a>
                  </div>
                  <div className="settings-resource-source">
                    Source: Ministry of Health and Family Welfare, Government of India
                  </div>
                </div>

                <div className="settings-resource-card">
                  <div className="settings-resource-name">KIRAN Mental Health Helpline</div>
                  <div className="settings-resource-meta">24x7 toll-free national helpline</div>
                  <div className="settings-resource-links">
                    <a href="tel:18005990019" className="settings-resource-link">Call 1800-599-0019</a>
                  </div>
                  <div className="settings-resource-source">
                    Source: Ministry of Social Justice and Empowerment, Government of India
                  </div>
                </div>

                <div className="settings-resource-card">
                  <div className="settings-resource-name">NIMHANS Psychosocial Helpline</div>
                  <div className="settings-resource-meta">National Institute of Mental Health and Neuro Sciences</div>
                  <div className="settings-resource-links">
                    <a href="tel:08046110007" className="settings-resource-link">Call 080-4611-0007</a>
                  </div>
                  <div className="settings-resource-source">
                    Source: NIMHANS Bengaluru / Ministry of Health and Family Welfare
                  </div>
                </div>

                <div className="settings-resource-card">
                  <div className="settings-resource-name">iCALL Psychosocial Helpline</div>
                  <div className="settings-resource-meta">Mon–Sat, 8:00 AM to 9:00 PM IST</div>
                  <div className="settings-resource-links">
                    <a href="tel:9152987821" className="settings-resource-link">Call 9152987821</a>
                    <a href="https://icallhelpline.org" target="_blank" rel="noopener noreferrer" className="settings-resource-link">
                      icallhelpline.org
                    </a>
                  </div>
                  <div className="settings-resource-source">
                    Source: Tata Institute of Social Sciences (TISS), Mumbai
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 8. CUSTOMIZE (Custom Styles) */}
          {activeTab === "customize" && (
            <div className="settings-tab-pane">
              <p className="settings-tab-desc">
                Create up to 3 custom writing styles from a sample of your writing. Select a style below to apply its tone and phrasing across new replies.
              </p>

              <div className="settings-style-list">
                <div
                  className={`settings-style-card ${!preferences.activeCustomStyleId ? "active" : ""}`}
                >
                  <div className="settings-style-card-top">
                    <div>
                      <div className="settings-style-name">Default Style</div>
                      <div className="settings-style-desc">Uses your standard Response Style preference.</div>
                    </div>
                    <Button
                      variant={!preferences.activeCustomStyleId ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setActiveCustomStyle(null)}
                    >
                      {!preferences.activeCustomStyleId ? "Active" : "Use"}
                    </Button>
                  </div>
                </div>

                {(preferences.customStyles || []).map((st) => {
                  const isActive = preferences.activeCustomStyleId === st.id;
                  const isEditing = editingStyleId === st.id;
                  return (
                    <div key={st.id} className={`settings-style-card ${isActive ? "active" : ""}`}>
                      {isEditing ? (
                        <div className="settings-style-edit">
                          <input
                            type="text"
                            className="settings-input-control"
                            maxLength={40}
                            value={editingStyleName}
                            onChange={(e) => setEditingStyleName(e.target.value)}
                            placeholder="Style name"
                          />
                          <textarea
                            className="settings-textarea-control"
                            maxLength={300}
                            rows={2}
                            value={editingStyleDesc}
                            onChange={(e) => setEditingStyleDesc(e.target.value)}
                          />
                          <div className="settings-memory-edit-actions">
                            <Button
                              size="sm"
                              onClick={async () => {
                                await updateCustomStyle(st.id, {
                                  name: editingStyleName,
                                  description: editingStyleDesc,
                                });
                                setEditingStyleId(null);
                              }}
                            >
                              Save
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditingStyleId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="settings-style-card-top">
                          <div className="settings-style-info">
                            <div className="settings-style-name">{st.name}</div>
                            <div className="settings-style-desc">{st.description}</div>
                          </div>
                          <div className="settings-row-action">
                            <Button
                              variant={isActive ? "primary" : "secondary"}
                              size="sm"
                              onClick={() => setActiveCustomStyle(isActive ? null : st.id)}
                            >
                              {isActive ? "Active" : "Use"}
                            </Button>
                            <button
                              type="button"
                              className="settings-icon-action-btn"
                              aria-label="Edit custom style"
                              onClick={() => {
                                setEditingStyleId(st.id);
                                setEditingStyleName(st.name);
                                setEditingStyleDesc(st.description);
                              }}
                            >
                              <IconEdit size={14} />
                            </button>
                            <button
                              type="button"
                              className="settings-icon-action-btn danger"
                              aria-label="Delete custom style"
                              onClick={() => deleteCustomStyle(st.id)}
                            >
                              <IconTrash size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {(preferences.customStyles || []).length < 3 && (
                <form className="settings-style-form" onSubmit={handleCreateStyle}>
                  <div className="settings-subsection-title">New Custom Style ({(preferences.customStyles || []).length}/3)</div>
                  {isGuest ? (
                    <div className="settings-info-note">Sign in to analyze and save custom styles.</div>
                  ) : (
                    <>
                      <input
                        type="text"
                        className="settings-input-control"
                        maxLength={40}
                        placeholder="Style name (e.g., Concise Founder Notes)"
                        value={newStyleName}
                        onChange={(e) => setNewStyleName(e.target.value)}
                      />
                      <div className="settings-row-header-between">
                        <label htmlFor="settings-style-sample" className="settings-item-desc">
                          {t("pasteWritingSample")}
                        </label>
                        <span className="settings-char-counter">{newStyleSample.length} / 2000</span>
                      </div>
                      <textarea
                        id="settings-style-sample"
                        className="settings-textarea-control"
                        maxLength={2000}
                        rows={4}
                        placeholder="Paste 1-3 paragraphs written in the voice you want AUTONEXIS Assistant to mirror..."
                        value={newStyleSample}
                        onChange={(e) => setNewStyleSample(e.target.value)}
                      />
                      {styleError && <div className="settings-warning-note">{styleError}</div>}
                      <div>
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          disabled={isCreatingStyle || newStyleSample.trim().length < 15}
                        >
                          <IconSparkles size={14} />{" "}
                          {isCreatingStyle ? "Analyzing..." : t("analyzeAndSaveStyle")}
                        </Button>
                      </div>
                    </>
                  )}
                </form>
              )}
            </div>
          )}

          {/* 9. LANGUAGE (App UI Language) */}
          {activeTab === "language" && (
            <div className="settings-tab-pane">
              <p className="settings-tab-desc">
                Choose the language used for menus, buttons, and labels in this app. Changes apply immediately without reloading.
              </p>

              <div className="settings-lang-cards" role="radiogroup" aria-label={t("interfaceLanguageTitle")}>
                {(
                  [
                    { id: "English", title: "English", sub: "Standard English app interface" },
                    { id: "Hindi", title: "हिन्दी (Hindi)", sub: "देवनागरी लिपि में ऐप मेनू और लेबल" },
                    { id: "Hinglish", title: "Hinglish", sub: "Friendly Roman Hindi + English interface" },
                  ] as const
                ).map((opt) => {
                  const selected = (preferences.interfaceLanguage || "English") === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`settings-lang-card ${selected ? "active" : ""}`}
                      onClick={() => updatePreferences({ interfaceLanguage: opt.id })}
                    >
                      <div>
                        <div className="settings-style-name">{opt.title}</div>
                        <div className="settings-style-desc">{opt.sub}</div>
                      </div>
                      {selected && <IconCheck size={16} />}
                    </button>
                  );
                })}
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("replyLanguage")}</span>
                  <span className="settings-item-desc">
                    Looking for what language the assistant replies in? Set it under Personalization.
                  </span>
                </div>
                <Button variant="secondary" size="sm" onClick={() => navigateSection("personalization")}>
                  Go to Personalization
                </Button>
              </div>
            </div>
          )}

          {/* 10. HELP */}
          {activeTab === "help" && (
            <div className="settings-tab-pane">
              <div className="settings-subsection-title">{t("faqTitle")}</div>
              <div className="settings-faq-list">
                {FAQ_ITEMS.map((item, idx) => (
                  <details key={idx} className="settings-faq-item">
                    <summary className="settings-faq-q">{item.q}</summary>
                    <p className="settings-faq-a">{item.a}</p>
                  </details>
                ))}
              </div>

              <div className="settings-subsection-title">{t("reportProblemTitle")}</div>
              {isGuest ? (
                <div className="settings-info-note">Please sign in to submit a problem report to your account log.</div>
              ) : (
                <form className="settings-report-form" onSubmit={handleSubmitReport}>
                  <div className="settings-row-header-between">
                    <select
                      aria-label="Issue category"
                      className="settings-select-control"
                      value={reportCategory}
                      onChange={(e) => setReportCategory(e.target.value)}
                    >
                      <option value="Bug">Bug / App error</option>
                      <option value="Response quality">Response quality</option>
                      <option value="Account / Settings">Account / Settings</option>
                      <option value="Feature request">Feature request</option>
                      <option value="Other">Other</option>
                    </select>
                    <span className="settings-char-counter">{reportMessage.length} / 2000</span>
                  </div>
                  <textarea
                    className="settings-textarea-control"
                    maxLength={2000}
                    rows={3}
                    placeholder="Describe what happened and how to reproduce it..."
                    value={reportMessage}
                    onChange={(e) => setReportMessage(e.target.value)}
                  />
                  <div className="settings-item-desc">
                    Includes app version ({APP_VERSION}) and browser info automatically.
                  </div>
                  {reportStatus && (
                    <div
                      className={reportStatus.ok ? "settings-toast-banner" : "settings-warning-note"}
                      role="status"
                    >
                      <span>{reportStatus.msg}</span>
                    </div>
                  )}
                  <div>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={isSubmittingReport || !reportMessage.trim()}
                    >
                      {isSubmittingReport ? "Sending..." : t("submitReport")}
                    </Button>
                  </div>
                </form>
              )}

              {SUPPORT_EMAIL.trim().length > 0 && (
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-item-title">Support Email</span>
                    <span className="settings-item-desc">Reach out directly for account or urgent questions.</span>
                  </div>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="settings-resource-link">
                    {SUPPORT_EMAIL}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* 11. ABOUT (and Terms / Privacy Policy / Shortcuts sub-views) */}
          {activeTab === "about" && subView === "main" && (
            <div className="settings-tab-pane">
              <div className="settings-about-box">
                <div className="settings-about-line">
                  <span className="settings-about-name">AUTONEXIS Assistant</span>
                  <span className="settings-about-badge">{APP_VERSION}</span>
                </div>
                <p className="settings-about-desc">
                  Personal multi-modal workspace with private per-account history, projects, memory controls, custom styles, and multilingual support.
                </p>
              </div>

              {showInstallCard && (
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-item-title">{t("installApp")}</span>
                    <span className="settings-item-desc">Add AUTONEXIS Assistant as an app for faster launch.</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => triggerInstall()}
                  >
                    <IconSmartphone size={14} /> {t("installApp")}
                  </Button>
                </div>
              )}

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("terms")}</span>
                  <span className="settings-item-desc">Plain-language terms for using this assistant.</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigateSection("about", "terms")}>
                  <IconFileText size={14} /> View <IconChevronRight size={14} />
                </Button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("privacyPolicy")}</span>
                  <span className="settings-item-desc">Plain-language summary of what stays on your account vs browser.</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigateSection("about", "privacy")}>
                  <IconShield size={14} /> View <IconChevronRight size={14} />
                </Button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">{t("keyboardShortcuts")}</span>
                  <span className="settings-item-desc">Fast navigation and sending shortcuts.</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigateSection("about", "shortcuts")}>
                  <IconKeyboard size={14} /> View <IconChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {activeTab === "about" && subView === "terms" && (
            <div className="settings-tab-pane">
              <div className="settings-subview-header">
                <Button variant="ghost" size="sm" onClick={() => navigateSection("about", "main")}>
                  <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                    <IconChevronRight size={14} />
                  </span>
                  Back to About
                </Button>
                <span className="settings-subview-title">{t("terms")}</span>
              </div>
              <div className="settings-doc-card">
                <p>
                  AUTONEXIS Assistant is provided as a helpful productivity and reasoning workspace. Please review important outputs before relying on them for medical, legal, financial, or safety-critical decisions.
                </p>
                <p>
                  You stay in control of the chats, files, memories, and custom styles you save to your account, and may export or delete them at any time under Settings &rarr; Privacy.
                </p>
                <p>
                  Please do not use this service for illegal activities, harassment, or attempting to bypass security boundaries.
                </p>
                <div className="settings-draft-badge">Draft, to be reviewed</div>
              </div>
            </div>
          )}

          {activeTab === "about" && subView === "privacy" && (
            <div className="settings-tab-pane">
              <div className="settings-subview-header">
                <Button variant="ghost" size="sm" onClick={() => navigateSection("about", "main")}>
                  <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                    <IconChevronRight size={14} />
                  </span>
                  Back to About
                </Button>
                <span className="settings-subview-title">{t("privacyPolicy")}</span>
              </div>
              <div className="settings-doc-card">
                <p>
                  <strong>Account storage:</strong> When signed in, your chats, preferences, saved memories, custom styles, projects, and submitted problem reports are stored per account under your private user collection in Firestore.
                </p>
                <p>
                  <strong>Temporary Chats:</strong> Messages sent inside Temporary Chat are held only in memory for your active tab and never written to your cloud history or memory store.
                </p>
                <p>
                  <strong>Guest mode:</strong> Guest sessions remain only inside your browser&apos;s local storage and are cleared on request via &ldquo;Clear data on this device&rdquo;.
                </p>
                <p>
                  <strong>No cross-account sharing:</strong> Conversations and memories from one account are strictly isolated from other accounts.
                </p>
                <div className="settings-draft-badge">Draft, to be reviewed</div>
              </div>
            </div>
          )}

          {activeTab === "about" && subView === "shortcuts" && (
            <div className="settings-tab-pane">
              <div className="settings-subview-header">
                <Button variant="ghost" size="sm" onClick={() => navigateSection("about", "main")}>
                  <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                    <IconChevronRight size={14} />
                  </span>
                  Back to About
                </Button>
                <span className="settings-subview-title">{t("keyboardShortcuts")}</span>
              </div>
              <div className="settings-shortcuts-list">
                <div className="settings-shortcut-row">
                  <span>Search chats &amp; messages</span>
                  <kbd className="settings-kbd">Ctrl + K</kbd>
                </div>
                <div className="settings-shortcut-row">
                  <span>Start a new chat</span>
                  <kbd className="settings-kbd">Ctrl + Shift + O</kbd>
                </div>
                <div className="settings-shortcut-row">
                  <span>Open or close Settings</span>
                  <kbd className="settings-kbd">Ctrl + Shift + ,</kbd>
                </div>
                <div className="settings-shortcut-row">
                  <span>Close open menu or modal</span>
                  <kbd className="settings-kbd">Esc</kbd>
                </div>
                <div className="settings-shortcut-row">
                  <span>
                    Send message ({preferences.enterToSend !== false ? "Enter active" : "Ctrl+Enter active"})
                  </span>
                  <kbd className="settings-kbd">
                    {preferences.enterToSend !== false ? "Enter" : "Ctrl + Enter"}
                  </kbd>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </Modal>
  );
};
