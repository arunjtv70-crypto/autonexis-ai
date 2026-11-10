import React, { useState, useRef, useEffect } from "react";
import {
  useChats,
  type ChatItem,
  type MessageItem,
  type AttachmentPayload,
  type ChatSearchResult,
} from "../state/chats";
import { useAuth } from "../state/auth";
import { usePwa } from "../state/pwa";
import { Logo } from "../components/Logo";
import { SettingsModal } from "../components/SettingsModal";
import { ProjectModal } from "../components/ProjectModal";
import { PwaInstallModal } from "../components/PwaInstallModal";
import { UserMenuDropdown, type SettingsTabId, type SettingsSubView } from "../components/UserMenuDropdown";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { translate } from "../i18n/translations";
import type { FirestoreProject } from "../db";
import {
  isImageFile,
  isTextFile,
  isPdfFile,
  compressImagesBatch,
  readTextFile,
  extractPdfText,
  formatFileSize,
} from "../utils/fileHelpers";
import {
  ImageCreationCard,
  VideoCreationCard,
  SpeechAudioButton,
  speakTextWithPreferences,
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
  IconFolder,
  IconFileText,
  IconSparkles,
  IconChevronDown,
  IconShield,
  IconGlobe,
  IconBrain,
  IconPaperclip,
  IconPin,
  IconArchive,
  IconEdit,
  IconThumbsUp,
  IconThumbsDown,
  IconSmartphone,
  IconMoreHorizontal,
} from "../components/Icons";
import "./ChatScreen.css";

// Speech Recognition API typings for browser compatibility
interface IWindow extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

const VALID_SETTINGS_SECTIONS = new Set<SettingsTabId>([
  "account",
  "appearance",
  "personalization",
  "capabilities",
  "notifications",
  "privacy",
  "wellbeing",
  "customize",
  "language",
  "help",
  "about",
]);

function parseSettingsPath(
  pathname: string
): { tab: SettingsTabId; subView: SettingsSubView } | null {
  const clean = (pathname || "").replace(/\/+$/, "");
  if (clean === "/settings") {
    return { tab: "account", subView: "main" };
  }
  if (!clean.startsWith("/settings/")) return null;
  const parts = clean.slice("/settings/".length).split("/").filter(Boolean);
  const rawTab = parts[0] as SettingsTabId;
  if (!VALID_SETTINGS_SECTIONS.has(rawTab)) return null;
  const rawSub = (parts[1] || "main") as SettingsSubView;
  const validSub: SettingsSubView =
    rawSub === "terms" ||
    rawSub === "privacy" ||
    rawSub === "shortcuts" ||
    rawSub === "support-resources"
      ? rawSub
      : "main";
  return { tab: rawTab, subView: validSub };
}

export const ChatScreen: React.FC = () => {
  const {
    chats,
    activeChat,
    activeChatId,
    memory,
    preferences,
    projects,
    activeProjectId,
    setActiveProjectId,
    togglePinChat,
    toggleArchiveChat,
    searchMessagesInChats,
    moveChatToProject,
    feedbackByMessage,
    submitFeedback,
    editAndResendLastMessage,
    isTemporaryChat,
    startTemporaryChat,
    exitTemporaryChat,
    isWebSearchActive,
    setIsWebSearchActive,
    lastExtractedMemory,
    undoLastMemory,
    clearLastExtractedMemory,
    selectChat,
    createNewChat,
    deleteChat,
    renameChat,
    sendMessage,
    isSending,
    guestMessagesRemaining,
    showGuestLimitModal,
    setShowGuestLimitModal,
    loadMoreChats,
    hasMoreChats,
    firestoreError,
  } = useChats();

  const { user, firebaseUser, isGuest, setIsAuthScreenVisible, logout } = useAuth();
  const {
    isStandalone,
    isInstalled,
    canPromptInstall,
    isInstallSupported,
    triggerInstall,
    shouldShowPostLoginBanner,
    dismissPostLoginBanner,
    markBannerShownNow,
  } = usePwa();

  const t = (key: string) => translate(key, preferences.interfaceLanguage);

  const initialRoute =
    typeof window !== "undefined" ? parseSettingsPath(window.location.pathname) : null;

  // Input & UI States
  const [inputContent, setInputContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSearchResult[] | null>(null);
  const [isSearchingMessages, setIsSearchingMessages] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(!!initialRoute);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(initialRoute?.tab || "account");
  const [settingsSubView, setSettingsSubView] = useState<SettingsSubView>(
    initialRoute?.subView || "main"
  );
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Wellbeing break reminder tracking
  const [showBreakReminder, setShowBreakReminder] = useState(false);
  const activeSessionMsRef = useRef<number>(0);

  // Sidebar Pin / Archive / Chat Actions / Projects States
  const [showArchivedSection, setShowArchivedSection] = useState(false);
  const [openChatMenuId, setOpenChatMenuId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameInputVal, setRenameInputVal] = useState("");
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<FirestoreProject | null>(null);

  // Feedback & Message Editing States
  const [feedbackPopoverMsgId, setFeedbackPopoverMsgId] = useState<string | null>(null);
  const [feedbackReason, setFeedbackReason] = useState("Wrong answer");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editMsgContent, setEditMsgContent] = useState("");

  // Attachment & Tool Menus
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isHomeAttachmentMenuOpen, setIsHomeAttachmentMenuOpen] = useState(false);

  // Creative Studio Mode: "chat" | "image" | "video" | "voice"
  const [inputMode, setInputMode] = useState<"chat" | "image" | "video" | "voice">("chat");
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);

  // Voice Interaction States
  const [isListening, setIsListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const recognitionRef = useRef<any>(null);

  // File & Image Attachment States (supports up to 4 images, PDF & text files)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachedImages, setAttachedImages] = useState<Array<{ dataUrl: string; fileName: string }>>([]);
  const [attachedFile, setAttachedFile] = useState<{
    textContent: string;
    fileName: string;
    fileSize?: number;
    isPdf?: boolean;
    truncationNote?: string;
  } | null>(null);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // Auto-scroll & Dynamic Viewport Tracking
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Determine user display name: preference override > Firebase User > fallback
  const userName =
    preferences.displayName ||
    user?.display_name ||
    (user?.email ? user.email.split("@")[0].replace(/[._-]+/g, " ").trim() : (memory.userName || "User"));

  const openSettingsAt = (tab: SettingsTabId = "account", subView: SettingsSubView = "main") => {
    setSettingsTab(tab);
    setSettingsSubView(subView);
    setIsSettingsOpen(true);
    setIsMobileMenuOpen(false);
    setIsUserMenuOpen(false);
    try {
      const nextPath = `/settings/${tab}${subView !== "main" ? `/${subView}` : ""}`;
      if (window.location.pathname !== nextPath) {
        window.history.pushState(null, "", nextPath);
      }
    } catch {}
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    try {
      if (window.location.pathname.startsWith("/settings")) {
        window.history.pushState(null, "", "/");
      }
    } catch {}
  };

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseSettingsPath(window.location.pathname);
      if (parsed) {
        setSettingsTab(parsed.tab);
        setSettingsSubView(parsed.subView);
        setIsSettingsOpen(true);
      } else {
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Wellbeing break reminder active timer (only counts while tab is visible)
  useEffect(() => {
    if (!preferences.breakReminderEnabled) {
      activeSessionMsRef.current = 0;
      setShowBreakReminder(false);
      return;
    }
    const thresholdMs = (preferences.breakReminderMinutes || 60) * 60 * 1000;
    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      activeSessionMsRef.current += 60_000;
      if (activeSessionMsRef.current >= thresholdMs) {
        setShowBreakReminder(true);
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [preferences.breakReminderEnabled, preferences.breakReminderMinutes]);

  const showInstallBanner = shouldShowPostLoginBanner(!!user && !isGuest, isGuest);
  useEffect(() => {
    if (showInstallBanner) {
      markBannerShownNow();
    }
  }, [showInstallBanner, markBannerShownNow]);

  // Debounced deep message search (runs after pause in typing; Enter also triggers immediately)
  useEffect(() => {
    const trimmedQ = searchQuery.trim();
    if (!trimmedQ) {
      setSearchResults(null);
      setIsSearchingMessages(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchingMessages(true);
      try {
        const res = await searchMessagesInChats(trimmedQ);
        setSearchResults(res);
      } finally {
        setIsSearchingMessages(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMessagesInChats]);

  const handleSearchEnter = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      e.preventDefault();
      setIsSearchingMessages(true);
      try {
        const res = await searchMessagesInChats(searchQuery.trim());
        setSearchResults(res);
      } finally {
        setIsSearchingMessages(false);
      }
    }
  };

  // Global Shortcuts: Ctrl+K (Search), Ctrl+Shift+, (Settings), Ctrl+Shift+O (New Chat), Esc (Close dialogs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (window.innerWidth <= 768) {
          setIsMobileMenuOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 40);
        } else {
          searchInputRef.current?.focus();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "," || e.key === "<")) {
        e.preventDefault();
        setIsSettingsOpen((prev) => {
          if (prev) {
            try {
              if (window.location.pathname.startsWith("/settings")) {
                window.history.pushState(null, "", "/");
              }
            } catch {}
            return false;
          }
          setSettingsTab("account");
          setSettingsSubView("main");
          try {
            if (window.location.pathname !== "/settings/account") {
              window.history.pushState(null, "", "/settings/account");
            }
          } catch {}
          return true;
        });
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        createNewChat();
      } else if (e.key === "Escape") {
        closeSettings();
        setIsProjectModalOpen(false);
        setIsMobileMenuOpen(false);
        setIsUserMenuOpen(false);
        setOpenChatMenuId(null);
        setIsAttachmentMenuOpen(false);
        setIsHomeAttachmentMenuOpen(false);
        setIsModeDropdownOpen(false);
        setFeedbackPopoverMsgId(null);
        setEditingMsgId(null);
        setRenamingChatId(null);
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
      recognition.lang = preferences.micLanguage || "en-IN";

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep speech recognition language synced with user preferences
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = preferences.micLanguage || "en-IN";
    }
  }, [preferences.micLanguage]);

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
        recognitionRef.current.lang = preferences.micLanguage || "en-IN";
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
      speakTextWithPreferences(lastMsg.content.slice(0, 400), {
        voiceName: preferences.voiceName,
        voiceSpeed: preferences.voiceSpeed,
        voiceLanguage: preferences.voiceLanguage,
      });
    }
  }, [activeChat?.messages.length, isSending, autoSpeak, preferences.voiceName, preferences.voiceSpeed, preferences.voiceLanguage]);

  // Track scroll position to know when user intentionally scrolled up
  const handleScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom > 75) {
      userScrolledUpRef.current = true;
      setShowScrollToBottom(true);
    } else {
      userScrolledUpRef.current = false;
      setShowScrollToBottom(false);
    }
  };

  const scrollToBottom = () => {
    userScrolledUpRef.current = false;
    setShowScrollToBottom(false);
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  };

  // Auto-scroll on incoming stream updates (respects autoScroll preference)
  useEffect(() => {
    if (preferences.autoScroll === false) return;
    if (!userScrolledUpRef.current && chatScrollRef.current) {
      requestAnimationFrame(() => {
        if (chatScrollRef.current && !userScrolledUpRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
      });
    }
  }, [activeChat?.messages, isSending, preferences.autoScroll]);

  // Auto grow textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const nextHeight = Math.min(textareaRef.current.scrollHeight, 180);
      textareaRef.current.style.height = `${nextHeight}px`;
    }
  }, [inputContent]);

  const handleSend = async () => {
    if ((!inputContent.trim() && attachedImages.length === 0 && !attachedFile) || isSending || isProcessingFile) return;

    if (isGuest && guestMessagesRemaining <= 0) {
      setShowGuestLimitModal(true);
      return;
    }

    const textToSend = inputContent.trim();
    const curImages = attachedImages;
    const curFile = attachedFile;

    setInputContent("");
    setAttachedImages([]);
    setAttachedFile(null);
    setFileUploadError(null);

    // Re-engage auto-follow on sending
    userScrolledUpRef.current = false;
    setShowScrollToBottom(false);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    let attachmentPayload: AttachmentPayload | null = null;
    if (curImages.length > 0) {
      attachmentPayload = {
        type: "image",
        dataUrl: curImages[0].dataUrl,
        fileName: curImages[0].fileName,
        images: curImages,
      };
    } else if (curFile) {
      attachmentPayload = {
        type: "file",
        textContent: curFile.textContent,
        fileName: curFile.fileName,
        fileSize: curFile.fileSize,
        isPdf: curFile.isPdf,
        truncationNote: curFile.truncationNote,
      };
    }

    await sendMessage(textToSend, inputMode, attachmentPayload);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const enterSends = preferences.enterToSend !== false;
    if (enterSends) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    } else {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    if (isGuest) {
      setShowGuestLimitModal(true);
      e.target.value = "";
      return;
    }

    try {
      setIsProcessingFile(true);
      setFileUploadError(null);
      const files = Array.from(fileList);
      const imageFiles = files.filter(isImageFile);
      const pdfFiles = files.filter(isPdfFile);
      const textFiles = files.filter(isTextFile);

      if (imageFiles.length > 0) {
        const remainingSlots = Math.max(0, 4 - attachedImages.length);
        if (remainingSlots === 0) {
          setFileUploadError("You can attach up to 4 images per message.");
          return;
        }
        const toProcess = imageFiles.slice(0, remainingSlots);
        const result = await compressImagesBatch(toProcess);
        if (result.error) {
          setFileUploadError(result.error);
        } else {
          setAttachedImages((prev) => [...prev, ...result.images].slice(0, 4));
          setAttachedFile(null);
        }
      } else if (pdfFiles.length > 0) {
        const pdfFile = pdfFiles[0];
        const res = await extractPdfText(pdfFile, 20, 30000);
        if (res.isScanned) {
          setFileUploadError(
            `"${pdfFile.name}" has no selectable text (looks like a scanned PDF). Please take screenshots or export the pages as images and attach them instead.`
          );
          return;
        }
        setAttachedFile({
          textContent: res.text,
          fileName: pdfFile.name,
          fileSize: pdfFile.size,
          isPdf: true,
          truncationNote: res.truncationNote,
        });
        setAttachedImages([]);
      } else if (textFiles.length > 0) {
        const tf = textFiles[0];
        const rawText = await readTextFile(tf);
        const truncated = rawText.length > 30000;
        setAttachedFile({
          textContent: truncated ? rawText.slice(0, 30000) : rawText,
          fileName: tf.name,
          fileSize: tf.size,
          isPdf: false,
          truncationNote: truncated
            ? "Note: Only the first 30,000 characters were loaded to fit context limits."
            : undefined,
        });
        setAttachedImages([]);
      } else {
        setFileUploadError("Unsupported file format. Attach images, PDF, or text/code files.");
      }
    } catch (err) {
      console.error("[AUTONEXIS] Attachment processing error:", err);
      setFileUploadError("Unable to read this file. Please try a smaller or text-based file.");
    } finally {
      setIsProcessingFile(false);
      e.target.value = "";
    }
  };

  const trimmedSearch = searchQuery.trim().toLowerCase();
  const baseChats = chats.filter((c) => {
    if (trimmedSearch && !c.title.toLowerCase().includes(trimmedSearch)) return false;
    if (activeProjectId && c.projectId !== activeProjectId) return false;
    return true;
  });

  const pinnedChats = baseChats.filter((c) => c.pinned && !c.archived);
  const recentChats = baseChats.filter((c) => !c.pinned && !c.archived);
  const archivedChats = chats.filter(
    (c) => c.archived && (!trimmedSearch || c.title.toLowerCase().includes(trimmedSearch))
  );

  const renderChatRow = (chat: ChatItem) => {
    const isActive = chat.id === activeChatId;
    const isMenuOpen = openChatMenuId === chat.id;
    const isRenaming = renamingChatId === chat.id;
    const proj = chat.projectId ? projects.find((p) => p.id === chat.projectId) : null;

    return (
      <div
        key={chat.id}
        className={`chat-list-item ${isActive ? "active" : ""}`}
        style={{ position: "relative" }}
        onClick={() => {
          if (!isRenaming) {
            selectChat(chat.id);
            setOpenChatMenuId(null);
            setIsMobileMenuOpen(false);
          }
        }}
      >
        {isRenaming ? (
          <div
            style={{ display: "flex", gap: "4px", width: "100%", alignItems: "center" }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              className="chat-rename-input"
              value={renameInputVal}
              autoFocus
              onChange={(e) => setRenameInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameChat(chat.id, renameInputVal);
                  setRenamingChatId(null);
                } else if (e.key === "Escape") {
                  setRenamingChatId(null);
                }
              }}
              onBlur={() => {
                if (renameInputVal.trim()) renameChat(chat.id, renameInputVal);
                setRenamingChatId(null);
              }}
            />
          </div>
        ) : (
          <>
            <div className="chat-item-text">
              {chat.pinned ? (
                <IconPin size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
              ) : (
                <IconFileText size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
              )}
              <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
                <span className="chat-item-title">{chat.title}</span>
                {proj && !activeProjectId && (
                  <span style={{ fontSize: "0.66rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {proj.name}
                  </span>
                )}
              </div>
            </div>

            <div className="chat-item-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="chat-menu-trigger-btn"
                onClick={() => setOpenChatMenuId(isMenuOpen ? null : chat.id)}
                aria-label="Chat options"
                title="Chat options"
              >
                <IconMoreHorizontal size={14} />
              </button>
            </div>

            {isMenuOpen && (
              <div
                className="chat-item-context-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="chat-context-menu-btn"
                  onClick={() => {
                    togglePinChat(chat.id);
                    setOpenChatMenuId(null);
                  }}
                >
                  <IconPin size={13} />
                  <span>{chat.pinned ? "Unpin chat" : "Pin chat"}</span>
                </button>
                <button
                  type="button"
                  className="chat-context-menu-btn"
                  onClick={() => {
                    setRenameInputVal(chat.title);
                    setRenamingChatId(chat.id);
                    setOpenChatMenuId(null);
                  }}
                >
                  <IconEdit size={13} />
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  className="chat-context-menu-btn"
                  onClick={() => {
                    toggleArchiveChat(chat.id);
                    setOpenChatMenuId(null);
                  }}
                >
                  <IconArchive size={13} />
                  <span>{chat.archived ? "Unarchive" : "Archive"}</span>
                </button>

                {projects.length > 0 && (
                  <div className="chat-context-menu-project-group">
                    <span className="chat-context-menu-sublabel">Project:</span>
                    <select
                      className="chat-context-project-select"
                      value={chat.projectId || ""}
                      onChange={(e) => {
                        moveChatToProject(chat.id, e.target.value || null);
                        setOpenChatMenuId(null);
                      }}
                    >
                      <option value="">None (Main List)</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  type="button"
                  className="chat-context-menu-btn danger"
                  onClick={() => {
                    deleteChat(chat.id);
                    setOpenChatMenuId(null);
                  }}
                >
                  <IconTrash size={13} />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

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
            createNewChat(activeProjectId);
            setIsMobileMenuOpen(false);
          }}
          title="New Chat (Ctrl+Shift+O)"
        >
          <div className="sidebar-nav-btn-left">
            <IconPlus size={16} />
            <span>{t("newChat")}</span>
          </div>
          <span className="sidebar-nav-shortcut">Ctrl+Shift+O</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-btn ${isTemporaryChat ? "active" : ""}`}
          onClick={() => {
            startTemporaryChat();
            setIsMobileMenuOpen(false);
          }}
          title="Temporary Chat (Conversations & memory are paused)"
        >
          <div className="sidebar-nav-btn-left">
            <IconShield size={16} />
            <span>{t("temporaryChat")}</span>
          </div>
        </button>

        <button
          type="button"
          className="sidebar-nav-btn"
          onClick={() => openSettingsAt("account", "main")}
        >
          <div className="sidebar-nav-btn-left">
            <IconSettings size={15} />
            <span>{t("settings")}</span>
          </div>
        </button>
      </div>

      {/* Search Input Filter (Ctrl+K) */}
      <div className="sidebar-search">
        <IconSearch size={14} className="search-icon" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder={t("searchChats")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchEnter}
          className="search-input"
        />
        {searchQuery && (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => {
              setSearchQuery("");
              setSearchResults(null);
            }}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Deep Message Search Results Dropdown / Panel */}
      {searchQuery.trim() && (
        <div className="sidebar-search-results">
          {isSearchingMessages ? (
            <div className="search-loading-note">Searching recent messages...</div>
          ) : searchResults && searchResults.length > 0 ? (
            <>
              <div className="sidebar-recents-header" style={{ paddingLeft: "4px" }}>
                <span>Matches ({searchResults.length})</span>
              </div>
              {searchResults.map((res) => (
                <button
                  key={res.chatId}
                  type="button"
                  className="search-result-card"
                  onClick={() => {
                    selectChat(res.chatId);
                    setSearchQuery("");
                    setSearchResults(null);
                    setIsMobileMenuOpen(false);
                  }}
                >
                  <span className="search-result-title">{res.chatTitle}</span>
                  <span className="search-result-snippet">{res.snippet}</span>
                </button>
              ))}
            </>
          ) : (
            <div className="search-loading-note">No matching messages found</div>
          )}
        </div>
      )}

      {/* Projects Section (Authenticated Users) */}
      {!isGuest && (
        <div className="sidebar-projects-section">
          <div className="sidebar-recents-header" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
            <span>Projects</span>
            <button
              type="button"
              className="sidebar-project-add-btn"
              onClick={() => {
                setEditingProject(null);
                setIsProjectModalOpen(true);
              }}
              title="Create Project"
            >
              <IconPlus size={12} /> New
            </button>
          </div>
          {projects.length === 0 ? (
            <div className="sidebar-project-empty">
              <span>Organize files & instructions into projects</span>
            </div>
          ) : (
            <div className="sidebar-project-list">
              {projects.map((p) => {
                const isProjSelected = activeProjectId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`sidebar-project-item ${isProjSelected ? "active" : ""}`}
                    onClick={() => setActiveProjectId(isProjSelected ? null : p.id)}
                  >
                    <div className="chat-item-text">
                      <IconFolder size={13} style={{ color: isProjSelected ? "var(--accent)" : undefined, flexShrink: 0 }} />
                      <span className="chat-item-title">{p.name}</span>
                    </div>
                    <button
                      type="button"
                      className="project-manage-icon-btn"
                      title="Manage project files & instructions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProject(p);
                        setIsProjectModalOpen(true);
                      }}
                    >
                      <IconEdit size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Project Filter Notice */}
      {activeProjectId && (
        <div className="sidebar-project-filter-banner">
          <span>
            Project: {projects.find((p) => p.id === activeProjectId)?.name || "Filtered"}
          </span>
          <button type="button" onClick={() => setActiveProjectId(null)}>
            Show all
          </button>
        </div>
      )}

      {/* Chat Conversations List */}
      <div className="sidebar-chat-list">
        {pinnedChats.length > 0 && (
          <>
            <div className="sidebar-recents-header">
              <span>{t("pinned")}</span>
            </div>
            {pinnedChats.map(renderChatRow)}
          </>
        )}

        <div className="sidebar-recents-header">
          <span>{t("recents")}</span>
        </div>

        {recentChats.length === 0 && pinnedChats.length === 0 ? (
          <div className="empty-chat-list">
            <span>{t("noConversations")}</span>
          </div>
        ) : (
          recentChats.map(renderChatRow)
        )}

        {hasMoreChats && !activeProjectId && (
          <button
            type="button"
            className="sidebar-load-more-btn"
            onClick={loadMoreChats}
            style={{
              width: "100%",
              padding: "8px 12px",
              marginTop: "6px",
              background: "transparent",
              border: "1px dashed var(--border-subtle, rgba(255, 255, 255, 0.15))",
              borderRadius: "8px",
              color: "var(--text-secondary, #94a3b8)",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            {t("loadMoreChats")}
          </button>
        )}

        {/* Archived Chats Collapsible Section */}
        {archivedChats.length > 0 && (
          <div style={{ marginTop: "10px" }}>
            <button
              type="button"
              className="sidebar-archived-toggle"
              onClick={() => setShowArchivedSection((prev) => !prev)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <IconArchive size={13} />
                <span>{t("archived")} ({archivedChats.length})</span>
              </div>
              <IconChevronDown
                size={13}
                style={{ transform: showArchivedSection ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
              />
            </button>
            {showArchivedSection && archivedChats.map(renderChatRow)}
          </div>
        )}
      </div>

      {/* Bottom User Profile & Account Menu Trigger */}
      <div className="sidebar-bottom">
        <div
          role="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-expanded={isUserMenuOpen}
          className="user-profile-pill"
          onClick={() => setIsUserMenuOpen((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsUserMenuOpen((prev) => !prev);
            }
          }}
          title="Account Menu"
        >
          <div className="user-profile-left">
            <div className="user-avatar-circle">
              <img
                src={firebaseUser?.photoURL || "/logo_circle.png?v=20261107"}
                alt="User"
                className="user-avatar-img"
              />
            </div>
            <span className="user-name-text">
              {userName}
              {isGuest ? ` · ${t("guestMode")}` : ""}
            </span>
          </div>
          <IconChevronDown size={14} style={{ opacity: 0.7 }} />
        </div>

        <UserMenuDropdown
          isOpen={isUserMenuOpen}
          onClose={() => setIsUserMenuOpen(false)}
          userName={userName}
          userEmail={user?.email || (isGuest ? "Guest session" : "Signed in")}
          interfaceLanguage={preferences.interfaceLanguage || "English"}
          showInstallOption={!isStandalone && !isInstalled && (isInstallSupported || canPromptInstall)}
          onInstallPwa={() => triggerInstall()}
          onOpenSettings={(tab, sub) => openSettingsAt(tab || "account", sub || "main")}
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

            {/* If in Guest mode, show remaining messages pill and sign in */}
            {isGuest && (
              <div className="guest-counter-pill" title="Free guest messages remaining">
                <span>Guest ({guestMessagesRemaining} left)</span>
              </div>
            )}

            {isGuest && (
              <button
                type="button"
                className="topbar-signin-pill"
                onClick={() => setIsAuthScreenVisible(true)}
              >
                {t("signIn")}
              </button>
            )}

            {/* Settings icon button */}
            <button
              type="button"
              className="topbar-action-btn"
              onClick={() => openSettingsAt("account", "main")}
              aria-label={t("settings")}
              title={`${t("settings")} (Ctrl+Shift+,)`}
            >
              <IconSettings size={18} />
            </button>
          </div>
        </header>

        {/* Temporary Chat Mode Banner */}
        {isTemporaryChat && (
          <div className="temporary-chat-banner" role="alert">
            <div className="temporary-chat-banner-left">
              <IconShield size={15} />
              <span>{t("tempBannerText")}</span>
            </div>
            <button
              type="button"
              className="temporary-chat-exit-btn"
              onClick={exitTemporaryChat}
            >
              {t("exit")}
            </button>
          </div>
        )}

        {/* Calm Dismissible Wellbeing Break Reminder Pill */}
        {showBreakReminder && (
          <div className="wellbeing-break-pill" role="status">
            <span>{t("breakReminderText")}</span>
            <div className="wellbeing-break-actions">
              <button
                type="button"
                className="wellbeing-break-link"
                onClick={() => openSettingsAt("wellbeing", "main")}
              >
                {t("secWellbeing")}
              </button>
              <button
                type="button"
                className="wellbeing-break-dismiss"
                onClick={() => {
                  activeSessionMsRef.current = 0;
                  setShowBreakReminder(false);
                }}
              >
                {t("dismiss")}
              </button>
            </div>
          </div>
        )}

        {/* Active Project Banner */}
        {activeChat?.projectId && (() => {
          const activeProj = projects.find((p) => p.id === activeChat.projectId);
          if (!activeProj) return null;
          return (
            <div className="active-project-topbar-pill">
              <div className="active-project-topbar-left">
                <IconFolder size={14} style={{ color: "var(--accent)" }} />
                <span>
                  Project: <strong>{activeProj.name}</strong>
                </span>
              </div>
              <button
                type="button"
                className="active-project-topbar-btn"
                onClick={() => {
                  setEditingProject(activeProj);
                  setIsProjectModalOpen(true);
                }}
              >
                Files &amp; Instructions
              </button>
            </div>
          );
        })()}

        {/* Post-login Subtle Dismissible PWA Install Banner (never shown to guests, at most once/week) */}
        {showInstallBanner && (
          <div className="pwa-install-banner" role="region" aria-label="Install app">
            <div className="pwa-install-banner-left">
              <IconSmartphone size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <span>
                Install the app for faster access
                {!isInstallSupported && " — Open this site in Chrome or Safari to install it"}
              </span>
            </div>
            <div className="pwa-install-banner-actions">
              {isInstallSupported && (
                <button
                  type="button"
                  className="pwa-banner-install-btn"
                  onClick={() => {
                    triggerInstall();
                    dismissPostLoginBanner();
                  }}
                >
                  Install AUTONEXIS Assistant
                </button>
              )}
              <button
                type="button"
                className="pwa-banner-dismiss-btn"
                onClick={dismissPostLoginBanner}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Hidden File Input for Image, PDF & Code Uploads */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          multiple
          accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.sql,.sh,.yaml,.yml,.env,.log"
          style={{ display: "none" }}
        />

        {/* Scrollable Conversation / Home Area */}
        <main
          className="chat-conversation-area"
          ref={chatScrollRef}
          onScroll={handleScroll}
        >
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
                  {t("backAtIt")}, {userName}
                </h1>
              </div>

              {firestoreError && (
                <div
                  style={{
                    padding: "6px 14px",
                    fontSize: "0.78rem",
                    backgroundColor: "rgba(234, 179, 8, 0.12)",
                    color: "var(--text-secondary, #eab308)",
                    borderRadius: "6px",
                    textAlign: "center",
                    marginBottom: "10px",
                  }}
                >
                  {firestoreError}
                </div>
              )}

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
                      : preferences.enterToSend === false
                      ? t("askAnythingCtrlEnter")
                      : t("howCanIHelp")
                  }
                  className="chat-input-textarea"
                />

                {/* Attached Images Thumbnails Preview (up to 4 images) */}
                {attachedImages.length > 0 && (
                  <div className="attached-images-preview-row">
                    {attachedImages.map((img, idx) => (
                      <div key={idx} className="attachment-indicator-pill attached-image-indicator">
                        <img src={img.dataUrl} alt={`Thumbnail ${idx + 1}`} className="input-thumb-preview" />
                        <span className="attachment-filename">{img.fileName}</span>
                        <button
                          type="button"
                          onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                          className="attachment-remove-btn"
                          aria-label={`Remove image ${idx + 1}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {attachedImages.length < 4 && (
                      <button
                        type="button"
                        className="add-more-images-btn"
                        onClick={() => fileInputRef.current?.click()}
                        title="Add another image (up to 4)"
                      >
                        <IconPlus size={12} />
                        <span>Add ({attachedImages.length}/4)</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Attached PDF/Text/Code File Preview */}
                {attachedFile && (
                  <div className="attached-file-chip-wrapper">
                    <div className="attachment-indicator-pill">
                      <IconFileText size={13} />
                      <span className="attachment-filename">{attachedFile.fileName}</span>
                      {attachedFile.fileSize ? (
                        <span className="attachment-filesize">
                          ({formatFileSize(attachedFile.fileSize)})
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setAttachedFile(null)}
                        className="attachment-remove-btn"
                        aria-label="Remove file"
                      >
                        ✕
                      </button>
                    </div>
                    {attachedFile.truncationNote && (
                      <div className="attachment-truncation-note">
                        {attachedFile.truncationNote}
                      </div>
                    )}
                  </div>
                )}

                {fileUploadError && (
                  <div className="attachment-error-note">
                    <span>{fileUploadError}</span>
                    <button type="button" onClick={() => setFileUploadError(null)}>✕</button>
                  </div>
                )}

                {isProcessingFile && (
                  <div className="attachment-indicator-pill">
                    <span className="attachment-filename">Reading attachment...</span>
                  </div>
                )}

                <div className="chat-input-card-bottom">
                  <div className="input-toolbar-left">
                    {/* Attachment & Tools Dropdown Button */}
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        className="input-tool-icon-btn"
                        onClick={() => setIsHomeAttachmentMenuOpen((prev) => !prev)}
                        title="Add attachments or tools"
                        aria-label="Add attachments or tools"
                      >
                        <IconPlus size={16} />
                      </button>

                      {isHomeAttachmentMenuOpen && (
                        <div className="attachment-dropdown-menu">
                          <button
                            type="button"
                            className="attachment-dropdown-item"
                            onClick={() => {
                              setIsHomeAttachmentMenuOpen(false);
                              if (isGuest) {
                                setShowGuestLimitModal(true);
                                return;
                              }
                              fileInputRef.current?.click();
                            }}
                          >
                            <IconPaperclip size={14} />
                            <span>Attach image, PDF or file</span>
                          </button>

                          <button
                            type="button"
                            className={`attachment-dropdown-item ${isWebSearchActive ? "active" : ""}`}
                            onClick={() => {
                              if (isGuest) {
                                setShowGuestLimitModal(true);
                                return;
                              }
                              setIsWebSearchActive(!isWebSearchActive);
                              setIsHomeAttachmentMenuOpen(false);
                            }}
                          >
                            <IconGlobe size={14} />
                            <span>Web Search ({isWebSearchActive ? "ON" : "OFF"})</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Active Web Search Indicator Pill */}
                    {isWebSearchActive && (
                      <div className="active-websearch-pill" title="Web search active for this chat">
                        <IconGlobe size={12} />
                        <span>Web Search</span>
                      </div>
                    )}

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
                      disabled={(!inputContent.trim() && attachedImages.length === 0 && !attachedFile) || isSending || isProcessingFile}
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
                {t("engineTag")}
              </div>

              {/* Recent Artifacts & Starter Creations Section */}
              {preferences.showStarterPrompts !== false && (
                <div className="home-artifacts-section">
                  <div className="artifacts-header">
                    <span className="artifacts-title">{t("recentCreations")}</span>
                    <button
                      type="button"
                      className="artifacts-view-all"
                      onClick={() => {
                        setInputMode("image");
                        setInputContent("A futuristic hyper-detailed cosmic portal in 8K");
                      }}
                    >
                      {t("viewAll")}
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
              )}
            </div>
          ) : (
            /* ==============================================================
               CONVERSATION VIEW (ACTIVE CHAT WITH MESSAGES & CREATIONS)
               ============================================================== */
            <div className="chat-scroll-wrapper">
              <div className="message-list">
                {(() => {
                  const lastUserMsgId = [...activeChat.messages]
                    .reverse()
                    .find((m) => m.role === "user")?.id;

                  return activeChat.messages.map((msg: MessageItem) => {
                    const isUser = msg.role === "user";
                    const isLastUser = isUser && msg.id === lastUserMsgId;
                    const isEditingThis = editingMsgId === msg.id;

                    // Parse [file: name] marker or msg.fileMeta for clean chip display
                    let displayBody = msg.content || "";
                    let chipName = msg.fileMeta?.name;
                    const chipSize = msg.fileMeta?.size;
                    const fileMarkerMatch = displayBody.match(/\[file:\s*([^\]]+)\]/);
                    if (fileMarkerMatch) {
                      if (!chipName) chipName = fileMarkerMatch[1].trim();
                      displayBody = displayBody.replace(fileMarkerMatch[0], "").trim();
                    }

                    const msgFeedback = feedbackByMessage[msg.id];
                    const isDownPopoverOpen = feedbackPopoverMsgId === msg.id;

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
                          {/* User uploaded image thumbnails (supports up to 4 images) */}
                          {isUser && (msg.mediaUrls?.length || msg.mediaUrl) && (
                            <div className="user-uploaded-images-grid">
                              {(msg.mediaUrls || [msg.mediaUrl!]).map((url, imgIdx) => (
                                <div key={imgIdx} className="user-uploaded-image-wrapper">
                                  <img
                                    src={url}
                                    alt={`Uploaded attachment ${imgIdx + 1}`}
                                    className="user-uploaded-img"
                                    onClick={() => window.open(url, "_blank")}
                                    title="Click to view full size"
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {/* User Attached File Chip in Message Bubble */}
                          {isUser && chipName && (
                            <div className="message-file-chip">
                              <IconFileText size={13} />
                              <span className="attachment-filename">{chipName}</span>
                              {chipSize ? (
                                <span className="attachment-filesize">
                                  ({formatFileSize(chipSize)})
                                </span>
                              ) : null}
                            </div>
                          )}

                          {/* 1. Assistant Image Studio Card if mediaType is image */}
                          {!isUser && msg.mediaType === "image" && (
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

                          {/* 3. Text Content: Assistant or User (with inline Edit mode for last user msg) */}
                          {!isUser && msg.content && (
                            <div className="message-text-content">
                              <MarkdownRenderer content={msg.content} />
                            </div>
                          )}

                          {isUser && isEditingThis ? (
                            <div className="user-edit-message-box">
                              <textarea
                                className="user-edit-textarea"
                                rows={3}
                                value={editMsgContent}
                                onChange={(e) => setEditMsgContent(e.target.value)}
                                autoFocus
                              />
                              <div className="user-edit-actions">
                                <button
                                  type="button"
                                  className="msg-action-btn"
                                  onClick={() => setEditingMsgId(null)}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="msg-edit-save-btn"
                                  disabled={!editMsgContent.trim() || isSending}
                                  onClick={() => {
                                    const nextText = editMsgContent.trim();
                                    setEditingMsgId(null);
                                    editAndResendLastMessage(activeChat.id, msg.id, nextText);
                                  }}
                                >
                                  Save &amp; Send
                                </button>
                              </div>
                            </div>
                          ) : (
                            isUser &&
                            displayBody && (
                              <div className="message-text-content">
                                <MarkdownRenderer content={displayBody} />
                              </div>
                            )
                          )}

                          {/* Edit Button on User's Last Message */}
                          {isLastUser && !isEditingThis && !isSending && (
                            <div className="user-message-actions">
                              <button
                                type="button"
                                className="msg-action-btn"
                                onClick={() => {
                                  setEditingMsgId(msg.id);
                                  setEditMsgContent(displayBody || msg.content);
                                }}
                                title="Edit message and regenerate reply"
                              >
                                <IconEdit size={12} />
                                <span>Edit</span>
                              </button>
                            </div>
                          )}

                          {/* Assistant Action Buttons: Copy, Listen TTS, Thumbs Up, Thumbs Down */}
                          {!isUser && msg.content && (
                            <>
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

                                <SpeechAudioButton
                                  text={msg.content}
                                  voiceName={preferences.voiceName}
                                  voiceSpeed={preferences.voiceSpeed}
                                  voiceLanguage={preferences.voiceLanguage}
                                />

                                {!isGuest && (
                                  <>
                                    <button
                                      type="button"
                                      className={`msg-action-btn ${msgFeedback?.rating === "up" ? "fb-active-up" : ""}`}
                                      onClick={() => {
                                        setFeedbackPopoverMsgId(null);
                                        submitFeedback(activeChat.id, msg.id, "up");
                                      }}
                                      aria-label="Helpful"
                                      title="Good response"
                                    >
                                      <IconThumbsUp size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className={`msg-action-btn ${msgFeedback?.rating === "down" ? "fb-active-down" : ""}`}
                                      onClick={() => {
                                        setFeedbackReason(msgFeedback?.reason || "Wrong answer");
                                        setFeedbackComment(msgFeedback?.comment || "");
                                        setFeedbackPopoverMsgId(isDownPopoverOpen ? null : msg.id);
                                      }}
                                      aria-label="Not helpful"
                                      title="Report issue with response"
                                    >
                                      <IconThumbsDown size={13} />
                                    </button>
                                  </>
                                )}
                              </div>

                              {/* Thumbs Down Reasons Popover */}
                              {isDownPopoverOpen && (
                                <div className="feedback-reason-card">
                                  <div className="feedback-reason-header">
                                    <span>What went wrong?</span>
                                    <button
                                      type="button"
                                      onClick={() => setFeedbackPopoverMsgId(null)}
                                      style={{ opacity: 0.7, fontSize: "0.78rem" }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                  <div className="feedback-reasons-pills">
                                    {["Wrong answer", "Not helpful", "Too long", "Bad format", "Other"].map(
                                      (reasonOpt) => (
                                        <button
                                          key={reasonOpt}
                                          type="button"
                                          className={`feedback-reason-pill ${
                                            feedbackReason === reasonOpt ? "active" : ""
                                          }`}
                                          onClick={() => setFeedbackReason(reasonOpt)}
                                        >
                                          {reasonOpt}
                                        </button>
                                      )
                                    )}
                                  </div>
                                  <input
                                    type="text"
                                    className="feedback-comment-input"
                                    placeholder="Optional comment..."
                                    value={feedbackComment}
                                    onChange={(e) => setFeedbackComment(e.target.value)}
                                    maxLength={400}
                                  />
                                  <div className="feedback-submit-row">
                                    <button
                                      type="button"
                                      className="msg-action-btn"
                                      onClick={() => setFeedbackPopoverMsgId(null)}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="msg-edit-save-btn"
                                      onClick={() => {
                                        submitFeedback(
                                          activeChat.id,
                                          msg.id,
                                          "down",
                                          feedbackReason,
                                          feedbackComment
                                        );
                                        setFeedbackPopoverMsgId(null);
                                      }}
                                    >
                                      Submit Feedback
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* Sending / Generating indicator: ONLY show before text tokens start arriving */}
                {isSending &&
                  (!activeChat.messages.length ||
                    activeChat.messages[activeChat.messages.length - 1].role !== "assistant" ||
                    !activeChat.messages[activeChat.messages.length - 1].content) && (
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
              </div>
            </div>
          )}

          {/* Floating Scroll-to-Latest Button */}
          {showScrollToBottom && (
            <button
              type="button"
              className="scroll-to-latest-pill"
              onClick={scrollToBottom}
              aria-label="Scroll to latest message"
            >
              <IconChevronDown size={14} />
              <span>Scroll to latest</span>
            </button>
          )}
        </main>

        {/* Bottom Input Zone (Visible when in active conversation) */}
        {activeChat && activeChat.messages.length > 0 && (
          <footer className="conversation-input-bar">
            {/* Calm Memory Saved Pill */}
            {lastExtractedMemory && (
              <div className="memory-saved-toast-pill" role="status">
                <div className="memory-saved-toast-left">
                  <IconBrain size={14} />
                  <span>Saved to memory: <strong>{lastExtractedMemory.text}</strong></span>
                </div>
                <div className="memory-saved-toast-actions">
                  <button
                    type="button"
                    className="memory-undo-btn"
                    onClick={undoLastMemory}
                    title="Undo and delete this memory"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="memory-dismiss-btn"
                    onClick={clearLastExtractedMemory}
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {firestoreError && (
              <div
                style={{
                  padding: "4px 12px",
                  fontSize: "0.78rem",
                  backgroundColor: "rgba(234, 179, 8, 0.12)",
                  color: "var(--text-secondary, #eab308)",
                  borderRadius: "6px",
                  textAlign: "center",
                  marginBottom: "6px",
                  maxWidth: "500px",
                  margin: "0 auto 6px",
                }}
              >
                {firestoreError}
              </div>
            )}
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
                    : preferences.enterToSend === false
                    ? t("askAnythingCtrlEnter")
                    : t("askAnythingEnter")
                }
                className="chat-input-textarea"
              />

              {/* Attached Images Thumbnails Preview (up to 4 images) */}
              {attachedImages.length > 0 && (
                <div className="attached-images-preview-row">
                  {attachedImages.map((img, idx) => (
                    <div key={idx} className="attachment-indicator-pill attached-image-indicator">
                      <img src={img.dataUrl} alt={`Thumbnail ${idx + 1}`} className="input-thumb-preview" />
                      <span className="attachment-filename">{img.fileName}</span>
                      <button
                        type="button"
                        onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                        className="attachment-remove-btn"
                        aria-label={`Remove image ${idx + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {attachedImages.length < 4 && (
                    <button
                      type="button"
                      className="add-more-images-btn"
                      onClick={() => fileInputRef.current?.click()}
                      title="Add another image (up to 4)"
                    >
                      <IconPlus size={12} />
                      <span>Add ({attachedImages.length}/4)</span>
                    </button>
                  )}
                </div>
              )}

              {/* Attached PDF/Text/Code File Preview */}
              {attachedFile && (
                <div className="attached-file-chip-wrapper">
                  <div className="attachment-indicator-pill">
                    <IconFileText size={13} />
                    <span className="attachment-filename">{attachedFile.fileName}</span>
                    {attachedFile.fileSize ? (
                      <span className="attachment-filesize">
                        ({formatFileSize(attachedFile.fileSize)})
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setAttachedFile(null)}
                      className="attachment-remove-btn"
                      aria-label="Remove file"
                    >
                      ✕
                    </button>
                  </div>
                  {attachedFile.truncationNote && (
                    <div className="attachment-truncation-note">
                      {attachedFile.truncationNote}
                    </div>
                  )}
                </div>
              )}

              {fileUploadError && (
                <div className="attachment-error-note">
                  <span>{fileUploadError}</span>
                  <button type="button" onClick={() => setFileUploadError(null)}>✕</button>
                </div>
              )}

              {isProcessingFile && (
                <div className="attachment-indicator-pill">
                  <span className="attachment-filename">Reading attachment...</span>
                </div>
              )}

              <div className="chat-input-card-bottom">
                <div className="input-toolbar-left">
                  {/* Attachment & Tools Dropdown Button */}
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="input-tool-icon-btn"
                      onClick={() => setIsAttachmentMenuOpen((prev) => !prev)}
                      title="Add attachments or tools"
                      aria-label="Add attachments or tools"
                    >
                      <IconPlus size={16} />
                    </button>

                    {isAttachmentMenuOpen && (
                      <div className="attachment-dropdown-menu">
                        <button
                          type="button"
                          className="attachment-dropdown-item"
                          onClick={() => {
                            setIsAttachmentMenuOpen(false);
                            if (isGuest) {
                              setShowGuestLimitModal(true);
                              return;
                            }
                            fileInputRef.current?.click();
                          }}
                        >
                          <IconPaperclip size={14} />
                          <span>Attach image, PDF or file</span>
                        </button>

                        <button
                          type="button"
                          className={`attachment-dropdown-item ${isWebSearchActive ? "active" : ""}`}
                          onClick={() => {
                            if (isGuest) {
                              setShowGuestLimitModal(true);
                              return;
                            }
                            setIsWebSearchActive(!isWebSearchActive);
                            setIsAttachmentMenuOpen(false);
                          }}
                        >
                          <IconGlobe size={14} />
                          <span>Web Search ({isWebSearchActive ? "ON" : "OFF"})</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Active Web Search Indicator Pill */}
                  {isWebSearchActive && (
                    <div className="active-websearch-pill" title="Web search active for this chat">
                      <IconGlobe size={12} />
                      <span>Web Search</span>
                    </div>
                  )}

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
                    disabled={(!inputContent.trim() && attachedImages.length === 0 && !attachedFile) || isSending || isProcessingFile}
                    onClick={handleSend}
                    aria-label="Send message"
                    title={preferences.enterToSend === false ? "Send (Ctrl+Enter)" : "Send (Enter)"}
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
        onClose={closeSettings}
        initialTab={settingsTab}
        initialSubView={settingsSubView}
        onTabChange={(tab, sub) => openSettingsAt(tab, sub || "main")}
      />

      {/* Project Management Modal */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        editingProject={editingProject}
      />

      {/* iOS Safari PWA Install Guide Sheet */}
      <PwaInstallModal />

      {/* Calm Guest Limit Modal */}
      {showGuestLimitModal && (
        <div className="modal-backdrop" onClick={() => setShowGuestLimitModal(false)}>
          <div className="guest-limit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="guest-modal-icon">
              <img src="/logo_icon.png?v=20261107" alt="AUTONEXIS" style={{ width: 44, height: 44 }} />
            </div>
            <h3 className="guest-modal-title">Log in to continue</h3>
            <p className="guest-modal-desc">
              You've reached your free 5 guest messages. Sign in with your Google or email account to unlock unlimited messaging, multimodal image understanding, and persistent memory.
            </p>
            <div className="guest-modal-actions">
              <button
                type="button"
                className="guest-modal-login-btn"
                onClick={() => {
                  setShowGuestLimitModal(false);
                  setIsAuthScreenVisible(true);
                }}
              >
                Sign In / Create Account
              </button>
              <button
                type="button"
                className="guest-modal-close-btn"
                onClick={() => setShowGuestLimitModal(false)}
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
