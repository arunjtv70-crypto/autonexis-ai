/**
 * Phase 1 Verification Test Suite: Chat Memory Engine
 */

import {
  normalizeToken,
  tokenizeText,
  estimateTokens,
  detectRecallCue,
  searchChatHistoryBM25,
  formatRelativeTime,
  buildTimeContext,
  buildContextPack,
  type SearchableMessage,
} from "../src/utils/chatMemory";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

console.log("=== RUNNING PHASE 1 TEST SUITE: CHAT MEMORY ENGINE ===");

// ---------------------------------------------------------------------------
// 1. Hinglish & Multilingual Tokenizer & Normalizer
// ---------------------------------------------------------------------------
console.log("\n[1] Hinglish Tokenizer & Canonical Normalizer Tests");
assert(normalizeToken("sooooo") === "so", "Repeated characters collapse: sooooo -> so");
assert(normalizeToken("bohotttt") === "bohot", "Repeated characters collapse: bohotttt -> bohot");
assert(normalizeToken("kia") === "kya", "Canonical mapping: kia -> kya");
assert(normalizeToken("nhi") === "nahi", "Canonical mapping: nhi -> nahi");
assert(normalizeToken("kese") === "kaise", "Canonical mapping: kese -> kaise");
assert(normalizeToken("btao") === "batao", "Canonical mapping: btao -> batao");
assert(normalizeToken("yr") === "yaar", "Canonical mapping: yr -> yaar");
assert(normalizeToken("phle") === "pehle", "Canonical mapping: phle -> pehle");
assert(normalizeToken("yad") === "yaad", "Canonical mapping: yad -> yaad");

// Devanagari bidirectional mapping
assert(normalizeToken("क्या") === "kya", "Devanagari mapping: क्या -> kya");
assert(normalizeToken("है") === "hai", "Devanagari mapping: है -> hai");
assert(normalizeToken("नहीं") === "nahi", "Devanagari mapping: नहीं -> nahi");
assert(normalizeToken("याद") === "yaad", "Devanagari mapping: याद -> yaad");
assert(normalizeToken("पहले") === "pehle", "Devanagari mapping: पहले -> pehle");

const sampleTokens = tokenizeText("Bhai kya yaad hai pehle kya decide kiya tha humne?");
assert(sampleTokens.includes("bhai"), "Tokenized contains bhai");
assert(sampleTokens.includes("kya"), "Tokenized contains kya");
assert(sampleTokens.includes("yaad"), "Tokenized contains yaad");
assert(sampleTokens.includes("pehle"), "Tokenized contains pehle");
assert(sampleTokens.includes("decide"), "Tokenized contains decide");

// ---------------------------------------------------------------------------
// 2. Token Estimator (~3.5 chars / token)
// ---------------------------------------------------------------------------
console.log("\n[2] Token Estimator Tests (~3.5 chars/tok)");
const text35Chars = "12345678901234567890123456789012345"; // 35 chars
const est = estimateTokens(text35Chars);
assert(est === 10, `35 chars estimated as 10 tokens (actual: ${est})`);
assert(estimateTokens("") === 0, "Empty string estimates 0 tokens");

// ---------------------------------------------------------------------------
// 3. Recall Cue Detection
// ---------------------------------------------------------------------------
console.log("\n[3] Recall Cue Detection Tests");
assert(detectRecallCue("pehle kya hua tha?"), "Detects 'pehle kya hua tha'");
assert(detectRecallCue("kuch der pehle maine kya bataya tha?"), "Detects 'kuch der pehle'");
assert(detectRecallCue("kya tumhe yaad hai humne kya tay kiya?"), "Detects 'yaad hai'");
assert(detectRecallCue("earlier in this chat what was my decision?"), "Detects 'earlier in this chat'");
assert(detectRecallCue("what did I tell you about the database?"), "Detects 'what did I tell you'");
assert(detectRecallCue("क्या याद है पहले क्या कहा था"), "Detects Devanagari recall cue");
assert(!detectRecallCue("Write a python function to sort an array"), "Normal query does NOT trigger recall cue");

// ---------------------------------------------------------------------------
// 4. Time Awareness & Gap Detection (>= 20m)
// ---------------------------------------------------------------------------
console.log("\n[4] Time Awareness & Gap Detection Tests");
const now = new Date("2026-11-13T17:30:00Z");
const time35mAgo = new Date("2026-11-13T16:55:00Z").toISOString();
const time3hAgo = new Date("2026-11-13T14:30:00Z").toISOString();
const time2mAgo = new Date("2026-11-13T17:28:00Z").toISOString();

const formatted35 = formatRelativeTime(time35mAgo, now);
assert(formatted35.includes("about 35 mins ago") || formatted35.includes("35 min"), `Formats 35m relative time: ${formatted35}`);

// 35-minute gap simulation
const msgs35mGap: SearchableMessage[] = [
  { id: "m1", role: "user", content: "Hello", createdAt: new Date("2026-11-13T16:00:00Z").toISOString() },
  { id: "m2", role: "assistant", content: "Hi there!", createdAt: time35mAgo },
];
const timeInfo35 = buildTimeContext(msgs35mGap, now.toISOString(), "Asia/Kolkata");
assert(timeInfo35.gapMinutes === 35, `Detected 35 min gap (actual: ${timeInfo35.gapMinutes})`);
assert(timeInfo35.isReturningAfterGap === true, "isReturningAfterGap is TRUE for 35m gap");
assert(timeInfo35.block.includes("LONG GAP DETECTED"), "Time block contains long gap indicator");

// 3-hour gap simulation
const msgs3hGap: SearchableMessage[] = [
  { id: "m1", role: "user", content: "Hello", createdAt: new Date("2026-11-13T12:00:00Z").toISOString() },
  { id: "m2", role: "assistant", content: "Hi!", createdAt: time3hAgo },
];
const timeInfo3h = buildTimeContext(msgs3hGap, now.toISOString(), "Asia/Kolkata");
assert(timeInfo3h.gapMinutes === 180, `Detected 180 min gap (actual: ${timeInfo3h.gapMinutes})`);
assert(timeInfo3h.isReturningAfterGap === true, "isReturningAfterGap is TRUE for 3h gap");

// 2-minute active conversation simulation (gap < 20m)
const msgsActive: SearchableMessage[] = [
  { id: "m1", role: "user", content: "Hi", createdAt: new Date("2026-11-13T17:25:00Z").toISOString() },
  { id: "m2", role: "assistant", content: "Hello!", createdAt: time2mAgo },
];
const timeInfoActive = buildTimeContext(msgsActive, now.toISOString(), "Asia/Kolkata");
assert(timeInfoActive.gapMinutes === 2, `Detected 2 min gap (actual: ${timeInfoActive.gapMinutes})`);
assert(timeInfoActive.isReturningAfterGap === false, "isReturningAfterGap is FALSE for active conversation");

// ---------------------------------------------------------------------------
// 5. BM25 Search & Neighbor Expansion
// ---------------------------------------------------------------------------
console.log("\n[5] BM25 Search with Conversational Turn Expansion");
const simulatedHistory: SearchableMessage[] = [
  { id: "msg_0", role: "user", content: "Main Jaipur me shift ho raha hu agle mahine.", createdAt: "14:10" },
  { id: "msg_1", role: "assistant", content: "Wah, Jaipur bahut sundar shahar hai! Pink City me swagat hai.", createdAt: "14:11" },
  { id: "msg_2", role: "user", content: "Vahan mera budget 25000 per month hai rent ke liye.", createdAt: "14:12" },
  { id: "msg_3", role: "assistant", content: "25000 me Vaishali Nagar ya Malviya Nagar me badhiya 2BHK mil jayega.", createdAt: "14:13" },
];

// Add 30 filler messages about unrelated programming questions
for (let i = 4; i < 40; i++) {
  simulatedHistory.push({
    id: `msg_${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: `Programming topic #${i}: React, TypeScript, and state management techniques.`,
    createdAt: "14:30",
  });
}

// User asks about earlier planted fact using Hinglish recall cue
const recallQuery = "Pehle maine rent ka budget kitna bataya tha?";
const snippets = searchChatHistoryBM25(simulatedHistory, recallQuery, {
  hasRecallCue: true,
  topK: 8,
});

assert(snippets.length > 0, "BM25 retrieved snippets for rent budget query");
const topSnippet = snippets[0];
assert(topSnippet.snippetText.includes("25000"), "Snippet contains the planted fact '25000'");
assert(topSnippet.snippetText.includes("Vaishali Nagar") || topSnippet.snippetText.includes("Jaipur"), "Snippet includes neighbor turn context");
console.log(`Top snippet retrieved:\n${topSnippet.snippetText}`);

// ---------------------------------------------------------------------------
// 6. Context Pack Builder Budget Test (200 messages simulation <= 3,500 tokens)
// ---------------------------------------------------------------------------
console.log("\n[6] Context Pack Builder Budget Tests (200 messages)");
const longHistory: SearchableMessage[] = [];
for (let i = 1; i <= 200; i++) {
  longHistory.push({
    id: `m_${i}`,
    role: i % 2 === 1 ? "user" : "assistant",
    content: `This is conversational turn #${i} discussing architecture, components, and project implementation details in deep depth.`,
    createdAt: new Date(Date.now() - (200 - i) * 60000).toISOString(),
  });
}

const fakeState = {
  summary: "The user is building a complex multi-stage fullstack architecture with in-chat memory and real-time streaming.",
  facts: [
    { id: "f1", text: "Rent budget is 25000 per month in Jaipur", type: "fact" as const, time: "14:12" },
    { id: "f2", text: "Prefers concise, natural Hinglish without corporate fluff", type: "preference" as const },
    { id: "f3", text: "Decided to deploy on Vercel with serverless backend", type: "decision" as const },
  ],
  openThreads: ["Implement client-side BM25 indexing", "Verify rate limits on summarize endpoint"],
  timeline: [
    { time: "14:10", note: "Discussed relocation to Jaipur" },
    { time: "14:15", note: "Agreed on budget and areas" },
  ],
  version: 2,
  updatedAt: new Date().toISOString(),
};

const packResult = buildContextPack({
  messages: longHistory,
  chatMemoryState: fakeState,
  newQuery: "Rent ka budget yaad hai?",
  clientTimeIso: new Date().toISOString(),
  timezone: "Asia/Kolkata",
  maxTokens: 3500,
});

assert(packResult.debugInfo.totalTokens <= 3500, `Context pack total tokens (${packResult.debugInfo.totalTokens}) <= 3500 limit`);
assert(packResult.chatContextBlock.includes("[TIME CONTEXT]:"), "Includes [TIME CONTEXT]");
assert(packResult.chatContextBlock.includes("[CHAT NOTES (Durable In-Chat Memory)]:"), "Includes [CHAT NOTES]");
assert(packResult.chatContextBlock.includes("Rent budget is 25000 per month in Jaipur"), "Includes durable fact in notes");
assert(packResult.verbatimMessages.length >= 4, `Keeps at least 4 recent verbatim messages (kept: ${packResult.verbatimMessages.length})`);

console.log("\nToken Breakdown for 200-Message Chat:");
console.log(`  Time Tokens:     ${packResult.debugInfo.timeTokens}`);
console.log(`  Notes Tokens:    ${packResult.debugInfo.notesTokens}`);
console.log(`  Snippet Tokens:  ${packResult.debugInfo.snippetTokens}`);
console.log(`  Verbatim Tokens: ${packResult.debugInfo.verbatimTokens}`);
console.log(`  TOTAL TOKENS:    ${packResult.debugInfo.totalTokens} / 3500 max`);

console.log("\n✨ ALL PHASE 1 CLIENT MEMORY ENGINE TESTS PASSED SUCCESSFULLY! ✨");

