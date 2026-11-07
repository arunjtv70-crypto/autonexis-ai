import React, { createContext, useContext, useState, useEffect } from "react";
import { postChatMessage, streamChatMessage, type ChatMessagePayload } from "../api/client";
import { useAuth } from "./auth";

export interface MessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  mediaType?: "text" | "image" | "video" | "voice";
  mediaUrl?: string;
  mediaPrompt?: string;
  videoDuration?: string;
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
  memory: UserMemoryStore;
  createNewChat: () => string;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => void;
  renameChat: (id: string, newTitle: string) => void;
  clearAllChats: () => void;
  resetMemory: () => void;
  updateCallName: (name: string) => void;
  sendMessage: (content: string, mode?: "chat" | "image" | "video" | "voice") => Promise<void>;
  isSending: boolean;
}

const CHATS_STORAGE_KEY = "autonexis_saved_chats";
const MEMORY_STORAGE_KEY = "autonexis_user_memories";

const ChatsContext = createContext<ChatsContextType | undefined>(undefined);

// Helper function to extract any personal facts mentioned across all chats
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
  // Filter other chats that have messages
  const pastChats = allChats.filter((c) => c.id !== currentId && c.messages && c.messages.length > 0);
  if (pastChats.length === 0) return "";

  const sections: string[] = [];
  sections.push("[CROSS-CHAT MEMORY - PREVIOUS CONVERSATIONS WITH THIS USER]:");
  sections.push("Below is what the user talked about in their other previous chats. You MUST remember these facts, topics, and discussions if the user asks about them or refers to past chats:\n");

  // Include up to 6 recent past chats
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
  const { user, updateProfileName } = useAuth();

  // Load persistent cross-chat memory
  const [memory, setMemory] = useState<UserMemoryStore>(() => {
    try {
      const stored = localStorage.getItem(MEMORY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          userName: parsed.userName || (user?.display_name && user.display_name !== "User" ? user.display_name : "User"),
          facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        };
      }
    } catch {
      // Ignore
    }
    return {
      userName: user?.display_name && user.display_name !== "User" ? user.display_name : "User",
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

  const clearAllChats = () => {
    const freshId = "chat-" + Date.now();
    const freshChat: ChatItem = {
      id: freshId,
      title: "New Chat",
      updated_at: "Just now",
      messages: [],
    };
    setChats([freshChat]);
    setActiveChatId(freshId);
    try {
      localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify([freshChat]));
    } catch {}
  };

  const resetMemory = () => {
    const freshMemory: UserMemoryStore = {
      userName: user?.display_name && user.display_name !== "User" ? user.display_name : "User",
      facts: [],
    };
    setMemory(freshMemory);
    try {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(freshMemory));
    } catch {}
  };

  const updateCallName = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setMemory((prev) => {
      const updated = { ...prev, userName: clean };
      try {
        localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
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

  const sendMessage = async (content: string, mode: "chat" | "image" | "video" | "voice" = "chat") => {
    if (!content.trim() || isSending) return;

    let targetChatId = activeChatId;
    if (!targetChatId) {
      targetChatId = createNewChat();
    }

    // Check if message is an image generation request
    const isImageRequest =
      mode === "image" ||
      /(?:create|generate|make|draw)\s+(?:an?\s+)?(?:image|photo|picture|wallpaper|drawing)|(?:photo|image|tasveer|chhavi)\s+(?:banao|karo|bana\s+do)/i.test(content);

    // Check if message is a video generation request
    const isVideoRequest =
      mode === "video" ||
      /(?:create|generate|make|render)\s+(?:an?\s+)?(?:video|clip|animation|cinematic)|(?:video)\s+(?:banao|karo|bana\s+do)/i.test(content);

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

    if (isImageRequest) {
      const imagePrompt = content
        .replace(/(?:create|generate|make|draw)\s+(?:an?\s+)?(?:image|photo|picture|wallpaper|drawing)\s+(?:of\s+)?/i, "")
        .replace(/(?:photo|image|tasveer)\s+(?:banao|karo|bana\s+do)/i, "")
        .trim() || content.trim();

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
      const videoPrompt = content
        .replace(/(?:create|generate|make|render)\s+(?:an?\s+)?(?:video|clip|animation)\s+(?:of\s+)?/i, "")
        .replace(/(?:video)\s+(?:banao|karo|bana\s+do)/i, "")
        .trim() || content.trim();

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
    const hasDevanagari = /[\u0900-\u097F]/.test(content);
    const hinglishMarkers = [
      "kya", "kar", "rhe", "rahe", "ho", "hai", "hain", "hu", "hoon", "mera", "meri", "mere",
      "naam", "nam", "kaise", "kaisa", "kaisi", "batao", "bataiye", "bol", "bolo", "bolna",
      "kaho", "kehna", "aaj", "kal", "dukhi", "khush", "yaar", "bhai", "dost", "thik", "theek",
      "nahi", "nahin", "mat", "karo", "karna", "acha", "achha", "accha", "bahut", "bohot",
      "samajh", "aaya", "gaya", "chahiye", "kuch", "kuchh", "yeh", "ye", "woh", "wo", "apna",
      "apne", "apni", "aap", "tum", "tu", "kyu", "kyun", "kaha", "kahan", "kab", "kaun",
      "kaam", "baat", "bata", "rakho", "rakh", "dekh", "dekho", "suno", "sun", "paas", "bhi"
    ];
    const inputWords = content.toLowerCase().split(/[\s,?.!;:()"]+/);
    const isHinglish = !hasDevanagari && inputWords.some((w) => hinglishMarkers.includes(w));

    if (hasDevanagari) {
      memoryPrompt += `\nLANGUAGE MANDATE: User is writing in Devanagari Hindi. Reply naturally in Hindi using Devanagari script.\n`;
    } else if (isHinglish) {
      memoryPrompt += `\nLANGUAGE MANDATE (CRITICAL): User is writing in HINGLISH (Hindi typed in English letters, e.g. "${content}"). You MUST reply in natural, friendly HINGLISH using English/Roman alphabet (e.g. "Main badhiya hoon! Aap batao, sab kaisa chal raha hai?"). NEVER reply in Devanagari Hindi!\n`;
    } else {
      memoryPrompt += `\nLANGUAGE MANDATE: User is writing in English. Reply completely in natural, fluent English.\n`;
    }

    if (extractedName) {
      memoryPrompt += `CRITICAL INSTRUCTION: The user has just explicitly requested/instructed you to address them as "${extractedName}" (message: "${content}"). You MUST immediately, warmly, and enthusiastically accept this and call them "${extractedName}". NEVER argue, refuse, or say Google or system prevents you.\n`;
    }

    // Detect if user asks what their name is
    const asksForName = /(?:mera|apna)\s+(?:naam|name|nam)\s+(?:kya|batao)|what(?:\s+is|\s*'s)\s+my\s+name|who\s+am\s+i/i.test(content);
    if (asksForName) {
      memoryPrompt += `CRITICAL INSTRUCTION: The user is explicitly asking for their name ("${content}"). Their remembered name is "${effectiveUserName}". Answer them directly, warmly, and accurately that their name is "${effectiveUserName}".\n`;
    }

    // Detect if user asks about past chats / previous conversations
    const asksAboutPastChats = /(?:pehle|pichli|purani|previous|earlier|last)\s+(?:baat|chat|conversation|cheto|chizo|kya\s+baat)|tujhe\s+yaad\s+hai|kya\s+yaad\s+hai|do\s+you\s+remember/i.test(content);
    if (asksAboutPastChats) {
      memoryPrompt += `\nCRITICAL DIRECTIVE: The user is explicitly asking about their past conversations ("${content}"). You MUST review the past conversations listed below and summarize clearly, warmly, and accurately what they discussed with you in previous chats. Never claim you forgot or cannot see past chats.\n`;
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
