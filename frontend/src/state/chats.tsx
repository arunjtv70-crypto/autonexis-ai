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

  // Helper to extract user name or facts from user's message
  const extractUserMemory = (text: string) => {
    // 1. Name patterns: "mera naam X hai", "my name is X", "i am X", "main X hoon"
    const nameMatch =
      text.match(/(?:mera naam|my name is|i am|call me|main)\s+([A-Za-z\u0900-\u097F]+)(?:\s+hai|\s+hoon)?/i);

    if (nameMatch && nameMatch[1]) {
      const extractedName = nameMatch[1].trim();
      const disallowed = ["a", "the", "fine", "good", "sad", "dukhi", "khush", "happy", "here", "ek"];
      if (!disallowed.includes(extractedName.toLowerCase())) {
        const capitalized = extractedName.charAt(0).toUpperCase() + extractedName.slice(1);
        setMemory((prev) => ({
          ...prev,
          userName: capitalized,
        }));
        updateProfileName(capitalized);
      }
    }

    // 2. City / location patterns
    const cityMatch = text.match(/(?:rehta hu|living in|from|live in)\s+([A-Za-z\u0900-\u097F]+)/i);
    if (cityMatch && cityMatch[1]) {
      const city = cityMatch[1].trim();
      setMemory((prev) => {
        const fact = `Lives in / from ${city}`;
        if (!prev.facts.includes(fact)) {
          return { ...prev, facts: [...prev.facts, fact] };
        }
        return prev;
      });
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || isSending) return;

    let targetChatId = activeChatId;
    if (!targetChatId) {
      targetChatId = createNewChat();
    }

    // Extract memory from user message
    extractUserMemory(content);

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

    // Build memory context string to send to backend
    const effectiveUserName = memory.userName || user?.display_name || "Friend";
    let memoryPrompt = `User's Name: ${effectiveUserName}. The user introduced themselves as ${effectiveUserName}. Always remember and state their name if asked.`;
    if (memory.facts.length > 0) {
      memoryPrompt += ` Known facts: ${memory.facts.join("; ")}.`;
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
