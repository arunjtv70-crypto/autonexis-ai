/**
 * Client-side image compression and text-file reader utilities
 * Ensures payload remains well below Vercel's 4.5 MB body limit.
 */

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
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
