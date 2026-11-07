import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import {
  IconSearch,
  IconUser,
  IconPalette,
  IconBrain,
  IconZap,
  IconShield,
  IconGlobe,
  IconHelpCircle,
  IconTrash,
} from "./Icons";
import { useTheme, type ThemeChoice } from "../state/theme";
import { useAuth } from "../state/auth";
import { useChats } from "../state/chats";
import type { SettingsTabId } from "./UserMenuDropdown";
import {
  apiListSessions,
  apiDeleteSession,
  apiRevokeAllSessions,
  apiUpdateSettings,
  apiDeleteAllUserChats,
  apiDeleteAccount,
  getOrCreateSessionId,
  type SessionItem,
} from "../api/settings";
import "./SettingsModal.css";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTabId;
}

function formatRelativeTime(isoString?: string): string {
  if (!isoString) return "Recently";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (isNaN(diffMs) || diffMs < 0) return "Just now";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function formatSessionDate(isoString?: string): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = "account",
}) => {
  const { theme, setTheme } = useTheme();
  const { user, firebaseUser, logout, updateProfileName } = useAuth();
  const { chats, memory, clearAllChats, resetMemory, updateCallName } = useChats();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");

  // Account states
  const [fullName, setFullName] = useState(
    user?.display_name || (user?.email ? user.email.split("@")[0] : "User")
  );
  const [callName, setCallName] = useState(
    memory.userName || (user?.display_name ? user.display_name.split(" ")[0] : "Friend")
  );
  const [avatarUrl, setAvatarUrl] = useState(
    () => localStorage.getItem("autonexis_user_avatar") || "/logo_circle.png?v=20261107"
  );
  const [accountSaved, setAccountSaved] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [loggingOutSessionId, setLoggingOutSessionId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  // Appearance states
  const [fontScale, setFontScale] = useState<"compact" | "standard" | "spacious">(
    () => (localStorage.getItem("autonexis_font_scale") as any) || "standard"
  );
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem("autonexis_sound_enabled") === "true"
  );

  // Memory states
  const [customInstructions, setCustomInstructions] = useState(
    () => localStorage.getItem("autonexis_custom_instructions") || ""
  );
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [memoryResetDone, setMemoryResetDone] = useState(false);

  // Capabilities states
  const [streamingEnabled, setStreamingEnabled] = useState(
    () => localStorage.getItem("autonexis_streaming") !== "false"
  );
  const [syntaxHighlight, setSyntaxHighlight] = useState(
    () => localStorage.getItem("autonexis_syntax_highlight") !== "false"
  );

  // Language state
  const [preferredLang, setPreferredLang] = useState(
    () => localStorage.getItem("autonexis_language") || "auto"
  );

  // Privacy states
  const [exportNotice, setExportNotice] = useState(false);
  const [chatsClearedNotice, setChatsClearedNotice] = useState(false);
  const [chatsClearing, setChatsClearing] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  const currentSessionId = getOrCreateSessionId();

  // Switch tab on external initialTab change
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Keep full name synced with user
  useEffect(() => {
    if (user?.display_name) {
      setFullName(user.display_name);
    }
  }, [user?.display_name]);

  // Load real sessions when modal opens or activeTab is 'account'
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const list = await apiListSessions();
      setSessions(list);
    } catch {
      setSessionsError("Unable to load active sessions right now. Please try again later.");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeTab === "account") {
      loadSessions();
    }
  }, [isOpen, activeTab, loadSessions]);

  // Save Account Profile
  const handleSaveAccount = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAccountSaving(true);
    setAccountError(null);
    try {
      const cleanName = fullName.trim();
      if (cleanName) {
        await updateProfileName(cleanName);
        await apiUpdateSettings(cleanName, theme);
      }
      if (callName.trim()) {
        updateCallName(callName.trim());
        localStorage.setItem("autonexis_user_callname", callName.trim());
      }
      setAccountSaved(true);
      setTimeout(() => setAccountSaved(false), 2500);
    } catch {
      setAccountError("Failed to save changes. Please check your connection and try again.");
    } finally {
      setAccountSaving(false);
    }
  };

  // Avatar change
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setAvatarUrl(result);
        localStorage.setItem("autonexis_user_avatar", result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Terminate a single non-current session
  const handleLogoutSession = async (sessionId: string) => {
    setLoggingOutSessionId(sessionId);
    try {
      const ok = await apiDeleteSession(sessionId);
      if (ok) {
        setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      }
    } catch {
      // friendly silent fail
    } finally {
      setLoggingOutSessionId(null);
    }
  };

  // Revoke all sessions
  const handleRevokeAllSessions = async () => {
    if (
      !window.confirm(
        "Are you sure you want to log out of all devices? This will invalidate all active sessions and return you to the sign-in screen."
      )
    ) {
      return;
    }
    setRevokingAll(true);
    try {
      await apiRevokeAllSessions();
    } catch {
      // Proceed to sign out locally
    } finally {
      setRevokingAll(false);
      onClose();
      await logout();
    }
  };

  // Theme update
  const handleThemeChange = async (t: ThemeChoice) => {
    setTheme(t);
    try {
      await apiUpdateSettings(fullName.trim() || undefined, t);
    } catch {
      // Best-effort backend sync
    }
  };

  // Export chats as JSON
  const handleExportChats = () => {
    const dataStr =
      "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(chats, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `autonexis_chats_export_${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExportNotice(true);
    setTimeout(() => setExportNotice(false), 2500);
  };

  // Export chats as Text
  const handleExportText = () => {
    let output = `AUTONEXIS Assistant - Chat History Export\nGenerated: ${new Date().toLocaleString()}\n=========================================\n\n`;
    for (const chat of chats) {
      output += `Chat: ${chat.title} (${chat.updated_at})\n-----------------------------------------\n`;
      for (const m of chat.messages) {
        output += `[${m.role.toUpperCase()} - ${m.created_at || ""}]:\n${m.content}\n\n`;
      }
      output += `\n=========================================\n\n`;
    }
    const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(output);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `autonexis_chats_${new Date().toISOString().slice(0, 10)}.txt`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExportNotice(true);
    setTimeout(() => setExportNotice(false), 2500);
  };

  // Clear all chats
  const handleClearAllChats = async () => {
    if (
      !window.confirm(
        "Are you sure you want to permanently delete all your chats? This action cannot be undone."
      )
    ) {
      return;
    }
    setChatsClearing(true);
    try {
      await apiDeleteAllUserChats();
      clearAllChats();
      setChatsClearedNotice(true);
      setTimeout(() => setChatsClearedNotice(false), 2500);
    } catch {
      alert("Unable to delete chats at this time. Please try again.");
    } finally {
      setChatsClearing(false);
    }
  };

  // Delete account
  const handleConfirmDeleteAccount = async () => {
    if (deleteConfirmationText.trim() !== "DELETE") {
      setDeleteAccountError('Please type "DELETE" exactly to confirm.');
      return;
    }
    setIsDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      const ok = await apiDeleteAccount();
      if (!ok) {
        throw new Error("Deletion failed");
      }
      setShowDeleteAccountModal(false);
      onClose();
      await logout();
    } catch {
      setDeleteAccountError(
        "Unable to delete account right now. For security, you may need to log in again and retry."
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  // Reset Memory
  const handleResetMemory = () => {
    if (window.confirm("Are you sure you want to reset all AI memory and stored facts?")) {
      resetMemory();
      setMemoryResetDone(true);
      setTimeout(() => setMemoryResetDone(false), 2500);
    }
  };

  // Save Custom Instructions
  const handleSaveInstructions = () => {
    localStorage.setItem("autonexis_custom_instructions", customInstructions);
    setInstructionsSaved(true);
    setTimeout(() => setInstructionsSaved(false), 2000);
  };

  // Login method detection
  const loginMethod = (() => {
    const providerId = firebaseUser?.providerData?.[0]?.providerId;
    if (providerId === "google.com") return "Google Account";
    if (providerId === "password") return "Email & Password";
    return "Email";
  })();

  // Navigation Items
  const navItems = [
    { id: "account" as SettingsTabId, label: "Account", icon: <IconUser size={16} />, category: "General" },
    { id: "appearance" as SettingsTabId, label: "Appearance", icon: <IconPalette size={16} />, category: "Preferences" },
    { id: "your_autonexis" as SettingsTabId, label: "Your Autonexis", icon: <IconBrain size={16} />, category: "Preferences" },
    { id: "capabilities" as SettingsTabId, label: "Capabilities", icon: <IconZap size={16} />, category: "Preferences" },
    { id: "privacy" as SettingsTabId, label: "Privacy", icon: <IconShield size={16} />, category: "Preferences" },
    { id: "language" as SettingsTabId, label: "Language", icon: <IconGlobe size={16} />, category: "Advanced" },
  ];

  const filteredNav = searchQuery.trim()
    ? navItems.filter((item) => item.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : navItems;

  const generalGroup = filteredNav.filter((item) => item.category === "General");
  const prefsGroup = filteredNav.filter((item) => item.category === "Preferences");
  const advGroup = filteredNav.filter((item) => item.category === "Advanced");

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="880px">
      <div className="settings-modal-dialog">
        {/* Left Sidebar */}
        <aside className="settings-sidebar">
          {/* Search Box */}
          <div className="settings-search-box">
            <IconSearch size={14} className="settings-search-icon" />
            <input
              type="text"
              className="settings-search-input"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* General Navigation Group */}
          {generalGroup.length > 0 && (
            <div className="settings-nav-group">
              {generalGroup.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-btn ${activeTab === item.id ? "active" : ""}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <div className="settings-nav-btn-left">
                    {item.icon}
                    <span>{item.label}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="settings-nav-divider" />

          {/* Preferences Navigation Group */}
          {prefsGroup.length > 0 && (
            <div className="settings-nav-group">
              {prefsGroup.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-btn ${activeTab === item.id ? "active" : ""}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <div className="settings-nav-btn-left">
                    {item.icon}
                    <span>{item.label}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="settings-nav-divider" />

          {/* Advanced Navigation Group */}
          {advGroup.length > 0 && (
            <div className="settings-nav-group">
              {advGroup.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-btn ${activeTab === item.id ? "active" : ""}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <div className="settings-nav-btn-left">
                    {item.icon}
                    <span>{item.label}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="settings-sidebar-bottom">
            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "help" ? "active" : ""}`}
              onClick={() => setActiveTab("help")}
            >
              <div className="settings-nav-btn-left">
                <IconHelpCircle size={16} />
                <span>Get help</span>
              </div>
            </button>
          </div>
        </aside>

        {/* Right Main Content Panel */}
        <main className="settings-main">
          {/* TAB 1: ACCOUNT */}
          {activeTab === "account" && (
            <div>
              <h2 className="settings-pane-title">Profile</h2>

              {/* Profile photo */}
              <div className="settings-profile-photo-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Profile photo</span>
                  <span className="settings-item-desc">Personalize your avatar in conversations.</span>
                </div>
                <div className="settings-avatar-wrapper">
                  <img src={avatarUrl} alt="Avatar" className="settings-avatar-img" />
                  <label className="settings-avatar-upload-btn">
                    Change
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarChange}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
              </div>

              {/* Full name */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Full name</span>
                  <span className="settings-item-desc">Your display name across the workspace.</span>
                </div>
                <input
                  type="text"
                  className="settings-input-control"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                />
              </div>

              {/* Email address (Read-only) */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Email address</span>
                  <span className="settings-item-desc">Authenticated account address.</span>
                </div>
                <input
                  type="text"
                  className="settings-input-control"
                  value={user?.email || firebaseUser?.email || "Signed in"}
                  disabled
                  style={{ opacity: 0.7, cursor: "not-allowed" }}
                />
              </div>

              {/* Sign-in Method */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Sign-in method</span>
                  <span className="settings-item-desc">Authentication method used for this account.</span>
                </div>
                <div className="settings-provider-badge">
                  {loginMethod}
                </div>
              </div>

              {/* Preferred Call Name */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">What should Autonexis call you?</span>
                  <span className="settings-item-desc">
                    Your preferred name remembered in conversations.
                  </span>
                </div>
                <input
                  type="text"
                  className="settings-input-control"
                  value={callName}
                  onChange={(e) => setCallName(e.target.value)}
                  placeholder="e.g. Alex"
                />
              </div>

              {/* Save Profile Button */}
              <div style={{ padding: "1rem 0", display: "flex", gap: "10px", alignItems: "center" }}>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => handleSaveAccount()}
                  disabled={accountSaving}
                >
                  {accountSaving
                    ? "Saving..."
                    : accountSaved
                    ? "Changes Saved!"
                    : "Save Profile Changes"}
                </Button>
                {accountSaved && (
                  <span style={{ color: "var(--accent)", fontSize: "0.85rem" }}>
                    ✓ Profile updated successfully
                  </span>
                )}
                {accountError && (
                  <span style={{ color: "var(--danger, #ef4444)", fontSize: "0.85rem" }}>
                    {accountError}
                  </span>
                )}
              </div>

              {/* Where you're logged in */}
              <div className="settings-devices-section">
                <div className="settings-devices-header">
                  <span className="settings-item-title">Where you're logged in</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRevokeAllSessions}
                    disabled={revokingAll}
                  >
                    {revokingAll ? "Logging out..." : "Log out of all devices"}
                  </Button>
                </div>

                {sessionsLoading ? (
                  <div style={{ padding: "0.5rem 0" }}>
                    <div className="settings-skeleton-row" />
                    <div className="settings-skeleton-row" />
                  </div>
                ) : sessionsError ? (
                  <div style={{ padding: "0.8rem 0", color: "var(--text-muted)", fontSize: "0.84rem" }}>
                    {sessionsError}
                  </div>
                ) : (
                  <table className="settings-devices-table">
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Location</th>
                        <th>Signed in</th>
                        <th>Last active</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => {
                        const isCurrent = s.session_id === currentSessionId;
                        const deviceName = `${s.browser || "Browser"} on ${
                          s.device || s.os || "Device"
                        }`;
                        const locationStr =
                          [s.city, s.region, s.country].filter(Boolean).join(", ") ||
                          s.location ||
                          "Local Network";

                        return (
                          <tr key={s.session_id}>
                            <td>
                              {deviceName}
                              {isCurrent && (
                                <span className="device-current-badge">Current</span>
                              )}
                            </td>
                            <td>{locationStr}</td>
                            <td>{formatSessionDate(s.created_at)}</td>
                            <td>{formatRelativeTime(s.last_active)}</td>
                            <td>
                              {isCurrent ? (
                                <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                                  This device
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="device-logout-btn"
                                  onClick={() => handleLogoutSession(s.session_id)}
                                  disabled={loggingOutSessionId === s.session_id}
                                >
                                  {loggingOutSessionId === s.session_id
                                    ? "Logging out..."
                                    : "Log out"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {sessions.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                            No active sessions found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: APPEARANCE */}
          {activeTab === "appearance" && (
            <div>
              <h2 className="settings-pane-title">Appearance</h2>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Theme</span>
                  <span className="settings-item-desc">
                    Select Light, Dark, or automatically match your system appearance.
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {(["light", "dark", "auto"] as ThemeChoice[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`settings-avatar-upload-btn ${theme === t ? "active" : ""}`}
                      style={
                        theme === t
                          ? { borderColor: "var(--accent)", color: "var(--accent)" }
                          : {}
                      }
                      onClick={() => handleThemeChange(t)}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Font Size & Spacing</span>
                  <span className="settings-item-desc">Adjust chat text size for optimal readability.</span>
                </div>
                <select
                  className="settings-select-control"
                  value={fontScale}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setFontScale(val);
                    localStorage.setItem("autonexis_font_scale", val);
                  }}
                >
                  <option value="compact">Compact</option>
                  <option value="standard">Standard (Default)</option>
                  <option value="spacious">Spacious</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Audio Chime</span>
                  <span className="settings-item-desc">Play a subtle soft sound when assistant finishes replying.</span>
                </div>
                <label className="settings-switch-label">
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => {
                      setSoundEnabled(e.target.checked);
                      localStorage.setItem("autonexis_sound_enabled", String(e.target.checked));
                    }}
                  />
                  <span className="settings-switch-slider"></span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 3: YOUR AUTONEXIS (Memory & Personalization) */}
          {activeTab === "your_autonexis" && (
            <div>
              <h2 className="settings-pane-title">Your Autonexis & Memory</h2>

              <div className="settings-row-col">
                <span className="settings-item-title">Custom Instructions</span>
                <span className="settings-item-desc">
                  What would you like AUTONEXIS Assistant to know about you to provide better responses?
                </span>
                <textarea
                  className="settings-textarea-control"
                  placeholder="e.g. Talk concisely, explain code with real-world examples..."
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                />
                <div style={{ marginTop: "6px" }}>
                  <Button variant="secondary" size="sm" onClick={handleSaveInstructions}>
                    {instructionsSaved ? "Saved!" : "Save Instructions"}
                  </Button>
                </div>
              </div>

              <div className="settings-row-col">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span className="settings-item-title">Active AI Memory Inspector</span>
                    <div className="settings-item-desc">
                      Facts AUTONEXIS has retained about you across chats:
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleResetMemory}>
                    <IconTrash size={14} /> Clear Memory
                  </Button>
                </div>

                <div className="settings-facts-grid">
                  <div
                    className="settings-fact-chip"
                    style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                  >
                    👤 Call Name: {memory.userName || fullName || "User"}
                  </div>
                  {memory.facts.map((fact, idx) => (
                    <div key={idx} className="settings-fact-chip">
                      📌 {fact}
                    </div>
                  ))}
                  {memory.facts.length === 0 && (
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginTop: "6px",
                      }}
                    >
                      No additional facts recorded yet. Chat naturally to build your assistant's memory.
                    </span>
                  )}
                </div>
                {memoryResetDone && (
                  <span
                    style={{
                      color: "var(--accent)",
                      fontSize: "0.82rem",
                      marginTop: "6px",
                    }}
                  >
                    ✓ Memory has been reset.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: CAPABILITIES */}
          {activeTab === "capabilities" && (
            <div>
              <h2 className="settings-pane-title">Capabilities</h2>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Real-Time Token Streaming</span>
                  <span className="settings-item-desc">Stream assistant responses word-by-word with low latency.</span>
                </div>
                <label className="settings-switch-label">
                  <input
                    type="checkbox"
                    checked={streamingEnabled}
                    onChange={(e) => {
                      setStreamingEnabled(e.target.checked);
                      localStorage.setItem("autonexis_streaming", String(e.target.checked));
                    }}
                  />
                  <span className="settings-switch-slider"></span>
                </label>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Syntax Highlighting</span>
                  <span className="settings-item-desc">Render formatted programming code blocks with copy shortcuts.</span>
                </div>
                <label className="settings-switch-label">
                  <input
                    type="checkbox"
                    checked={syntaxHighlight}
                    onChange={(e) => {
                      setSyntaxHighlight(e.target.checked);
                      localStorage.setItem("autonexis_syntax_highlight", String(e.target.checked));
                    }}
                  />
                  <span className="settings-switch-slider"></span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 5: PRIVACY & DATA */}
          {activeTab === "privacy" && (
            <div>
              <h2 className="settings-pane-title">Privacy & Data Management</h2>

              {/* Export chats */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Export Chat History</span>
                  <span className="settings-item-desc">Download a backup copy of all your conversations.</span>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button variant="secondary" size="sm" onClick={handleExportChats}>
                    Export JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportText}>
                    Export Text
                  </Button>
                </div>
              </div>
              {exportNotice && (
                <span style={{ color: "var(--accent)", fontSize: "0.82rem" }}>
                  ✓ Export initiated!
                </span>
              )}

              {/* Delete all chats */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title" style={{ color: "var(--danger, #ef4444)" }}>
                    Clear All Conversations
                  </span>
                  <span className="settings-item-desc">
                    Permanently delete all your chats from the server and local storage.
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAllChats}
                  disabled={chatsClearing}
                  style={{
                    color: "var(--danger, #ef4444)",
                    borderColor: "rgba(239, 68, 68, 0.4)",
                  }}
                >
                  {chatsClearing ? "Clearing..." : "Clear History"}
                </Button>
              </div>
              {chatsClearedNotice && (
                <span style={{ color: "var(--accent)", fontSize: "0.82rem" }}>
                  ✓ All chats permanently deleted!
                </span>
              )}

              {/* Delete account */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title" style={{ color: "var(--danger, #ef4444)" }}>
                    Delete Account
                  </span>
                  <span className="settings-item-desc">
                    Permanently delete your profile, chats, active sessions, and account credentials.
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteAccountModal(!showDeleteAccountModal)}
                  style={{
                    color: "var(--danger, #ef4444)",
                    borderColor: "rgba(239, 68, 68, 0.4)",
                  }}
                >
                  Delete Account
                </Button>
              </div>

              {/* Strong confirmation for delete account */}
              {showDeleteAccountModal && (
                <div className="settings-confirm-delete-box">
                  <div style={{ fontSize: "0.88rem", fontWeight: 500, color: "var(--text-primary)" }}>
                    Confirm Permanent Account Deletion
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                    This action is permanent and cannot be reversed. All chats, active sessions, preferences, and your login will be completely erased.
                    <br />
                    To confirm, please type <strong>DELETE</strong> in uppercase below:
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="text"
                      className="settings-confirm-delete-input"
                      placeholder="Type DELETE"
                      value={deleteConfirmationText}
                      onChange={(e) => {
                        setDeleteConfirmationText(e.target.value);
                        setDeleteAccountError(null);
                      }}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleConfirmDeleteAccount}
                      disabled={deleteConfirmationText.trim() !== "DELETE" || isDeletingAccount}
                      style={{
                        backgroundColor: "var(--danger, #ef4444)",
                        borderColor: "var(--danger, #ef4444)",
                        color: "#fff",
                      }}
                    >
                      {isDeletingAccount ? "Deleting..." : "Permanently Delete"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowDeleteAccountModal(false);
                        setDeleteConfirmationText("");
                        setDeleteAccountError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  {deleteAccountError && (
                    <span style={{ color: "var(--danger, #ef4444)", fontSize: "0.82rem" }}>
                      {deleteAccountError}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: LANGUAGE */}
          {activeTab === "language" && (
            <div>
              <h2 className="settings-pane-title">Language Preferences</h2>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Primary Conversation Language</span>
                  <span className="settings-item-desc">AI will match your selected language or auto-adapt.</span>
                </div>
                <select
                  className="settings-select-control"
                  value={preferredLang}
                  onChange={(e) => {
                    setPreferredLang(e.target.value);
                    localStorage.setItem("autonexis_language", e.target.value);
                  }}
                >
                  <option value="auto">Auto-Detect (Seamless)</option>
                  <option value="en">English (Primary)</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="hinglish">Hinglish (Natural)</option>
                </select>
              </div>
            </div>
          )}

          {/* TAB 7: HELP */}
          {activeTab === "help" && (
            <div>
              <h2 className="settings-pane-title">Help & Shortcuts</h2>
              <table className="settings-devices-table" style={{ marginTop: "1rem" }}>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Shortcut</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Open Settings Dialog</td>
                    <td>
                      <kbd
                        style={{
                          padding: "2px 6px",
                          background: "var(--surface-raised)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "4px",
                        }}
                      >
                        Ctrl + Shift + ,
                      </kbd>
                    </td>
                  </tr>
                  <tr>
                    <td>Send Message</td>
                    <td>
                      <kbd
                        style={{
                          padding: "2px 6px",
                          background: "var(--surface-raised)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "4px",
                        }}
                      >
                        Enter
                      </kbd>
                    </td>
                  </tr>
                  <tr>
                    <td>Add New Line in Chat</td>
                    <td>
                      <kbd
                        style={{
                          padding: "2px 6px",
                          background: "var(--surface-raised)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "4px",
                        }}
                      >
                        Shift + Enter
                      </kbd>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </Modal>
  );
};
