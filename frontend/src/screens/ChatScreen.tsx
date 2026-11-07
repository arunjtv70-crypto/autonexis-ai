import React, { useState, useRef, useEffect } from "react";
import { useChats, type ChatItem, type MessageItem } from "../state/chats";
import { useAuth } from "../state/auth";
import { Logo } from "../components/Logo";
import { SettingsModal } from "../components/SettingsModal";
import { UserMenuDropdown, type SettingsTabId } from "../components/UserMenuDropdown";
import {
  ImageCreationCard,
  VideoCreationCard,
  SpeechAudioButton,
} from "../components/CreationCards";
import {
  IconMenu,
  IconPlus,
  IconSettings,
  IconSearch,
  IconSend,
  IconTrash,
  IconCopy,
  IconCheck,
  IconMic,
  IconMicOff,
  IconVolume,
  IconImage,
  IconVideo,
  IconPaperclip,
  IconFolder,
  IconFileText,
  IconSparkles,
  IconChevronDown,
} from "../components/Icons";
import "./ChatScreen.css";

// Speech Recognition API typings for browser compatibility
interface IWindow extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

export const ChatScreen: React.FC = () => {
  const {
    chats,
    activeChat,
    activeChatId,
    memory,
    selectChat,
    createNewChat,
    deleteChat,
    sendMessage,
    isSending,
  } = useChats();

  const { user, isGuest, setIsAuthScreenVisible, logout } = useAuth();

  // Input & UI States
  const [inputContent, setInputContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("account");
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Creative Studio Mode: "chat" | "image" | "video" | "voice"
  const [inputMode, setInputMode] = useState<"chat" | "image" | "video" | "voice">("chat");
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);

  // Voice Interaction States
  const [isListening, setIsListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const recognitionRef = useRef<any>(null);

  // File Attachment Reference
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Determine user display name: Firebase User account > fallback
  const userName =
    user?.display_name ||
    (user?.email ? user.email.split("@")[0].replace(/[._-]+/g, " ").trim() : (memory.userName || "User"));

  // Global Ctrl+Shift+, Keyboard Shortcut for Settings & Ctrl+Shift+O for New Chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "," || e.key === "<")) {
        e.preventDefault();
        setSettingsTab("account");
        setIsSettingsOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        createNewChat();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [createNewChat]);

  // Setup Web Speech Recognition (STT)
  useEffect(() => {
    const win = window as unknown as IWindow;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-IN"; // Default English/Hindi friendly

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInputContent((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
      } catch {
        recognitionRef.current.stop();
      }
    }
  };

  // Auto-speak response if autoSpeak is enabled
  useEffect(() => {
    if (!autoSpeak || !activeChat || activeChat.messages.length === 0) return;
    const lastMsg = activeChat.messages[activeChat.messages.length - 1];
    if (lastMsg.role === "assistant" && lastMsg.content && !isSending) {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const clean = lastMsg.content.replace(/[*#`_~[\]()]/g, "").slice(0, 400);
        const utter = new SpeechSynthesisUtterance(clean);
        const voices = window.speechSynthesis.getVoices();
        const targetVoice =
          voices.find((v) => v.lang.startsWith("hi")) ||
          voices.find((v) => v.lang.startsWith("en-IN")) ||
          voices.find((v) => v.lang.startsWith("en"));
        if (targetVoice) utter.voice = targetVoice;
        window.speechSynthesis.speak(utter);
      }
    }
  }, [activeChat?.messages.length, isSending, autoSpeak]);

  // Auto scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages, isSending]);

  // Auto grow textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const nextHeight = Math.min(textareaRef.current.scrollHeight, 180);
      textareaRef.current.style.height = `${nextHeight}px`;
    }
  }, [inputContent]);

  const handleSend = async () => {
    if (!inputContent.trim() || isSending) return;
    let textToSend = inputContent.trim();
    if (attachedFileName) {
      textToSend = `[Attached: ${attachedFileName}] ${textToSend}`;
      setAttachedFileName(null);
    }
    setInputContent("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendMessage(textToSend, inputMode);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachedFileName(file.name);
    }
  };

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sidebar content (desktop & mobile)
  const renderSidebarContent = () => (
    <div className="sidebar-inner">
      {/* Brand Header */}
      <div className="sidebar-brand-header">
        <div className="sidebar-brand-left">
          <Logo size="sm" showSubtitle={false} />
        </div>
      </div>

      {/* Action Navigation Buttons */}
      <div className="sidebar-nav-actions">
        <button
          type="button"
          className="sidebar-nav-btn new-chat-highlight"
          onClick={() => {
            createNewChat();
            setIsMobileMenuOpen(false);
          }}
          title="New Chat (Ctrl+Shift+O)"
        >
          <div className="sidebar-nav-btn-left">
            <IconPlus size={16} />
            <span>New Chat</span>
          </div>
          <span className="sidebar-nav-shortcut">Ctrl+Shift+O</span>
        </button>

        <button
          type="button"
          className="sidebar-nav-btn"
          onClick={() => {
            const input = document.querySelector(".search-input") as HTMLInputElement;
            input?.focus();
          }}
        >
          <div className="sidebar-nav-btn-left">
            <IconSearch size={15} />
            <span>Search</span>
          </div>
        </button>

        <button
          type="button"
          className="sidebar-nav-btn"
          onClick={() => {
            setSettingsTab("capabilities");
            setIsSettingsOpen(true);
          }}
        >
          <div className="sidebar-nav-btn-left">
            <IconFolder size={15} />
            <span>Projects</span>
          </div>
        </button>

        <button
          type="button"
          className="sidebar-nav-btn"
          onClick={() => {
            // Pick image creation prompt
            setInputMode("image");
            setInputContent("A futuristic orbital star station above a violet nebula, 8k cinematic");
          }}
        >
          <div className="sidebar-nav-btn-left">
            <IconSparkles size={15} />
            <span>Artifacts</span>
          </div>
        </button>

        <button
          type="button"
          className="sidebar-nav-btn"
          onClick={() => {
            setSettingsTab("your_autonexis");
            setIsSettingsOpen(true);
          }}
        >
          <div className="sidebar-nav-btn-left">
            <IconSettings size={15} />
            <span>Customize</span>
          </div>
        </button>
      </div>

      {/* Search Input Filter */}
      <div className="sidebar-search">
        <IconSearch size={14} className="search-icon" />
        <input
          type="text"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      {/* Recents Section Header */}
      <div className="sidebar-recents-header">
        <span>Recents</span>
      </div>

      {/* Chat Conversations List */}
      <div className="sidebar-chat-list">
        {filteredChats.length === 0 ? (
          <div className="empty-chat-list">
            <span>No conversations found</span>
          </div>
        ) : (
          filteredChats.map((chat: ChatItem) => {
            const isActive = chat.id === activeChatId;
            return (
              <div
                key={chat.id}
                className={`chat-list-item ${isActive ? "active" : ""}`}
                onClick={() => {
                  selectChat(chat.id);
                  setIsMobileMenuOpen(false);
                }}
              >
                <div className="chat-item-text">
                  <IconFileText size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
                  <span className="chat-item-title">{chat.title}</span>
                </div>

                <button
                  type="button"
                  className="chat-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteChat(chat.id);
                  }}
                  aria-label="Delete chat"
                  title="Delete chat"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom User Profile & Settings */}
      <div className="sidebar-bottom">
        <div
          className="user-profile-pill"
          onClick={() => setIsUserMenuOpen((prev) => !prev)}
          title="Account Menu"
        >
          <div className="user-profile-left">
            <div className="user-avatar-circle">
              <img
                src={localStorage.getItem("autonexis_user_avatar") || "/logo_circle.png?v=20261107"}
                alt="User"
                className="user-avatar-img"
              />
            </div>
            <span className="user-name-text">
              {userName} · Free
            </span>
          </div>
          <IconChevronDown size={14} style={{ opacity: 0.7 }} />
        </div>

        <UserMenuDropdown
          isOpen={isUserMenuOpen}
          onClose={() => setIsUserMenuOpen(false)}
          userEmail={user?.email || "Account"}
          onOpenSettings={(tab) => {
            setSettingsTab(tab || "account");
            setIsSettingsOpen(true);
          }}
          onLogout={logout}
        />
      </div>
    </div>
  );

  return (
    <div className="chat-screen-layout">
      {/* Background Subtle Watermark */}
      <div className="chat-watermark" aria-hidden="true">
        AUTONEXIS
      </div>

      {/* Desktop Persistent Sidebar */}
      <aside className="desktop-sidebar">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="mobile-drawer-pane" onClick={(e) => e.stopPropagation()}>
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Main Chat Center Container */}
      <div className="chat-main-container">
        {/* Top Navbar */}
        <header className="chat-topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-trigger"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <IconMenu size={20} />
            </button>
          </div>

          <div className="topbar-center" />

          <div className="topbar-right">
            {/* Auto-Voice Readout (TTS) Toggle */}
            <button
              type="button"
              className={`topbar-action-btn ${autoSpeak ? "auto-speak-active" : ""}`}
              onClick={() => setAutoSpeak((prev) => !prev)}
              aria-label="Toggle voice responses"
              title={autoSpeak ? "Auto-Voice Output: ON" : "Auto-Voice Output: OFF"}
            >
              <IconVolume size={18} />
            </button>

            {/* If in Guest mode, show quick Sign In button */}
            {isGuest && (
              <button
                type="button"
                className="topbar-signin-pill"
                onClick={() => setIsAuthScreenVisible(true)}
              >
                Sign In
              </button>
            )}

            {/* Settings icon button */}
            <button
              type="button"
              className="topbar-action-btn"
              onClick={() => {
                setSettingsTab("account");
                setIsSettingsOpen(true);
              }}
              aria-label="Settings"
              title="Settings (Ctrl+Shift+,)"
            >
              <IconSettings size={18} />
            </button>
          </div>
        </header>

        {/* Scrollable Conversation / Home Area */}
        <main className="chat-conversation-area">
          {!activeChat || activeChat.messages.length === 0 ? (
            /* ==============================================================
               INSPIRATION-ALIGNED HOME SCREEN (AUTONEXIS AESTHETIC)
               ============================================================== */
            <div className="chat-home-container">
              {/* Star Greeting */}
              <div className="home-greeting-section">
                <img
                  src="/logo_icon.png?v=20261107"
                  alt="Orbital Star"
                  className="home-orbital-icon"
                />
                <h1 className="home-greeting-title">
                  Back at it, {userName}
                </h1>
              </div>

              {/* Main Rounded Input Card */}
              <div className="chat-input-card">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={inputContent}
                  onChange={(e) => setInputContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    inputMode === "image"
                      ? "Describe the visual you want to create with AUTONEXIS Image Studio..."
                      : inputMode === "video"
                      ? "Describe the cinematic scene for AUTONEXIS Video Studio..."
                      : "How can I help you today?"
                  }
                  className="chat-input-textarea"
                />

                {attachedFileName && (
                  <div className="attachment-indicator-pill">
                    <IconPaperclip size={12} />
                    <span>{attachedFileName}</span>
                    <button
                      type="button"
                      onClick={() => setAttachedFileName(null)}
                      className="attachment-remove-btn"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <div className="chat-input-card-bottom">
                  <div className="input-toolbar-left">
                    {/* File Attachment Button */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      style={{ display: "none" }}
                    />
                    <button
                      type="button"
                      className="input-tool-icon-btn"
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach file or image"
                      aria-label="Attach file"
                    >
                      <IconPlus size={16} />
                    </button>

                    {/* Mode Selector Dropdown */}
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        className="mode-selector-pill"
                        onClick={() => setIsModeDropdownOpen((prev) => !prev)}
                        title="Select Studio Mode"
                      >
                        {inputMode === "image" && <IconImage size={13} />}
                        {inputMode === "video" && <IconVideo size={13} />}
                        {inputMode === "voice" && <IconMic size={13} />}
                        {inputMode === "chat" && <IconSparkles size={13} />}
                        <span>
                          {inputMode === "image"
                            ? "Image Studio"
                            : inputMode === "video"
                            ? "Video Studio"
                            : inputMode === "voice"
                            ? "Voice Mode"
                            : "Chat"}
                        </span>
                        <IconChevronDown size={11} />
                      </button>

                      {isModeDropdownOpen && (
                        <div className="mode-dropdown-menu">
                          <button
                            type="button"
                            className={`mode-dropdown-item ${inputMode === "chat" ? "active" : ""}`}
                            onClick={() => {
                              setInputMode("chat");
                              setIsModeDropdownOpen(false);
                            }}
                          >
                            <IconSparkles size={14} />
                            <span>Normal Chat</span>
                          </button>
                          <button
                            type="button"
                            className={`mode-dropdown-item ${inputMode === "image" ? "active" : ""}`}
                            onClick={() => {
                              setInputMode("image");
                              setIsModeDropdownOpen(false);
                            }}
                          >
                            <IconImage size={14} />
                            <span>🎨 Image Creation</span>
                          </button>
                          <button
                            type="button"
                            className={`mode-dropdown-item ${inputMode === "video" ? "active" : ""}`}
                            onClick={() => {
                              setInputMode("video");
                              setIsModeDropdownOpen(false);
                            }}
                          >
                            <IconVideo size={14} />
                            <span>🎬 Video Creation</span>
                          </button>
                          <button
                            type="button"
                            className={`mode-dropdown-item ${inputMode === "voice" ? "active" : ""}`}
                            onClick={() => {
                              setInputMode("voice");
                              setIsModeDropdownOpen(false);
                            }}
                          >
                            <IconMic size={14} />
                            <span>🎙️ Voice Mode</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="input-toolbar-right">
                    {/* Speech-to-Text Voice Input Button */}
                    <button
                      type="button"
                      className={`voice-mic-btn ${isListening ? "listening" : ""}`}
                      onClick={toggleListening}
                      title={isListening ? "Stop listening" : "Speak your prompt (STT)"}
                      aria-label="Microphone"
                    >
                      {isListening ? <IconMicOff size={16} /> : <IconMic size={16} />}
                    </button>

                    {/* Send Button */}
                    <button
                      type="button"
                      className="chat-send-btn"
                      disabled={!inputContent.trim() || isSending}
                      onClick={handleSend}
                      aria-label="Send message"
                      title="Send message (Enter)"
                    >
                      <IconSend size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Engine Badge */}
              <div className="home-engine-tag">
                AUTONEXIS Nexus-1 • Ultra • Fast • Multi-Modal
              </div>

              {/* Recent Artifacts & Creations Section */}
              <div className="home-artifacts-section">
                <div className="artifacts-header">
                  <span className="artifacts-title">Recent creations & studio presets</span>
                  <button
                    type="button"
                    className="artifacts-view-all"
                    onClick={() => {
                      setInputMode("image");
                      setInputContent("A futuristic hyper-detailed cosmic portal in 8K");
                    }}
                  >
                    View all
                  </button>
                </div>

                <div className="artifacts-grid">
                  {/* Artifact Card 1: Image Studio Preset */}
                  <div
                    className="artifact-card"
                    onClick={() => {
                      setInputMode("image");
                      setInputContent("Hyper-realistic futuristic neon car speeding on a cyberpunk highway at rain night");
                    }}
                  >
                    <div className="artifact-card-preview">
                      <img
                        src="https://image.pollinations.ai/prompt/cyberpunk%20neon%20car%20night%20highway?width=300&height=180&nologo=true"
                        alt="Cyberpunk"
                        className="artifact-img-preview"
                      />
                    </div>
                    <div className="artifact-card-title">Cyberpunk Speed Machine</div>
                    <div className="artifact-card-time">Image Studio • 1024×768 HD</div>
                  </div>

                  {/* Artifact Card 2: Video Studio Preset */}
                  <div
                    className="artifact-card"
                    onClick={() => {
                      setInputMode("video");
                      setInputContent("Cinematic glowing purple gravitational singularity particle vortex");
                    }}
                  >
                    <div className="artifact-card-preview" style={{ background: "radial-gradient(circle, #581c87 0%, #0c0c0e 80%)" }}>
                      <IconVideo size={28} style={{ color: "#c084fc", opacity: 0.9 }} />
                    </div>
                    <div className="artifact-card-title">Orbital Singularity Loop</div>
                    <div className="artifact-card-time">Video Studio • 4K 60FPS</div>
                  </div>

                  {/* Artifact Card 3: Memory & Assistant Prompt */}
                  <div
                    className="artifact-card"
                    onClick={() => {
                      setInputMode("chat");
                      setInputContent("Give me a strategic overview of our autonomous AI capabilities and project roadmap");
                    }}
                  >
                    <div className="artifact-card-preview">
                      <div className="artifact-doc-preview">
                        <strong>AUTONEXIS Assistant</strong>
                        <p>Self-learning, cross-chat persistent memory, native speech synthesis and studio multi-modal rendering engine.</p>
                      </div>
                    </div>
                    <div className="artifact-card-title">System Architecture Overview</div>
                    <div className="artifact-card-time">Prompt & Knowledge • Just now</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ==============================================================
               CONVERSATION VIEW (ACTIVE CHAT WITH MESSAGES & CREATIONS)
               ============================================================== */
            <div className="chat-scroll-wrapper">
              <div className="message-list">
                {activeChat.messages.map((msg: MessageItem) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`message-row ${isUser ? "user-row" : "assistant-row"}`}
                    >
                      {!isUser && (
                        <div className="assistant-avatar" aria-hidden="true">
                          <img
                            src="/logo_icon.png?v=20261107"
                            alt="AUTONEXIS"
                            className="assistant-avatar-img"
                          />
                        </div>
                      )}

                      <div className={`message-bubble-box ${isUser ? "user-box" : "assistant-box"}`}>
                        {/* 1. Image Studio Card if mediaType is image */}
                        {msg.mediaType === "image" && (
                          <ImageCreationCard
                            prompt={msg.mediaPrompt || msg.content}
                            imageUrl={msg.mediaUrl}
                          />
                        )}

                        {/* 2. Video Studio Card if mediaType is video */}
                        {msg.mediaType === "video" && (
                          <VideoCreationCard
                            prompt={msg.mediaPrompt || msg.content}
                            duration={msg.videoDuration || "00:05"}
                          />
                        )}

                        {/* 3. Text Content */}
                        {msg.content && msg.mediaType !== "image" && msg.mediaType !== "video" && (
                          <div className="message-text-content">
                            {msg.content}
                          </div>
                        )}

                        {/* Assistant Action Buttons: Copy & Speech TTS */}
                        {!isUser && msg.content && (
                          <div className="assistant-message-actions">
                            <button
                              type="button"
                              className="msg-action-btn"
                              onClick={() => handleCopyMessage(msg.id, msg.content)}
                              aria-label="Copy message"
                            >
                              {copiedId === msg.id ? (
                                <>
                                  <IconCheck size={13} />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <IconCopy size={13} />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>

                            {/* Listen via Text-to-Speech (TTS) */}
                            <SpeechAudioButton text={msg.content} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Sending / Generating indicator */}
                {isSending && (
                  <div className="message-row assistant-row">
                    <div className="assistant-avatar">
                      <img
                        src="/logo_icon.png?v=20261107"
                        alt="AUTONEXIS"
                        className="assistant-avatar-img"
                      />
                    </div>
                    <div className="message-bubble-box assistant-box">
                      <div className="typing-dots">
                        <span className="dot"></span>
                        <span className="dot"></span>
                        <span className="dot"></span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </main>

        {/* Bottom Input Zone (Visible when in active conversation) */}
        {activeChat && activeChat.messages.length > 0 && (
          <footer className="conversation-input-bar">
            <div className="chat-input-card">
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputContent}
                onChange={(e) => setInputContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  inputMode === "image"
                    ? "Create an image with AUTONEXIS Image Studio..."
                    : inputMode === "video"
                    ? "Render a cinematic scene with Video Studio..."
                    : "Ask AUTONEXIS Assistant anything... (Enter to send)"
                }
                className="chat-input-textarea"
              />

              {attachedFileName && (
                <div className="attachment-indicator-pill">
                  <IconPaperclip size={12} />
                  <span>{attachedFileName}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedFileName(null)}
                    className="attachment-remove-btn"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className="chat-input-card-bottom">
                <div className="input-toolbar-left">
                  {/* File Attachment */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    className="input-tool-icon-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file"
                    aria-label="Attach file"
                  >
                    <IconPlus size={16} />
                  </button>

                  {/* Mode Selector Pill */}
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="mode-selector-pill"
                      onClick={() => setIsModeDropdownOpen((prev) => !prev)}
                      title="Select Studio Mode"
                    >
                      {inputMode === "image" && <IconImage size={13} />}
                      {inputMode === "video" && <IconVideo size={13} />}
                      {inputMode === "voice" && <IconMic size={13} />}
                      {inputMode === "chat" && <IconSparkles size={13} />}
                      <span>
                        {inputMode === "image"
                          ? "Image Studio"
                          : inputMode === "video"
                          ? "Video Studio"
                          : inputMode === "voice"
                          ? "Voice Mode"
                          : "Chat"}
                      </span>
                      <IconChevronDown size={11} />
                    </button>

                    {isModeDropdownOpen && (
                      <div className="mode-dropdown-menu">
                        <button
                          type="button"
                          className={`mode-dropdown-item ${inputMode === "chat" ? "active" : ""}`}
                          onClick={() => {
                            setInputMode("chat");
                            setIsModeDropdownOpen(false);
                          }}
                        >
                          <IconSparkles size={14} />
                          <span>Normal Chat</span>
                        </button>
                        <button
                          type="button"
                          className={`mode-dropdown-item ${inputMode === "image" ? "active" : ""}`}
                          onClick={() => {
                            setInputMode("image");
                            setIsModeDropdownOpen(false);
                          }}
                        >
                          <IconImage size={14} />
                          <span>🎨 Image Creation</span>
                        </button>
                        <button
                          type="button"
                          className={`mode-dropdown-item ${inputMode === "video" ? "active" : ""}`}
                          onClick={() => {
                            setInputMode("video");
                            setIsModeDropdownOpen(false);
                          }}
                        >
                          <IconVideo size={14} />
                          <span>🎬 Video Creation</span>
                        </button>
                        <button
                          type="button"
                          className={`mode-dropdown-item ${inputMode === "voice" ? "active" : ""}`}
                          onClick={() => {
                            setInputMode("voice");
                            setIsModeDropdownOpen(false);
                          }}
                        >
                          <IconMic size={14} />
                          <span>🎙️ Voice Mode</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="input-toolbar-right">
                  {/* Microphone Speech-to-Text */}
                  <button
                    type="button"
                    className={`voice-mic-btn ${isListening ? "listening" : ""}`}
                    onClick={toggleListening}
                    title={isListening ? "Stop listening" : "Speak prompt (STT)"}
                    aria-label="Microphone"
                  >
                    {isListening ? <IconMicOff size={16} /> : <IconMic size={16} />}
                  </button>

                  {/* Send Button */}
                  <button
                    type="button"
                    className="chat-send-btn"
                    disabled={!inputContent.trim() || isSending}
                    onClick={handleSend}
                    aria-label="Send message"
                    title="Send (Enter)"
                  >
                    <IconSend size={15} />
                  </button>
                </div>
              </div>
            </div>
          </footer>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsTab}
      />
    </div>
  );
};
