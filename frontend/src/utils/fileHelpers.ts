/**
 * Client-side image compression and text-file reader utilities
 * Ensures payload remains well below Vercel's 4.5 MB body limit.
 */

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${Math.max(1, bytes || 0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sql",
  ".sh",
  ".yaml",
  ".yml",
  ".env",
  ".log",
];

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  const name = file.name.toLowerCase();
  return TEXT_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Resizes an image file to max 1600px on its longest edge and compresses to JPEG ~0.85 quality.
 * Returns a base64 Data URL (data:image/jpeg;base64,...).
 */
export async function resizeImageToDataUrl(
  file: File,
  maxDimension = 1600,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image file"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Unable to load image for resizing"));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        // Guarantee minimum 32x32 for Groq vision models
        width = Math.max(width, 32);
        height = Math.max(height, 32);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not create canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export interface CompressedImageResult {
  dataUrl: string;
  fileName: string;
  sizeBytes: number;
}

export interface BatchCompressionResult {
  images: CompressedImageResult[];
  totalBytes: number;
  error?: string;
}

/**
 * Optimizes a batch of up to 4 images to ensure total payload size
 * remains comfortably below Vercel's 4.5 MB request limit.
 * Dynamically steps down quality if the collective size is large.
 */
export async function compressImagesBatch(
  files: File[],
  maxFiles = 4
): Promise<BatchCompressionResult> {
  const selectedFiles = files.slice(0, maxFiles);
  let quality = 0.85;
  let maxDim = 1600;

  // Helper to compress all files at given params
  const tryCompress = async (dim: number, qual: number) => {
    const results: CompressedImageResult[] = [];
    let total = 0;
    for (const f of selectedFiles) {
      const dataUrl = await resizeImageToDataUrl(f, dim, qual);
      const sizeBytes = Math.round((dataUrl.length * 3) / 4);
      total += sizeBytes;
      results.push({ dataUrl, fileName: f.name, sizeBytes });
    }
    return { results, total };
  };

  // Target: Under 3.2 MB total (well below 4.5 MB Vercel limit)
  const MAX_ALLOWED_BYTES = 3.2 * 1024 * 1024;

  let attempt = await tryCompress(maxDim, quality);

  if (attempt.total > MAX_ALLOWED_BYTES) {
    quality = 0.75;
    attempt = await tryCompress(maxDim, quality);
  }

  if (attempt.total > MAX_ALLOWED_BYTES) {
    quality = 0.65;
    maxDim = 1280;
    attempt = await tryCompress(maxDim, quality);
  }

  if (attempt.total > MAX_ALLOWED_BYTES) {
    quality = 0.55;
    maxDim = 1024;
    attempt = await tryCompress(maxDim, quality);
  }

  if (attempt.total > 3.6 * 1024 * 1024) {
    return {
      images: attempt.results,
      totalBytes: attempt.total,
      error: "The selected images are too large to send together. Please choose fewer or smaller images.",
    };
  }

  return {
    images: attempt.results,
    totalBytes: attempt.total,
  };
}

/**
 * Reads a text-like file (.txt, .md, .csv, .json, code files) in the browser.
 */
export async function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read text file"));
    reader.onload = () => resolve((reader.result as string) || "");
    reader.readAsText(file);
  });
}

export interface PdfExtractResult {
  text: string;
  totalPages: number;
  extractedPages: number;
  truncated: boolean;
  truncationNote?: string;
  isScanned: boolean;
}

/**
 * Lazily loads pdfjs-dist with its local worker and extracts text from a PDF file.
 * Limits: up to maxPages (default 20) and maxChars (default 30,000).
 * Detects scanned/image-only PDFs cleanly.
 */
export async function extractPdfText(
  file: File,
  maxPages = 20,
  maxChars = 30000
): Promise<PdfExtractResult> {
  const pdfjsLib = await import("pdfjs-dist");
  const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const totalPages = pdf.numPages || 0;
  const pagesToRead = Math.min(totalPages, maxPages);
  const pageTexts: string[] = [];
  let charCount = 0;
  let charTruncated = false;

  for (let pageNum = 1; pageNum <= pagesToRead; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const strings = textContent.items
      .map((item: any) => (typeof item?.str === "string" ? item.str : ""))
      .filter(Boolean);
    const pageStr = strings.join(" ").replace(/\s+/g, " ").trim();
    if (pageStr) {
      const formattedPage = `[Page ${pageNum}]\n${pageStr}`;
      if (charCount + formattedPage.length > maxChars) {
        const remaining = maxChars - charCount;
        if (remaining > 50) {
          pageTexts.push(formattedPage.slice(0, remaining) + "...");
        }
        charTruncated = true;
        break;
      }
      pageTexts.push(formattedPage);
      charCount += formattedPage.length + 2;
    }
  }

  const combinedText = pageTexts.join("\n\n").trim();
  const isScanned = combinedText.length < 20;
  const pageTruncated = totalPages > maxPages;
  const truncated = pageTruncated || charTruncated;

  let truncationNote: string | undefined;
  if (truncated) {
    const reasons: string[] = [];
    if (pageTruncated) reasons.push(`first ${maxPages} of ${totalPages} pages`);
    if (charTruncated) reasons.push(`first ~${maxChars.toLocaleString()} characters`);
    truncationNote = `Note: Only ${reasons.join(" and ")} were extracted to stay within size limits.`;
  }

  return {
    text: combinedText,
    totalPages,
    extractedPages: pagesToRead,
    truncated,
    truncationNote,
    isScanned,
  };
}

