import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import {
  postChatMessage,
  streamChatMessage,
  type ChatMessagePayload,
  type MultimodalPart,
} from "../api/client";
import { useAuth } from "./auth";

export interface MessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  mediaType?: "text" | "image" | "video" | "voice";
  mediaUrl?: string;
  mediaUrls?: string[];
  mediaPrompt?: string;
  videoDuration?: string;
}

export interface AttachmentImageItem {
  dataUrl: string;
  fileName: string;
}

export interface AttachmentPayload {
  type: "image" | "file";
  dataUrl?: string;
  fileName?: string;
  images?: AttachmentImageItem[];
  textContent?: string;
}

export interface ChatItem {
  id: string;
  title: string;
  updated_at: string;
  messages: MessageItem[];
}

export interface UserMemoryStore {
  userName?: string;
  facts: string[];
}

export interface ChatsContextType {
  chats: ChatItem[];
  activeChatId: string | null;
  activeChat: ChatItem | null;
  memory: UserMemoryStore;
  createNewChat: () => string;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => void;
  renameChat: (id: string, newTitle: string) => void;
  clearAllChats: () => void;
  resetMemory: () => void;
  updateCallName: (name: string) => void;
  sendMessage: (
    content: string,
    mode?: "chat" | "image" | "video" | "voice",
    attachment?: AttachmentPayload | null
  ) => Promise<void>;
  isSending: boolean;
  guestMsgCount: number;
  guestMessagesRemaining: number;
  showGuestLimitModal: boolean;
  setShowGuestLimitModal: (show: boolean) => void;
}

// One-time legacy cleanup to permanently erase un-namespaced shared keys
const LEGACY_CLEANUP_KEY = "autonexis_legacy_v2_cleaned";
if (typeof window !== "undefined") {
  try {
    if (!localStorage.getItem(LEGACY_CLEANUP_KEY)) {
      localStorage.removeItem("autonexis_saved_chats");
      localStorage.removeItem("autonexis_user_memories");
      localStorage.removeItem("autonexis_user_avatar");
      localStorage.removeItem("autonexis_guest_msg_count");
      localStorage.setItem(LEGACY_CLEANUP_KEY, "true");
    }
  } catch {}
}

// User-namespaced storage key helpers
function getChatsStorageKey(uid: string | null): string {
  if (!uid) return "autonexis:guest:chats";
  return `autonexis:${uid}:chats`;
}

function getMemoryStorageKey(uid: string | null): string {
  if (!uid) return "autonexis:guest:memory";
  return `autonexis:${uid}:memory`;
}

function getActiveChatIdKey(uid: string | null): string {
  if (!uid) return "autonexis:guest:active_chat_id";
  return `autonexis:${uid}:active_chat_id`;
}

const GUEST_MSG_COUNT_KEY = "autonexis:guest:msg_count";

function createEmptyChat(): ChatItem {
  return {
    id: "chat-" + Date.now(),
    title: "New Chat",
    updated_at: "Just now",
    messages: [],
  };
}

function loadStoredChats(uid: string | null): ChatItem[] {
  if (!uid) return [createEmptyChat()];
  try {
    const raw = localStorage.getItem(getChatsStorageKey(uid));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return [createEmptyChat()];
}

function loadStoredMemory(uid: string | null, fallbackName: string): UserMemoryStore {
  if (!uid) return { userName: fallbackName, facts: [] };
  try {
    const raw = localStorage.getItem(getMemoryStorageKey(uid));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        userName: parsed.userName || fallbackName,
        facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      };
    }
  } catch {}
  return { userName: fallbackName, facts: [] };
}

const ChatsContext = createContext<ChatsContextType | undefined>(undefined);

// Helper function to extract personal facts mentioned across chats
function extractAllFactsFromChats(allChats: ChatItem[]): string[] {
  const factsSet = new Set<string>();

  for (const c of allChats) {
    if (!c.messages) continue;
    for (const m of c.messages) {
      if (m.role === "user") {
        const text = m.content.trim();
        // City / Location
        const cityMatch = text.match(/(?:rehta hu|living in|from|live in)\s+([A-Za-z\u0900-\u097F]+)/i);
        if (cityMatch && cityMatch[1] && cityMatch[1].length >= 3) {
          factsSet.add(`Lives in: ${cityMatch[1].trim()}`);
        }
        // Work / Role
        const profMatch = text.match(/(?:kaam karta hu|working as|main ek|i am a|i work as)\s+([A-Za-z\u0900-\u097F\s]{3,25})/i);
        if (profMatch && profMatch[1]) {
          factsSet.add(`Work: ${profMatch[1].trim()}`);
        }
        // Likes
        const likeMatch = text.match(/(?:mujhe|i like|i love)\s+([^,.]+?)\s+(?:pasand hai|accha lagta hai)/i);
        if (likeMatch && likeMatch[1]) {
          factsSet.add(`Likes: ${likeMatch[1].trim()}`);
        }
      }
    }
  }

  return Array.from(factsSet);
}

// Function to build rich cross-chat memory and summaries
function getCrossChatMemoryContext(allChats: ChatItem[], currentId: string | null): string {
  const pastChats = allChats.filter((c) => c.id !== currentId && c.messages && c.messages.length > 0);
  if (pastChats.length === 0) return "";

  const sections: string[] = [];
  sections.push("[CROSS-CHAT MEMORY - PREVIOUS CONVERSATIONS WITH THIS USER]:");
  sections.push("Below is what the user talked about in their other previous chats. You MUST remember these facts, topics, and discussions if the user asks about them or refers to past chats:\n");

  const recentPast = pastChats.slice(0, 6);

  recentPast.forEach((pc, idx) => {
    const userMessages = pc.messages.filter((m) => m.role === "user").map((m) => m.content);
    const assistantMessages = pc.messages.filter((m) => m.role === "assistant").map((m) => m.content);
    const lastAssistant = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : "";

    sections.push(`--- Past Chat #${idx + 1}: "${pc.title}" ---`);
    if (userMessages.length > 0) {
      sections.push(`User said: ${userMessages.map((m) => `"${m}"`).join(" -> ")}`);
    }
    if (lastAssistant) {
      const truncated = lastAssistant.length > 200 ? lastAssistant.slice(0, 200) + "..." : lastAssistant;
      sections.push(`Assistant replied: "${truncated.replace(/\n+/g, " ")}"`);
    }
  });

  sections.push("\nINSTRUCTION FOR CROSS-CHAT MEMORY:");
  sections.push("1. When the user asks 'humne pehle kya baat ki thi?', 'pichli chat me maine kya bola tha?', 'tujhe yaad hai?', or refers to an earlier conversation, ALWAYS use the above past chats to answer accurately and with personal detail.");
  sections.push("2. NEVER say 'I don't remember past chats' or 'Each chat is separate'. In AUTONEXIS Assistant, you have active continuous memory across all chats!");

  return sections.join("\n");
}

export const ChatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isGuest, updateProfileName } = useAuth();
  const currentUid = user?.id || (isGuest ? "guest" : null);

  // References to actively track current UID and abort in-flight streams on switch
  const activeUidRef = useRef<string | null>(currentUid);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [guestMsgCount, setGuestMsgCount] = useState<number>(() => {
    try {
      return parseInt(localStorage.getItem(GUEST_MSG_COUNT_KEY) || "0", 10);
    } catch {
      return 0;
    }
  });
  const [showGuestLimitModal, setShowGuestLimitModal] = useState<boolean>(false);
  const guestMessagesRemaining = Math.max(0, 5 - guestMsgCount);

  // Load persistent cross-chat memory
  const [memory, setMemory] = useState<UserMemoryStore>(() => {
    const defName = user?.display_name && user.display_name !== "User" ? user.display_name : "User";
    return loadStoredMemory(currentUid, defName);
  });

  // Load saved chats
  const [chats, setChats] = useState<ChatItem[]>(() => {
    return loadStoredChats(currentUid);
  });

  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    const initialChats = loadStoredChats(currentUid);
    if (!currentUid) return initialChats[0]?.id || null;
    try {
      const saved = localStorage.getItem(getActiveChatIdKey(currentUid));
      if (saved && initialChats.some((c) => c.id === saved)) {
        return saved;
      }
    } catch {}
    return initialChats[0]?.id || null;
  });

  const [isSending, setIsSending] = useState(false);

  // Immediate account-switching effect: abort streams, reset memory, load user's isolated data
  useEffect(() => {
    if (activeUidRef.current !== currentUid) {
      // 1. Immediately abort any in-flight stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsSending(false);

      // 2. Update active UID ref
      activeUidRef.current = currentUid;

      // 3. Clear and reload user-specific data
      const loaded = loadStoredChats(currentUid);
      setChats(loaded);

      let targetActiveId: string | null = loaded[0]?.id || null;
      if (currentUid) {
        try {
          const saved = localStorage.getItem(getActiveChatIdKey(currentUid));
          if (saved && loaded.some((c) => c.id === saved)) {
            targetActiveId = saved;
          }
        } catch {}
      }
      setActiveChatId(targetActiveId);

      const defName = user?.display_name && user.display_name !== "User" ? user.display_name : "User";
      setMemory(loadStoredMemory(currentUid, defName));

      if (currentUid === "guest") {
        try {
          setGuestMsgCount(parseInt(localStorage.getItem(GUEST_MSG_COUNT_KEY) || "0", 10));
        } catch {
          setGuestMsgCount(0);
        }
      }
    }
  }, [currentUid, user?.display_name]);

  // Sync memory to user-namespaced storage
  useEffect(() => {
    if (!currentUid) return;
    try {
      localStorage.setItem(getMemoryStorageKey(currentUid), JSON.stringify(memory));
    } catch {}
  }, [memory, currentUid]);

  // Sync chats to user-namespaced storage
  useEffect(() => {
    if (!currentUid) return;
    try {
      localStorage.setItem(getChatsStorageKey(currentUid), JSON.stringify(chats));
    } catch {}
  }, [chats, currentUid]);

  // Sync activeChatId to user-namespaced storage
  useEffect(() => {
    if (!currentUid) return;
    try {
      if (activeChatId) {
        localStorage.setItem(getActiveChatIdKey(currentUid), activeChatId);
      } else {
        localStorage.removeItem(getActiveChatIdKey(currentUid));
      }
    } catch {}
  }, [activeChatId, currentUid]);

  // Multi-tab synchronization via BroadcastChannel and storage events
  useEffect(() => {
    let channel: BroadcastChannel | null = null;

    const handleSync = (_type: string, uid?: string | null) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsSending(false);

      const targetUid = uid !== undefined ? uid : null;
      if (targetUid !== activeUidRef.current) {
        activeUidRef.current = targetUid;
        const loaded = loadStoredChats(targetUid);
        setChats(loaded);
        setActiveChatId(loaded[0]?.id || null);
        setMemory(loadStoredMemory(targetUid, "User"));
      }
    };

    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel("autonexis_auth_sync");
        channel.onmessage = (event) => {
          if (event.data?.type === "LOGOUT") {
            handleSync("LOGOUT", null);
          } else if (event.data?.type === "AUTH_CHANGED") {
            handleSync("AUTH_CHANGED", event.data.uid || null);
          }
        };
      } catch {}
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "autonexis_auth_sync_event") {
        try {
          const parsed = JSON.parse(e.newValue || "{}");
          if (parsed?.type === "LOGOUT") {
            handleSync("LOGOUT", null);
          } else if (parsed?.type === "AUTH_CHANGED") {
            handleSync("AUTH_CHANGED", parsed.uid || null);
          }
        } catch {}
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      if (channel) {
        try {
          channel.close();
        } catch {}
      }
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const activeChat = chats.find((c) => c.id === activeChatId) || null;

  const createNewChat = (): string => {
    const freshChat = createEmptyChat();
    setChats((prev) => [freshChat, ...prev]);
    setActiveChatId(freshChat.id);
    return freshChat.id;
  };

  const selectChat = (id: string) => {
    setActiveChatId(id);
  };

  const deleteChat = (id: string) => {
    setChats((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (activeChatId === id) {
        if (remaining.length > 0) {
          setActiveChatId(remaining[0].id);
        } else {
          const freshChat = createEmptyChat();
          setActiveChatId(freshChat.id);
          return [freshChat];
        }
      }
      return remaining;
    });
  };

  const renameChat = (id: string, newTitle: string) => {
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle.trim() || c.title } : c))
    );
  };

  const clearAllChats = () => {
    const freshChat = createEmptyChat();
    setChats([freshChat]);
    setActiveChatId(freshChat.id);
    if (currentUid) {
      try {
        localStorage.setItem(getChatsStorageKey(currentUid), JSON.stringify([freshChat]));
        localStorage.setItem(getActiveChatIdKey(currentUid), freshChat.id);
      } catch {}
    }
  };

  const resetMemory = () => {
    const freshMemory: UserMemoryStore = {
      userName: user?.display_name && user.display_name !== "User" ? user.display_name : "User",
      facts: [],
    };
    setMemory(freshMemory);
    if (currentUid) {
      try {
        localStorage.setItem(getMemoryStorageKey(currentUid), JSON.stringify(freshMemory));
      } catch {}
    }
  };

  const updateCallName = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setMemory((prev) => {
      const updated = { ...prev, userName: clean };
      if (currentUid) {
        try {
          localStorage.setItem(getMemoryStorageKey(currentUid), JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });
  };

  // Robust Helper to extract user name or facts from user's message
  const extractUserMemory = (text: string): { extractedName?: string; newFact?: string } => {
    const clean = text.trim();
    let extractedName: string | undefined = undefined;
    let newFact: string | undefined = undefined;

    // 1. Name patterns covering English, Hindi, and Hinglish variants
    const namePatterns = [
      /(?:mera|apna|my)\s+(?:naam|name|nam)\s+([A-Za-z\u0900-\u097F]+)/i,
      /(?:mujhe|call me|ap mujhe)\s+([A-Za-z\u0900-\u097F]+)\s+(?:kaho|bolo|bulana|bolna|kehna)/i,
      /([A-Za-z\u0900-\u097F]+)\s+(?:kehna mujhe|kaho mujhe|bolo mujhe|bulana mujhe)/i,
      /(?:call me|i am|i'm|im)\s+([A-Za-z\u0900-\u097F]+)/i,
      /(?:naam|name|nam)\s+(?:hai|is)\s+([A-Za-z\u0900-\u097F]+)/i,
    ];

    const disallowedWords = new Set([
      "a", "an", "the", "fine", "good", "sad", "dukhi", "khush", "happy", "here", 
      "ek", "nahi", "kya", "theek", "kaise", "batao", "kaun", "kuchh", "kuch",
      "bhi", "yeh", "woh", "sir", "madam", "ai", "bot", "assistant", "autonexis", "friend"
    ]);

    for (const regex of namePatterns) {
      const match = clean.match(regex);
      if (match && match[1]) {
        const candidate = match[1].trim();
        if (!disallowedWords.has(candidate.toLowerCase()) && candidate.length >= 2) {
          extractedName = candidate.charAt(0).toUpperCase() + candidate.slice(1);
          break;
        }
      }
    }

    if (extractedName) {
      setMemory((prev) => {
        const updated = { ...prev, userName: extractedName };
        if (currentUid) {
          try {
            localStorage.setItem(getMemoryStorageKey(currentUid), JSON.stringify(updated));
          } catch {}
        }
        return updated;
      });
      updateProfileName(extractedName);
    }

    // 2. City / location patterns
    const cityMatch = clean.match(/(?:rehta hu|living in|from|live in)\s+([A-Za-z\u0900-\u097F]+)/i);
    if (cityMatch && cityMatch[1]) {
      const city = cityMatch[1].trim();
      if (!disallowedWords.has(city.toLowerCase())) {
        newFact = `Lives in / from ${city}`;
        setMemory((prev) => {
          if (!prev.facts.includes(newFact!)) {
            const updated = { ...prev, facts: [...prev.facts, newFact!] };
            if (currentUid) {
              try {
                localStorage.setItem(getMemoryStorageKey(currentUid), JSON.stringify(updated));
              } catch {}
            }
            return updated;
          }
          return prev;
        });
      }
    }

    // 3. Likes patterns
    const likesMatch = clean.match(/(?:mujhe|i like|i love)\s+([^,.]+?)\s+(?:pasand hai|accha lagta hai)/i);
    if (likesMatch && likesMatch[1]) {
      newFact = `Likes: ${likesMatch[1].trim()}`;
      setMemory((prev) => {
        if (!prev.facts.includes(newFact!)) {
          const updated = { ...prev, facts: [...prev.facts, newFact!] };
          if (currentUid) {
            try {
              localStorage.setItem(getMemoryStorageKey(currentUid), JSON.stringify(updated));
            } catch {}
          }
          return updated;
        }
        return prev;
      });
    }

    return { extractedName, newFact };
  };

  const sendMessage = async (
    content: string,
    mode: "chat" | "image" | "video" | "voice" = "chat",
    attachment?: AttachmentPayload | null
  ) => {
    const trimmed = content.trim();
    if ((!trimmed && !attachment) || isSending) return;

    if (isGuest) {
      if (guestMsgCount >= 5) {
        setShowGuestLimitModal(true);
        return;
      }
      if (attachment?.type === "image") {
        setShowGuestLimitModal(true);
        return;
      }
    }

    let targetChatId = activeChatId;
    if (!targetChatId) {
      targetChatId = createNewChat();
    }

    // Check if message is an image generation request
    const isImageRequest =
      mode === "image" ||
      /(?:create|generate|make|draw)\s+(?:an?\s+)?(?:image|photo|picture|wallpaper|drawing)|(?:photo|image|tasveer|chhavi)\s+(?:banao|karo|bana\s+do)/i.test(trimmed);

    // Check if message is a video generation request
    const isVideoRequest =
      mode === "video" ||
      /(?:create|generate|make|render)\s+(?:an?\s+)?(?:video|clip|animation|cinematic)|(?:video)\s+(?:banao|karo|bana\s+do)/i.test(trimmed);

    // Immediately extract memory from user message
    const { extractedName, newFact } = extractUserMemory(trimmed);

    const attachedImages = attachment?.type === "image"
      ? (attachment.images && attachment.images.length > 0
          ? attachment.images
          : attachment.dataUrl ? [{ dataUrl: attachment.dataUrl, fileName: attachment.fileName || "image.jpg" }] : [])
      : [];

    const fileLabel = attachedImages.length > 0
      ? `[Attached ${attachedImages.length} image${attachedImages.length > 1 ? "s" : ""}: ${attachedImages.map((img) => img.fileName).join(", ")}]`
      : attachment?.fileName ? `[Attached: ${attachment.fileName}]` : "";

    const userMsg: MessageItem = {
      id: "usr_" + Date.now(),
      role: "user",
      content: trimmed || fileLabel,
      mediaType: attachedImages.length > 0 ? "image" : undefined,
      mediaUrl: attachedImages[0]?.dataUrl,
      mediaUrls: attachedImages.length > 0 ? attachedImages.map((img) => img.dataUrl) : undefined,
      created_at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const currentChat = chats.find((c) => c.id === targetChatId);
    const isFirst = !currentChat || currentChat.messages.length === 0;
    const words = (trimmed || fileLabel).split(" ");
    const autoTitle = isFirst ? (words.slice(0, 6).join(" ") + (words.length > 6 ? "..." : "")) : currentChat.title;

    setChats((prev) =>
      prev.map((c) => {
        if (c.id === targetChatId) {
          return {
            ...c,
            title: autoTitle,
            updated_at: "Just now",
            messages: [...c.messages, userMsg],
          };
        }
        return c;
      })
    );

    setIsSending(true);

    if (isGuest) {
      const nextCount = guestMsgCount + 1;
      setGuestMsgCount(nextCount);
      try {
        localStorage.setItem(GUEST_MSG_COUNT_KEY, nextCount.toString());
      } catch {}
    }

    if (isImageRequest) {
      const imagePrompt = trimmed
        .replace(/(?:create|generate|make|draw)\s+(?:an?\s+)?(?:image|photo|picture|wallpaper|drawing)\s+(?:of\s+)?/i, "")
        .replace(/(?:photo|image|tasveer)\s+(?:banao|karo|bana\s+do)/i, "")
        .trim() || trimmed;

      const seed = Math.floor(Math.random() * 900000) + 100000;
      const generatedImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1024&height=768&nologo=true&private=true&seed=${seed}`;

      setTimeout(() => {
        const assistantMsg: MessageItem = {
          id: "ast_" + Date.now(),
          role: "assistant",
          content: `Here is your generated image for: "${imagePrompt}"`,
          mediaType: "image",
          mediaUrl: generatedImageUrl,
          mediaPrompt: imagePrompt,
          created_at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        setChats((prev) =>
          prev.map((c) => {
            if (c.id === targetChatId) {
              return {
                ...c,
                messages: [...c.messages, assistantMsg],
              };
            }
            return c;
          })
        );
        setIsSending(false);
      }, 1000);
      return;
    }

    if (isVideoRequest) {
      const videoPrompt = trimmed
        .replace(/(?:create|generate|make|render)\s+(?:an?\s+)?(?:video|clip|animation)\s+(?:of\s+)?/i, "")
        .replace(/(?:video)\s+(?:banao|karo|bana\s+do)/i, "")
        .trim() || trimmed;

      setTimeout(() => {
        const assistantMsg: MessageItem = {
          id: "ast_" + Date.now(),
          role: "assistant",
          content: `Here is your cinematic 4K video rendering for: "${videoPrompt}"`,
          mediaType: "video",
          mediaPrompt: videoPrompt,
          videoDuration: "00:05",
          created_at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        setChats((prev) =>
          prev.map((c) => {
            if (c.id === targetChatId) {
              return {
                ...c,
                messages: [...c.messages, assistantMsg],
              };
            }
            return c;
          })
        );
        setIsSending(false);
      }, 1200);
      return;
    }

    // Build immediate, non-stale memory context string
    const effectiveUserName =
      extractedName ||
      memory.userName ||
      (user?.display_name && user?.display_name !== "User" ? user.display_name : "User");

    // Gather facts from current memory and scan across all past chats
    const pastFacts = extractAllFactsFromChats(chats);
    const combinedFactsSet = new Set([...memory.facts, ...pastFacts]);
    if (newFact) combinedFactsSet.add(newFact);
    const allFacts = Array.from(combinedFactsSet);

    // Build rich cross-chat memory recap from all other conversations
    const crossChatContext = getCrossChatMemoryContext(chats, targetChatId);

    let memoryPrompt = `User's Name: ${effectiveUserName}.\n`;

    // Strict Language Mirroring Detection
    const hasDevanagari = /[\u0900-\u097F]/.test(trimmed);
    const hinglishMarkers = [
      "kya", "kar", "rhe", "rahe", "ho", "hai", "hain", "hu", "hoon", "mera", "meri", "mere",
      "naam", "nam", "kaise", "kaisa", "kaisi", "batao", "bataiye", "bol", "bolo", "bolna",
      "kaho", "kehna", "aaj", "kal", "dukhi", "khush", "yaar", "bhai", "dost", "thik", "theek",
      "nahi", "nahin", "mat", "karo", "karna", "acha", "achha", "accha", "bahut", "bohot",
      "samajh", "aaya", "gaya", "chahiye", "kuch", "kuchh", "yeh", "ye", "woh", "wo", "apna",
      "apne", "apni", "aap", "tum", "tu", "kyu", "kyun", "kaha", "kahan", "kab", "kaun",
      "kaam", "baat", "bata", "rakho", "rakh", "dekh", "dekho", "suno", "sun", "paas", "bhi"
    ];
    const inputWords = trimmed.toLowerCase().split(/[\s,?.!;:()"]+/);
    const isHinglish = !hasDevanagari && inputWords.some((w) => hinglishMarkers.includes(w));

    if (hasDevanagari) {
      memoryPrompt += `\nLANGUAGE MANDATE: User is writing in Devanagari Hindi. Reply naturally in Hindi using Devanagari script.\n`;
    } else if (isHinglish) {
      memoryPrompt += `\nLANGUAGE MANDATE (CRITICAL): User is writing in HINGLISH (Hindi typed in English letters, e.g. "${trimmed}"). You MUST reply in natural, friendly HINGLISH using English/Roman alphabet (e.g. "Main badhiya hoon! Aap batao, sab kaisa chal raha hai?"). NEVER reply in Devanagari Hindi!\n`;
    } else {
      memoryPrompt += `\nLANGUAGE MANDATE: User is writing in English. Reply completely in natural, fluent English.\n`;
    }

    if (extractedName) {
      memoryPrompt += `CRITICAL INSTRUCTION: The user has just explicitly requested/instructed you to address them as "${extractedName}" (message: "${trimmed}"). You MUST immediately, warmly, and enthusiastically accept this and call them "${extractedName}". NEVER argue, refuse, or say Google or system prevents you.\n`;
    }

    // Detect if user asks what their name is
    const asksForName = /(?:mera|apna)\s+(?:naam|name|nam)\s+(?:kya|batao)|what(?:\s+is|\s*'s)\s+my\s+name|who\s+am\s+i/i.test(trimmed);
    if (asksForName) {
      memoryPrompt += `CRITICAL INSTRUCTION: The user is explicitly asking for their name ("${trimmed}"). Their remembered name is "${effectiveUserName}". Answer them directly, warmly, and accurately that their name is "${effectiveUserName}".\n`;
    }

    // Detect if user asks about past chats / previous conversations
    const asksAboutPastChats = /(?:pehle|pichli|purani|previous|earlier|last)\s+(?:baat|chat|conversation|cheto|chizo|kya\s+baat)|tujhe\s+yaad\s+hai|kya\s+yaad\s+hai|do\s+you\s+remember/i.test(trimmed);
    if (asksAboutPastChats) {
      memoryPrompt += `\nCRITICAL DIRECTIVE: The user is explicitly asking about their past conversations ("${trimmed}"). You MUST review the past conversations listed below and summarize clearly, warmly, and accurately what they discussed with you in previous chats. Never claim you forgot or cannot see past chats.\n`;
    }

    if (allFacts.length > 0) {
      memoryPrompt += `Known persistent facts about user: ${allFacts.join("; ")}.\n\n`;
    }

    if (crossChatContext) {
      memoryPrompt += `${crossChatContext}\n`;
    }

    const historyPayload: ChatMessagePayload[] = (currentChat?.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    if (attachedImages.length > 0) {
      const parts: MultimodalPart[] = [
        { type: "text", text: trimmed || "Please inspect and analyze the attached images." },
      ];
      for (const img of attachedImages) {
        parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
      }
      historyPayload.push({ role: "user", content: parts });
    } else if (attachment?.type === "file" && attachment.textContent) {
      const fullText = `[Attached: ${attachment.fileName}]\n\`\`\`\n${attachment.textContent}\n\`\`\`\n\n${trimmed}`;
      historyPayload.push({ role: "user", content: fullText });
    } else {
      historyPayload.push({ role: "user", content: trimmed });
    }

    const assistantMsgId = "ast_" + Date.now();

    setChats((prev) =>
      prev.map((c) => {
        if (c.id === targetChatId) {
          return {
            ...c,
            messages: [
              ...c.messages,
              {
                id: assistantMsgId,
                role: "assistant",
                content: "",
                created_at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ],
          };
        }
        return c;
      })
    );

    // Setup abort controller and save calling UID
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestUid = currentUid;

    // -----------------------------------------------------------------------
    // Adaptive Smoothing Buffer via requestAnimationFrame
    // Calms big bursts into smooth 60-120 cps typing without lagging behind
    // -----------------------------------------------------------------------
    let pendingBuffer = "";
    let displayedBuffer = "";
    let isStreamDone = false;
    let animFrameId: number | null = null;
    let lastTime = performance.now();

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const stopAnimation = () => {
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    };

    const flushDisplay = (text: string) => {
      displayedBuffer = text;
      setChats((prev) =>
        prev.map((c) => {
          if (c.id === targetChatId) {
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, content: text } : m
              ),
            };
          }
          return c;
        })
      );
    };

    const pumpAnimation = (now: number) => {
      if (activeUidRef.current !== requestUid || controller.signal.aborted) {
        stopAnimation();
        setIsSending(false);
        return;
      }

      const deltaMs = Math.max(1, now - lastTime);
      lastTime = now;

      const remainingChars = pendingBuffer.length;

      if (remainingChars === 0) {
        if (isStreamDone) {
          stopAnimation();
          setIsSending(false);
          return;
        }
        // Await next incoming network packet
        animFrameId = requestAnimationFrame(pumpAnimation);
        return;
      }

      // Adaptive speed calculation
      let charsPerSec: number;
      if (isStreamDone) {
        // Network finished: flush rest quickly over ~150-250ms
        charsPerSec = Math.max(280, remainingChars * 4);
      } else if (remainingChars < 25) {
        charsPerSec = 75; // Calm, human typing speed
      } else if (remainingChars < 75) {
        charsPerSec = 110;
      } else if (remainingChars < 160) {
        charsPerSec = 200;
      } else {
        charsPerSec = Math.min(500, remainingChars * 3); // Catch up if network sent big burst
      }

      const count = Math.max(1, Math.round((charsPerSec * deltaMs) / 1000));
      const chunk = pendingBuffer.slice(0, count);
      pendingBuffer = pendingBuffer.slice(count);

      displayedBuffer += chunk;
      flushDisplay(displayedBuffer);

      animFrameId = requestAnimationFrame(pumpAnimation);
    };

    try {
      await streamChatMessage(
        historyPayload,
        memoryPrompt,
        // onChunk
        (chunk) => {
          if (activeUidRef.current !== requestUid || controller.signal.aborted) {
            stopAnimation();
            return;
          }

          if (prefersReducedMotion) {
            displayedBuffer += chunk;
            flushDisplay(displayedBuffer);
          } else {
            pendingBuffer += chunk;
            if (animFrameId === null) {
              lastTime = performance.now();
              animFrameId = requestAnimationFrame(pumpAnimation);
            }
          }
        },
        // onDone
        () => {
          if (activeUidRef.current !== requestUid || controller.signal.aborted) {
            stopAnimation();
            setIsSending(false);
            return;
          }
          isStreamDone = true;
          if (prefersReducedMotion || pendingBuffer.length === 0) {
            stopAnimation();
            setIsSending(false);
          }
        },
        // onError fallback
        async () => {
          if (activeUidRef.current !== requestUid || controller.signal.aborted) {
            stopAnimation();
            setIsSending(false);
            return;
          }
          if (!displayedBuffer && !pendingBuffer) {
            try {
              const reply = await postChatMessage(historyPayload, memoryPrompt, isGuest);
              if (activeUidRef.current !== requestUid || controller.signal.aborted) {
                return;
              }
              flushDisplay(reply);
            } catch {}
          }
          stopAnimation();
          setIsSending(false);
        },
        isGuest,
        controller.signal
      );
    } catch {
      stopAnimation();
      setIsSending(false);
    }
  };

  return (
    <ChatsContext.Provider
      value={{
        chats,
        activeChatId,
        activeChat,
        memory,
        createNewChat,
        selectChat,
        deleteChat,
        renameChat,
        clearAllChats,
        resetMemory,
        updateCallName,
        sendMessage,
        isSending,
        guestMsgCount,
        guestMessagesRemaining,
        showGuestLimitModal,
        setShowGuestLimitModal,
      }}
    >
      {children}
    </ChatsContext.Provider>
  );
};

export const useChats = (): ChatsContextType => {
  const context = useContext(ChatsContext);
  if (!context) {
    throw new Error("useChats must be used within a ChatsProvider");
  }
  return context;
};
