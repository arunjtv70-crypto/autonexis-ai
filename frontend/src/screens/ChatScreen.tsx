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
import { useAppNavigation } from "../state/navigation";
import { Logo } from "../components/Logo";
import { SettingsModal } from "../components/SettingsModal";
import { ProjectModal } from "../components/ProjectModal";
import { PwaInstallModal } from "../components/PwaInstallModal";
import { UserMenuDropdown } from "../components/UserMenuDropdown";
import { VoiceCallModal } from "../components/VoiceCallModal";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { translate } from "../i18n/translations";
import { getStorageDebugTraces, type FirestoreProject } from "../db";
import {
  isImageFile,
  isTextFile,
  isPdfFile,
  readTextFile,
  extractPdfText,
  renderPdfPagesAsImageFiles,
  formatFileSize,
} from "../utils/fileHelpers";
import {
  type PreparedImageAttachment,
  type ImageEditState,
  DEFAULT_IMAGE_EDITS,
  intakeImageFiles,
  finalizeCanvasAsAttachment,
  packAttachmentsWithinBudget,
  dataUrlToCanvas,
  cropHighResRegionAsAttachment,
} from "../utils/imageIntake";
import { ImageEditorModal, CameraCaptureModal } from "../components/ImageEditorModal";
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
  IconDownload,
  IconPhone,
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
    imageStyle,
    setImageStyle,
    imageAspect,
    setImageAspect,
    loadLazyImageForMessage,
    regenerateMessageImage,
    deleteMessageImage,
    reportMessageImage,
    getFullQualityImageUrl,
    deleteErrorBanner,
    retryFailedDelete,
    dismissDeleteError,
    isSending,
    visionStage,
    cancelActiveReply,
    getSessionOriginalUrl,
    guestMessagesRemaining,
    showGuestLimitModal,
    setShowGuestLimitModal,
    loadMoreChats,
    hasMoreChats,
    firestoreError,
  } = useChats();

  const { user, firebaseUser, isGuest, setIsAuthScreenVisible, logout } = useAuth();
  const {
    isInstallSupported,
    isIos,
    triggerInstall,
    shouldShowPostLoginBanner,
    dismissPostLoginBanner,
    markBannerShownNow,
  } = usePwa();
  const {
    route,
    hasOverlay,
    pushOverlay,
    closeOverlay,
    closeAllOverlays,
    openSettings,
    navigateSettings,
    goBackFromSettings,
    closeSettings,
  } = useAppNavigation();

  const t = (key: string) => translate(key, preferences.interfaceLanguage);

  // Input & UI States
  const [inputContent, setInputContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSearchResult[] | null>(null);
  const [isSearchingMessages, setIsSearchingMessages] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const accountAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const isDebugMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";
  const [debugTraceDismissed, setDebugTraceDismissed] = useState(false);
  const [debugTraces, setDebugTraces] = useState<Array<{ ts: string; op: string; path: string }>>(() =>
    isDebugMode ? getStorageDebugTraces() : []
  );

  useEffect(() => {
    if (!isDebugMode) return;
    setDebugTraces(getStorageDebugTraces());
    const onTrace = () => {
      setDebugTraces(getStorageDebugTraces());
    };
    window.addEventListener("autonexis:storage-trace", onTrace);
    return () => window.removeEventListener("autonexis:storage-trace", onTrace);
  }, [isDebugMode]);

  // Coordinated history-backed overlay states
  const isMobileMenuOpen = hasOverlay("drawer");
  const setIsMobileMenuOpen = (open: boolean) =>
    open ? pushOverlay("drawer") : closeOverlay("drawer");
  const isUserMenuOpen = hasOverlay("accountMenu");
  const isProjectModalOpen = hasOverlay("projectModal");
  const setIsProjectModalOpen = (open: boolean) =>
    open ? pushOverlay("projectModal") : closeOverlay("projectModal");
  const isVoiceCallOpen = hasOverlay("voiceCall");
  const isSettingsOpen = route.isSettings;
  const [guestModalReason, setGuestModalReason] = useState<"limit" | "voiceCall">("limit");

  const handleLaunchVoiceCall = () => {
    if (isGuest) {
      setGuestModalReason("voiceCall");
      setShowGuestLimitModal(true);
      return;
    }
    pushOverlay("voiceCall");
  };

  // Wellbeing break reminder tracking
  const [showBreakReminder, setShowBreakReminder] = useState(false);
  const activeSessionMsRef = useRef<number>(0);

  // Sidebar Pin / Archive / Chat Actions / Projects States
  const [showArchivedSection, setShowArchivedSection] = useState(false);
  const [openChatMenuId, setOpenChatMenuId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameInputVal, setRenameInputVal] = useState("");
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

  // File & Image Attachment States (supports up to 4 images, scanned PDF up to 5 pages, camera, paste, drag-drop, editor)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const intakeAbortRef = useRef<AbortController | null>(null);
  const [attachedImages, setAttachedImages] = useState<PreparedImageAttachment[]>([]);
  const [attachedFile, setAttachedFile] = useState<{
    textContent: string;
    fileName: string;
    fileSize?: number;
    isPdf?: boolean;
    truncationNote?: string;
  } | null>(null);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [processingLabel, setProcessingLabel] = useState("Preparing the image");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragCounterRef = useRef(0);
  const [editingImageIndex, setEditingImageIndex] = useState<number | null>(null);
  const [retakeTargetIndex, setRetakeTargetIndex] = useState<number | null>(null);
  const [askPartTarget, setAskPartTarget] = useState<{ url: string; fileName: string } | null>(null);

  const isImageEditorOpen = hasOverlay("imageEditor");
  const isCameraCaptureOpen = hasOverlay("cameraCapture");

  useEffect(() => {
    if (!isImageEditorOpen) {
      setEditingImageIndex(null);
      setAskPartTarget(null);
    }
  }, [isImageEditorOpen]);

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

  // Keep Guest Limit modal synced with the browser history overlay stack
  const isGuestOverlayOpen = hasOverlay("guestModal");
  const prevGuestOverlayOpenRef = useRef(false);
  useEffect(() => {
    if (showGuestLimitModal && !isGuestOverlayOpen && !prevGuestOverlayOpenRef.current) {
      pushOverlay("guestModal");
    } else if (!showGuestLimitModal && isGuestOverlayOpen && prevGuestOverlayOpenRef.current) {
      closeOverlay("guestModal");
    }
  }, [showGuestLimitModal, isGuestOverlayOpen, pushOverlay, closeOverlay]);

  useEffect(() => {
    if (prevGuestOverlayOpenRef.current && !isGuestOverlayOpen && showGuestLimitModal) {
      setGuestModalReason("limit");
      setShowGuestLimitModal(false);
    }
    prevGuestOverlayOpenRef.current = isGuestOverlayOpen;
  }, [isGuestOverlayOpen, showGuestLimitModal, setShowGuestLimitModal]);

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

  // Global Shortcuts: Ctrl+K (Search), Ctrl+Shift+, (Settings), Ctrl+Shift+O (New Chat), Esc (Close topmost dialog)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (window.innerWidth <= 768) {
          pushOverlay("drawer");
          setTimeout(() => searchInputRef.current?.focus(), 40);
        } else {
          searchInputRef.current?.focus();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "," || e.key === "<")) {
        e.preventDefault();
        if (isSettingsOpen) {
          closeSettings();
        } else {
          openSettings(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        createNewChat();
      } else if (e.key === "Escape") {
        // Topmost modal components (Lightbox, Modal/ProjectModal/iOS sheet, UserMenu) stopPropagation on their own Esc handlers; handle remaining overlays calmly
        if (hasOverlay("voiceCall") || hasOverlay("lightbox") || hasOverlay("iosInstall") || hasOverlay("projectModal") || hasOverlay("accountMenu")) {
          return;
        }
        if (hasOverlay("guestModal")) {
          setShowGuestLimitModal(false);
          return;
        }
        if (hasOverlay("drawer")) {
          closeOverlay("drawer");
          return;
        }
        if (isSettingsOpen) {
          closeSettings();
          return;
        }
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
  }, [createNewChat, isSettingsOpen, hasOverlay, pushOverlay, closeOverlay, openSettings, closeSettings, setShowGuestLimitModal]);

  // Handle manifest shortcuts (?action=new-chat | ?action=create-image) once on mount
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const action = params.get("action");
      if (action === "new-chat") {
        createNewChat();
      } else if (action === "create-image") {
        createNewChat();
        setInputMode("image");
      }
      if (action) {
        params.delete("action");
        const remaining = params.toString();
        const nextUrl = window.location.pathname + (remaining ? `?${remaining}` : "");
        window.history.replaceState(window.history.state, "", nextUrl);
      }
    } catch {}
    // Run intentionally once on mount for shortcut launches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        images: curImages.map((img) => ({
          dataUrl: img.usingOriginal ? img.originalDataUrl : img.dataUrl,
          fileName: img.fileName,
          tiles: img.usingOriginal ? undefined : img.tiles,
          originalDataUrl: img.originalDataUrl,
          decodedCodes: img.decodedCodes.map((c) => ({ rawValue: c.rawValue, format: c.format })),
        })),
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

    await sendMessage(
      textToSend,
      inputMode,
      attachmentPayload,
      inputMode === "image" ? { style: imageStyle, aspect: imageAspect } : undefined
    );
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

  const cancelFileIntake = () => {
    if (intakeAbortRef.current) {
      intakeAbortRef.current.abort();
      intakeAbortRef.current = null;
    }
    setIsProcessingFile(false);
    setProcessingLabel("Preparing the image");
  };

  const processIncomingFiles = async (
    rawFiles: File[],
    source: PreparedImageAttachment["source"],
    replaceIdx?: number | null
  ) => {
    if (!rawFiles || rawFiles.length === 0) return;

    if (isGuest) {
      setShowGuestLimitModal(true);
      return;
    }

    if (intakeAbortRef.current) {
      intakeAbortRef.current.abort();
    }
    const controller = new AbortController();
    intakeAbortRef.current = controller;

    try {
      setIsProcessingFile(true);
      setProcessingLabel("Preparing the image");
      setFileUploadError(null);

      const imageFiles = rawFiles.filter(isImageFile);
      const pdfFiles = rawFiles.filter(isPdfFile);
      const textFiles = rawFiles.filter(isTextFile);

      if (imageFiles.length > 0) {
        if (replaceIdx !== null && replaceIdx !== undefined && replaceIdx >= 0 && replaceIdx < attachedImages.length) {
          const withoutTarget = attachedImages.filter((_, i) => i !== replaceIdx);
          const { items, errors } = await intakeImageFiles([imageFiles[0]], withoutTarget, {
            source,
            maxCount: 4,
            signal: controller.signal,
            onProgress: setProcessingLabel,
          });
          setAttachedImages(items);
          setAttachedFile(null);
          if (errors.length > 0) setFileUploadError(errors[0]);
          return;
        }

        const remainingSlots = Math.max(0, 4 - attachedImages.length);
        if (remainingSlots === 0) {
          setFileUploadError("You can attach up to 4 images per message.");
          return;
        }
        const { items, errors } = await intakeImageFiles(imageFiles, attachedImages, {
          source,
          maxCount: 4,
          signal: controller.signal,
          onProgress: setProcessingLabel,
        });
        setAttachedImages(items);
        setAttachedFile(null);
        if (imageFiles.length > remainingSlots) {
          setFileUploadError(`Only the first 4 images can be attached per message.`);
        } else if (errors.length > 0) {
          setFileUploadError(errors.join(" "));
        }
      } else if (pdfFiles.length > 0) {
        const pdfFile = pdfFiles[0];
        setProcessingLabel("Reading PDF...");
        const res = await extractPdfText(pdfFile, 20, 30000);
        if (controller.signal.aborted) return;

        if (res.isScanned) {
          const rendered = await renderPdfPagesAsImageFiles(
            pdfFile,
            5,
            controller.signal,
            setProcessingLabel
          );
          if (controller.signal.aborted) return;
          if (rendered.files.length === 0) {
            setFileUploadError(`"${pdfFile.name}" has no pages that could be rendered.`);
            return;
          }
          const { items, errors } = await intakeImageFiles(rendered.files, [], {
            source: "pdf",
            maxCount: 5,
            signal: controller.signal,
            onProgress: setProcessingLabel,
          });
          setAttachedImages(items);
          setAttachedFile(null);
          if (errors.length > 0) {
            setFileUploadError(errors.join(" "));
          } else if (rendered.totalPages > 5) {
            setFileUploadError(
              `Rendered first 5 of ${rendered.totalPages} scanned pages from "${pdfFile.name}".`
            );
          }
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
        if (controller.signal.aborted) return;
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
        setFileUploadError(
          `Unsupported file format (${rawFiles[0]?.name || "unknown"}). Supported: JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC/HEIF, PDF, or text/code files.`
        );
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return;
      }
      console.error("[AUTONEXIS] Attachment processing error:", err);
      setFileUploadError(err?.message || "Unable to read this file. Please try another image or file.");
    } finally {
      if (intakeAbortRef.current === controller) {
        intakeAbortRef.current = null;
      }
      setIsProcessingFile(false);
      setProcessingLabel("Preparing the image");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const targetIdx = retakeTargetIndex;
    setRetakeTargetIndex(null);
    e.target.value = "";
    await processIncomingFiles(files, "gallery", targetIdx);
  };

  const handleCameraInputCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const targetIdx = retakeTargetIndex;
    setRetakeTargetIndex(null);
    e.target.value = "";
    await processIncomingFiles(files, "camera", targetIdx);
  };

  const handleComposerPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      await processIncomingFiles(pastedFiles, "paste");
    }
  };

  const handleAutoFixImage = async (idx: number) => {
    const target = attachedImages[idx];
    if (!target) return;
    try {
      setIsProcessingFile(true);
      setProcessingLabel("Preparing the image");
      const canvas = await dataUrlToCanvas(target.originalDataUrl);
      const needsRotate = target.issues.some((i) => i.code === "needsRotate90");
      const nextEdits: ImageEditState = {
        ...target.edits,
        autoEnhance: true,
        rotateDeg: needsRotate ? (((target.edits.rotateDeg + 90) % 360) as 0 | 90 | 180 | 270) : target.edits.rotateDeg,
      };
      const updated = await finalizeCanvasAsAttachment(
        target.id,
        target.fileName,
        target.source,
        canvas,
        nextEdits,
        target.decodedCodes,
        target.originalDataUrl
      );
      const nextArr = attachedImages.map((item, i) => (i === idx ? updated : item));
      setAttachedImages(await packAttachmentsWithinBudget(nextArr));
    } catch (err: any) {
      setFileUploadError(err?.message || "Could not enhance image.");
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleApplyEditorChanges = async (idx: number, nextEdits: ImageEditState) => {
    const target = attachedImages[idx];
    if (!target) return;
    try {
      setIsProcessingFile(true);
      setProcessingLabel("Preparing the image");
      const canvas = await dataUrlToCanvas(target.originalDataUrl);
      const updated = await finalizeCanvasAsAttachment(
        target.id,
        target.fileName,
        target.source,
        canvas,
        nextEdits,
        target.decodedCodes,
        target.originalDataUrl
      );
      const nextArr = attachedImages.map((item, i) => (i === idx ? updated : item));
      setAttachedImages(await packAttachmentsWithinBudget(nextArr));
    } catch (err: any) {
      setFileUploadError(err?.message || "Could not update image.");
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleToggleUseOriginal = async (idx: number) => {
    const updated = attachedImages.map((item, i) =>
      i === idx ? { ...item, usingOriginal: !item.usingOriginal, dismissedIssues: true } : item
    );
    setAttachedImages(await packAttachmentsWithinBudget(updated));
  };

  const handleOpenAskAboutPart = (displayUrl: string, fileName = "selected-part.jpg") => {
    if (isGuest) {
      setShowGuestLimitModal(true);
      return;
    }
    const origUrl = getSessionOriginalUrl(displayUrl) || displayUrl;
    setAskPartTarget({ url: origUrl, fileName });
    pushOverlay("imageEditor");
  };

  const handleConfirmAskAboutPart = async (cropRect: { x: number; y: number; w: number; h: number }) => {
    if (!askPartTarget) return;
    try {
      setIsProcessingFile(true);
      setProcessingLabel("Preparing the image");
      const cropped = await cropHighResRegionAsAttachment(
        askPartTarget.url,
        `focus-${askPartTarget.fileName}`,
        cropRect
      );
      const nextArr = await packAttachmentsWithinBudget([...attachedImages, cropped].slice(0, 4));
      setAttachedImages(nextArr);
      setAttachedFile(null);
      if (!inputContent.trim()) {
        setInputContent("Please focus on this selected part of the image:");
      }
      setTimeout(() => textareaRef.current?.focus(), 60);
    } catch (err: any) {
      setFileUploadError(err?.message || "Could not crop that image section.");
    } finally {
      setIsProcessingFile(false);
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
          <Logo variant="full" size="sm" showSubtitle={false} />
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
          onClick={() => openSettings(null)}
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
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isUserMenuOpen}
          className="user-profile-pill"
          onClick={(e) => {
            accountAnchorRef.current = e.currentTarget;
            if (isUserMenuOpen) {
              closeOverlay("accountMenu");
            } else {
              pushOverlay("accountMenu");
            }
          }}
          title="Account Menu"
        >
          <span className="user-profile-left">
            <span className="user-avatar-circle">
              <img
                src={firebaseUser?.photoURL || "/brand/logo-mark.png"}
                alt="User"
                className="user-avatar-img"
              />
            </span>
            <span className="user-name-text">
              {userName}
              {isGuest ? ` · ${t("guestMode")}` : ""}
            </span>
          </span>
          <IconChevronDown size={14} style={{ opacity: 0.7 }} />
        </button>
      </div>
    </div>
  );

  const imageStyleOptions = [
    "Auto",
    "Realistic photo",
    "Cinematic",
    "Illustration",
    "Anime",
    "3D render",
    "Minimal logo",
  ];
  const imageAspectOptions = ["Auto", "1:1", "4:5", "16:9", "9:16"];

  const renderImageModeControls = () => {
    if (inputMode !== "image") return null;
    return (
      <div className="image-mode-controls-bar" role="region" aria-label="Image creation options">
        <div className="image-mode-header-row">
          <span className="image-mode-active-badge">
            <IconImage size={12} />
            <span>Creating image</span>
          </span>
          <button
            type="button"
            className="image-mode-exit-btn"
            onClick={() => setInputMode("chat")}
            aria-label="Exit Create image mode"
            title="Exit Create image mode"
          >
            ✕ Exit
          </button>
        </div>

        <div className="image-mode-pills-scroll" aria-label="Image style">
          {imageStyleOptions.map((st) => (
            <button
              key={st}
              type="button"
              className={`image-mode-chip ${imageStyle === st ? "active" : ""}`}
              onClick={() => setImageStyle(st)}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="image-mode-pills-scroll" aria-label="Image aspect ratio">
          {imageAspectOptions.map((ar) => (
            <button
              key={ar}
              type="button"
              className={`image-mode-chip aspect ${imageAspect === ar ? "active" : ""}`}
              onClick={() => setImageAspect(ar)}
            >
              {ar === "Auto" ? "Ratio: Auto" : ar}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderDeleteErrorBanner = () => {
    if (!deleteErrorBanner) return null;
    return (
      <div className="delete-error-banner" role="alert">
        <span>{deleteErrorBanner.message}</span>
        <div className="delete-error-banner-actions">
          <button type="button" className="delete-error-retry-btn" onClick={retryFailedDelete}>
            Retry
          </button>
          <button type="button" className="delete-error-dismiss-btn" onClick={dismissDeleteError}>
            Dismiss
          </button>
        </div>
      </div>
    );
  };

  const renderVisionProgressStatus = () => {
    if (!isProcessingFile && !(isSending && visionStage)) return null;
    const labelMap: Record<string, string> = {
      preparing: processingLabel || "Preparing the image",
      reading: "Reading",
      checking: "Checking details",
      writing: "Writing the answer",
    };
    const statusText = isProcessingFile ? (processingLabel || "Preparing the image") : labelMap[visionStage || "reading"];
    return (
      <div className="vision-progress-strip" role="status" aria-live="polite">
        <div className="vision-progress-left">
          <span className="vision-progress-dot" />
          <span className="vision-progress-label">{statusText}...</span>
        </div>
        <button
          type="button"
          className="vision-progress-cancel-btn"
          onClick={isProcessingFile ? cancelFileIntake : cancelActiveReply}
        >
          Cancel
        </button>
      </div>
    );
  };

  const renderComposerAttachmentArea = () => (
    <>
      {attachedImages.length > 0 && (
        <div className="attached-images-preview-row">
          {attachedImages.map((img, idx) => {
            const visibleIssues = img.dismissedIssues ? [] : img.issues;
            const hasAutoFix = visibleIssues.some((iss) => iss.autoFixable);
            const hasBeenModified =
              img.edits.autoEnhance ||
              img.edits.rotateDeg !== 0 ||
              img.edits.brightness !== 0 ||
              img.edits.contrast !== 0 ||
              Boolean(img.edits.crop);
            return (
              <div key={img.id} className="attached-image-card">
                <div className="attachment-indicator-pill attached-image-indicator">
                  <img
                    src={img.usingOriginal ? img.originalDataUrl : img.dataUrl}
                    alt={`Thumbnail ${idx + 1}`}
                    className="input-thumb-preview clickable"
                    onClick={() => {
                      setEditingImageIndex(idx);
                      setAskPartTarget(null);
                      pushOverlay("imageEditor");
                    }}
                    title="Click to crop, rotate, or adjust brightness & contrast"
                  />
                  <div className="attachment-meta-col">
                    <span className="attachment-filename">{img.fileName}</span>
                    <span className="attachment-submeta">
                      {img.width}×{img.height}
                      {img.tiles && img.tiles.length > 0 && !img.usingOriginal
                        ? ` · ${img.tiles.length} sections`
                        : ""}
                      {img.usingOriginal ? " · Original" : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="attachment-edit-btn"
                    onClick={() => {
                      setEditingImageIndex(idx);
                      setAskPartTarget(null);
                      pushOverlay("imageEditor");
                    }}
                    title="Crop, rotate, brightness & contrast"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="attachment-remove-btn"
                    aria-label={`Remove image ${idx + 1}`}
                  >
                    ✕
                  </button>
                </div>

                {/* Quality Checks + Non-blocking Hints + Auto-Fix / Retake / Send Anyway */}
                {(visibleIssues.length > 0 || hasBeenModified) && (
                  <div className="attachment-quality-bar">
                    {visibleIssues.length > 0 && (
                      <span className="attachment-quality-hint">
                        {visibleIssues.map((i) => i.label).join(" · ")}
                      </span>
                    )}
                    <div className="attachment-quality-actions">
                      {hasAutoFix && !img.usingOriginal && (
                        <button
                          type="button"
                          className="quality-action-btn primary"
                          onClick={() => handleAutoFixImage(idx)}
                        >
                          Fix
                        </button>
                      )}
                      <button
                        type="button"
                        className="quality-action-btn"
                        onClick={() => {
                          setRetakeTargetIndex(idx);
                          pushOverlay("cameraCapture");
                        }}
                      >
                        Retake
                      </button>
                      {hasBeenModified && (
                        <button
                          type="button"
                          className="quality-action-btn"
                          onClick={() => handleToggleUseOriginal(idx)}
                        >
                          {img.usingOriginal ? "Use enhanced" : "Send original"}
                        </button>
                      )}
                      {visibleIssues.length > 0 && (
                        <button
                          type="button"
                          className="quality-action-btn"
                          onClick={() =>
                            setAttachedImages((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, dismissedIssues: true } : it))
                            )
                          }
                        >
                          Send anyway
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Local QR / Barcode Preview (Never Auto-Opened) */}
                {img.decodedCodes.length > 0 && (
                  <div className="attachment-barcode-list">
                    {img.decodedCodes.map((code, cIdx) => (
                      <div
                        key={cIdx}
                        className={`attachment-barcode-card ${code.isShortener || code.isSuspicious ? "is-warn" : ""}`}
                      >
                        <div className="barcode-header-row">
                          <span className="barcode-badge">{code.isUrl ? "Link detected" : "Code detected"}</span>
                          {code.hostname && <strong className="barcode-domain">{code.hostname}</strong>}
                          <div className="barcode-actions">
                            <button
                              type="button"
                              className="barcode-action-btn"
                              onClick={() => navigator.clipboard?.writeText(code.rawValue)}
                            >
                              Copy
                            </button>
                            {code.isUrl && (
                              <a
                                href={code.rawValue}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="barcode-action-btn"
                              >
                                Open
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="barcode-raw-value">{code.displayUrl || code.rawValue}</div>
                        {code.warning && <div className="barcode-warning-text">{code.warning}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {attachedImages.length < 4 && (
            <button
              type="button"
              className="add-more-images-btn"
              onClick={() => {
                setRetakeTargetIndex(null);
                fileInputRef.current?.click();
              }}
              title="Add another image (up to 4)"
            >
              <IconPlus size={12} />
              <span>Add ({attachedImages.length}/4)</span>
            </button>
          )}
        </div>
      )}

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
            <div className="attachment-truncation-note">{attachedFile.truncationNote}</div>
          )}
        </div>
      )}

      {fileUploadError && (
        <div className="attachment-error-note">
          <span>{fileUploadError}</span>
          <button type="button" onClick={() => setFileUploadError(null)}>✕</button>
        </div>
      )}

      {renderVisionProgressStatus()}
    </>
  );

  const renderAttachmentDropdown = (isOpen: boolean, closeMenu: () => void) => {
    if (!isOpen) return null;
    return (
      <div className="attachment-dropdown-menu">
        <button
          type="button"
          className={`attachment-dropdown-item ${inputMode === "image" ? "active" : ""}`}
          onClick={() => {
            setInputMode(inputMode === "image" ? "chat" : "image");
            closeMenu();
            textareaRef.current?.focus();
          }}
        >
          <IconImage size={14} />
          <span>Create image</span>
        </button>

        <button
          type="button"
          className="attachment-dropdown-item"
          onClick={() => {
            closeMenu();
            if (isGuest) {
              setShowGuestLimitModal(true);
              return;
            }
            setRetakeTargetIndex(null);
            fileInputRef.current?.click();
          }}
        >
          <IconPaperclip size={14} />
          <span>Attach image, PDF or file</span>
        </button>

        <button
          type="button"
          className="attachment-dropdown-item"
          onClick={() => {
            closeMenu();
            if (isGuest) {
              setShowGuestLimitModal(true);
              return;
            }
            setRetakeTargetIndex(null);
            pushOverlay("cameraCapture");
          }}
        >
          <IconImage size={14} />
          <span>Take photo (Camera)</span>
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
            closeMenu();
          }}
        >
          <IconGlobe size={14} />
          <span>Web Search ({isWebSearchActive ? "ON" : "OFF"})</span>
        </button>
      </div>
    );
  };

  return (
    <div className="chat-screen-layout">
      {/* Background Subtle Watermark */}
      <div className="chat-watermark" aria-hidden="true">
        <Logo variant="mark" size="lg" tile="none" className="chat-watermark-logo" />
      </div>

      {/* Desktop Persistent Sidebar */}
      <aside className="desktop-sidebar">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div
          className="mobile-drawer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div className="mobile-drawer-pane" onClick={(e) => e.stopPropagation()}>
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Main Chat Center Container */}
      <div
        className="chat-main-container"
        onDragEnter={(e) => {
          if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
            dragCounterRef.current += 1;
            setIsDraggingFiles(true);
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
          }
        }}
        onDragLeave={() => {
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) setIsDraggingFiles(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          dragCounterRef.current = 0;
          setIsDraggingFiles(false);
          const dropped = Array.from(e.dataTransfer?.files || []);
          if (dropped.length > 0) {
            await processIncomingFiles(dropped, "drop");
          }
        }}
      >
        {isDraggingFiles && (
          <div className="chat-drop-overlay" aria-live="polite">
            <div className="chat-drop-overlay-card">
              <strong>Drop images, PDF, or text files</strong>
              <span>Up to 4 images or a scanned PDF (first 5 pages)</span>
            </div>
          </div>
        )}
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
            <div className="topbar-brand-mark">
              <Logo variant="mark" size="xs" />
            </div>
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

            {/* Small Install App Icon Button (shown only when installable and not already installed) */}
            {isInstallSupported && (
              <button
                type="button"
                className="topbar-action-btn"
                data-browser-only="true"
                onClick={() => triggerInstall()}
                aria-label="Install app"
                title="Install app"
              >
                <IconDownload size={18} />
              </button>
            )}

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
              onClick={() => openSettings(null)}
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
                onClick={() => openSettings("wellbeing", "main")}
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
          <div className="pwa-install-banner" data-browser-only="true" role="region" aria-label="Install app">
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
          accept="image/*,.heic,.heif,.avif,.bmp,.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.sql,.sh,.yaml,.yml,.env,.log"
          style={{ display: "none" }}
        />

        {/* Hidden System Camera Input Fallback */}
        <input
          type="file"
          ref={cameraInputRef}
          onChange={handleCameraInputCapture}
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
        />

        {/* Scrollable Conversation / Home Stage + Floating Scroll-to-Latest Pill */}
        <div className="chat-scroll-stage">
          {isDebugMode && !debugTraceDismissed && debugTraces.length > 0 && (
            <div className="debug-storage-trace-strip" style={{ margin: "6px 14px 0" }}>
              <span>
                Debug storage:{" "}
                {debugTraces
                  .slice(-4)
                  .map((tr) => `${tr.op}:${tr.path}`)
                  .join(" · ")}
              </span>
              <button
                type="button"
                className="debug-trace-dismiss"
                onClick={() => setDebugTraceDismissed(true)}
                aria-label="Dismiss debug strip"
              >
                ✕
              </button>
            </div>
          )}
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
                {/* Brand Mark + Greeting */}
                <div className="home-greeting-section">
                  <Logo variant="full" size="md" layout="stacked" showSubtitle={false} />
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

                {renderDeleteErrorBanner()}

                {/* Main Rounded Input Card */}
                <div className="chat-input-card">
                  {renderImageModeControls()}
                  <textarea
                    ref={textareaRef}
                    rows={2}
                    value={inputContent}
                    onChange={(e) => setInputContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handleComposerPaste}
                    placeholder={
                      inputMode === "image"
                        ? "Describe the visual you want to create..."
                        : inputMode === "video"
                        ? "Describe the cinematic scene for Video Studio..."
                        : preferences.enterToSend === false
                        ? t("askAnythingCtrlEnter")
                        : t("howCanIHelp")
                    }
                    className="chat-input-textarea"
                  />

                {renderComposerAttachmentArea()}

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

                      {renderAttachmentDropdown(isHomeAttachmentMenuOpen, () => setIsHomeAttachmentMenuOpen(false))}
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
                    {/* Live Voice Call Button */}
                    <button
                      type="button"
                      className="voice-call-launch-btn"
                      onClick={handleLaunchVoiceCall}
                      title="Start live voice call"
                      aria-label="Start voice call"
                    >
                      <IconPhone size={15} />
                    </button>

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

              {/* Empty-Home Quick Mode Chips (visible even if starter prompts are off) */}
              <div className="home-quick-actions-row">
                <button
                  type="button"
                  className={`home-quick-chip ${inputMode === "image" ? "active" : ""}`}
                  onClick={() => {
                    setInputMode(inputMode === "image" ? "chat" : "image");
                    textareaRef.current?.focus();
                  }}
                >
                  <IconImage size={14} />
                  <span>Create image</span>
                </button>
                <button
                  type="button"
                  className={`home-quick-chip ${isWebSearchActive ? "active" : ""}`}
                  onClick={() => {
                    if (isGuest) {
                      setShowGuestLimitModal(true);
                      return;
                    }
                    setIsWebSearchActive(!isWebSearchActive);
                  }}
                >
                  <IconGlobe size={14} />
                  <span>Web search</span>
                </button>
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
                        setInputContent("A futuristic cosmic portal glowing in deep violet and silver");
                      }}
                    >
                      {t("viewAll")}
                    </button>
                  </div>

                  <div className="artifacts-grid">
                    {/* Artifact Card 1: Create Image Preset */}
                    <div
                      className="artifact-card"
                      onClick={() => {
                        setInputMode("image");
                        setInputContent("Photorealistic sleek sports car cruising a rain-slicked neon city boulevard at night");
                      }}
                    >
                      <div
                        className="artifact-card-preview"
                        style={{ background: "linear-gradient(135deg, #1b1035 0%, #3b1764 55%, #0e172a 100%)" }}
                      >
                        <IconImage size={28} style={{ color: "#e9d5ff", opacity: 0.92 }} />
                      </div>
                      <div className="artifact-card-title">Create Image Studio</div>
                      <div className="artifact-card-time">Multiple styles &amp; ratios</div>
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
                          <div className="assistant-avatar-wrap" aria-hidden="true">
                            <Logo variant="mark" size="xs" tile="circle" />
                          </div>
                        )}

                        <div className={`message-bubble-box ${isUser ? "user-box" : "assistant-box"}`}>
                          {msg.mediaType === "voice" && (
                            <div className="msg-voice-tag" title="From live voice call">
                              <IconPhone size={11} />
                              <span>Voice</span>
                            </div>
                          )}
                          {/* User uploaded image thumbnails (supports up to 4 images + tap to Ask about this part) */}
                          {isUser && (msg.mediaUrls?.length || msg.mediaUrl) && (
                            <div className="user-uploaded-images-grid">
                              {(msg.mediaUrls || [msg.mediaUrl!]).map((url, imgIdx) => (
                                <div key={imgIdx} className="user-uploaded-image-wrapper">
                                  <img
                                    src={url}
                                    alt={`Uploaded attachment ${imgIdx + 1}`}
                                    className="user-uploaded-img"
                                    onClick={() => handleOpenAskAboutPart(url, `image-${imgIdx + 1}.jpg`)}
                                    title="Tap to inspect or ask about a specific part"
                                  />
                                  <button
                                    type="button"
                                    className="user-uploaded-ask-part-btn"
                                    onClick={() => handleOpenAskAboutPart(url, `image-${imgIdx + 1}.jpg`)}
                                  >
                                    Ask about part
                                  </button>
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

                          {/* 1. Assistant Image Card if mediaType is image */}
                          {!isUser && msg.mediaType === "image" && (
                            <ImageCreationCard
                              chatId={activeChat.id}
                              messageId={msg.id}
                              prompt={msg.originalRequest || msg.mediaPrompt || msg.content}
                              finalPrompt={msg.finalPrompt}
                              imageUrl={msg.mediaUrl}
                              fullQualityUrl={getFullQualityImageUrl(msg.id)}
                              style={msg.style}
                              aspect={msg.aspect}
                              width={msg.width}
                              height={msg.height}
                              seed={msg.seed}
                              status={msg.status}
                              errorMessage={msg.errorMessage}
                              warnings={msg.warnings}
                              addDownloadWatermark={!!preferences.addDownloadWatermark}
                              isGuest={isGuest}
                              onLazyLoadAsset={() => loadLazyImageForMessage(activeChat.id, msg.id)}
                              onRegenerate={() => regenerateMessageImage(activeChat.id, msg.id)}
                              onVariation={() => regenerateMessageImage(activeChat.id, msg.id, { variation: true })}
                              onEditPrompt={(newPrompt) =>
                                regenerateMessageImage(activeChat.id, msg.id, { editedPrompt: newPrompt })
                              }
                              onDeleteImage={() => deleteMessageImage(activeChat.id, msg.id)}
                              onReportImage={() => reportMessageImage(activeChat.id, msg.id)}
                              onRetryError={() => regenerateMessageImage(activeChat.id, msg.id)}
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
                          {!isUser && msg.content && msg.status !== "error" && (
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

                          {!isUser && isDebugMode && msg.routerMeta && (
                            <div className="debug-router-pill">
                              route: {msg.routerMeta.intent} ({Math.round(msg.routerMeta.confidence * 100)}%) ·{" "}
                              {msg.routerMeta.reason}
                            </div>
                          )}

                          {!isUser && isDebugMode && msg.visionDebug && (
                            <div className="debug-router-pill" data-testid="vision-debug-line">
                              vision: {msg.visionDebug.payload_kb} KB · {msg.visionDebug.image_count} img · route:{msg.visionDebug.route} · {msg.visionDebug.latency_ms} ms · status:{msg.visionDebug.status}
                              {msg.visionDebug.error ? ` · err:${msg.visionDebug.error}` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* Sending / Generating indicator: ONLY before text tokens start AND never duplicate image skeletons */}
                {isSending &&
                  (!activeChat.messages.length ||
                    activeChat.messages[activeChat.messages.length - 1].role !== "assistant" ||
                    (!activeChat.messages[activeChat.messages.length - 1].content &&
                      activeChat.messages[activeChat.messages.length - 1].mediaType !== "image")) && (
                    <div className="message-row assistant-row">
                      <div className="assistant-avatar-wrap" aria-hidden="true">
                        <Logo variant="mark" size="xs" tile="circle" />
                      </div>
                      <div className="message-bubble-box assistant-box">
                        {visionStage ? (
                          <div className="vision-bubble-stage">
                            <div className="typing-dots">
                              <span className="dot"></span>
                              <span className="dot"></span>
                              <span className="dot"></span>
                            </div>
                            <span className="vision-bubble-stage-text">
                              {visionStage === "preparing"
                                ? "Preparing the image..."
                                : visionStage === "reading"
                                ? "Reading..."
                                : visionStage === "checking"
                                ? "Checking details..."
                                : "Writing the answer..."}
                            </span>
                          </div>
                        ) : (
                          <div className="typing-dots">
                            <span className="dot"></span>
                            <span className="dot"></span>
                            <span className="dot"></span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}
          </main>

          {/* Floating Scroll-to-Latest Button (anchored cleanly inside .chat-scroll-stage above input bar) */}
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
        </div>

        {/* Bottom Input Zone (Visible when in active conversation) */}
        {activeChat && activeChat.messages.length > 0 && (
          <footer className="conversation-input-bar">
            {renderDeleteErrorBanner()}
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
              {renderImageModeControls()}
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputContent}
                onChange={(e) => setInputContent(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handleComposerPaste}
                placeholder={
                  inputMode === "image"
                    ? "Describe the visual you want to create..."
                    : inputMode === "video"
                    ? "Render a cinematic scene with Video Studio..."
                    : preferences.enterToSend === false
                    ? t("askAnythingCtrlEnter")
                    : t("askAnythingEnter")
                }
                className="chat-input-textarea"
              />

              {renderComposerAttachmentArea()}

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

                    {renderAttachmentDropdown(isAttachmentMenuOpen, () => setIsAttachmentMenuOpen(false))}
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
                  {/* Live Voice Call */}
                  <button
                    type="button"
                    className="voice-call-launch-btn"
                    onClick={handleLaunchVoiceCall}
                    title="Start live voice call"
                    aria-label="Start voice call"
                  >
                    <IconPhone size={15} />
                  </button>

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

      {/* Single Root Account Menu Portal (never duplicated between desktop/mobile sidebars) */}
      <UserMenuDropdown
        isOpen={isUserMenuOpen}
        onClose={() => closeOverlay("accountMenu")}
        anchorRef={accountAnchorRef}
        userName={userName}
        userEmail={user?.email || (isGuest ? "Guest session" : "Signed in")}
        interfaceLanguage={preferences.interfaceLanguage || "English"}
        showInstallOption={isInstallSupported}
        onInstallPwa={() => {
          triggerInstall();
          if (!isIos) {
            closeOverlay("accountMenu");
          }
        }}
        onOpenSettings={(tab, sub) => openSettings(tab ?? null, sub || "main")}
        onLogout={() => {
          closeAllOverlays();
          logout();
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={route.isSettings}
        isExactList={route.isExactSettingsList}
        activeTab={route.settingsTab}
        subView={route.settingsSubView}
        onSelectSection={(tab, sub) => navigateSettings(tab, sub || "main")}
        onBack={goBackFromSettings}
        onClose={closeSettings}
      />

      {/* Project Management Modal */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        editingProject={editingProject}
      />

      {/* iOS Safari PWA Install Guide Sheet */}
      <PwaInstallModal />

      {/* Live Voice Call Mode */}
      <VoiceCallModal
        isOpen={isVoiceCallOpen}
        onClose={() => closeOverlay("voiceCall")}
      />

      {/* Image Editor / "Ask about this part" Sheet (Hardware Back supported via navigation overlay) */}
      <ImageEditorModal
        isOpen={
          isImageEditorOpen &&
          ((editingImageIndex !== null && !!attachedImages[editingImageIndex]) || !!askPartTarget)
        }
        mode={askPartTarget ? "askPart" : "edit"}
        fileName={
          askPartTarget
            ? askPartTarget.fileName
            : editingImageIndex !== null && attachedImages[editingImageIndex]
            ? attachedImages[editingImageIndex].fileName
            : "image.jpg"
        }
        sourceUrl={
          askPartTarget
            ? askPartTarget.url
            : editingImageIndex !== null && attachedImages[editingImageIndex]
            ? attachedImages[editingImageIndex].originalDataUrl
            : ""
        }
        initialEdits={
          !askPartTarget && editingImageIndex !== null && attachedImages[editingImageIndex]
            ? attachedImages[editingImageIndex].edits
            : DEFAULT_IMAGE_EDITS
        }
        onClose={() => closeOverlay("imageEditor")}
        onApplyEdit={
          editingImageIndex !== null
            ? (nextEdits) => handleApplyEditorChanges(editingImageIndex, nextEdits)
            : undefined
        }
        onAskAboutPart={askPartTarget ? handleConfirmAskAboutPart : undefined}
      />

      {/* In-App Camera Capture Modal (Hardware Back supported via navigation overlay) */}
      <CameraCaptureModal
        isOpen={isCameraCaptureOpen}
        onClose={() => {
          setRetakeTargetIndex(null);
          closeOverlay("cameraCapture");
        }}
        onCaptureFile={async (file) => {
          const targetIdx = retakeTargetIndex;
          setRetakeTargetIndex(null);
          await processIncomingFiles([file], "camera", targetIdx);
        }}
        onFallbackSystemCamera={() => cameraInputRef.current?.click()}
      />

      {/* Calm Guest Limit / Voice Call Login Modal */}
      {showGuestLimitModal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setGuestModalReason("limit");
            setShowGuestLimitModal(false);
          }}
        >
          <div className="guest-limit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="guest-modal-icon">
              <Logo variant="mark" size="md" tile="circle" />
            </div>
            <h3 className="guest-modal-title">
              {guestModalReason === "voiceCall" ? "Log in to use voice calls" : "Log in to continue"}
            </h3>
            <p className="guest-modal-desc">
              {guestModalReason === "voiceCall"
                ? "Voice calls are available for signed-in users. Log in with your Google or email account to start a live voice call."
                : "You've reached your free 5 guest messages. Sign in with your Google or email account to unlock unlimited messaging, multimodal image understanding, and persistent memory."}
            </p>
            <div className="guest-modal-actions">
              <button
                type="button"
                className="guest-modal-login-btn"
                onClick={() => {
                  setGuestModalReason("limit");
                  setShowGuestLimitModal(false);
                  setIsAuthScreenVisible(true);
                }}
              >
                Sign In / Create Account
              </button>
              <button
                type="button"
                className="guest-modal-close-btn"
                onClick={() => {
                  setGuestModalReason("limit");
                  setShowGuestLimitModal(false);
                }}
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
