/**
 * AUTONEXIS Chat Memory Engine (In-Chat Context & Recall System)
 *
 * Provides:
 * 1. Hinglish + Hindi + English Tokenizer & Canonical Normalizer
 * 2. Token estimator calibrated for Hinglish/Devanagari/English (~3.5 chars/tok)
 * 3. BM25 Inverted Index & Neighbor Expansion (turn context)
 * 4. Recall Cue Detection (triggers deeper retrieval & timeline cues)
 * 5. Relative & Absolute Time Awareness (gap detection >= 20m)
 * 6. Context Pack Builder (Strict 3,500 token budget)
 */

import type { ChatMemoryState, ChatMemoryFact, ChatMemoryTimelineItem } from "../db";

// ---------------------------------------------------------------------------
// 1. Hinglish & Multilingual Tokenizer and Normalizer
// ---------------------------------------------------------------------------

const HINGLISH_SPELLING_MAP: Record<string, string> = {
  // Common question words & pronouns
  kia: "kya",
  kya: "kya",
  kyu: "kyun",
  kyun: "kyun",
  kon: "kaun",
  kaun: "kaun",
  kese: "kaise",
  kaise: "kaise",
  kaisa: "kaise",
  kaisi: "kaise",
  kab: "kab",
  kaha: "kaha",
  kha: "kaha",
  kidhar: "kidhar",
  kdhar: "kidhar",

  // Copula & auxiliary verbs
  h: "hai",
  he: "hai",
  hai: "hai",
  hain: "hai",
  tha: "tha",
  thaa: "tha",
  thi: "tha",
  the: "tha",
  hu: "hoon",
  hun: "hoon",
  hoon: "hoon",
  ho: "ho",

  // Negation
  nhi: "nahi",
  nahin: "nahi",
  nahi: "nahi",
  na: "nahi",
  mat: "mat",

  // Common verbs
  btao: "batao",
  batao: "batao",
  batana: "batao",
  bataiye: "batao",
  bolo: "bolo",
  bol: "bolo",
  kro: "karo",
  karo: "karo",
  karna: "karo",
  kr: "kar",
  kar: "kar",
  raha: "raha",
  rahe: "raha",
  rahi: "raha",
  rhe: "raha",
  dkh: "dekh",
  dekho: "dekh",
  dekh: "dekh",
  samjho: "samajh",
  samajh: "samajh",
  smjh: "samajh",
  socho: "soch",
  soch: "soch",
  pta: "pata",
  pata: "pata",

  // Adjectives, modifiers, conversation markers
  acha: "acha",
  achha: "acha",
  accha: "acha",
  sahi: "sahi",
  thik: "thik",
  theek: "thik",
  bohot: "bohot",
  bahut: "bohot",
  bht: "bohot",
  boht: "bohot",
  kch: "kuch",
  kchh: "kuch",
  kuch: "kuch",
  thoda: "thoda",
  thodi: "thoda",
  yr: "yaar",
  yar: "yaar",
  yaar: "yaar",
  bhai: "bhai",
  bro: "bhai",
  bhiya: "bhai",
  bhaiya: "bhai",
  dost: "dost",

  // Memory & time markers
  phle: "pehle",
  pehle: "pehle",
  pehla: "pehle",
  yad: "yaad",
  yaad: "yaad",
  baat: "baat",
  kaam: "kaam",
  decide: "decide",
  decision: "decide",
  tay: "tay",
  aaj: "aaj",
  kal: "kal",
  ab: "ab",
  abhi: "abhi",

  // Pronouns
  mjhe: "mujhe",
  mujhe: "mujhe",
  mujhko: "mujhe",
  mera: "mera",
  meri: "mera",
  mere: "mera",
  tera: "tera",
  teri: "tera",
  tere: "tera",
  tujhe: "tera",
  apna: "apna",
  apni: "apna",
  apne: "apna",
  aap: "tum",
  tum: "tum",
  tu: "tum",
  hum: "hum",
  ham: "hum",
  ye: "yeh",
  yeh: "yeh",
  wo: "woh",
  woh: "woh",
};

const DEVANAGARI_TO_ROMAN_MAP: Record<string, string> = {
  क्या: "kya",
  है: "hai",
  हैं: "hai",
  नहीं: "nahi",
  था: "tha",
  थी: "tha",
  थे: "tha",
  याद: "yaad",
  पहले: "pehle",
  पिछली: "pehle",
  बात: "baat",
  काम: "kaam",
  कहा: "kaha",
  कहो: "kaha",
  कैसे: "kaise",
  कैसा: "kaise",
  कैसी: "kaise",
  बताओ: "batao",
  बताइए: "batao",
  अच्छा: "acha",
  अच्छी: "acha",
  अच्छे: "acha",
  बहुत: "bohot",
  भाई: "bhai",
  कुछ: "kuch",
  करो: "karo",
  करना: "karo",
  देखो: "dekh",
  देख: "dekh",
  पता: "pata",
  मुझे: "mujhe",
  मेरा: "mera",
  मेरी: "mera",
  मेरे: "mera",
  तुम: "tum",
  आप: "tum",
  हम: "hum",
  आज: "aaj",
  कल: "kal",
  तय: "tay",
  फैसला: "decide",
};

/**
 * Normalizes a single token: collapses repeated characters (e.g. soooo -> so, bohottt -> bohot),
 * translates common Devanagari keywords to Roman Hinglish tokens, and maps to canonical spelling.
 */
export function normalizeToken(rawToken: string): string {
  let token = rawToken.toLowerCase().trim();
  if (!token) return "";

  // Check Devanagari exact match
  if (DEVANAGARI_TO_ROMAN_MAP[token]) {
    return DEVANAGARI_TO_ROMAN_MAP[token];
  }

  // Collapse 3+ identical consecutive characters down to 1 or 2
  // (e.g., 'sooooo' -> 'so', 'yaaar' -> 'yaar', 'bhaiiii' -> 'bhai')
  token = token.replace(/([a-z])\1{2,}/g, "$1");

  // Canonical spelling map
  if (HINGLISH_SPELLING_MAP[token]) {
    return HINGLISH_SPELLING_MAP[token];
  }

  return token;
}

/**
 * Splits text into normalized, searchable tokens.
 * Handles English, Hinglish, and Devanagari unicode characters.
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];

  // Split on punctuation, whitespace, and formatting characters
  const rawParts = text
    .replace(/[^\w\s\u0900-\u097F]/g, " ")
    .split(/\s+/);

  const tokens: string[] = [];
  for (const part of rawParts) {
    if (!part) continue;
    const norm = normalizeToken(part);
    if (norm && norm.length >= 2) {
      tokens.push(norm);
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// 2. Hinglish Token Estimator (~3.5 chars / token)
// ---------------------------------------------------------------------------

/**
 * Accurately estimates token count for mixed Hinglish, Devanagari, and English text.
 * Benchmarked at ~3.5 characters per token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const clean = text.trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 3.5));
}

// ---------------------------------------------------------------------------
// 3. Recall Cue Detection
// ---------------------------------------------------------------------------

const RECALL_CUE_PATTERNS = [
  /\b(?:pehle|pichle|pichli|purani|purane)\b/i,
  /\bkuch\s+der\s+pehle\b/i,
  /\bthodi\s+der\s+pehle\b/i,
  /\b(?:yaad\s+hai|yaad\s+karo)\b/i,
  /\bkya\s+(?:hua\s+tha|bola\s+tha|kaha\s+tha|decide\s+kiya|tay\s+hua|baat\s+hui)\b/i,
  /\bmaine\s+kya\s+(?:kaha|bola|pucha)\b/i,
  /\bearlier\b/i,
  /\bpreviously\b/i,
  /\bremember\b/i,
  /\bwhat\s+did\s+(?:we|i|you)\s+(?:say|decide|discuss|tell)\b/i,
  /\bwhat\s+happened\s+earlier\b/i,
  /\bwhere\s+were\s+we\b/i,
  /\brecap\b/i,
  /(?:पहले|पिछली|याद\s*है|क्या\s*हुआ\s*था|क्या\s*कहा\s*था|क्या\s*तय\s*हुआ|क्या\s*बात\s*हुई)/,
];

/**
 * Checks if the user's prompt is explicitly asking about prior conversation context.
 */
export function detectRecallCue(text: string): boolean {
  if (!text) return false;
  return RECALL_CUE_PATTERNS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// 4. BM25 Search & Neighbor Turn Expansion
// ---------------------------------------------------------------------------

export interface SearchableMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  created_at?: string;
}

export interface RecalledSnippet {
  id: string;
  turnRange: string;
  score: number;
  reason: string;
  snippetText: string;
  relativeTime: string;
}

/**
 * BM25 index and retrieval over in-chat messages with conversational neighbor expansion.
 */
export function searchChatHistoryBM25(
  messages: SearchableMessage[],
  queryText: string,
  options?: { topK?: number; hasRecallCue?: boolean }
): RecalledSnippet[] {
  if (!messages || messages.length === 0 || !queryText.trim()) return [];

  // Limit search window to latest 500 messages to prevent excessive memory overhead
  const searchPool = messages.slice(-500);
  const totalDocs = searchPool.length;
  if (totalDocs === 0) return [];

  const queryTokens = tokenizeText(queryText);
  if (queryTokens.length === 0) return [];

  // Pre-tokenize docs and compute document frequency (DF) for query tokens
  const docTokensList: string[][] = [];
  const docLengths: number[] = [];
  let totalLength = 0;

  const docFreq: Record<string, number> = {};
  for (const qTok of queryTokens) {
    docFreq[qTok] = 0;
  }

  for (let i = 0; i < totalDocs; i++) {
    const rawContent = searchPool[i].content || "";
    const tokens = tokenizeText(rawContent);
    docTokensList.push(tokens);
    docLengths.push(tokens.length);
    totalLength += tokens.length;

    const tokenSet = new Set(tokens);
    for (const qTok of queryTokens) {
      if (tokenSet.has(qTok)) {
        docFreq[qTok] = (docFreq[qTok] || 0) + 1;
      }
    }
  }

  const avgDocLength = totalLength / Math.max(1, totalDocs);
  const k1 = 1.2;
  const b = 0.75;

  // Compute BM25 score for each message
  const scoredMsgs: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < totalDocs; i++) {
    const tokens = docTokensList[i];
    const docLen = docLengths[i];
    if (docLen === 0) continue;

    // Count term frequencies in this document
    const termCounts: Record<string, number> = {};
    for (const t of tokens) {
      termCounts[t] = (termCounts[t] || 0) + 1;
    }

    let score = 0;
    for (const qTok of queryTokens) {
      const tf = termCounts[qTok] || 0;
      if (tf === 0) continue;

      const df = docFreq[qTok] || 0;
      // Robertson-Spärck Jones IDF formula
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const tfWeight = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLength)));
      score += idf * tfWeight;
    }

    if (score > 0.05) {
      // Recency multiplier: newer messages in this chat receive a gentle boost up to 25%
      const recencyBoost = 1 + 0.25 * ((i + 1) / totalDocs);
      scoredMsgs.push({ index: i, score: score * recencyBoost });
    }
  }

  if (scoredMsgs.length === 0) return [];

  // Sort by score descending
  scoredMsgs.sort((a, b) => b.score - a.score);

  const recallCueActive = !!options?.hasRecallCue;
  const maxSnippets = options?.topK ?? (recallCueActive ? 8 : 4);

  // Group top hits and perform neighbor expansion (include previous + next message for context)
  const coveredIndices = new Set<number>();
  const snippetWindows: Array<{
    startIdx: number;
    endIdx: number;
    primaryScore: number;
    primaryIdx: number;
  }> = [];

  for (const item of scoredMsgs) {
    if (snippetWindows.length >= maxSnippets) break;
    if (coveredIndices.has(item.index)) continue;

    const startIdx = Math.max(0, item.index - 1);
    const endIdx = Math.min(totalDocs - 1, item.index + 1);

    for (let c = startIdx; c <= endIdx; c++) {
      coveredIndices.add(c);
    }

    snippetWindows.push({
      startIdx,
      endIdx,
      primaryScore: item.score,
      primaryIdx: item.index,
    });
  }

  const now = new Date();
  const results: RecalledSnippet[] = [];

  for (const win of snippetWindows) {
    const windowMsgs = searchPool.slice(win.startIdx, win.endIdx + 1);
    const primaryMsg = searchPool[win.primaryIdx];
    const timeStr = formatRelativeTime(primaryMsg.createdAt || primaryMsg.created_at || "", now);

    const formattedLines = windowMsgs.map((m) => {
      const sender = m.role === "user" ? "User" : "Assistant";
      const cleanContent = (m.content || "").replace(/\s+/g, " ").trim();
      const snippet = cleanContent.length > 280 ? cleanContent.slice(0, 280) + "..." : cleanContent;
      return `${sender}: "${snippet}"`;
    });

    results.push({
      id: primaryMsg.id || `msg_${win.primaryIdx}`,
      turnRange: `msgs ${win.startIdx + 1}-${win.endIdx + 1}`,
      score: Number(win.primaryScore.toFixed(2)),
      reason: `BM25 match (turn neighbor context expanded)`,
      snippetText: formattedLines.join("\n"),
      relativeTime: timeStr,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 5. Time Awareness & Formatting
// ---------------------------------------------------------------------------

/**
 * Formats relative and absolute time (e.g. "about 35 minutes ago, 15:48").
 */
export function formatRelativeTime(dateInput: string | number | undefined, referenceNow = new Date()): string {
  if (!dateInput) return "earlier in this chat";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    // If it's already a formatted time string like "15:48", return it
    if (typeof dateInput === "string" && /^\d{1,2}:\d{2}/.test(dateInput)) {
      return `at ${dateInput}`;
    }
    return "earlier in this chat";
  }

  const diffMs = referenceNow.getTime() - d.getTime();
  if (diffMs < 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const diffMins = Math.floor(diffMs / 60000);
  const timeOnly = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (diffMins < 1) {
    return `just now (${timeOnly})`;
  }
  if (diffMins < 60) {
    return `about ${diffMins} min${diffMins > 1 ? "s" : ""} ago (${timeOnly})`;
  }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `about ${diffHours} hour${diffHours > 1 ? "s" : ""} ago (${timeOnly})`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return `yesterday (${timeOnly})`;
  }
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeOnly}`;
}

export interface TimeContextInfo {
  block: string;
  gapMinutes: number;
  isReturningAfterGap: boolean;
  clientTimeStr: string;
  timezone: string;
}

/**
 * Constructs the [TIME CONTEXT] block with gap detection and client local timezone.
 */
export function buildTimeContext(
  messages: SearchableMessage[],
  clientTimeIso?: string,
  timeZoneOverride?: string
): TimeContextInfo {
  const now = clientTimeIso ? new Date(clientTimeIso) : new Date();
  const timezone =
    timeZoneOverride ||
    (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");

  const formattedCurrentTime = now.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let gapMinutes = 0;
  let isReturningAfterGap = false;
  let chatStartStr = "current session";

  if (messages && messages.length > 0) {
    const firstMsg = messages[0];
    const firstTime = firstMsg.createdAt || firstMsg.created_at;
    if (firstTime) {
      chatStartStr = formatRelativeTime(firstTime, now);
    }

    const lastMsg = messages[messages.length - 1];
    const lastTime = lastMsg.createdAt || lastMsg.created_at;
    if (lastTime) {
      const lastDate = new Date(lastTime);
      if (!isNaN(lastDate.getTime())) {
        const diffMs = now.getTime() - lastDate.getTime();
        gapMinutes = Math.max(0, Math.floor(diffMs / 60000));
        // Gap threshold: 20 minutes
        if (gapMinutes >= 20) {
          isReturningAfterGap = true;
        }
      }
    }
  }

  const lines = [
    `Current Local Time: ${formattedCurrentTime} (${timezone})`,
    `Chat Started: ${chatStartStr}`,
  ];

  if (messages.length > 1) {
    if (isReturningAfterGap) {
      lines.push(
        `Time Since Last Message: ${gapMinutes} minutes (LONG GAP DETECTED: User is returning after ${gapMinutes} minutes)`
      );
    } else if (gapMinutes > 0) {
      lines.push(`Time Since Last Message: ${gapMinutes} minutes (active conversation)`);
    } else {
      lines.push(`Time Since Last Message: <1 minute (active conversation)`);
    }
  }

  return {
    block: lines.join("\n"),
    gapMinutes,
    isReturningAfterGap,
    clientTimeStr: formattedCurrentTime,
    timezone,
  };
}

// ---------------------------------------------------------------------------
// 6. Context Pack Builder (Strict 3,500 Token Budget)
// ---------------------------------------------------------------------------

export const MAX_CONTEXT_PACK_TOKENS = 3500;

export interface ContextPackOptions {
  messages: SearchableMessage[];
  chatMemoryState?: ChatMemoryState | null;
  newQuery: string;
  clientTimeIso?: string;
  timezone?: string;
  maxTokens?: number;
}

export interface ContextPackDebugInfo {
  timeTokens: number;
  notesTokens: number;
  snippetTokens: number;
  verbatimTokens: number;
  totalTokens: number;
  recalledSnippets: Array<{ id: string; score: number; reason: string }>;
  gapMinutes: number;
  isReturningAfterGap: boolean;
  notesVersion: number;
  recallCueDetected: boolean;
}

export interface ContextPackResult {
  chatContextBlock: string;
  verbatimMessages: SearchableMessage[];
  debugInfo: ContextPackDebugInfo;
}

/**
 * Builds the balanced context pack respecting the 3,500 token budget.
 * Assembly order:
 *  1. [TIME CONTEXT]
 *  2. [CHAT NOTES] (Summary, Facts, Open Threads, Timeline)
 *  3. [RECALLED SNIPPETS] (BM25 + turn neighbor expansion)
 *  4. Verbatim recent messages (latest 10, shrinking down to min 4 if budget requires)
 *  5. User's new message
 */
export function buildContextPack(options: ContextPackOptions): ContextPackResult {
  const {
    messages = [],
    chatMemoryState,
    newQuery,
    clientTimeIso,
    timezone,
    maxTokens = MAX_CONTEXT_PACK_TOKENS,
  } = options;

  const recallCueDetected = detectRecallCue(newQuery);

  // 1. Time Context (~60-80 tokens)
  const timeInfo = buildTimeContext(messages, clientTimeIso, timezone);
  const timeBlockFormatted = `[TIME CONTEXT]:\n${timeInfo.block}`;
  const timeTokens = estimateTokens(timeBlockFormatted);

  // 2. Chat Notes (~400-800 tokens)
  const notesSections: string[] = [];
  if (chatMemoryState) {
    if (chatMemoryState.summary && chatMemoryState.summary.trim()) {
      notesSections.push(`Narrative Summary:\n${chatMemoryState.summary.trim()}`);
    }

    if (Array.isArray(chatMemoryState.facts) && chatMemoryState.facts.length > 0) {
      const factLines = chatMemoryState.facts
        .slice(0, 40)
        .map((f: ChatMemoryFact) => `- ${f.text}${f.time ? ` [${f.time}]` : ""}`);
      notesSections.push(`Key Facts & Decisions:\n${factLines.join("\n")}`);
    }

    if (Array.isArray(chatMemoryState.openThreads) && chatMemoryState.openThreads.length > 0) {
      const threadLines = chatMemoryState.openThreads.slice(0, 8).map((t) => `- ${t}`);
      notesSections.push(`Open Threads / Pending Actions:\n${threadLines.join("\n")}`);
    }

    if (Array.isArray(chatMemoryState.timeline) && chatMemoryState.timeline.length > 0) {
      const timelineLines = chatMemoryState.timeline
        .slice(0, 25)
        .map((tl: ChatMemoryTimelineItem) => `[${tl.time}]: ${tl.note}`);
      notesSections.push(`Conversation Timeline:\n${timelineLines.join("\n")}`);
    }
  }

  let notesBlockFormatted = "";
  if (notesSections.length > 0) {
    notesBlockFormatted = `[CHAT NOTES (Durable In-Chat Memory)]:\n${notesSections.join("\n\n")}`;
  }
  const notesTokens = estimateTokens(notesBlockFormatted);

  // Reserve budget for user query (~150 tokens) and safety overhead
  const queryTokens = estimateTokens(newQuery);
  const overheadBudget = timeTokens + notesTokens + queryTokens + 60;
  const remainingBudgetForHistoryAndSnippets = Math.max(1000, maxTokens - overheadBudget);

  // 3. Recalled Snippets via BM25
  const snippets = searchChatHistoryBM25(messages, newQuery, {
    hasRecallCue: recallCueDetected,
    topK: recallCueDetected ? 8 : 4,
  });

  let snippetLines: string[] = [];
  for (const s of snippets) {
    snippetLines.push(
      `--- Recalled snippet (${s.relativeTime}, match score: ${s.score}) ---\n${s.snippetText}`
    );
  }

  let snippetsBlockFormatted = "";
  if (snippetLines.length > 0) {
    snippetsBlockFormatted = `[RECALLED SNIPPETS FROM EARLIER IN THIS CHAT]:\n${snippetLines.join(
      "\n\n"
    )}`;
  }
  let snippetTokens = estimateTokens(snippetsBlockFormatted);

  // If snippets exceed 1,100 tokens, prune lowest scoring snippets
  while (snippetTokens > 1100 && snippetLines.length > 1) {
    snippetLines.pop();
    snippetsBlockFormatted = `[RECALLED SNIPPETS FROM EARLIER IN THIS CHAT]:\n${snippetLines.join(
      "\n\n"
    )}`;
    snippetTokens = estimateTokens(snippetsBlockFormatted);
  }

  // 4. Verbatim Recent Messages (Default 10, min 4)
  const budgetForVerbatim = Math.max(
    600,
    remainingBudgetForHistoryAndSnippets - snippetTokens
  );

  let verbatimSliceCount = Math.min(10, messages.length);
  let verbatimMessages = messages.slice(-verbatimSliceCount);
  let verbatimTokens = estimateTokens(
    verbatimMessages.map((m) => `${m.role}: ${m.content}`).join("\n")
  );

  // Shrink down towards 4 messages if necessary
  while (verbatimTokens > budgetForVerbatim && verbatimSliceCount > 4) {
    verbatimSliceCount--;
    verbatimMessages = messages.slice(-verbatimSliceCount);
    verbatimTokens = estimateTokens(
      verbatimMessages.map((m) => `${m.role}: ${m.content}`).join("\n")
    );
  }

  // Assemble the unified chat context block
  const blockParts: string[] = [timeBlockFormatted];

  if (notesBlockFormatted) {
    blockParts.push(notesBlockFormatted);
  }

  if (snippetsBlockFormatted) {
    blockParts.push(snippetsBlockFormatted);
  }

  const finalChatContextBlock = blockParts.join("\n\n");
  const totalTokens =
    estimateTokens(finalChatContextBlock) + verbatimTokens + queryTokens;

  return {
    chatContextBlock: finalChatContextBlock,
    verbatimMessages,
    debugInfo: {
      timeTokens,
      notesTokens,
      snippetTokens,
      verbatimTokens,
      totalTokens,
      recalledSnippets: snippets.map((s) => ({
        id: s.id,
        score: s.score,
        reason: s.reason,
      })),
      gapMinutes: timeInfo.gapMinutes,
      isReturningAfterGap: timeInfo.isReturningAfterGap,
      notesVersion: chatMemoryState?.version || 0,
      recallCueDetected,
    },
  };
}
