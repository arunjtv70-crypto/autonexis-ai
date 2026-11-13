#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const SCAN_DIRS = ["src", "public"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".json"]);

// Known dummy / placeholder markers
const FORBIDDEN_MARKERS = [
  "Orbital",
  "Singularity",
  "studio presets",
  "Recent creations",
  "Lorem",
  "demo data",
  "placeholder text",
  "4K 60FPS",
  "Video Studio",
  "Create Image Studio",
  "System Architecture Overview",
  "self-learning",
  "dummy",
];

// Forbidden model/provider names in user-facing UI
const FORBIDDEN_PROVIDERS = [
  "Claude",
  "Anthropic",
  "OpenAI",
  "Groq",
  "Qwen",
  "DeepSeek",
];

function extractLiteralsAndJsx(content, ext) {
  const results = [];
  const lines = content.split(/\r?\n/);
  let inBlockComment = false;

  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx];
    const lineNum = idx + 1;

    if (inBlockComment) {
      const endIdx = line.indexOf("*/");
      if (endIdx !== -1) {
        inBlockComment = false;
        line = line.slice(endIdx + 2);
      } else {
        continue;
      }
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    const commentMatch = line.match(/(?<!https?:)\/\/.*$/);
    if (commentMatch) {
      line = line.slice(0, commentMatch.index);
    }

    // String literals: "...", '...', `...`
    const strRegex = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
    let match;
    while ((match = strRegex.exec(line)) !== null) {
      results.push({ text: match[2], lineNum, rawLine: lines[idx].trim() });
    }

    // JSX text: >text<
    if (ext === ".tsx" || ext === ".jsx" || ext === ".html") {
      const jsxRegex = />([^<>{}\n]+)</g;
      let jsxMatch;
      while ((jsxMatch = jsxRegex.exec(line)) !== null) {
        const text = jsxMatch[1].trim();
        if (text) {
          results.push({ text, lineNum, rawLine: lines[idx].trim() });
        }
      }
    }
  }

  return results;
}

function scanFile(filePath) {
  const ext = path.extname(filePath);
  if (!EXTENSIONS.has(ext)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");

  // In CSS or JSON, scan whole non-comment lines
  if (ext === ".css" || ext === ".json") {
    const findings = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const trimmed = l.trim();
      if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
      for (const m of FORBIDDEN_MARKERS) {
        if (l.toLowerCase().includes(m.toLowerCase())) {
          findings.push({
            file: relPath,
            line: i + 1,
            marker: m,
            text: trimmed,
          });
        }
      }
    }
    return findings;
  }

  const items = extractLiteralsAndJsx(content, ext);
  const findings = [];

  for (const item of items) {
    const lower = item.text.toLowerCase();

    for (const marker of FORBIDDEN_MARKERS) {
      // For "dummy", check word boundary to avoid matching words containing dummy as substring if any
      const pattern = marker === "dummy" ? /\bdummy\b/i : new RegExp(marker, "i");
      if (pattern.test(lower)) {
        findings.push({
          file: relPath,
          line: item.lineNum,
          marker,
          text: item.rawLine,
        });
      }
    }

    for (const provider of FORBIDDEN_PROVIDERS) {
      const pattern = new RegExp(`\\b${provider}\\b`, "i");
      if (pattern.test(item.text)) {
        findings.push({
          file: relPath,
          line: item.lineNum,
          marker: `Provider: ${provider}`,
          text: item.rawLine,
        });
      }
    }
  }

  return findings;
}

function walk(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git") {
        files.push(...walk(fullPath));
      }
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function run() {
  console.log("🔍 Scanning UI string literals in src/ and public/ for dummy markers...");
  const allFindings = [];

  for (const dirName of SCAN_DIRS) {
    const dirPath = path.join(projectRoot, dirName);
    const files = walk(dirPath);
    for (const f of files) {
      const findings = scanFile(f);
      allFindings.push(...findings);
    }
  }

  if (allFindings.length > 0) {
    console.error(`\n❌ Found ${allFindings.length} placeholder / dummy marker(s):`);
    for (const f of allFindings) {
      console.error(`  - [${f.marker}] ${f.file}:${f.line} -> "${f.text}"`);
    }
    process.exit(1);
  }

  console.log("✓ Placeholder audit passed: 0 dummy markers found in UI string literals.");
  process.exit(0);
}

run();
