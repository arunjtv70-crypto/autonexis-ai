#!/usr/bin/env node
/**
 * Validates Digital Asset Links (/.well-known/assetlinks.json) both locally
 * (public/, dist/, vercel.json) and optionally against a live URL.
 *
 * Usage:
 *   npm run check:assetlinks
 *   npm run check:assetlinks -- https://your-domain.com/.well-known/assetlinks.json
 *   npm run check:assetlinks -- http://127.0.0.1:4173/.well-known/assetlinks.json --strict
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const urlArg = args.find((a) => !a.startsWith("-"));

const SHA256_REGEX = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

function validateAssetLinksPayload(data, sourceLabel) {
  if (!Array.isArray(data)) {
    throw new Error(`${sourceLabel}: Expected JSON array at top level.`);
  }

  if (data.length === 0) {
    if (strict) {
      throw new Error(
        `${sourceLabel}: assetlinks.json is still an empty placeholder [] (--strict requires at least one Android signing fingerprint entry).`
      );
    }
    console.log(
      `[OK] ${sourceLabel}: valid JSON array placeholder ([]). Add package_name + sha256_cert_fingerprints before Play release.`
    );
    return;
  }

  for (let i = 0; i < data.length; i += 1) {
    const entry = data[i];
    if (!entry || typeof entry !== "object") {
      throw new Error(`${sourceLabel}[${i}]: Entry must be an object.`);
    }
    if (!Array.isArray(entry.relation) || !entry.relation.includes("delegate_permission/common.handle_all_urls")) {
      throw new Error(
        `${sourceLabel}[${i}]: relation must include "delegate_permission/common.handle_all_urls".`
      );
    }
    const target = entry.target;
    if (!target || typeof target !== "object") {
      throw new Error(`${sourceLabel}[${i}]: Missing target object.`);
    }
    if (target.namespace !== "android_app") {
      throw new Error(`${sourceLabel}[${i}]: target.namespace must be "android_app".`);
    }
    if (typeof target.package_name !== "string" || !target.package_name.trim()) {
      throw new Error(`${sourceLabel}[${i}]: target.package_name must be a non-empty string.`);
    }
    if (!Array.isArray(target.sha256_cert_fingerprints) || target.sha256_cert_fingerprints.length === 0) {
      throw new Error(`${sourceLabel}[${i}]: target.sha256_cert_fingerprints must be a non-empty array.`);
    }
    for (const fp of target.sha256_cert_fingerprints) {
      if (typeof fp !== "string" || !SHA256_REGEX.test(fp.trim())) {
        throw new Error(
          `${sourceLabel}[${i}]: Invalid SHA-256 fingerprint format "${fp}" (expected 32 uppercase colon-separated hex bytes).`
        );
      }
    }
  }

  console.log(`[OK] ${sourceLabel}: ${data.length} valid Digital Asset Links entry(ies).`);
}

function checkLocalFiles() {
  const publicFile = path.join(repoRoot, "frontend", "public", ".well-known", "assetlinks.json");
  if (!fs.existsSync(publicFile)) {
    throw new Error(`Missing required file: ${publicFile}`);
  }
  const publicRaw = fs.readFileSync(publicFile, "utf8");
  const publicParsed = JSON.parse(publicRaw);
  validateAssetLinksPayload(publicParsed, "frontend/public/.well-known/assetlinks.json");

  const distFile = path.join(repoRoot, "frontend", "dist", ".well-known", "assetlinks.json");
  if (fs.existsSync(distFile)) {
    const distRaw = fs.readFileSync(distFile, "utf8");
    const distParsed = JSON.parse(distRaw);
    validateAssetLinksPayload(distParsed, "frontend/dist/.well-known/assetlinks.json");
  } else {
    console.log("[INFO] frontend/dist/.well-known/assetlinks.json not built yet (run npm run build first to include dist check).");
  }

  const vercelFile = path.join(repoRoot, "vercel.json");
  const vercelJson = JSON.parse(fs.readFileSync(vercelFile, "utf8"));
  const headerRule = (vercelJson.headers || []).find((h) => h.source === "/.well-known/assetlinks.json");
  if (!headerRule) {
    throw new Error("vercel.json is missing headers rule for /.well-known/assetlinks.json");
  }
  const contentTypeHeader = (headerRule.headers || []).find(
    (h) => String(h.key).toLowerCase() === "content-type" && String(h.value).includes("application/json")
  );
  if (!contentTypeHeader) {
    throw new Error("vercel.json /.well-known/assetlinks.json header must set Content-Type: application/json");
  }
  const spaRewrite = (vercelJson.rewrites || []).find((r) => r.destination === "/index.html");
  if (spaRewrite && !String(spaRewrite.source).includes(".well-known")) {
    throw new Error("vercel.json SPA rewrite must explicitly exclude .well-known/ so assetlinks.json never gets rewritten to HTML.");
  }
  console.log("[OK] vercel.json serves /.well-known/assetlinks.json with application/json and excludes .well-known/ from SPA rewrites.");
}

async function checkRemoteUrl(targetUrl) {
  let finalUrl = targetUrl;
  if (!targetUrl.endsWith("/.well-known/assetlinks.json")) {
    finalUrl = targetUrl.replace(/\/+$/, "") + "/.well-known/assetlinks.json";
  }
  const res = await fetch(finalUrl, { redirect: "manual" });
  if (res.status !== 200) {
    throw new Error(`Expected HTTP 200 for ${finalUrl} (no redirects allowed by Android TWA), got ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new Error(`Expected Content-Type application/json for ${finalUrl}, got "${ct}"`);
  }
  const bodyText = await res.text();
  if (bodyText.trim().startsWith("<")) {
    throw new Error(`Received HTML instead of JSON from ${finalUrl}`);
  }
  const parsed = JSON.parse(bodyText);
  validateAssetLinksPayload(parsed, finalUrl);
}

try {
  checkLocalFiles();
  if (urlArg) {
    await checkRemoteUrl(urlArg);
  }
} catch (err) {
  console.error(`[FAIL] ${err.message}`);
  process.exit(1);
}

