import React, { createContext, useContext, useState, useEffect } from "react";
import { postChatMessage, streamChatMessage, type ChatMessagePayload } from "../api/client";
import { useAuth } from "./auth";

export interface MessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface ChatItem {
  id: string;
  title: string;
  updated_at: string;
  messages: MessageItem[];
}

interface UserMemoryStore {
  userName?: string;
  facts: string[];
}

interface ChatsContextType {
  chats: ChatItem[];
  activeChatId: string | null;
  activeChat: ChatItem | null;
  createNewChat: () => string;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => void;
  renameChat: (id: string, newTitle: string) => void;
  sendMessage: (content: string) => Promise<void>;
  isSending: boolean;
}

const CHATS_STORAGE_KEY = "autonexis_saved_chats";
const MEMORY_STORAGE_KEY = "autonexis_user_memories";

const ChatsContext = createContext<ChatsContextType | undefined>(undefined);

export const ChatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, updateProfileName } = useAuth();

  // Load persistent cross-chat memory
  const [memory, setMemory] = useState<UserMemoryStore>(() => {
    try {
      const stored = localStorage.getItem(MEMORY_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // Ignore
    }
    return {
      userName: user?.display_name !== "User" && user?.display_name !== "Guest" ? user?.display_name : undefined,
      facts: [],
    };
  });

  // Load saved chats
  const [chats, setChats] = useState<ChatItem[]>(() => {
    try {
      const stored = localStorage.getItem(CHATS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Storage error
    }
    return [
      {
        id: "chat-" + Date.now(),
        title: "New Chat",
        updated_at: "Just now",
        messages: [],
      },
    ];
  });

  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    return chats.length > 0 ? chats[0].id : null;
  });

  const [isSending, setIsSending] = useState(false);

  // Sync memory to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memory));
    } catch {
      // Storage error
    }
  }, [memory]);

  // Sync chats to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(chats));
    } catch {
      // Storage error
    }
  }, [chats]);

  const activeChat = chats.find((c) => c.id === activeChatId) || null;

  const createNewChat = (): string => {
    const newId = "chat-" + Date.now();
    const newChat: ChatItem = {
      id: newId,
      title: "New Chat",
      updated_at: "Just now",
      messages: [],
    };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newId);
    return newId;
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
          const freshId = "chat-" + Date.now();
          const freshChat: ChatItem = {
            id: freshId,
            title: "New Chat",
            updated_at: "Just now",
            messages: [],
          };
          setActiveChatId(freshId);
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
        try {
          localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
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
            try {
              localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated));
            } catch {}
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
          try {
            localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        }
        return prev;
      });
    }

    return { extractedName, newFact };
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || isSending) return;

    let targetChatId = activeChatId;
    if (!targetChatId) {
      targetChatId = createNewChat();
    }

    // Immediately extract memory from user message
    const { extractedName, newFact } = extractUserMemory(content);

    const userMsg: MessageItem = {
      id: "usr_" + Date.now(),
      role: "user",
      content: content.trim(),
      created_at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const currentChat = chats.find((c) => c.id === targetChatId);
    const isFirst = !currentChat || currentChat.messages.length === 0;
    const words = content.trim().split(" ");
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

    // Build immediate, non-stale memory context string
    const effectiveUserName =
      extractedName ||
      memory.userName ||
      (user?.display_name && user?.display_name !== "User" && user?.display_name !== "Guest User" ? user.display_name : "Arun");

    const allFacts = [...memory.facts];
    if (newFact && !allFacts.includes(newFact)) {
      allFacts.push(newFact);
    }

    let memoryPrompt = `User's Name: ${effectiveUserName}.\n`;
    if (extractedName) {
      memoryPrompt += `CRITICAL INSTRUCTION: The user has just explicitly requested/instructed you to address them as "${extractedName}" (message: "${content}"). You MUST immediately, warmly, and enthusiastically accept this and call them "${extractedName}". NEVER argue, refuse, or say Google or system prevents you.\n`;
    }

    // Detect if user asks what their name is
    const asksForName = /(?:mera|apna)\s+(?:naam|name|nam)\s+(?:kya|batao)|what(?:\s+is|\s*'s)\s+my\s+name|who\s+am\s+i/i.test(content);
    if (asksForName) {
      memoryPrompt += `CRITICAL INSTRUCTION: The user is explicitly asking for their name ("${content}"). Their remembered name is "${effectiveUserName}". Answer them directly, warmly, and accurately that their name is "${effectiveUserName}".\n`;
    }

    if (allFacts.length > 0) {
      memoryPrompt += `Known persistent facts about user: ${allFacts.join("; ")}.\n`;
    }

    const historyPayload: ChatMessagePayload[] = (currentChat?.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    historyPayload.push({ role: "user", content: content.trim() });

    const assistantMsgId = "ast_" + Date.now();
    let accumulatedContent = "";

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

    try {
      await streamChatMessage(
        historyPayload,
        memoryPrompt,
        // onChunk
        (chunk) => {
          accumulatedContent += chunk;
          setChats((prev) =>
            prev.map((c) => {
              if (c.id === targetChatId) {
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, content: accumulatedContent } : m
                  ),
                };
              }
              return c;
            })
          );
        },
        // onDone
        () => {
          setIsSending(false);
        },
        // onError fallback
        async () => {
          if (!accumulatedContent) {
            const reply = await postChatMessage(historyPayload, memoryPrompt);
            setChats((prev) =>
              prev.map((c) => {
                if (c.id === targetChatId) {
                  return {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: reply } : m
                    ),
                  };
                }
                return c;
              })
            );
          }
          setIsSending(false);
        }
      );
    } catch {
      setIsSending(false);
    }
  };

  return (
    <ChatsContext.Provider
      value={{
        chats,
        activeChatId,
        activeChat,
        createNewChat,
        selectChat,
        deleteChat,
        renameChat,
        sendMessage,
        isSending,
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
