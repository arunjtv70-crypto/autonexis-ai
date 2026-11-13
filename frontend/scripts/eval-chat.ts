/**
 * Evaluation and Benchmarking Suite for AUTONEXIS Chat Voice & Memory Engine.
 * Run via: npm run eval:chat
 *
 * Covers:
 * 1. In-Chat Memory Fact Recall (35-min and 3-hour gaps, 200 messages)
 * 2. Hinglish Tokenizer, Normalizer & BM25 Neighbor Expansion
 * 3. Token Budget Strict Adherence (< 3,500 tokens)
 * 4. Casual Tone, Colloquial Slang, and Banter Responses
 * 5. Anti-Repetition & Canned Phrase Prevention
 */

import {
  tokenizeText,
  normalizeToken,
  estimateTokens,
  detectRecallCue,
  searchChatHistoryBM25,
  buildTimeContext,
  buildContextPack,
  type ChatMemoryPackState,
} from "../src/utils/chatMemory.ts";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface EvalResult {
  suite: string;
  testName: string;
  passed: boolean;
  score: number;
  details?: string;
}

const results: EvalResult[] = [];

function recordTest(suite: string, testName: string, passed: boolean, details?: string) {
  results.push({
    suite,
    testName,
    passed,
    score: passed ? 1 : 0,
    details,
  });
  if (passed) {
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}${details ? ` -> ${details}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// SUITE 1: Hinglish Tokenizer, Normalizer & Recall Cue Engine
// ---------------------------------------------------------------------------
console.log("\n[SUITE 1] HINGLISH TOKENIZER, NORMALIZER & RECALL CUE ENGINE");

const sampleRepeated = normalizeToken("bohooooot");
recordTest(
  "Tokenizer & Normalizer",
  "Repeated characters collapse ('bohooooot' -> 'bohot')",
  sampleRepeated === "bohot",
  `Got: ${sampleRepeated}`
);

const sampleKia = normalizeToken("kia");
recordTest(
  "Tokenizer & Normalizer",
  "Canonical spelling mapping ('kia' -> 'kya')",
  sampleKia === "kya",
  `Got: ${sampleKia}`
);

const devanagariTokens = tokenizeText("क्या आपको याद है पहले क्या हुआ था?");
recordTest(
  "Tokenizer & Normalizer",
  "Devanagari cross-script normalization to roman tokens",
  devanagariTokens.includes("kya") && devanagariTokens.includes("yaad") && devanagariTokens.includes("pehle"),
  `Tokens: ${JSON.stringify(devanagariTokens)}`
);

const recallQueries = [
  "pehle kya hua tha",
  "kuch der pehle",
  "yaad hai humne kya decide kiya tha",
  "what did I tell you earlier in this chat",
  "earlier we decided",
];
const allCuesDetected = recallQueries.every((q) => detectRecallCue(q));
recordTest(
  "Recall Cue Detection",
  "Accurately detects explicit recall cues in Hinglish & English",
  allCuesDetected
);

const nonRecallQueries = [
  "kya haal hai",
  "weather kaisa hai",
  "write a python script",
  "explain quantum physics",
];
const noFalsePositives = nonRecallQueries.every((q) => !detectRecallCue(q));
recordTest(
  "Recall Cue Detection",
  "Zero false positives on non-recall conversational queries",
  noFalsePositives
);

// ---------------------------------------------------------------------------
// SUITE 2: Planted Fact Recall Across 35-min & 3-hour Gaps
// ---------------------------------------------------------------------------
console.log("\n[SUITE 2] IN-CHAT MEMORY & PLANTED FACT RECALL");

// Construct a realistic 100-message chat with a planted fact at turn 4
const testChatMessages: any[] = [];
const nowTimestamp = Date.now();
const thirtyFiveMinsAgo = nowTimestamp - 35 * 60 * 1000;

testChatMessages.push({ id: "m1", role: "user", content: "Hi", createdAt: new Date(thirtyFiveMinsAgo).toISOString() });
testChatMessages.push({ id: "m2", role: "assistant", content: "Hello! Kaise ho?", createdAt: new Date(thirtyFiveMinsAgo + 1000).toISOString() });
testChatMessages.push({ id: "m3", role: "user", content: "Main theek hoon. Main agle mahine Goa shift ho raha hoon.", createdAt: new Date(thirtyFiveMinsAgo + 2000).toISOString() });
testChatMessages.push({ id: "m4", role: "assistant", content: "Wah, Goa! Wahan beaches aur sukoon badhiya hai.", createdAt: new Date(thirtyFiveMinsAgo + 3000).toISOString() });
testChatMessages.push({ id: "m5", role: "user", content: "Vahan mera budget maximum 45000 per month hai rent ke liye.", createdAt: new Date(thirtyFiveMinsAgo + 4000).toISOString() });
testChatMessages.push({ id: "m6", role: "assistant", content: "45k me Panjim ya Candolim me accha furnished flat mil jayega.", createdAt: new Date(thirtyFiveMinsAgo + 5000).toISOString() });

// Add filler conversation within the initial 5 minutes
for (let i = 7; i <= 80; i++) {
  const isUser = i % 2 !== 0;
  testChatMessages.push({
    id: `m${i}`,
    role: isUser ? "user" : "assistant",
    content: isUser ? `Yeh topic ${i} ke baare me batao.` : `Yeh topic ${i} ka explanation hai with some details.`,
    createdAt: new Date(thirtyFiveMinsAgo + 5000 + i * 1000).toISOString(),
  });
}

// User returns now (35 min gap from start, ~33 min from last message)
const timeContext35 = buildTimeContext(testChatMessages, new Date(nowTimestamp).toISOString(), "Asia/Kolkata");
recordTest(
  "Time Awareness (35m Gap)",
  "Correctly flags isReturningAfterGap after 35-minute pause",
  timeContext35.isReturningAfterGap === true && timeContext35.gapMinutes >= 30,
  `gapMinutes: ${timeContext35.gapMinutes}, returning: ${timeContext35.isReturningAfterGap}`
);

// BM25 Retrieval for planted fact: "rent budget"
const bm25Results = searchChatHistoryBM25(testChatMessages, "rent budget kitna tha mera", { topK: 3 });
const foundPlantedFact = bm25Results.some((s) => s.snippetText.includes("45000") || s.snippetText.includes("Goa"));
recordTest(
  "BM25 Fact Retrieval",
  "Retrieves planted fact ('45000 rent budget') from 75 messages back",
  foundPlantedFact && bm25Results.length > 0,
  `Snippets returned: ${bm25Results.length}`
);

// Verify neighbor expansion: should contain assistant's answer and preceding context
const topSnippet = bm25Results[0];
const hasNeighborContext = topSnippet && (topSnippet.snippetText.includes("Goa") || topSnippet.snippetText.includes("Panjim"));
recordTest(
  "Turn Expansion",
  "Retrieved snippet encompasses surrounding conversational turn context",
  Boolean(hasNeighborContext),
  topSnippet ? topSnippet.snippetText.slice(0, 100) : "empty"
);

// 3-hour gap test
const threeHoursAgo = nowTimestamp - 180 * 60 * 1000;
const gap3hChat = [
  { id: "g1", role: "user", content: "Pehle ki baat", createdAt: new Date(threeHoursAgo - 60000).toISOString() },
  { id: "g2", role: "assistant", content: "Theek hai", createdAt: new Date(threeHoursAgo).toISOString() },
];
const timeContext3h = buildTimeContext(gap3hChat, new Date(nowTimestamp).toISOString(), "Asia/Kolkata");
recordTest(
  "Time Awareness (3-Hour Gap)",
  "Accurately calculates ~180 min gap and sets returning flag",
  timeContext3h.gapMinutes === 180 && timeContext3h.isReturningAfterGap === true,
  `gapMinutes: ${timeContext3h.gapMinutes}`
);

// ---------------------------------------------------------------------------
// SUITE 3: Context Pack Builder Budget (200 Messages)
// ---------------------------------------------------------------------------
console.log("\n[SUITE 3] CONTEXT PACK TOKEN BUDGET & PERFORMANCE (< 3,500 TOKENS)");

// Generate full 200 messages
const deep200Chat: any[] = [];
for (let i = 1; i <= 200; i++) {
  const isUser = i % 2 !== 0;
  deep200Chat.push({
    id: `deep_${i}`,
    role: isUser ? "user" : "assistant",
    content: isUser
      ? `Main question number ${i} pooch raha hoon. Iska crisp answer do.`
      : `Yeh answer number ${i} hai. Isme useful factual details shaamil hain.`,
    timestamp: nowTimestamp - (200 - i) * 60000,
  });
}

const mockNotes: ChatMemoryPackState = {
  summary: "User is planning a relocation to Goa next month with a 45k INR rent budget. We explored Panjim and Candolim.",
  facts: [
    { id: "f1", text: "Moving to Goa next month", type: "fact" },
    { id: "f2", text: "Rent budget is 45,000 INR per month", type: "preference" },
    { id: "f3", text: "Prefers furnished 2BHK near Panjim", type: "detail" },
  ],
  openThreads: ["Explore Candolim flat options"],
  timeline: [{ time: "14:10", note: "Discussed relocation budget" }],
  lastSummarizedMessageId: "deep_190",
};

const t0 = performance.now();
const contextPack = buildContextPack({
  messages: deep200Chat,
  newQuery: "Pehle humne kya decide kiya tha rent ke baare me?",
  chatMemoryState: mockNotes,
  clientTimeIso: new Date(nowTimestamp).toISOString(),
  timezone: "Asia/Kolkata",
  maxTokens: 3500,
});
const t1 = performance.now();

recordTest(
  "Context Pack Budget",
  "Total Context Pack tokens <= 3,500 limit on 200-message chat",
  contextPack.debugInfo.totalTokens <= 3500 && contextPack.debugInfo.totalTokens > 0,
  `Actual tokens: ${contextPack.debugInfo.totalTokens} / 3500`
);

recordTest(
  "Context Pack Inclusions",
  "Context pack includes Time Context, Chat Notes, and Durable Facts",
  Boolean(
    contextPack.chatContextBlock.includes("[TIME CONTEXT]") &&
    contextPack.chatContextBlock.includes("[CHAT NOTES") &&
    contextPack.chatContextBlock.includes("45,000 INR")
  )
);

recordTest(
  "Context Pack Verbatim Sliding Window",
  "Maintains at least 4 and up to 10 latest verbatim conversation turns",
  contextPack.verbatimMessages.length >= 4 && contextPack.verbatimMessages.length <= 10,
  `Kept: ${contextPack.verbatimMessages.length} messages`
);

recordTest(
  "Performance & Latency",
  "Context Pack assembly latency < 30ms across 200 messages",
  t1 - t0 < 30,
  `Latency: ${(t1 - t0).toFixed(2)}ms`
);

// ---------------------------------------------------------------------------
// SUITE 4: Backend Voice, Slang & Anti-Repetition Benchmark
// ---------------------------------------------------------------------------
console.log("\n[SUITE 4] BACKEND CASUAL VOICE & ANTI-REPETITION SUITE (PYTHON)");

let pythonSuitePassed = false;
try {
  const pythonPath = path.resolve(__dirname, "../../backend/venv/Scripts/python.exe");
  const testScript = path.resolve(__dirname, "../../backend/test_phase2_voice.py");
  const out = execSync(`"${pythonPath}" "${testScript}"`, { encoding: "utf-8" });
  if (out.includes("ALL 21/21 PHASE 2 TESTS PASSED")) {
    pythonSuitePassed = true;
  }
} catch (err: any) {
  console.error("Python test execution error:", err.message);
}

recordTest(
  "Backend Voice & Anti-Repetition",
  "All 21 backend voice, slang classification, and anti-loop tests passed",
  pythonSuitePassed
);

// ---------------------------------------------------------------------------
// FINAL BENCHMARK SUMMARY & SCORECARD
// ---------------------------------------------------------------------------
console.log("\n===========================================================================");
console.log("             AUTONEXIS CHAT & MEMORY ENGINE BENCHMARK REPORT               ");
console.log("===========================================================================");

const totalTests = results.length;
const passedTests = results.filter((r) => r.passed).length;
const overallScore = Math.round((passedTests / totalTests) * 100);

const suites = Array.from(new Set(results.map((r) => r.suite)));
console.log("\nSuite Breakdown:");
for (const s of suites) {
  const suiteResults = results.filter((r) => r.suite === s);
  const suitePassed = suiteResults.filter((r) => r.passed).length;
  const pct = Math.round((suitePassed / suiteResults.length) * 100);
  console.log(`  • ${s.padEnd(40)}: ${suitePassed}/${suiteResults.length} passed (${pct}%)`);
}

console.log("\nOverall Scorecard:");
console.log(`  Total Tests Run : ${totalTests}`);
console.log(`  Tests Passed   : ${passedTests}`);
console.log(`  Tests Failed   : ${totalTests - passedTests}`);
console.log(`  Benchmark Score: ${overallScore}%`);
console.log("===========================================================================\n");

if (passedTests !== totalTests) {
  process.exit(1);
} else {
  console.log("✨ ALL BENCHMARK & EVALUATION TESTS PASSED WITH 100% SUCCESS! ✨\n");
}
