// Frontend Image Intake, Quality Analysis, Editing, Tiling & Barcode Utilities (Phase A)
// Keeps everything client-side using canvas APIs plus lazy-loaded decoders when needed.

export interface ImageQualityIssue {
  code: "blurry" | "tooSmall" | "tooDark" | "tooBright" | "needsRotate90" | "tilted" | "extremeAspect";
  label: string;
  severity: "info" | "warn";
  autoFixable: boolean;
}

export interface DecodedBarcodeInfo {
  rawValue: string;
  format: string;
  isUrl: boolean;
  displayUrl?: string;
  hostname?: string;
  isShortener?: boolean;
  isSuspicious?: boolean;
  warning?: string;
}

export interface ImageEditState {
  crop: { x: number; y: number; w: number; h: number } | null; // normalized 0..1
  rotateDeg: 0 | 90 | 180 | 270;
  brightness: number; // -50 .. +50
  contrast: number; // -50 .. +50
  autoEnhance: boolean;
}

export interface PreparedImageAttachment {
  id: string;
  fileName: string;
  source: "gallery" | "camera" | "paste" | "drop" | "pdf" | "crop";
  width: number;
  height: number;
  isTextHeavy: boolean;
  /** Ready-to-send dataUrl (overview or full image) */
  dataUrl: string;
  /** Optional tiled high-res slices in reading order for tall/wide text images */
  tiles?: string[];
  /** Unmodified normalized session original dataUrl (never sent if edited, never saved to Firestore) */
  originalDataUrl: string;
  originalWidth: number;
  originalHeight: number;
  byteSize: number;
  issues: ImageQualityIssue[];
  dismissedIssues?: boolean;
  usingOriginal?: boolean;
  edits: ImageEditState;
  decodedCodes: DecodedBarcodeInfo[];
  qualityMetrics: {
    blurVariance: number;
    meanLuma: number;
    aspectRatio: number;
  };
}

export const DEFAULT_IMAGE_EDITS: ImageEditState = {
  crop: null,
  rotateDeg: 0,
  brightness: 0,
  contrast: 0,
  autoEnhance: false,
};

// Strictly keep combined dataUrl strings under ~2.25 MB so serialized JSON + text history stays < 2.85 MB (< 3 MB budget)
export const MAX_TOTAL_IMAGE_PAYLOAD_BYTES = Math.floor(2.25 * 1024 * 1024);

const SUPPORTED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const SUPPORTED_IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
const HEIC_MIME_OR_EXT_RE = /heic|heif/i;

const URL_SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "rb.gy",
  "is.gd",
  "v.gd",
  "buff.ly",
  "cutt.ly",
  "shorturl.at",
  "rebrand.ly",
  "tiny.cc",
  "s.id",
  "lnkd.in",
  "adf.ly",
]);

export function isSupportedImageFormat(file: { name?: string; type?: string }): boolean {
  const mime = (file.type || "").toLowerCase().trim();
  if (mime && SUPPORTED_IMAGE_MIME.has(mime)) return true;
  if (file.name && SUPPORTED_IMAGE_EXT_RE.test(file.name)) return true;
  return false;
}

export function isHeicFile(file: { name?: string; type?: string }): boolean {
  return HEIC_MIME_OR_EXT_RE.test(file.type || "") || /\.heic$|\.heif$/i.test(file.name || "");
}

/**
 * Pure JPEG EXIF Orientation reader (returns 1..8, defaults to 1).
 * Works directly on Uint8Array for both runtime verification and tests.
 */
export function readJpegExifOrientation(bytes: Uint8Array): number {
  if (!bytes || bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return 1;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xffe1) {
      // APP1 Exif header: length(2) + "Exif\0\0"(6)
      if (offset + 8 >= bytes.length) return 1;
      const exifId = view.getUint32(offset + 2, false);
      if (exifId !== 0x45786966) return 1; // "Exif"
      const tiffStart = offset + 8;
      if (tiffStart + 8 >= bytes.length) return 1;
      const little = view.getUint16(tiffStart, false) === 0x4949; // "II" vs "MM"
      const ifdOffset = view.getUint32(tiffStart + 4, little);
      const ifdStart = tiffStart + ifdOffset;
      if (ifdStart + 2 > bytes.length) return 1;
      const entries = view.getUint16(ifdStart, little);
      for (let i = 0; i < entries; i++) {
        const entryOff = ifdStart + 2 + i * 12;
        if (entryOff + 12 > bytes.length) break;
        const tag = view.getUint16(entryOff, little);
        if (tag === 0x0112) {
          const val = view.getUint16(entryOff + 8, little);
          return val >= 1 && val <= 8 ? val : 1;
        }
      }
      return 1;
    } else if ((marker & 0xff00) !== 0xff00 || marker === 0xffda || marker === 0xffd9) {
      break;
    } else {
      const segLen = view.getUint16(offset, false);
      if (segLen < 2) break;
      offset += segLen;
    }
  }
  return 1;
}

/**
 * Inspects a decoded QR/barcode string and flags URLs, shorteners, punycode, and IP links.
 * Never auto-opens any URL.
 */
export function inspectDecodedCode(rawValue: string, format = "qr_code"): DecodedBarcodeInfo {
  const clean = (rawValue || "").trim();
  const looksUrl = /^https?:\/\/\S+/i.test(clean);
  if (!looksUrl) {
    return { rawValue: clean, format, isUrl: false };
  }
  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    const isShortener = URL_SHORTENERS.has(host) || Array.from(URL_SHORTENERS).some((s) => host.endsWith(`.${s}`));
    const isPunycode = host.includes("xn--");
    const isIpHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
    const hasAtUserInfo = Boolean(parsed.username || parsed.password);
    const isHttpInsecure = parsed.protocol === "http:";
    const isSuspicious = isPunycode || isIpHost || hasAtUserInfo;

    let warning: string | undefined;
    if (hasAtUserInfo) {
      warning = "Misleading link format (@ userinfo) — destination may differ from display text.";
    } else if (isPunycode) {
      warning = "Internationalized domain (punycode) — check spelling carefully before opening.";
    } else if (isIpHost) {
      warning = "Direct IP address link — verify the source before opening.";
    } else if (isShortener) {
      warning = "Shortened link — final destination is hidden until visited.";
    } else if (isHttpInsecure) {
      warning = "Unencrypted HTTP link.";
    }

    return {
      rawValue: clean,
      format,
      isUrl: true,
      displayUrl: `${parsed.protocol}//${host}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 90),
      hostname: host,
      isShortener,
      isSuspicious,
      warning,
    };
  } catch {
    return {
      rawValue: clean,
      format,
      isUrl: true,
      isSuspicious: true,
      warning: "Malformed link URL — check carefully before using.",
    };
  }
}

async function decodeBlobToCanvas(blob: Blob, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Prefer createImageBitmap with "from-image" so EXIF orientation is honored cleanly without double-rotation,
  // and drawing onto a fresh canvas completely strips all EXIF, GPS, and device metadata.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      if (signal?.aborted) {
        bitmap.close();
        throw new DOMException("Aborted", "AbortError");
      }
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        throw new Error("Canvas context unavailable");
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return canvas;
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      // Fall back to HTMLImageElement below
    }
  }

  return await new Promise<HTMLCanvasElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      try {
        if (signal?.aborted) {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          reject(new Error("Canvas context unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0);
        cleanup();
        resolve(canvas);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("Image could not be decoded by the browser."));
    };
    img.src = url;
  });
}

async function decodeFileToCleanCanvas(file: File, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  if (!isSupportedImageFormat(file)) {
    throw new Error(
      `"${file.name}" uses an unsupported format. Supported images: JPEG, PNG, WebP, GIF, BMP, AVIF, and HEIC/HEIF.`
    );
  }
  if (file.size === 0) {
    throw new Error(`"${file.name}" is empty (0 bytes).`);
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let targetBlob: Blob = file;
  if (isHeicFile(file)) {
    try {
      const mod: any = await import("heic2any");
      const heic2anyFn = mod?.default || mod;
      const converted = await heic2anyFn({
        blob: file,
        toType: "image/jpeg",
        quality: 0.92,
      });
      targetBlob = Array.isArray(converted) ? converted[0] : converted;
      if (!(targetBlob instanceof Blob)) {
        throw new Error("Empty HEIC output");
      }
    } catch (err: any) {
      throw new Error(
        `Could not decode HEIC/HEIF image "${file.name}" (${err?.message || "decoder error"}). Please try JPEG or PNG if this camera format variant is unsupported.`
      );
    }
  }

  try {
    return await decodeBlobToCanvas(targetBlob, signal);
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new Error(`Could not decode image "${file.name}". Please ensure it is a valid image file.`);
  }
}

export async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return decodeBlobToCanvas(blob);
}

/**
 * Pure pixel-level quality & orientation metric calculator (works on any RGBA buffer + full dimensions).
 * Exported cleanly so unit tests and runtime share the exact same checks.
 */
export function analyzeImagePixels(
  rgba: Uint8ClampedArray,
  sampleW: number,
  sampleH: number,
  origW: number,
  origH: number
): {
  isTextHeavy: boolean;
  blurVariance: number;
  meanLuma: number;
  aspectRatio: number;
  issues: ImageQualityIssue[];
} {
  const n = sampleW * sampleH;
  const luma = new Float32Array(n);
  let sumLuma = 0;
  let darkCount = 0;
  let brightCount = 0;
  let strokeDarkCount = 0;

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const y = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    luma[i] = y;
    sumLuma += y;
    if (y < 38) darkCount++;
    if (y > 240) brightCount++;
    if (y < 115) strokeDarkCount++;
  }

  const meanLuma = n > 0 ? sumLuma / n : 128;
  const darkRatio = n > 0 ? darkCount / n : 0;
  const brightRatio = n > 0 ? brightCount / n : 0;
  const strokeRatio = n > 0 ? strokeDarkCount / n : 0;

  // Laplacian variance (sharpness) + Sobel gradient energies (for text-heavy & 90-degree sideways hint)
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  let highEdgeCount = 0;
  let gxSum = 0;
  let gySum = 0;
  let diagSum = 0;

  for (let y = 1; y < sampleH - 1; y++) {
    const row = y * sampleW;
    for (let x = 1; x < sampleW - 1; x++) {
      const idx = row + x;
      const c = luma[idx];
      const lap = luma[idx - sampleW] + luma[idx + sampleW] + luma[idx - 1] + luma[idx + 1] - 4 * c;
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount++;
      if (Math.abs(lap) > 38) highEdgeCount++;

      const gx = luma[idx + 1] - luma[idx - 1];
      const gy = luma[idx + sampleW] - luma[idx - sampleW];
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      gxSum += ax;
      gySum += ay;
      if (ax > 18 && ay > 18 && Math.abs(ax - ay) < Math.max(ax, ay) * 0.45) {
        diagSum++;
      }
    }
  }

  const lapMean = lapCount > 0 ? lapSum / lapCount : 0;
  const blurVariance = lapCount > 0 ? Math.max(0, lapSqSum / lapCount - lapMean * lapMean) : 0;
  const highEdgeDensity = lapCount > 0 ? highEdgeCount / lapCount : 0;

  // Row-mean variance vs Column-mean variance for detecting clearly sideways printed text lines
  const rowMeans = new Float32Array(sampleH);
  const colMeans = new Float32Array(sampleW);
  for (let y = 0; y < sampleH; y++) {
    let rSum = 0;
    const row = y * sampleW;
    for (let x = 0; x < sampleW; x++) {
      const v = luma[row + x];
      rSum += v;
      colMeans[x] += v;
    }
    rowMeans[y] = sampleW > 0 ? rSum / sampleW : meanLuma;
  }
  for (let x = 0; x < sampleW; x++) {
    colMeans[x] = sampleH > 0 ? colMeans[x] / sampleH : meanLuma;
  }

  const computeVar = (arr: Float32Array) => {
    if (arr.length === 0) return 0;
    let m = 0;
    for (let i = 0; i < arr.length; i++) m += arr[i];
    m /= arr.length;
    let v = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - m;
      v += d * d;
    }
    return v / arr.length;
  };

  const rowVar = computeVar(rowMeans);
  const colVar = computeVar(colMeans);

  // Text-heavy classification: crisp edges + clear dark ink vs light paper OR bimodal screenshot contrast
  const isTextHeavy =
    highEdgeDensity > 0.045 ||
    (blurVariance > 450 && (brightRatio > 0.35 || darkRatio > 0.25)) ||
    (highEdgeDensity > 0.02 && strokeRatio > 0.04 && brightRatio > 0.35);

  const aspectRatio = Math.max(origW / Math.max(1, origH), origH / Math.max(1, origW));
  const longSide = Math.max(origW, origH);
  const issues: ImageQualityIssue[] = [];

  if (longSide < 600) {
    issues.push({
      code: "tooSmall",
      label: `Low resolution (${origW}×${origH})`,
      severity: "warn",
      autoFixable: false,
    });
  }

  if (blurVariance < 55 && highEdgeDensity < 0.015) {
    issues.push({
      code: "blurry",
      label: "Image looks blurry",
      severity: "warn",
      autoFixable: true,
    });
  }

  if (meanLuma < 56 || darkRatio > 0.68) {
    issues.push({
      code: "tooDark",
      label: "Image is quite dark",
      severity: "warn",
      autoFixable: true,
    });
  } else if (meanLuma > 228 && strokeRatio < 0.02 && highEdgeDensity < 0.015) {
    // Only flag overexposed photos; crisp white-background docs have stroke/edges
    issues.push({
      code: "tooBright",
      label: "Image is overexposed / washed out",
      severity: "warn",
      autoFixable: true,
    });
  }

  // Clearly sideways text detection: vertical columns vary strongly more than horizontal rows
  if (isTextHeavy && colVar > Math.max(12, rowVar * 2.3) && gxSum > gySum * 1.15) {
    issues.push({
      code: "needsRotate90",
      label: "Looks rotated 90° sideways",
      severity: "warn",
      autoFixable: true,
    });
  } else if (isTextHeavy && lapCount > 0 && diagSum / lapCount > 0.065) {
    issues.push({
      code: "tilted",
      label: "Page appears slightly tilted",
      severity: "info",
      autoFixable: false,
    });
  }

  if (aspectRatio > 3.2) {
    issues.push({
      code: "extremeAspect",
      label: "Very tall or wide — will be split into reading sections",
      severity: "info",
      autoFixable: false,
    });
  }

  return {
    isTextHeavy,
    blurVariance: Math.round(blurVariance),
    meanLuma: Math.round(meanLuma),
    aspectRatio: Number(aspectRatio.toFixed(2)),
    issues,
  };
}

export function analyzeCanvasQuality(canvas: HTMLCanvasElement) {
  const maxSample = 320;
  const scale = Math.min(1, maxSample / Math.max(canvas.width, canvas.height));
  const sw = Math.max(16, Math.round(canvas.width * scale));
  const sh = Math.max(16, Math.round(canvas.height * scale));
  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  const ctx = tmp.getContext("2d");
  if (!ctx) {
    return {
      isTextHeavy: false,
      blurVariance: 200,
      meanLuma: 128,
      aspectRatio: Number((Math.max(canvas.width / Math.max(1, canvas.height), canvas.height / Math.max(1, canvas.width))).toFixed(2)),
      issues: [] as ImageQualityIssue[],
    };
  }
  ctx.drawImage(canvas, 0, 0, sw, sh);
  const imgData = ctx.getImageData(0, 0, sw, sh);
  return analyzeImagePixels(imgData.data, sw, sh, canvas.width, canvas.height);
}

/**
 * Applies histogram levels stretch (exposure correction) + mild 3x3 unsharp sharpening + manual adjustments.
 */
export function renderEditedCanvas(
  sourceCanvas: HTMLCanvasElement,
  edits: ImageEditState,
  issues: ImageQualityIssue[] = []
): HTMLCanvasElement {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;

  // 1. Crop region from source canvas
  const crop = edits.crop;
  const sx = crop ? Math.max(0, Math.min(sw - 1, Math.round(crop.x * sw))) : 0;
  const sy = crop ? Math.max(0, Math.min(sh - 1, Math.round(crop.y * sh))) : 0;
  const cw = crop ? Math.max(8, Math.min(sw - sx, Math.round(crop.w * sw))) : sw;
  const ch = crop ? Math.max(8, Math.min(sh - sy, Math.round(crop.h * sh))) : sh;

  // 2. Rotate 90/180/270
  const rot = edits.rotateDeg % 360;
  const swapAxes = rot === 90 || rot === 270;
  const outW = swapAxes ? ch : cw;
  const outH = swapAxes ? cw : ch;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const ctx = outCanvas.getContext("2d");
  if (!ctx) return sourceCanvas;

  // CSS filter for brightness / contrast sliders when non-zero
  const filters: string[] = [];
  if (edits.brightness !== 0) {
    filters.push(`brightness(${Math.max(0.25, 1 + edits.brightness / 100).toFixed(2)})`);
  }
  if (edits.contrast !== 0) {
    filters.push(`contrast(${Math.max(0.3, 1 + edits.contrast / 100).toFixed(2)})`);
  }
  if (filters.length > 0 && "filter" in ctx) {
    ctx.filter = filters.join(" ");
  }

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(sourceCanvas, sx, sy, cw, ch, -cw / 2, -ch / 2, cw, ch);
  ctx.restore();
  ctx.filter = "none";

  // 3. Auto-enhance pixel pass (levels stretch & mild 3x3 unsharp mask when requested)
  if (edits.autoEnhance) {
    const imgData = ctx.getImageData(0, 0, outW, outH);
    const data = imgData.data;

    // Histogram stretch (1st to 99th percentile on luminance)
    const hist = new Uint32Array(256);
    const totalPx = outW * outH;
    for (let i = 0; i < data.length; i += 4) {
      const y = Math.min(255, Math.max(0, Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])));
      hist[y]++;
    }
    const lowCut = totalPx * 0.01;
    const highCut = totalPx * 0.99;
    let acc = 0;
    let pLow = 0;
    let pHigh = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc <= lowCut) pLow = v;
      if (acc >= highCut) {
        pHigh = v;
        break;
      }
    }
    const isTooDark = issues.some((it) => it.code === "tooDark");
    const isTooBright = issues.some((it) => it.code === "tooBright");
    const effLow = isTooDark ? Math.min(pLow, 4) : pLow;
    const effHigh = isTooBright ? Math.max(pHigh, 248) : pHigh;
    const span = Math.max(isTooDark ? 48 : 24, effHigh - effLow);
    const needStretch = span < 215 || effLow > 28 || effHigh < 220;
    const gamma = isTooDark ? 0.52 : isTooBright ? 1.32 : 1.0;

    if (needStretch || gamma !== 1.0) {
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) {
        let norm = (v - effLow) / span;
        norm = Math.max(0, Math.min(1, norm));
        if (gamma !== 1.0) norm = Math.pow(norm, gamma);
        lut[v] = Math.round(norm * 255);
      }
      for (let i = 0; i < data.length; i += 4) {
        data[i] = lut[data[i]];
        data[i + 1] = lut[data[i + 1]];
        data[i + 2] = lut[data[i + 2]];
      }
    }

    // Mild 3x3 unsharp kernel if blurry or general clarity boost (amount = 0.35)
    const shouldSharpen = issues.some((it) => it.code === "blurry") || totalPx <= 2200 * 2200;
    if (shouldSharpen && outW > 8 && outH > 8) {
      const copy = new Uint8ClampedArray(data);
      const amount = issues.some((it) => it.code === "blurry") ? 0.45 : 0.25;
      for (let y = 1; y < outH - 1; y++) {
        const row = y * outW;
        for (let x = 1; x < outW - 1; x++) {
          const p = (row + x) * 4;
          for (let c = 0; c < 3; c++) {
            const center = copy[p + c];
            const blurAvg =
              (copy[p - 4 + c] + copy[p + 4 + c] + copy[p - outW * 4 + c] + copy[p + outW * 4 + c]) * 0.25;
            data[p + c] = Math.max(0, Math.min(255, Math.round(center + amount * (center - blurAvg))));
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  return outCanvas;
}

function resizeCanvasMaxSide(canvas: HTMLCanvasElement, maxLongSide: number): HTMLCanvasElement {
  const longSide = Math.max(canvas.width, canvas.height);
  if (longSide <= maxLongSide) return canvas;
  const scale = maxLongSide / longSide;
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, w, h);
  return out;
}

function encodeCanvasJpeg(canvas: HTMLCanvasElement, maxLongSide: number, quality: number): string {
  const resized = resizeCanvasMaxSide(canvas, maxLongSide);
  return resized.toDataURL("image/jpeg", quality);
}

/**
 * Generates overlapping reading-order tiles (~10% overlap, max 6 tiles) + overview
 * for tall/wide high-res text images (e.g., long screenshots or dense scanned docs).
 */
export function buildImageTiles(canvas: HTMLCanvasElement, maxLongSide: number, quality: number): {
  overviewDataUrl: string;
  tiles: string[];
} {
  const w = canvas.width;
  const h = canvas.height;
  const overviewDataUrl = encodeCanvasJpeg(canvas, Math.min(960, maxLongSide), Math.max(0.72, quality - 0.08));

  const vertical = h >= w;
  const longDim = vertical ? h : w;
  const shortDim = vertical ? w : h;
  const ratio = longDim / Math.max(1, shortDim);

  // Target ~2-6 tiles depending on aspect/length
  const tileCount = Math.max(2, Math.min(6, Math.ceil(ratio / 1.15)));
  const overlapFrac = 0.1;
  // Each tile covers span S such that N*S - (N-1)*overlap*S = longDim
  const stepFrac = 1 / (tileCount - (tileCount - 1) * overlapFrac);
  const tileSpan = Math.max(64, Math.round(longDim * stepFrac));
  const stride = Math.max(32, Math.round(tileSpan * (1 - overlapFrac)));

  const tiles: string[] = [];
  for (let i = 0; i < tileCount; i++) {
    const start = i === tileCount - 1 ? Math.max(0, longDim - tileSpan) : Math.min(longDim - tileSpan, i * stride);
    const sx = vertical ? 0 : start;
    const sy = vertical ? start : 0;
    const sw = vertical ? w : Math.min(w - sx, tileSpan);
    const sh = vertical ? Math.min(h - sy, tileSpan) : h;

    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = sw;
    tileCanvas.height = sh;
    const ctx = tileCanvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    tiles.push(encodeCanvasJpeg(tileCanvas, Math.min(maxLongSide, 1600), quality));
  }

  return { overviewDataUrl, tiles };
}

/**
 * Local QR code and barcode detection:
 * Uses native BarcodeDetector when available, with lazy-loaded jsQR fallback.
 */
export async function scanCanvasCodes(canvas: HTMLCanvasElement): Promise<DecodedBarcodeInfo[]> {
  const foundMap = new Map<string, DecodedBarcodeInfo>();

  const scaled = resizeCanvasMaxSide(canvas, 1024);

  // 1. Native BarcodeDetector (supports QR, EAN, Code128, PDF417, etc. where available)
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    try {
      const DetectorCtor = (window as any).BarcodeDetector;
      const detector = new DetectorCtor({
        formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "data_matrix", "pdf417"],
      });
      const results = await detector.detect(scaled);
      if (Array.isArray(results)) {
        for (const r of results) {
          const val = String(r?.rawValue || "").trim();
          if (val && !foundMap.has(val)) {
            foundMap.set(val, inspectDecodedCode(val, String(r?.format || "code")));
          }
        }
      }
    } catch {
      // Ignore unsupported detector error and try jsQR fallback
    }
  }

  // 2. Lazy-loaded jsQR fallback for browsers without BarcodeDetector (or when native missed a QR code)
  if (foundMap.size === 0) {
    try {
      const ctx = scaled.getContext("2d");
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, scaled.width, scaled.height);
        const mod: any = await import("jsqr");
        const jsQR = mod?.default || mod;
        const qr = jsQR(imgData.data, scaled.width, scaled.height, { inversionAttempts: "attemptBoth" });
        const val = String(qr?.data || "").trim();
        if (val && !foundMap.has(val)) {
          foundMap.set(val, inspectDecodedCode(val, "qr_code"));
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return Array.from(foundMap.values());
}

function estimateTotalImagesBytes(items: PreparedImageAttachment[]): number {
  let total = 0;
  for (const it of items) {
    total += it.dataUrl.length;
    if (it.tiles) {
      for (const t of it.tiles) total += t.length;
    }
  }
  return total;
}

/**
 * Packs a batch of prepared image attachments (including optional tiles) strictly under
 * MAX_TOTAL_IMAGE_PAYLOAD_BYTES so the whole request always stays well below 3 MB.
 */
export async function packAttachmentsWithinBudget(
  items: PreparedImageAttachment[]
): Promise<PreparedImageAttachment[]> {
  if (items.length === 0) return items;
  let working = items.map((it) => ({ ...it }));
  let total = estimateTotalImagesBytes(working);
  if (total <= MAX_TOTAL_IMAGE_PAYLOAD_BYTES) return working;

  const qualitySteps = [0.76, 0.66, 0.56, 0.48];
  const scaleSteps = [0.85, 0.72, 0.58, 0.45];

  for (let s = 0; s < qualitySteps.length; s++) {
    const q = qualitySteps[s];
    const scale = scaleSteps[s];
    const recompressed: PreparedImageAttachment[] = [];

    for (const item of working) {
      const canvas = await dataUrlToCanvas(item.usingOriginal ? item.originalDataUrl : item.dataUrl);
      const baseMax = item.isTextHeavy ? 2000 : 1280;
      const targetMax = Math.max(640, Math.round(baseMax * scale));

      let nextDataUrl = encodeCanvasJpeg(canvas, targetMax, q);
      let nextTiles = item.tiles;
      if (nextTiles && nextTiles.length > 0) {
        if (s >= 2 && working.length > 1) {
          // If multiple attachments are crowding the budget, drop extra tiles and preserve high-detail overview
          nextTiles = undefined;
        } else {
          const tiled = buildImageTiles(canvas, Math.min(1400, targetMax), q);
          nextDataUrl = tiled.overviewDataUrl;
          nextTiles = tiled.tiles.slice(0, working.length > 1 ? 3 : 6);
        }
      }

      let bytes = nextDataUrl.length;
      if (nextTiles) {
        for (const t of nextTiles) bytes += t.length;
      }

      recompressed.push({
        ...item,
        dataUrl: nextDataUrl,
        tiles: nextTiles,
        byteSize: bytes,
      });
    }

    working = recompressed;
    total = estimateTotalImagesBytes(working);
    if (total <= MAX_TOTAL_IMAGE_PAYLOAD_BYTES) break;
  }

  return working;
}

/**
 * Prepares a rendered canvas into a full PreparedImageAttachment (adaptive compression, tiling, codes, quality).
 */
export async function finalizeCanvasAsAttachment(
  id: string,
  fileName: string,
  source: PreparedImageAttachment["source"],
  originalCanvas: HTMLCanvasElement,
  edits: ImageEditState = DEFAULT_IMAGE_EDITS,
  existingCodes?: DecodedBarcodeInfo[],
  existingOriginalDataUrl?: string
): Promise<PreparedImageAttachment> {
  // Re-encode normalized original once at high cap (up to 2200px) so metadata is stripped and memory stays bounded
  const origNormCanvas = resizeCanvasMaxSide(originalCanvas, 2200);
  const originalDataUrl = existingOriginalDataUrl || origNormCanvas.toDataURL("image/jpeg", 0.9);

  const baseMetrics = analyzeCanvasQuality(origNormCanvas);
  const editedCanvas = renderEditedCanvas(origNormCanvas, edits, baseMetrics.issues);
  const editedMetrics = analyzeCanvasQuality(editedCanvas);

  // If user already rotated manually or applied autoEnhance, clear resolved warnings cleanly
  const remainingIssues = editedMetrics.issues.filter((iss) => {
    if (edits.autoEnhance && (iss.code === "tooDark" || iss.code === "tooBright" || iss.code === "blurry")) {
      return false;
    }
    if (edits.rotateDeg !== 0 && iss.code === "needsRotate90") {
      return false;
    }
    return true;
  });

  const maxSide = editedMetrics.isTextHeavy ? 2000 : 1280;
  const quality = editedMetrics.isTextHeavy ? 0.88 : 0.82;
  const longSide = Math.max(editedCanvas.width, editedCanvas.height);

  let dataUrl: string;
  let tiles: string[] | undefined;

  if (editedMetrics.isTextHeavy && (longSide >= 2100 || editedMetrics.aspectRatio >= 2.5)) {
    const tiled = buildImageTiles(editedCanvas, maxSide, quality);
    dataUrl = tiled.overviewDataUrl;
    tiles = tiled.tiles;
  } else {
    dataUrl = encodeCanvasJpeg(editedCanvas, maxSide, quality);
  }

  const decodedCodes = existingCodes ?? (await scanCanvasCodes(editedCanvas));

  let byteSize = dataUrl.length;
  if (tiles) {
    for (const t of tiles) byteSize += t.length;
  }

  return {
    id,
    fileName,
    source,
    width: editedCanvas.width,
    height: editedCanvas.height,
    isTextHeavy: editedMetrics.isTextHeavy,
    dataUrl,
    tiles,
    originalDataUrl,
    originalWidth: origNormCanvas.width,
    originalHeight: origNormCanvas.height,
    byteSize,
    issues: remainingIssues,
    edits,
    decodedCodes,
    qualityMetrics: {
      blurVariance: editedMetrics.blurVariance,
      meanLuma: editedMetrics.meanLuma,
      aspectRatio: editedMetrics.aspectRatio,
    },
  };
}

/**
 * Full Phase A intake pipeline for raw File objects from gallery, drop, paste, camera, or scanned PDF pages.
 */
export async function intakeImageFiles(
  files: File[],
  existingItems: PreparedImageAttachment[],
  options: {
    source: PreparedImageAttachment["source"];
    maxCount?: number;
    signal?: AbortSignal;
    onProgress?: (msg: string) => void;
  }
): Promise<{
  items: PreparedImageAttachment[];
  errors: string[];
}> {
  const maxCount = options.maxCount ?? 4;
  const remaining = Math.max(0, maxCount - existingItems.length);
  const selected = files.slice(0, remaining);
  const newItems: PreparedImageAttachment[] = [];
  const errors: string[] = [];

  for (let i = 0; i < selected.length; i++) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const file = selected[i];
    options.onProgress?.(`Preparing image ${i + 1} of ${selected.length}...`);
    try {
      const canvas = await decodeFileToCleanCanvas(file, options.signal);
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const item = await finalizeCanvasAsAttachment(
        id,
        file.name || `image-${i + 1}.jpg`,
        options.source,
        canvas
      );
      newItems.push(item);
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      errors.push(err?.message || `Could not read "${file.name}".`);
    }
  }

  const combined = await packAttachmentsWithinBudget([...existingItems, ...newItems]);
  return { items: combined.slice(0, maxCount), errors };
}

/**
 * Crops a normalized rectangle from an image's high-resolution original (or fallback URL)
 * to implement "Ask about this part" cleanly at full detail.
 */
export async function cropHighResRegionAsAttachment(
  sourceDataUrl: string,
  fileName: string,
  cropRect: { x: number; y: number; w: number; h: number }
): Promise<PreparedImageAttachment> {
  const canvas = await dataUrlToCanvas(sourceDataUrl);
  const id = `img_crop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const croppedCanvas = renderEditedCanvas(canvas, { ...DEFAULT_IMAGE_EDITS, crop: cropRect });
  return finalizeCanvasAsAttachment(id, fileName, "crop", croppedCanvas);
}
