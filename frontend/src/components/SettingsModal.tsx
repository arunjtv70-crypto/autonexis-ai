import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useTheme, type ThemeChoice } from "../state/theme";
import { useAuth } from "../state/auth";
import { useChats } from "../state/chats";
import type { SettingsTabId } from "./UserMenuDropdown";
import {
  IconUser,
  IconSliders,
  IconBrain,
  IconPalette,
  IconDownload,
  IconTrash,
  IconEdit,
  IconCheck,
  IconPlus,
  IconGlobe,
  IconLogout,
} from "./Icons";
import "./SettingsModal.css";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTabId;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = "account",
}) => {
  const { theme, setTheme } = useTheme();
  const { user, firebaseUser, isGuest, logout, updateProfileName } = useAuth();
  const {
    preferences,
    memories,
    updatePreferences,
    addMemoryManual,
    editMemory,
    deleteMemory,
    clearAllMemories,
    clearAllChats,
    exportMyChats,
  } = useChats();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);

  // Profile fields
  const [displayName, setDisplayName] = useState(
    preferences.displayName || user?.display_name || firebaseUser?.displayName || ""
  );
  const [nickname, setNickname] = useState(preferences.nickname || "");
  const [profileSaved, setProfileSaved] = useState(false);

  // Personalization fields
  const [customInstructions, setCustomInstructions] = useState(
    preferences.customInstructions || ""
  );
  const [responseStyle, setResponseStyle] = useState<
    "Default" | "Short and direct" | "Detailed" | "Casual Hinglish" | "Formal"
  >(preferences.responseStyle || "Default");
  const [language, setLanguage] = useState<"Auto" | "Hindi" | "Hinglish" | "English">(
    preferences.language || "Auto"
  );
  const [personalizationSaved, setPersonalizationSaved] = useState(false);

  // Memory management fields
  const [newMemoryText, setNewMemoryText] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryText, setEditingMemoryText] = useState("");
  const [confirmDeleteAllMemories, setConfirmDeleteAllMemories] = useState(false);

  // Data management fields
  const [confirmDeleteAllChats, setConfirmDeleteAllChats] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Sync state whenever preferences or initialTab updates
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || "account");
      setDisplayName(preferences.displayName || user?.display_name || firebaseUser?.displayName || "");
      setNickname(preferences.nickname || "");
      setCustomInstructions(preferences.customInstructions || "");
      setResponseStyle(preferences.responseStyle || "Default");
      setLanguage(preferences.language || "Auto");
      setConfirmDeleteAllMemories(false);
      setConfirmDeleteAllChats(false);
      setActionNotice(null);
    }
  }, [isOpen, initialTab, preferences, user?.display_name, firebaseUser?.displayName]);

  // Determine sign-in method
  const getSignInMethod = (): string => {
    if (isGuest) return "Guest Mode";
    if (firebaseUser?.providerData && firebaseUser.providerData.length > 0) {
      const providerId = firebaseUser.providerData[0].providerId;
      if (providerId === "google.com") return "Google Account";
      if (providerId === "password") return "Email & Password";
      return providerId;
    }
    return "Email Account";
  };

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanName = displayName.trim();
    const cleanNickname = nickname.trim();
    await updatePreferences({
      displayName: cleanName || undefined,
      nickname: cleanNickname || undefined,
    });
    if (cleanName) {
      await updateProfileName(cleanName);
    }
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2200);
  };

  const handleSavePersonalization = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await updatePreferences({
      customInstructions: customInstructions.trim().slice(0, 1500),
      responseStyle,
      language,
    });
    setPersonalizationSaved(true);
    setTimeout(() => setPersonalizationSaved(false), 2200);
  };

  const handleToggleMemory = async () => {
    await updatePreferences({
      memoryEnabled: !preferences.memoryEnabled,
    });
  };

  const handleToggleWebSearch = async () => {
    await updatePreferences({
      webSearchDefault: !preferences.webSearchDefault,
    });
  };

  const handleSetTextSize = async (size: "Small" | "Medium" | "Large") => {
    await updatePreferences({ textSize: size });
  };

  const handleAddMemory = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = newMemoryText.trim();
    if (!clean) return;
    await addMemoryManual(clean);
    setNewMemoryText("");
    setActionNotice("Memory added successfully.");
    setTimeout(() => setActionNotice(null), 2500);
  };

  const handleStartEditMemory = (id: string, currentText: string) => {
    setEditingMemoryId(id);
    setEditingMemoryText(currentText);
  };

  const handleSaveEditMemory = async (id: string) => {
    const clean = editingMemoryText.trim();
    if (clean) {
      await editMemory(id, clean);
    }
    setEditingMemoryId(null);
    setEditingMemoryText("");
  };

  const handleDeleteOneMemory = async (id: string) => {
    await deleteMemory(id);
  };

  const handleConfirmDeleteAllMemories = async () => {
    await clearAllMemories();
    setConfirmDeleteAllMemories(false);
    setActionNotice("All memories permanently cleared.");
    setTimeout(() => setActionNotice(null), 2500);
  };

  const handleConfirmDeleteAllChats = async () => {
    clearAllChats();
    setConfirmDeleteAllChats(false);
    setActionNotice("All conversations deleted.");
    setTimeout(() => setActionNotice(null), 2500);
  };

  const handleExportChats = async () => {
    setIsExporting(true);
    try {
      await exportMyChats();
      setActionNotice("Chat export downloaded.");
    } catch {
      setActionNotice("Failed to download chat export.");
    } finally {
      setIsExporting(false);
      setTimeout(() => setActionNotice(null), 3000);
    }
  };

  const handleLogout = async () => {
    onClose();
    await logout();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="760px"
      className="settings-modal-fullscreen"
    >
      <div className="settings-modal-dialog">
        {/* Navigation Sidebar */}
        <nav className="settings-sidebar" aria-label="Settings navigation">
          <div className="settings-nav-group">
            <span className="settings-nav-header">Preferences</span>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "account" ? "active" : ""}`}
              onClick={() => setActiveTab("account")}
            >
              <div className="settings-nav-btn-left">
                <IconUser size={16} />
                <span>Profile</span>
              </div>
            </button>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "personalization" ? "active" : ""}`}
              onClick={() => setActiveTab("personalization")}
            >
              <div className="settings-nav-btn-left">
                <IconSliders size={16} />
                <span>Personalization</span>
              </div>
            </button>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "memory" ? "active" : ""}`}
              onClick={() => setActiveTab("memory")}
            >
              <div className="settings-nav-btn-left">
                <IconBrain size={16} />
                <span>Memory</span>
              </div>
            </button>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "appearance" ? "active" : ""}`}
              onClick={() => setActiveTab("appearance")}
            >
              <div className="settings-nav-btn-left">
                <IconPalette size={16} />
                <span>Appearance</span>
              </div>
            </button>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "data" ? "active" : ""}`}
              onClick={() => setActiveTab("data")}
            >
              <div className="settings-nav-btn-left">
                <IconDownload size={16} />
                <span>Data & About</span>
              </div>
            </button>
          </div>

          <div className="settings-sidebar-bottom">
            <button
              type="button"
              className="settings-nav-btn"
              onClick={handleLogout}
              style={{ color: "var(--danger, #ef4444)" }}
            >
              <div className="settings-nav-btn-left">
                <IconLogout size={16} />
                <span>Log out</span>
              </div>
            </button>
          </div>
        </nav>

        {/* Content Pane */}
        <main className="settings-main" role="tabpanel">
          {actionNotice && (
            <div className="settings-toast-banner" role="status">
              <IconCheck size={14} />
              <span>{actionNotice}</span>
            </div>
          )}

          {/* ==============================================================
             TAB 1: PROFILE
             ============================================================== */}
          {activeTab === "account" && (
            <div className="settings-tab-pane">
              <h2 className="settings-pane-title">Profile</h2>
              <p className="settings-tab-desc">
                Manage your account credentials and personal identity.
              </p>

              {/* Display Name */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Display Name</span>
                  <span className="settings-item-desc">
                    Your full name shown across AUTONEXIS.
                  </span>
                </div>
                <div className="settings-row-action">
                  <input
                    type="text"
                    className="settings-input-control"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex Sharma"
                    maxLength={50}
                  />
                </div>
              </div>

              {/* Nickname */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Assistant Nickname</span>
                  <span className="settings-item-desc">
                    What should AUTONEXIS Assistant call you?
                  </span>
                </div>
                <div className="settings-row-action">
                  <input
                    type="text"
                    className="settings-input-control"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="e.g. Alex"
                    maxLength={40}
                  />
                </div>
              </div>

              {/* Save Profile Button */}
              <div className="settings-save-row">
                <Button variant="primary" size="sm" onClick={() => handleSaveProfile()}>
                  {profileSaved ? (
                    <>
                      <IconCheck size={14} /> Saved
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>

              {/* Email (Read Only) */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Email Address</span>
                  <span className="settings-item-desc">
                    Your verified authentication email (read-only).
                  </span>
                </div>
                <div className="settings-row-action">
                  <input
                    type="text"
                    className="settings-input-control readonly"
                    value={user?.email || firebaseUser?.email || "Guest Session"}
                    disabled
                  />
                </div>
              </div>

              {/* Sign-in Method (Read Only) */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Sign-in Method</span>
                  <span className="settings-item-desc">
                    Authentication provider associated with this account.
                  </span>
                </div>
                <div className="settings-row-action">
                  <span className="settings-provider-badge">
                    {getSignInMethod()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
             TAB 2: PERSONALIZATION
             ============================================================== */}
          {activeTab === "personalization" && (
            <div className="settings-tab-pane">
              <h2 className="settings-pane-title">Personalization</h2>
              <p className="settings-tab-desc">
                Tailor how AUTONEXIS Assistant understands your background and crafts responses.
              </p>

              {/* Custom Instructions */}
              <div className="settings-row-col">
                <div className="settings-row-header-between">
                  <span className="settings-item-title">
                    Custom Instructions & Background
                  </span>
                  <span className="settings-char-counter">
                    {customInstructions.length} / 1500
                  </span>
                </div>
                <span className="settings-item-desc">
                  What should AUTONEXIS Assistant know about you and how should it reply?
                </span>
                <textarea
                  className="settings-textarea-control"
                  rows={4}
                  maxLength={1500}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="e.g. I run an electronics store in Mumbai. I prefer clear, practical advice with zero marketing fluff. I like math equations shown in step-by-step detail."
                />
              </div>

              {/* Response Style */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Response Style</span>
                  <span className="settings-item-desc">
                    Choose the baseline tone and structure of answers.
                  </span>
                </div>
                <div className="settings-row-action">
                  <select
                    className="settings-select-control"
                    value={responseStyle}
                    onChange={(e) =>
                      setResponseStyle(
                        e.target.value as "Default" | "Short and direct" | "Detailed" | "Casual Hinglish" | "Formal"
                      )
                    }
                  >
                    <option value="Default">Default (Balanced & Adaptive)</option>
                    <option value="Short and direct">Short and direct</option>
                    <option value="Detailed">Detailed & Structured</option>
                    <option value="Casual Hinglish">Casual Hinglish (Friendly Peer)</option>
                    <option value="Formal">Formal & Professional</option>
                  </select>
                </div>
              </div>

              {/* Language Preference */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Language</span>
                  <span className="settings-item-desc">
                    Default response language for new conversations.
                  </span>
                </div>
                <div className="settings-row-action">
                  <select
                    className="settings-select-control"
                    value={language}
                    onChange={(e) =>
                      setLanguage(
                        e.target.value as "Auto" | "Hindi" | "Hinglish" | "English"
                      )
                    }
                  >
                    <option value="Auto">Auto (Match my query)</option>
                    <option value="Hinglish">Hinglish (Hindi in English letters)</option>
                    <option value="Hindi">Hindi (हिंदी Devanagari)</option>
                    <option value="English">English</option>
                  </select>
                </div>
              </div>

              {/* Save Personalization Button */}
              <div className="settings-save-row">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleSavePersonalization()}
                >
                  {personalizationSaved ? (
                    <>
                      <IconCheck size={14} /> Saved
                    </>
                  ) : (
                    "Save Personalization"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* ==============================================================
             TAB 3: MEMORY
             ============================================================== */}
          {activeTab === "memory" && (
            <div className="settings-tab-pane">
              <h2 className="settings-pane-title">Memory</h2>
              <p className="settings-tab-desc">
                AUTONEXIS Assistant learns key durable facts from your chats to deliver personalized assistance.
              </p>

              {/* Toggle Generate Memory */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">
                    Generate memory from chats
                  </span>
                  <span className="settings-item-desc">
                    Automatically remember preferences and background shared in conversations.
                  </span>
                </div>
                <div className="settings-row-action">
                  <button
                    type="button"
                    className={`settings-toggle-btn ${preferences.memoryEnabled ? "active" : ""}`}
                    onClick={handleToggleMemory}
                    role="switch"
                    aria-checked={preferences.memoryEnabled}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
              </div>

              {/* Privacy Notice */}
              <div className="settings-privacy-callout">
                <span className="settings-privacy-title">🔒 Privacy & Security Guarantee</span>
                <p>
                  Memories only capture durable facts you explicitly state about yourself. Sensitive details (passwords, API keys, OTPs, bank cards, ID numbers, health conditions) are strictly omitted.
                </p>
              </div>

              {/* Add Memory Form */}
              <div className="settings-row-col">
                <span className="settings-item-title">Add a Memory Manually</span>
                <div className="settings-add-memory-row">
                  <input
                    type="text"
                    className="settings-input-control"
                    placeholder="e.g. Prefers answers with concise bullet points"
                    value={newMemoryText}
                    onChange={(e) => setNewMemoryText(e.target.value)}
                    maxLength={200}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddMemory();
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleAddMemory()}
                    disabled={!newMemoryText.trim()}
                  >
                    <IconPlus size={14} /> Add
                  </Button>
                </div>
              </div>

              {/* Manage Memories List */}
              <div className="settings-memories-header">
                <span className="settings-item-title">
                  Saved Memories ({memories.length})
                </span>
                {memories.length > 0 && !confirmDeleteAllMemories && (
                  <button
                    type="button"
                    className="settings-danger-link-btn"
                    onClick={() => setConfirmDeleteAllMemories(true)}
                  >
                    Clear all memory
                  </button>
                )}
              </div>

              {confirmDeleteAllMemories && (
                <div className="settings-confirm-delete-box">
                  <p>
                    Are you sure you want to permanently delete all stored memories? The assistant will forget all learned preferences.
                  </p>
                  <div className="settings-confirm-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDeleteAllMemories(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleConfirmDeleteAllMemories}
                      style={{
                        backgroundColor: "var(--danger, #ef4444)",
                        borderColor: "transparent",
                      }}
                    >
                      Yes, Delete All
                    </Button>
                  </div>
                </div>
              )}

              <div className="settings-memories-list">
                {memories.length === 0 ? (
                  <div className="settings-empty-memories">
                    No memories saved yet. Talk to AUTONEXIS Assistant or add one above!
                  </div>
                ) : (
                  memories.map((mem) => (
                    <div key={mem.id} className="settings-memory-card">
                      {editingMemoryId === mem.id ? (
                        <div className="settings-memory-edit-box">
                          <input
                            type="text"
                            className="settings-input-control"
                            value={editingMemoryText}
                            onChange={(e) => setEditingMemoryText(e.target.value)}
                            maxLength={200}
                          />
                          <div className="settings-memory-edit-actions">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setEditingMemoryId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleSaveEditMemory(mem.id)}
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="settings-memory-text-col">
                            <span className="settings-memory-text">{mem.text}</span>
                            <span className="settings-memory-date">
                              {new Date(mem.createdAt).toLocaleDateString([], {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                          <div className="settings-memory-actions">
                            <button
                              type="button"
                              className="settings-icon-action-btn"
                              title="Edit memory"
                              onClick={() => handleStartEditMemory(mem.id, mem.text)}
                            >
                              <IconEdit size={14} />
                            </button>
                            <button
                              type="button"
                              className="settings-icon-action-btn danger"
                              title="Delete memory"
                              onClick={() => handleDeleteOneMemory(mem.id)}
                            >
                              <IconTrash size={14} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ==============================================================
             TAB 4: SEARCH & APPEARANCE
             ============================================================== */}
          {activeTab === "appearance" && (
            <div className="settings-tab-pane">
              <h2 className="settings-pane-title">Search & Appearance</h2>
              <p className="settings-tab-desc">
                Configure live web intelligence and customize typography & color modes.
              </p>

              {/* Web Search Default Toggle */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <IconGlobe size={15} style={{ color: "var(--accent)" }} />
                    <span className="settings-item-title">Web Search by Default</span>
                  </div>
                  <span className="settings-item-desc">
                    When enabled, searches the live web for recent events and research. Also toggleable per-chat in the input menu.
                  </span>
                </div>
                <div className="settings-row-action">
                  <button
                    type="button"
                    className={`settings-toggle-btn ${preferences.webSearchDefault ? "active" : ""}`}
                    onClick={handleToggleWebSearch}
                    role="switch"
                    aria-checked={preferences.webSearchDefault}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
              </div>

              {/* Theme Selector */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Theme</span>
                  <span className="settings-item-desc">
                    Select your preferred visual atmosphere.
                  </span>
                </div>
                <div className="settings-pill-group">
                  {(["light", "dark", "auto"] as ThemeChoice[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`settings-pill-btn ${theme === t ? "active" : ""}`}
                      onClick={() => {
                        setTheme(t);
                        updatePreferences({ theme: t });
                      }}
                    >
                      {t === "auto" ? "System" : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Size Selector */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Text Size</span>
                  <span className="settings-item-desc">
                    Adjust font size scale across conversation views.
                  </span>
                </div>
                <div className="settings-pill-group">
                  {(["Small", "Medium", "Large"] as Array<"Small" | "Medium" | "Large">).map(
                    (size) => {
                      const isSelected = (preferences.textSize || "Medium") === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          className={`settings-pill-btn ${isSelected ? "active" : ""}`}
                          onClick={() => handleSetTextSize(size)}
                        >
                          {size}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
             TAB 5: DATA & ABOUT
             ============================================================== */}
          {activeTab === "data" && (
            <div className="settings-tab-pane">
              <h2 className="settings-pane-title">Data & About</h2>
              <p className="settings-tab-desc">
                Export chat records, manage stored data, and view system specifications.
              </p>

              {/* Export Chats */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Export Conversations</span>
                  <span className="settings-item-desc">
                    Download a complete JSON archive of all your chats and messages.
                  </span>
                </div>
                <div className="settings-row-action">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleExportChats}
                    disabled={isExporting}
                  >
                    <IconDownload size={14} />
                    {isExporting ? "Exporting..." : "Export Chats"}
                  </Button>
                </div>
              </div>

              {/* Delete All Chats */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Delete All Chats</span>
                  <span className="settings-item-desc">
                    Permanently delete all conversation history across all devices.
                  </span>
                </div>
                <div className="settings-row-action">
                  {!confirmDeleteAllChats ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDeleteAllChats(true)}
                      style={{
                        color: "var(--danger, #ef4444)",
                        borderColor: "rgba(239, 68, 68, 0.4)",
                      }}
                    >
                      Delete All Chats
                    </Button>
                  ) : (
                    <div className="settings-confirm-inline">
                      <span className="settings-danger-warning">Confirm delete?</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmDeleteAllChats(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleConfirmDeleteAllChats}
                        style={{
                          backgroundColor: "var(--danger, #ef4444)",
                          borderColor: "transparent",
                        }}
                      >
                        Yes, Delete
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Delete All Memory */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Delete All Memory</span>
                  <span className="settings-item-desc">
                    Clear all learned personal facts and stored memories.
                  </span>
                </div>
                <div className="settings-row-action">
                  {!confirmDeleteAllMemories ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDeleteAllMemories(true)}
                      style={{
                        color: "var(--danger, #ef4444)",
                        borderColor: "rgba(239, 68, 68, 0.4)",
                      }}
                    >
                      Delete All Memory
                    </Button>
                  ) : (
                    <div className="settings-confirm-inline">
                      <span className="settings-danger-warning">Confirm clear?</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmDeleteAllMemories(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleConfirmDeleteAllMemories}
                        style={{
                          backgroundColor: "var(--danger, #ef4444)",
                          borderColor: "transparent",
                        }}
                      >
                        Yes, Clear
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* About App */}
              <div className="settings-section" style={{ borderBottom: "none", marginTop: "1rem" }}>
                <h3 className="settings-section-subtitle">About</h3>
                <div className="settings-about-box">
                  <div className="settings-about-line">
                    <span className="settings-about-name">AUTONEXIS Assistant</span>
                    <span className="settings-about-badge">v2.4.0</span>
                  </div>
                  <p className="settings-about-desc">
                    Autonomous Multi-Modal AI Assistant featuring deep math reasoning, vision understanding, persistent memory, and live web intelligence.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </Modal>
  );
};
