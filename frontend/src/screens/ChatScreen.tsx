import React, { useState, useRef, useEffect } from "react";
import { useChats, type ChatItem } from "../state/chats";
import { useAuth } from "../state/auth";
import { Logo } from "../components/Logo";
import { Button } from "../components/Button";
import { Drawer } from "../components/Drawer";
import { SettingsModal } from "../components/SettingsModal";
import {
  IconMenu,
  IconPlus,
  IconSettings,
  IconSearch,
  IconSend,
  IconTrash,
  IconCopy,
  IconCheck,
} from "../components/Icons";
import "./ChatScreen.css";

export const ChatScreen: React.FC = () => {
  const { chats, activeChat, activeChatId, selectChat, createNewChat, deleteChat, sendMessage, isSending } = useChats();
  const { user, isGuest, setIsAuthScreenVisible } = useAuth();

  const [inputContent, setInputContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    const textToSend = inputContent;
    setInputContent("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendMessage(textToSend);
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

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sidebar content (desktop & mobile drawer)
  const renderSidebarContent = () => (
    <div className="sidebar-inner">
      {/* Top action: New Chat Button */}
      <div className="sidebar-top">
        <Button
          variant="outline"
          size="md"
          fullWidth
          onClick={() => {
            createNewChat();
            setIsMobileMenuOpen(false);
          }}
          className="new-chat-btn"
        >
          <IconPlus size={16} />
          <span>New Chat</span>
        </Button>
      </div>

      {/* Search Bar */}
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

      {/* Chat List */}
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
                  <span className="chat-item-title">{chat.title}</span>
                  <span className="chat-item-time">{chat.updated_at}</span>
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
                  <IconTrash size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom User Profile & Settings */}
      <div className="sidebar-bottom">
        <div className="user-profile-pill" onClick={() => setIsSettingsOpen(true)}>
          <div className="user-avatar-circle">
            <img src="/logo_icon.png" alt="User" className="user-avatar-img" />
          </div>
          <div className="user-profile-info">
            <span className="user-name-text">
              {user?.display_name || (isGuest ? "Guest User" : "User")}
            </span>
            <span className="user-status-text">
              {isGuest ? "Guest Mode" : "Online"}
            </span>
          </div>
        </div>

        {isGuest ? (
          <button
            type="button"
            className="sidebar-signin-link"
            onClick={() => setIsAuthScreenVisible(true)}
            title="Sign In / Register"
          >
            Sign In
          </button>
        ) : (
          <button
            type="button"
            className="settings-trigger-btn"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
          >
            <IconSettings size={18} />
          </button>
        )}
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
      <Drawer isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)}>
        {renderSidebarContent()}
      </Drawer>

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
            <Logo size="sm" showSubtitle={true} />
          </div>

          <div className="topbar-right">
            {/* If in Guest mode, show quick Sign In button */}
            {isGuest && (
              <button
                type="button"
                className="topbar-signin-pill"
                onClick={() => setIsAuthScreenVisible(true)}
              >
                Sign In / Sign Up
              </button>
            )}

            {/* New Chat icon button */}
            <button
              type="button"
              className="topbar-action-btn"
              onClick={createNewChat}
              aria-label="Start new chat"
              title="New Chat"
            >
              <IconPlus size={18} />
            </button>

            {/* Settings icon button */}
            <button
              type="button"
              className="topbar-action-btn"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
            >
              <IconSettings size={18} />
            </button>
          </div>
        </header>

        {/* Scrollable Conversation Area */}
        <main className="chat-conversation-area">
          <div className="chat-scroll-wrapper">
            {!activeChat || activeChat.messages.length === 0 ? (
              /* CLEAN EMPTY STATE: OFFICIAL LOGO + START A CHAT */
              <div className="chat-empty-state">
                <Logo size="lg" showSubtitle={true} />
                <p className="empty-state-subtext">
                  Start a Chat
                </p>
              </div>
            ) : (
              /* MESSAGE LIST */
              <div className="message-list">
                {activeChat.messages.map((msg) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`message-row ${isUser ? "user-row" : "assistant-row"}`}
                    >
                      {!isUser && (
                        <div className="assistant-avatar" aria-hidden="true">
                          <img
                            src="/logo_icon.png"
                            alt="AUTONEXIS"
                            className="assistant-avatar-img"
                          />
                        </div>
                      )}

                      <div className={`message-bubble-box ${isUser ? "user-box" : "assistant-box"}`}>
                        <div className="message-text-content">
                          {msg.content}
                        </div>

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
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Sending / Typing indicator */}
                {isSending && (
                  <div className="message-row assistant-row">
                    <div className="assistant-avatar">
                      <img
                        src="/logo_icon.png"
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
            )}
          </div>
        </main>

        {/* Bottom Rounded Input Box */}
        <footer className="chat-bottom-input-zone">
          <div className="input-capsule-box">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputContent}
              onChange={(e) => setInputContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask AUTONEXIS Assistant anything... (Press Enter to send)"
              className="chat-textarea"
            />

            <button
              type="button"
              className="chat-send-btn"
              disabled={!inputContent.trim() || isSending}
              onClick={handleSend}
              aria-label="Send message"
              title="Send"
            >
              <IconSend size={16} />
            </button>
          </div>

          <div className="bottom-disclaimer">
            <span>AUTONEXIS Assistant • Thoughtful, quiet and private AI</span>
          </div>
        </footer>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};
