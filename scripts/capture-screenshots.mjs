#!/usr/bin/env node
/**
 * Generates clean Play Store / PWA screenshots (using ONLY synthetic guest/mock state)
 * plus non-public Google Play Store assets under store-assets/.
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(REPO_ROOT, "frontend", "dist");
const SCREENSHOTS_DIR = path.join(REPO_ROOT, "frontend", "public", "screenshots");
const STORE_ASSETS_DIR = path.join(REPO_ROOT, "store-assets");
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 4189;
const DEBUG_PORT = 9241;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "autonexis-shots-"));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const SYNTHETIC_GUEST_CHATS = [
  {
    id: "demo-chat-1",
    title: "Weekly Focus Plan",
    updated_at: "2026-11-11T09:30:00.000Z",
    _messagesLoaded: true,
    pinned: true,
    messages: [
      {
        id: "demo-m1",
        role: "user",
        content: "Help me structure a calm three-block morning routine for deep coding work.",
        created_at: "2026-11-11T09:28:00.000Z",
      },
      {
        id: "demo-m2",
        role: "assistant",
        content:
          "Here is a quiet three-block structure built around uninterrupted focus:\n\n" +
          "1. **Warm-up (15 min):** Review today's single priority and inspect open notes before opening messages.\n" +
          "2. **Deep Build (90 min):** Tackle the hardest architectural task offline or in single-tab focus.\n" +
          "3. **Wrap & Reset (15 min):** Write clean next steps and take a five-minute screen break.\n\n" +
          "Would you like me to save this cadence to your workspace preferences or adapt it for afternoons?",
        created_at: "2026-11-11T09:29:00.000Z",
      },
    ],
  },
  {
    id: "demo-chat-2",
    title: "Quick Image Idea",
    updated_at: "2026-11-11T08:15:00.000Z",
    _messagesLoaded: true,
    messages: [],
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function killTree(pid) {
  if (!pid) return;
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
  } catch {}
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });
    this.ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evalExpr(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text || r.exceptionDetails.exception?.description || "Eval failed");
    }
    return r.result?.value;
  }
  close() {
    try { this.ws?.close(); } catch {}
  }
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", BASE_URL);
    if (reqUrl.pathname === "/__store-icon") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
<head>
<style>
  html, body {
    margin: 0; padding: 0; width: 512px; height: 512px;
    background: #000000; display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  img { width: 396px; height: 396px; object-fit: contain; display: block; }
</style>
</head>
<body><img src="/brand/logo-mark.png" alt="AUTONEXIS" /></body>
</html>`);
      return;
    }

    if (reqUrl.pathname === "/__store-feature") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
<head>
<style>
  @font-face {
    font-family: "Michroma";
    src: url("/fonts/michroma-latin-400.woff2") format("woff2");
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: "Inter";
    src: url("/fonts/inter-latin.woff2") format("woff2");
    font-weight: 300 600;
    font-style: normal;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1024px; height: 500px; background: #000000; color: #ededf0;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden; font-family: "Inter", sans-serif;
  }
  .canvas {
    position: relative; width: 1024px; height: 500px; background: #000000;
    display: flex; align-items: center; justify-content: center; gap: 56px;
    padding: 48px 72px;
  }
  .ring {
    position: absolute; right: -120px; top: -120px; width: 520px; height: 520px;
    border-radius: 50%; border: 1px solid rgba(203, 177, 132, 0.14);
    pointer-events: none;
  }
  .ring2 {
    position: absolute; left: -160px; bottom: -180px; width: 460px; height: 460px;
    border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.06);
    pointer-events: none;
  }
  .mark-box {
    width: 240px; height: 240px; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .mark-box img { width: 224px; height: 224px; object-fit: contain; display: block; }
  .copy {
    display: flex; flex-direction: column; align-items: flex-start; gap: 18px; z-index: 1;
  }
  .wordmark {
    font-family: "Michroma", sans-serif; font-size: 56px; font-weight: 400;
    letter-spacing: 0.24em; color: #f4f4f6; line-height: 1.1;
  }
  .tagline {
    font-family: "Inter", sans-serif; font-size: 22px; font-weight: 400;
    letter-spacing: 0.08em; color: #cbb184;
  }
  .sub {
    font-size: 16px; color: #9c9ca6; letter-spacing: 0.02em;
  }
</style>
</head>
<body>
  <div class="canvas">
    <div class="ring"></div>
    <div class="ring2"></div>
    <div class="mark-box">
      <img src="/brand/logo-mark.png" alt="AUTONEXIS" />
    </div>
    <div class="copy">
      <div class="wordmark">AUTONEXIS</div>
      <div class="tagline">Your AI Assistant</div>
      <div class="sub">Private chat, image creation, live voice calls &amp; documents</div>
    </div>
  </div>
</body>
</html>`);
      return;
    }

    let filePath = path.join(DIST_DIR, decodeURIComponent(reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname));
    if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, "index.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function openTargetPage(targetUrl) {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
  const target = await res.json();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return { cdp, targetId: target.id };
}

async function waitLoaded(cdp) {
  for (let i = 0; i < 60; i += 1) {
    const ready = await cdp.evalExpr(`
      return document.readyState === "complete" && !!document.getElementById("root");
    `);
    if (ready) break;
    await sleep(100);
  }
  await cdp.evalExpr(`if (document.fonts && document.fonts.ready) await document.fonts.ready;`);
  await sleep(450);
}

async function seedGuestAndOpen(cdp, w, h, mode = "chat") {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: w <= 640,
  });
  await cdp.evalExpr(`
    localStorage.setItem("autonexis_is_guest", "true");
    localStorage.setItem("autonexis_app_mode", "1");
    localStorage.setItem("autonexis_theme", "dark");
    sessionStorage.setItem("autonexis_splash_done", "1");
    localStorage.setItem("autonexis:guest:chats", ${JSON.stringify(JSON.stringify(SYNTHETIC_GUEST_CHATS))});
  `);
  await cdp.send("Page.navigate", { url: `${BASE_URL}/?source=app` });
  await waitLoaded(cdp);
  // Wait for splash and chats hydration
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.evalExpr(`
      const s = document.getElementById("autonexis-splash");
      const hidden = !s || s.style.display === "none" || s.classList.contains("is-hidden");
      const hasLayout = !!document.querySelector(".chat-screen-layout");
      return hidden && hasLayout;
    `);
    if (ready) break;
    await sleep(100);
  }
  await sleep(300);

  if (mode === "chat") {
    await cdp.evalExpr(`
      const firstChatBtn = Array.from(document.querySelectorAll(".chat-list-item, .chat-item-btn, [data-chat-id], button"))
        .find((el) => (el.textContent || "").includes("Weekly Focus Plan"));
      if (firstChatBtn) firstChatBtn.click();
    `);
    await sleep(350);
    await cdp.evalExpr(`
      const closeBtn = document.querySelector(".drawer-close-btn, .mobile-drawer-overlay");
      if (closeBtn) closeBtn.click();
    `);
    await sleep(250);
  } else if (mode === "home") {
    await cdp.evalExpr(`
      const newChatBtn = Array.from(document.querySelectorAll("button"))
        .find((el) => (el.textContent || "").includes("New Chat"));
      if (newChatBtn) newChatBtn.click();
    `);
    await sleep(350);
    await cdp.evalExpr(`
      const closeBtn = document.querySelector(".drawer-close-btn, .mobile-drawer-overlay");
      if (closeBtn) closeBtn.click();
    `);
    await sleep(250);
  }
}

async function capturePng(cdp, outPath, w, h) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(250);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(data, "base64"));
  console.log(`[SAVED] ${path.relative(REPO_ROOT, outPath)} (${w}x${h})`);
}

async function main() {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error("frontend/dist missing. Run npm run build first.");
  }
  const server = await startStaticServer();
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ]);

  let cdp = null;
  try {
    // Wait for Chrome CDP
    for (let i = 0; i < 40; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
        if (r.ok) break;
      } catch {}
      await sleep(150);
    }

    const opened = await openTargetPage(`${BASE_URL}/`);
    cdp = opened.cdp;

    // 1. Desktop wide workspace screenshot (1280x720)
    await seedGuestAndOpen(cdp, 1280, 720, "chat");
    await capturePng(cdp, path.join(SCREENSHOTS_DIR, "wide-workspace-dark.png"), 1280, 720);

    // 2. Phone chat screenshot (540x960)
    await seedGuestAndOpen(cdp, 540, 960, "chat");
    await capturePng(cdp, path.join(SCREENSHOTS_DIR, "phone-chat-dark.png"), 540, 960);

    // 3. Phone welcome / modes screenshot (540x960)
    await seedGuestAndOpen(cdp, 540, 960, "home");
    await capturePng(cdp, path.join(SCREENSHOTS_DIR, "phone-voice-dark.png"), 540, 960);

    // 4. Non-public Store Icon 512x512 on pure black
    await cdp.send("Page.navigate", { url: `${BASE_URL}/__store-icon` });
    await sleep(450);
    await capturePng(cdp, path.join(STORE_ASSETS_DIR, "icon-512.png"), 512, 512);

    // 5. Non-public Store Feature Graphic 1024x500 on pure black
    await cdp.send("Page.navigate", { url: `${BASE_URL}/__store-feature` });
    await sleep(500);
    await capturePng(cdp, path.join(STORE_ASSETS_DIR, "feature-graphic-1024x500.png"), 1024, 500);
  } finally {
    cdp?.close();
    killTree(chrome.pid);
    server.close();
    try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
