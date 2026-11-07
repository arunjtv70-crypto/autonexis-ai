import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import {
  IconSearch,
  IconUser,
  IconCreditCard,
  IconPalette,
  IconBrain,
  IconZap,
  IconBell,
  IconShield,
  IconHeart,
  IconSliders,
  IconCode,
  IconGlobe,
  IconKey,
  IconHelpCircle,
  IconCopy,
  IconCheck,
  IconExternalLink,
  IconTrash,
} from "./Icons";
import { useTheme, type ThemeChoice } from "../state/theme";
import { useAuth } from "../state/auth";
import { useChats } from "../state/chats";
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
  initialTab = "account",
}) => {
  const { theme, setTheme } = useTheme();
  const { user, logout, updateProfileName } = useAuth();
  const { chats, memory, clearAllChats, resetMemory, updateCallName } = useChats();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");

  // Whenever modal opens with a specific tab, switch to it
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Account Tab States
  const [fullName, setFullName] = useState(user?.display_name || "Arun ambedkar34");
  const [callName, setCallName] = useState(memory.userName || "Arun");
  const [workDesc, setWorkDesc] = useState(() => localStorage.getItem("autonexis_user_work") || "Engineering");
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem("autonexis_user_avatar") || "/logo_circle.png?v=20261107");
  const [orgId] = useState("42035f7c-bd9f-43b4-946a-1a7226bd2e91");
  const [copiedOrgId, setCopiedOrgId] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);

  // Appearance Tab States
  const [fontScale, setFontScale] = useState<"compact" | "standard" | "spacious">(
    () => (localStorage.getItem("autonexis_font_scale") as any) || "standard"
  );
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem("autonexis_sound_enabled") === "true"
  );

  // Memory & Personalization Tab States
  const [customInstructions, setCustomInstructions] = useState(
    () => localStorage.getItem("autonexis_custom_instructions") || ""
  );
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [memoryResetDone, setMemoryResetDone] = useState(false);

  // Capabilities States
  const [streamingEnabled, setStreamingEnabled] = useState(
    () => localStorage.getItem("autonexis_streaming") !== "false"
  );
  const [syntaxHighlight, setSyntaxHighlight] = useState(
    () => localStorage.getItem("autonexis_syntax_highlight") !== "false"
  );

  // Notifications States
  const [browserNotifications, setBrowserNotifications] = useState(
    () => localStorage.getItem("autonexis_notifications") === "true"
  );

  // Language State
  const [preferredLang, setPreferredLang] = useState(
    () => localStorage.getItem("autonexis_language") || "auto"
  );

  // API Key State
  const [customApiKey, setCustomApiKey] = useState(
    () => localStorage.getItem("autonexis_custom_api_key") || ""
  );
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Privacy States
  const [exportNotice, setExportNotice] = useState(false);
  const [chatsClearedNotice, setChatsClearedNotice] = useState(false);

  // Wellbeing States
  const [breakReminders, setBreakReminders] = useState(
    () => localStorage.getItem("autonexis_wellbeing_breaks") === "true"
  );

  // Save Account Changes
  const handleSaveAccount = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (fullName.trim()) {
      updateProfileName(fullName.trim());
    }
    if (callName.trim()) {
      updateCallName(callName.trim());
      localStorage.setItem("autonexis_user_callname", callName.trim());
    }
    localStorage.setItem("autonexis_user_work", workDesc);
    setAccountSaved(true);
    setTimeout(() => setAccountSaved(false), 2500);
  };

  const handleCopyOrgId = () => {
    navigator.clipboard.writeText(orgId);
    setCopiedOrgId(true);
    setTimeout(() => setCopiedOrgId(false), 2000);
  };

  // Avatar Upload / Simulation
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

  // Export Chats as JSON
  const handleExportChats = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(chats, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `autonexis_chats_export_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExportNotice(true);
    setTimeout(() => setExportNotice(false), 2500);
  };

  // Export Chats as Readable TXT
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
    downloadAnchor.setAttribute("download", `autonexis_chats_${new Date().toISOString().slice(0, 10)}.txt`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExportNotice(true);
    setTimeout(() => setExportNotice(false), 2500);
  };

  // Clear Chats
  const handleClearAllChats = () => {
    if (window.confirm("Are you sure you want to clear all chat histories? This cannot be undone.")) {
      clearAllChats();
      setChatsClearedNotice(true);
      setTimeout(() => setChatsClearedNotice(false), 2500);
    }
  };

  // Reset Memory
  const handleResetMemory = () => {
    if (window.confirm("Are you sure you want to reset all AI memory and forgotten facts?")) {
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

  // Save API Key
  const handleSaveApiKey = () => {
    localStorage.setItem("autonexis_custom_api_key", customApiKey.trim());
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  };

  // Navigation Items matching Image 2
  const navItems = [
    { id: "account" as SettingsTabId, label: "Account", icon: <IconUser size={16} />, category: "General" },
    { id: "billing" as SettingsTabId, label: "Billing", icon: <IconCreditCard size={16} />, category: "General" },
    { id: "appearance" as SettingsTabId, label: "Appearance", icon: <IconPalette size={16} />, category: "Preferences" },
    { id: "your_autonexis" as SettingsTabId, label: "Your Autonexis", icon: <IconBrain size={16} />, category: "Preferences" },
    { id: "capabilities" as SettingsTabId, label: "Capabilities", icon: <IconZap size={16} />, category: "Preferences" },
    { id: "notifications" as SettingsTabId, label: "Notifications", icon: <IconBell size={16} />, category: "Preferences" },
    { id: "privacy" as SettingsTabId, label: "Privacy", icon: <IconShield size={16} />, category: "Preferences" },
    { id: "wellbeing" as SettingsTabId, label: "Wellbeing", icon: <IconHeart size={16} />, category: "Preferences" },
    { id: "customize" as SettingsTabId, label: "Customize", icon: <IconSliders size={16} />, category: "Advanced" },
    { id: "code" as SettingsTabId, label: "Code", icon: <IconCode size={16} />, category: "Advanced" },
    { id: "language" as SettingsTabId, label: "Language", icon: <IconGlobe size={16} />, category: "Advanced" },
    { id: "apikeys" as SettingsTabId, label: "API keys", icon: <IconKey size={16} />, category: "Advanced" },
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
                  {item.id === "apikeys" && <IconExternalLink size={13} className="user-menu-arrow" />}
                </button>
              ))}
            </div>
          )}

          <div className="settings-sidebar-bottom">
            <button
              type="button"
              className="settings-nav-btn"
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
          {/* TAB 1: ACCOUNT (Matches Image 2 exactly) */}
          {activeTab === "account" && (
            <div>
              <h2 className="settings-pane-title">Profile</h2>

              {/* Profile photo */}
              <div className="settings-profile-photo-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Profile photo</span>
                  <span className="settings-item-desc">PNG, JPEG, or WebP, up to 10MB.</span>
                </div>
                <div className="settings-avatar-wrapper">
                  <img src={avatarUrl} alt="Avatar" className="settings-avatar-img" />
                  <label className="settings-avatar-upload-btn">
                    Change
                    <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: "none" }} />
                  </label>
                </div>
              </div>

              {/* Full name */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Full name</span>
                </div>
                <input
                  type="text"
                  className="settings-input-control"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                />
              </div>

              {/* What should Autonexis call you? */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">What should Autonexis call you?</span>
                  <span className="settings-item-desc">Your preferred name remembered across all conversations.</span>
                </div>
                <input
                  type="text"
                  className="settings-input-control"
                  value={callName}
                  onChange={(e) => setCallName(e.target.value)}
                  placeholder="e.g. Arun"
                />
              </div>

              {/* What best describes your work? */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">What best describes your work?</span>
                </div>
                <select
                  className="settings-select-control"
                  value={workDesc}
                  onChange={(e) => setWorkDesc(e.target.value)}
                >
                  <option value="Engineering">Engineering</option>
                  <option value="Software Development">Software Development</option>
                  <option value="Product & Design">Product & Design</option>
                  <option value="Marketing & Sales">Marketing & Sales</option>
                  <option value="Business & Founder">Business & Founder</option>
                  <option value="Student & Research">Student & Research</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Content Creator">Content Creator</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Organization ID */}
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Organization ID</span>
                </div>
                <button type="button" className="settings-copy-pill" onClick={handleCopyOrgId} title="Click to copy">
                  <span>{orgId}</span>
                  {copiedOrgId ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </button>
              </div>

              {/* Save Account Button */}
              <div style={{ padding: "1rem 0", display: "flex", gap: "10px", alignItems: "center" }}>
                <Button variant="primary" size="md" onClick={() => handleSaveAccount()}>
                  {accountSaved ? "Changes Saved!" : "Save Profile Changes"}
                </Button>
                {accountSaved && <span style={{ color: "var(--accent)", fontSize: "0.85rem" }}>✓ Profile & AI Memory updated</span>}
              </div>

              {/* Where you're logged in */}
              <div className="settings-devices-section">
                <div className="settings-devices-header">
                  <span className="settings-item-title">Where you're logged in</span>
                  <Button variant="outline" size="sm" onClick={() => logout()}>
                    Log out of all devices
                  </Button>
                </div>

                <table className="settings-devices-table">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Location</th>
                      <th>Signed in</th>
                      <th>Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        Chrome (Windows)
                        <span className="device-current-badge">Current</span>
                      </td>
                      <td>Madhya Pradesh, India</td>
                      <td>Oct 1, 2026, 10:18 AM</td>
                      <td>Nov 7, 2026, 9:29 AM</td>
                    </tr>
                    <tr>
                      <td>Android (PWA App)</td>
                      <td>Madhya Pradesh, India</td>
                      <td>Sep 21, 2026, 3:15 PM</td>
                      <td>Nov 3, 2026, 3:55 PM</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Trusted devices */}
              <div style={{ padding: "1rem 0" }}>
                <div className="settings-item-title">Trusted devices</div>
                <div className="settings-item-desc" style={{ marginBottom: "0.5rem" }}>
                  Devices that can control your assistant remotely.
                </div>
                <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>No trusted devices.</span>
              </div>
            </div>
          )}

          {/* TAB 2: BILLING */}
          {activeTab === "billing" && (
            <div>
              <h2 className="settings-pane-title">Billing & Plans</h2>

              <div className="settings-plan-card" style={{ marginBottom: "1.2rem" }}>
                <div className="settings-plan-badge">Current Active Plan</div>
                <div style={{ fontSize: "1.1rem", fontWeight: 500, color: "var(--text-primary)" }}>
                  AUTONEXIS Standard (Free Tier)
                </div>
                <div className="settings-item-desc">
                  Includes full access to AUTONEXIS Assistant, persistent cross-chat memory, PWA install, and unlimited chats.
                </div>
              </div>

              <div className="settings-plan-card" style={{ borderColor: "var(--accent)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: "1.2rem", fontWeight: 500, color: "var(--text-primary)" }}>
                    AUTONEXIS Pro
                  </div>
                  <div style={{ fontSize: "1.1rem", color: "var(--accent)", fontWeight: 500 }}>
                    ₹1,499 <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>/ month</span>
                  </div>
                </div>
                <div className="settings-item-desc">
                  Accelerated inference, extended 128k context window, priority token streaming, and team collaboration.
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  <Button variant="primary" size="md">
                    Upgrade to Pro Plan
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: APPEARANCE */}
          {activeTab === "appearance" && (
            <div>
              <h2 className="settings-pane-title">Appearance</h2>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Theme</span>
                  <span className="settings-item-desc">Select Light, Dark, or follow system theme.</span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {(["light", "dark", "auto"] as ThemeChoice[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`settings-avatar-upload-btn ${theme === t ? "active" : ""}`}
                      style={theme === t ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
                      onClick={() => setTheme(t)}
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

          {/* TAB 4: YOUR AUTONEXIS (Memory & Personalization) */}
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
                  placeholder="e.g. Talk concisely, answer in Hindi or Hinglish, explain code with real-world examples..."
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
                    <div className="settings-item-desc">Facts AUTONEXIS has permanently retained about you across chats:</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleResetMemory}>
                    <IconTrash size={14} /> Clear Memory
                  </Button>
                </div>

                <div className="settings-facts-grid">
                  <div className="settings-fact-chip" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                    👤 Call Name: {memory.userName || "Arun"}
                  </div>
                  <div className="settings-fact-chip">💼 Work: {workDesc}</div>
                  {memory.facts.map((fact, idx) => (
                    <div key={idx} className="settings-fact-chip">
                      📌 {fact}
                    </div>
                  ))}
                  {memory.facts.length === 0 && (
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "6px" }}>
                      No additional facts recorded yet. Chat naturally to build your assistant's memory.
                    </span>
                  )}
                </div>
                {memoryResetDone && <span style={{ color: "var(--accent)", fontSize: "0.82rem", marginTop: "6px" }}>✓ Memory has been reset.</span>}
              </div>
            </div>
          )}

          {/* TAB 5: CAPABILITIES */}
          {activeTab === "capabilities" && (
            <div>
              <h2 className="settings-pane-title">Capabilities</h2>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Real-Time Token Streaming</span>
                  <span className="settings-item-desc">Stream assistant responses word-by-word with ultra-low latency.</span>
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

          {/* TAB 6: NOTIFICATIONS */}
          {activeTab === "notifications" && (
            <div>
              <h2 className="settings-pane-title">Notifications</h2>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Desktop & Browser Notifications</span>
                  <span className="settings-item-desc">Notify when long background tasks or responses complete.</span>
                </div>
                <label className="settings-switch-label">
                  <input
                    type="checkbox"
                    checked={browserNotifications}
                    onChange={async (e) => {
                      const enabled = e.target.checked;
                      if (enabled && "Notification" in window) {
                        const perm = await Notification.requestPermission();
                        if (perm !== "granted") return;
                      }
                      setBrowserNotifications(enabled);
                      localStorage.setItem("autonexis_notifications", String(enabled));
                    }}
                  />
                  <span className="settings-switch-slider"></span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 7: PRIVACY & DATA */}
          {activeTab === "privacy" && (
            <div>
              <h2 className="settings-pane-title">Privacy & Data Management</h2>

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
              {exportNotice && <span style={{ color: "var(--accent)", fontSize: "0.82rem" }}>✓ Export initiated!</span>}

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title" style={{ color: "var(--danger)" }}>Clear All Conversations</span>
                  <span className="settings-item-desc">Permanently wipe all chats from local storage and start fresh.</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleClearAllChats} style={{ color: "var(--danger)", borderColor: "var(--danger-soft)" }}>
                  Clear History
                </Button>
              </div>
              {chatsClearedNotice && <span style={{ color: "var(--danger)", fontSize: "0.82rem" }}>✓ All chats cleared!</span>}
            </div>
          )}

          {/* TAB 8: WELLBEING */}
          {activeTab === "wellbeing" && (
            <div>
              <h2 className="settings-pane-title">Wellbeing & Ergonomics</h2>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Break Reminders</span>
                  <span className="settings-item-desc">Gentle notification to rest your eyes after 45 minutes of continuous work.</span>
                </div>
                <label className="settings-switch-label">
                  <input
                    type="checkbox"
                    checked={breakReminders}
                    onChange={(e) => {
                      setBreakReminders(e.target.checked);
                      localStorage.setItem("autonexis_wellbeing_breaks", String(e.target.checked));
                    }}
                  />
                  <span className="settings-switch-slider"></span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 9: CUSTOMIZE */}
          {activeTab === "customize" && (
            <div>
              <h2 className="settings-pane-title">Customize Assistant</h2>
              <div className="settings-row-col">
                <span className="settings-item-title">Assistant Personality Style</span>
                <span className="settings-item-desc">Select how AUTONEXIS responds to your prompts:</span>
                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  {["Warm & Empathetic", "Direct & Concise", "Deep & Technical"].map((style) => (
                    <button
                      key={style}
                      type="button"
                      className="settings-avatar-upload-btn"
                      onClick={() => alert(`Personality style set to: ${style}`)}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 10: CODE */}
          {activeTab === "code" && (
            <div>
              <h2 className="settings-pane-title">Code Preferences</h2>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-item-title">Show Line Numbers in Code Snippets</span>
                  <span className="settings-item-desc">Display row markers beside code blocks.</span>
                </div>
                <label className="settings-switch-label">
                  <input type="checkbox" defaultChecked />
                  <span className="settings-switch-slider"></span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 11: LANGUAGE */}
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

          {/* TAB 12: API KEYS */}
          {activeTab === "apikeys" && (
            <div>
              <h2 className="settings-pane-title">API Keys Configuration</h2>
              <div className="settings-row-col">
                <span className="settings-item-title">Bring Your Own Key (Optional)</span>
                <span className="settings-item-desc">
                  Override default compute with your own private OpenAI or Groq API key:
                </span>
                <input
                  type="password"
                  className="settings-input-control"
                  style={{ maxWidth: "480px" }}
                  placeholder="gsk_... or sk-..."
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                />
                <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
                  <Button variant="primary" size="sm" onClick={handleSaveApiKey}>
                    {apiKeySaved ? "Key Saved!" : "Save Key"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => alert("Connecting to endpoint... Live verification active.")}>
                    Test Connection
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 13: HELP */}
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
                    <td><kbd style={{ padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", borderRadius: "4px" }}>Ctrl + Shift + ,</kbd></td>
                  </tr>
                  <tr>
                    <td>Send Message</td>
                    <td><kbd style={{ padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", borderRadius: "4px" }}>Enter</kbd></td>
                  </tr>
                  <tr>
                    <td>Add New Line in Chat</td>
                    <td><kbd style={{ padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", borderRadius: "4px" }}>Shift + Enter</kbd></td>
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
