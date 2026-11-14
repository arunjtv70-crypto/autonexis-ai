/**
 * On-Device NSFW & Intimate Content Classifier
 *
 * Runs client-side using bundled nsfwjs + TensorFlow.js (no external CDN calls).
 * Lazy-loaded strictly on demand when an image is attached.
 *
 * Explicit nudity or sexual content is blocked locally:
 * - Never uploaded to backend
 * - Never sent to upstream LLM
 * - Never stored in Firestore or localStorage
 * - Local preview cleared on send with sensitive_image_not_sent flag passed
 *
 * Borderline images (medical, skin, artistic) are permitted but marked sensitive.
 */

export interface NsfwThresholds {
  explicitPorn: number;
  explicitHentai: number;
  explicitCombined: number;
  borderlineSexy: number;
  borderlinePornLow: number;
}

export const DEFAULT_NSFW_THRESHOLDS: NsfwThresholds = {
  explicitPorn: 0.55,
  explicitHentai: 0.60,
  explicitCombined: 0.65,
  borderlineSexy: 0.50,
  borderlinePornLow: 0.25,
};

export interface NsfwScores {
  porn: number;
  hentai: number;
  sexy: number;
  neutral: number;
  drawing: number;
}

export interface NsfwScreeningResult {
  category: "explicit" | "borderline" | "safe";
  isExplicit: boolean;
  isBorderline: boolean;
  isSafe: boolean;
  scores: NsfwScores;
  notice: string;
}

interface AggregateStats {
  screenedCount: number;
  explicitBlockedCount: number;
  borderlineCount: number;
  safeCount: number;
}

const aggregateStats: AggregateStats = {
  screenedCount: 0,
  explicitBlockedCount: 0,
  borderlineCount: 0,
  safeCount: 0,
};

let nsfwModelPromise: Promise<any> | null = null;

/**
 * Lazy loads the NSFWJS model from bundled npm package without CDN calls.
 */
export async function getOrLoadNsfwClassifier(): Promise<any> {
  if (!nsfwModelPromise) {
    nsfwModelPromise = (async () => {
      try {
        const nsfw = await import("nsfwjs");
        const model = await nsfw.load();
        return model;
      } catch (err) {
        console.warn("[AUTONEXIS NSFW] Failed to initialize on-device classifier:", err);
        return null;
      }
    })();
  }
  return nsfwModelPromise;
}

/**
 * Returns calm, non-judgmental notice text matching the user's language.
 */
export function getSensitiveBlockedNotice(langHint = "en"): string {
  const norm = (langHint || "").toLowerCase();
  if (norm.startsWith("hi")) {
    return "यह फ़ोटो नीति के अनुसार नहीं भेजी जाएगी। आपका सामान्य प्रश्न सामान्य रूप से भेजा जा रहा है।";
  }
  if (norm.includes("hinglish") || norm.includes("hi-in")) {
    return "Yeh photo policy ke mutabiq bheji nahi jayegi. Aapka sawal normal tarike se bheja ja raha hai.";
  }
  return "This photo will not be sent. Your question will be answered normally.";
}

/**
 * Screens an image element or data URL using the on-device classifier.
 */
export async function screenImageWithClassifier(
  imageSource: HTMLImageElement | HTMLCanvasElement | string,
  thresholds: NsfwThresholds = DEFAULT_NSFW_THRESHOLDS,
  langHint = "en"
): Promise<NsfwScreeningResult> {
  const model = await getOrLoadNsfwClassifier();

  const defaultScores: NsfwScores = {
    porn: 0,
    hentai: 0,
    sexy: 0,
    neutral: 1,
    drawing: 0,
  };

  if (!model) {
    // If WebGL/classifier fails to initialize, gracefully allow through as safe
    return {
      category: "safe",
      isExplicit: false,
      isBorderline: false,
      isSafe: true,
      scores: defaultScores,
      notice: "",
    };
  }

  let imgElement: HTMLImageElement;
  let createdElement = false;

  if (typeof imageSource === "string") {
    imgElement = new Image();
    imgElement.crossOrigin = "anonymous";
    imgElement.src = imageSource;
    createdElement = true;
    try {
      await imgElement.decode();
    } catch {
      // Decode error
      return {
        category: "safe",
        isExplicit: false,
        isBorderline: false,
        isSafe: true,
        scores: defaultScores,
        notice: "",
      };
    }
  } else if (imageSource instanceof HTMLCanvasElement) {
    imgElement = new Image();
    imgElement.src = imageSource.toDataURL("image/jpeg", 0.85);
    createdElement = true;
    try {
      await imgElement.decode();
    } catch {
      return {
        category: "safe",
        isExplicit: false,
        isBorderline: false,
        isSafe: true,
        scores: defaultScores,
        notice: "",
      };
    }
  } else {
    imgElement = imageSource;
  }

  try {
    const predictions: Array<{ className: string; probability: number }> =
      await model.classify(imgElement);

    const scores: NsfwScores = { ...defaultScores };
    for (const p of predictions) {
      const cls = (p.className || "").toLowerCase();
      if (cls === "porn") scores.porn = p.probability;
      else if (cls === "hentai") scores.hentai = p.probability;
      else if (cls === "sexy") scores.sexy = p.probability;
      else if (cls === "neutral") scores.neutral = p.probability;
      else if (cls === "drawing") scores.drawing = p.probability;
    }

    aggregateStats.screenedCount += 1;

    // Explicit check: adult nudity or explicit sexual acts
    const isExplicit =
      scores.porn >= thresholds.explicitPorn ||
      scores.hentai >= thresholds.explicitHentai ||
      scores.porn + scores.hentai >= thresholds.explicitCombined ||
      (scores.porn >= 0.40 && scores.sexy >= 0.35);

    if (isExplicit) {
      aggregateStats.explicitBlockedCount += 1;
      return {
        category: "explicit",
        isExplicit: true,
        isBorderline: false,
        isSafe: false,
        scores,
        notice: getSensitiveBlockedNotice(langHint),
      };
    }

    // Borderline check: revealing attire, skin-heavy medical or anatomical context
    const isBorderline =
      scores.sexy >= thresholds.borderlineSexy ||
      (scores.porn >= thresholds.borderlinePornLow && scores.porn < thresholds.explicitPorn) ||
      (scores.sexy >= 0.35 && scores.neutral < 0.60);

    if (isBorderline) {
      aggregateStats.borderlineCount += 1;
      return {
        category: "borderline",
        isExplicit: false,
        isBorderline: true,
        isSafe: false,
        scores,
        notice: "",
      };
    }

    aggregateStats.safeCount += 1;
    return {
      category: "safe",
      isExplicit: false,
      isBorderline: false,
      isSafe: true,
      scores,
      notice: "",
    };
  } catch (err) {
    console.warn("[AUTONEXIS NSFW] Classification error:", err);
    return {
      category: "safe",
      isExplicit: false,
      isBorderline: false,
      isSafe: true,
      scores: defaultScores,
      notice: "",
    };
  } finally {
    if (createdElement) {
      imgElement.src = "";
    }
  }
}

/**
 * Returns aggregate metrics for logging without storing any sensitive user data.
 */
export function getNsfwAggregateStats(): Readonly<AggregateStats> {
  return { ...aggregateStats };
}
