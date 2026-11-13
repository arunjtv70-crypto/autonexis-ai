import React, { useState, useRef, useEffect } from "react";
import { useAppNavigation } from "../state/navigation";
import {
  IconDownload,
  IconCopy,
  IconCheck,
  IconImage,
  IconVolume,
  IconSparkles,
  IconEdit,
  IconTrash,
  IconInfo,
  IconPlus,
  IconClose,
} from "./Icons";
import "./CreationCards.css";

// 1. Image Creation Card Component
export interface ImageCardProps {
  chatId?: string;
  messageId?: string;
  prompt: string;
  finalPrompt?: string;
  imageUrl?: string;
  fullQualityUrl?: string;
  style?: string;
  aspect?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  seed?: number;
  status?: "generating" | "ready" | "expired" | "deleted" | "error" | "blocked";
  errorMessage?: string;
  warnings?: string[];
  addDownloadWatermark?: boolean;
  isGuest?: boolean;
  onLazyLoadAsset?: () => Promise<string | null>;
  onRegenerate?: () => void;
  onVariation?: () => void;
  onEditPrompt?: (newPrompt: string) => void;
  onDeleteImage?: () => Promise<void> | void;
  onReportImage?: () => Promise<boolean> | boolean;
  onRetryError?: () => void;
}

function resolveCssAspectRatio(aspect?: string, width?: number, height?: number): string {
  if (aspect === "4:5") return "4 / 5";
  if (aspect === "16:9") return "16 / 9";
  if (aspect === "9:16") return "9 / 16";
  if (aspect === "1:1") return "1 / 1";
  if (width && height && width > 0 && height > 0) return `${width} / ${height}`;
  return "1 / 1";
}

function getTouchDistance(t1: React.Touch, t2: React.Touch): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}

export const ImageCreationCard: React.FC<ImageCardProps> = ({
  prompt,
  imageUrl,
  fullQualityUrl,
  style,
  aspect,
  aspectRatio,
  width,
  height,
  seed,
  status = "ready",
  errorMessage,
  warnings,
  addDownloadWatermark = false,
  onLazyLoadAsset,
  onRegenerate,
  onVariation,
  onEditPrompt,
  onDeleteImage,
  onReportImage,
  onRetryError,
}) => {
  const { hasOverlay, pushOverlay, closeOverlay } = useAppNavigation();
  const [copied, setCopied] = useState(false);
  const [isLocalFullscreen, setIsLocalFullscreen] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [lazyLoading, setLazyLoading] = useState(false);
  const [lazyAttempted, setLazyAttempted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState("0.0");
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPromptVal, setEditedPromptVal] = useState(prompt);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent">("idle");

  // Lightbox zoom & pan state
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const panStartRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);

  const cardWrapperRef = useRef<HTMLDivElement | null>(null);
  const effectiveImageUrl = fullQualityUrl || imageUrl;
  const cssAspect = resolveCssAspectRatio(aspect || aspectRatio, width, height);
  const isPortrait = aspect === "9:16" || aspect === "4:5" || (height && width && height > width);
  const isFullscreen = isLocalFullscreen && hasOverlay("lightbox");

  useEffect(() => {
    setEditedPromptVal(prompt);
  }, [prompt]);

  useEffect(() => {
    setImgLoaded(false);
  }, [effectiveImageUrl]);

  // Live elapsed timer while generating
  useEffect(() => {
    if (status !== "generating") return;
    const startMs = Date.now();
    setElapsedSec("0.0");
    const timer = window.setInterval(() => {
      setElapsedSec(((Date.now() - startMs) / 1000).toFixed(1));
    }, 100);
    return () => window.clearInterval(timer);
  }, [status]);

  // Lazy load compressed image from Firestore only when card scrolls into view
  useEffect(() => {
    if (status !== "ready" || effectiveImageUrl || lazyAttempted || !onLazyLoadAsset) return;
    let cancelled = false;
    const triggerLoad = async () => {
      if (cancelled) return;
      setLazyLoading(true);
      setLazyAttempted(true);
      try {
        await onLazyLoadAsset();
      } finally {
        if (!cancelled) setLazyLoading(false);
      }
    };

    const el = cardWrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      triggerLoad();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          triggerLoad();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [status, effectiveImageUrl, lazyAttempted, onLazyLoadAsset]);

  // Keep lightbox synced with history-based overlay stack (hardware back button)
  useEffect(() => {
    if (!hasOverlay("lightbox") && isLocalFullscreen) {
      setIsLocalFullscreen(false);
      setZoomScale(1);
      setPanOffset({ x: 0, y: 0 });
    }
  }, [hasOverlay, isLocalFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsLocalFullscreen(false);
        closeOverlay("lightbox");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen, closeOverlay]);

  const openFullscreen = () => {
    if (!effectiveImageUrl) return;
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setIsLocalFullscreen(true);
    pushOverlay("lightbox");
  };

  const closeFullscreen = () => {
    setIsLocalFullscreen(false);
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    closeOverlay("lightbox");
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(prompt).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = async () => {
    const src = fullQualityUrl || imageUrl;
    if (!src) return;
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || width || 1024;
      canvas.height = img.naturalHeight || height || 1024;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Stamp subtle AUTONEXIS corner mark ONLY if explicitly enabled in Settings
        if (addDownloadWatermark) {
          const logoImg = new Image();
          logoImg.src = "/brand/logo-mark.png";
          await new Promise((res) => {
            logoImg.onload = res;
            logoImg.onerror = res;
          });
          const badgeW = 136;
          const badgeH = 30;
          const badgeX = canvas.width - badgeW - 14;
          const badgeY = canvas.height - badgeH - 14;

          ctx.fillStyle = "rgba(12, 12, 16, 0.78)";
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 15);
          } else {
            ctx.rect(badgeX, badgeY, badgeW, badgeH);
          }
          ctx.fill();

          try {
            ctx.drawImage(logoImg, badgeX + 6, badgeY + 4, 22, 22);
          } catch {}

          ctx.fillStyle = "#ffffff";
          ctx.font = "600 12px system-ui, -apple-system, sans-serif";
          ctx.fillText("AUTONEXIS", badgeX + 34, badgeY + 19);
        }

        canvas.toBlob(
          (blob) => {
            if (!blob) return;
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `autonexis_${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
          },
          "image/jpeg",
          0.94
        );
        return;
      }
    } catch {
      const a = document.createElement("a");
      a.href = src;
      a.download = `autonexis_${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  const handleSaveEditedPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = editedPromptVal.trim();
    if (!clean || !onEditPrompt) return;
    setIsEditingPrompt(false);
    onEditPrompt(clean);
  };

  const handleReport = async () => {
    if (!onReportImage || reportStatus !== "idle") return;
    setReportStatus("sending");
    const ok = await onReportImage();
    setReportStatus(ok ? "sent" : "idle");
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStartDistRef.current = getTouchDistance(e.touches[0], e.touches[1]);
      pinchStartScaleRef.current = zoomScale;
      panStartRef.current = null;
    } else if (e.touches.length === 1 && zoomScale > 1) {
      panStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        origX: panOffset.x,
        origY: panOffset.y,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current) {
      e.preventDefault();
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      const ratio = dist / pinchStartDistRef.current;
      const nextScale = Math.min(4, Math.max(1, pinchStartScaleRef.current * ratio));
      setZoomScale(nextScale);
      if (nextScale <= 1.02) setPanOffset({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && zoomScale > 1 && panStartRef.current) {
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      setPanOffset({ x: panStartRef.current.origX + dx, y: panStartRef.current.origY + dy });
    }
  };

  const handleTouchEnd = () => {
    pinchStartDistRef.current = null;
    panStartRef.current = null;
  };

  const isExpiredOrDeleted =
    status === "expired" ||
    status === "deleted" ||
    (status === "ready" && !effectiveImageUrl && lazyAttempted && !lazyLoading);

  const metaParts: string[] = [];
  if (style && style !== "Auto") metaParts.push(style);
  if (aspect && aspect !== "Auto") metaParts.push(aspect);
  else if (width && height) metaParts.push(`${width}×${height}`);

  return (
    <div
      ref={cardWrapperRef}
      className={`creation-card image-creation-card ${isPortrait ? "is-portrait" : ""}`}
    >
      <div className="creation-card-header">
        <div className="creation-card-tag">
          <IconImage size={15} />
          <span>Generated image</span>
          {metaParts.length > 0 && (
            <span className="creation-badge">{metaParts.join(" · ")}</span>
          )}
        </div>
        <button
          type="button"
          className="creation-action-icon-btn"
          onClick={handleCopyPrompt}
          title="Copy prompt"
          aria-label="Copy image prompt"
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </button>
      </div>

      {status === "error" ? (
        <div className="creation-error-box">
          <p className="creation-error-text">
            {errorMessage || "Could not create this image right now. Please try again."}
          </p>
          {(onRetryError || onRegenerate) && (
            <button
              type="button"
              className="creation-secondary-btn"
              onClick={onRetryError || onRegenerate}
            >
              Retry
            </button>
          )}
        </div>
      ) : status === "generating" || lazyLoading ? (
        <div className="creation-image-wrapper is-skeleton" style={{ aspectRatio: cssAspect }}>
          <div className="creation-loader-overlay">
            <IconSparkles size={24} className="sparkle-spin" />
            <span>
              {status === "generating"
                ? `Creating your image... ${elapsedSec}s`
                : "Loading saved image..."}
            </span>
          </div>
        </div>
      ) : isExpiredOrDeleted ? (
        <div className="creation-image-wrapper is-expired" style={{ aspectRatio: cssAspect }}>
          <div className="creation-expired-content">
            <IconImage size={26} />
            <p className="creation-expired-title">
              Stored image expired or removed — prompt &amp; seed preserved.
            </p>
            {typeof seed === "number" && (
              <span className="creation-seed-chip">Seed {seed}</span>
            )}
            {onRegenerate && (
              <button
                type="button"
                className="creation-download-btn"
                onClick={onRegenerate}
              >
                <IconSparkles size={14} />
                <span>Regenerate (same settings)</span>
              </button>
            )}
          </div>
        </div>
      ) : effectiveImageUrl ? (
        <div
          className="creation-image-wrapper"
          style={{ aspectRatio: cssAspect }}
          onClick={openFullscreen}
          title="Click to view full size"
        >
          {!imgLoaded && (
            <div className="creation-loader-overlay">
              <IconSparkles size={22} className="sparkle-spin" />
              <span>Preparing preview...</span>
            </div>
          )}
          <img
            src={effectiveImageUrl}
            alt={prompt}
            className="creation-img"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
          />
        </div>
      ) : null}

      {warnings && warnings.length > 0 && (
        <div className="creation-warning-note">
          <IconInfo size={13} />
          <span>{warnings.join(" ")}</span>
        </div>
      )}

      {isEditingPrompt && (
        <form className="creation-edit-form" onSubmit={handleSaveEditedPrompt}>
          <input
            type="text"
            className="creation-edit-input"
            value={editedPromptVal}
            onChange={(e) => setEditedPromptVal(e.target.value)}
            placeholder="Describe changes or refine prompt..."
            aria-label="Edit image prompt"
            autoFocus
          />
          <div className="creation-edit-actions">
            <button type="submit" className="creation-download-btn">
              Generate
            </button>
            <button
              type="button"
              className="creation-secondary-btn"
              onClick={() => {
                setIsEditingPrompt(false);
                setEditedPromptVal(prompt);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {confirmDelete && (
        <div className="creation-delete-confirm">
          <span>Remove this stored image? Prompt &amp; seed stay saved.</span>
          <div className="creation-delete-confirm-btns">
            <button
              type="button"
              className="creation-danger-btn"
              onClick={() => {
                setConfirmDelete(false);
                onDeleteImage?.();
              }}
            >
              Delete image
            </button>
            <button
              type="button"
              className="creation-secondary-btn"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="creation-card-footer">
        <div className="creation-prompt-text" title={prompt}>
          <span className="prompt-label">Prompt:</span> {prompt}
        </div>
        {status === "ready" && effectiveImageUrl && (
          <div className="creation-actions-bar">
            <button
              type="button"
              className="creation-download-btn"
              onClick={handleDownload}
              title="Download JPEG"
            >
              <IconDownload size={14} />
              <span>Download</span>
            </button>
            {onRegenerate && (
              <button
                type="button"
                className="creation-secondary-btn"
                onClick={onRegenerate}
                title="Regenerate with same prompt and seed"
              >
                Regenerate
              </button>
            )}
            {onVariation && (
              <button
                type="button"
                className="creation-secondary-btn"
                onClick={onVariation}
                title="Create a new variation"
              >
                Variation
              </button>
            )}
            {onEditPrompt && (
              <button
                type="button"
                className="creation-secondary-btn"
                onClick={() => setIsEditingPrompt((v) => !v)}
                title="Edit prompt"
              >
                <IconEdit size={13} />
                <span>Edit</span>
              </button>
            )}
            {onDeleteImage && (
              <button
                type="button"
                className="creation-secondary-btn"
                onClick={() => setConfirmDelete((v) => !v)}
                title="Delete stored image"
                aria-label="Delete image"
              >
                <IconTrash size={13} />
              </button>
            )}
            {onReportImage && (
              <button
                type="button"
                className="creation-secondary-btn"
                onClick={handleReport}
                disabled={reportStatus !== "idle"}
                title="Report issue with this image"
              >
                {reportStatus === "sent" ? "Reported" : "Report"}
              </button>
            )}
          </div>
        )}
      </div>

      {isFullscreen && effectiveImageUrl && (
        <div
          className="creation-lightbox"
          onClick={closeFullscreen}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="lightbox-topbar" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="lightbox-ctrl-btn"
              onClick={() => {
                setZoomScale((s) => {
                  const next = Math.max(1, Number((s - 0.5).toFixed(2)));
                  if (next === 1) setPanOffset({ x: 0, y: 0 });
                  return next;
                });
              }}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="lightbox-ctrl-btn"
              onClick={() => {
                setZoomScale(1);
                setPanOffset({ x: 0, y: 0 });
              }}
              title="Reset zoom"
            >
              {Math.round(zoomScale * 100)}%
            </button>
            <button
              type="button"
              className="lightbox-ctrl-btn"
              onClick={() => setZoomScale((s) => Math.min(4, Number((s + 0.5).toFixed(2))))}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <IconPlus size={15} />
            </button>
            <button
              type="button"
              className="lightbox-ctrl-btn"
              onClick={handleDownload}
              aria-label="Download image"
              title="Download JPEG"
            >
              <IconDownload size={15} />
            </button>
            <button
              type="button"
              className="lightbox-close-btn"
              aria-label="Close image preview"
              onClick={closeFullscreen}
            >
              <IconClose size={18} />
            </button>
          </div>
          <div
            className="lightbox-img-wrapper"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => {
              if (zoomScale > 1.1) {
                setZoomScale(1);
                setPanOffset({ x: 0, y: 0 });
              } else {
                setZoomScale(2);
              }
            }}
          >
            <img
              src={effectiveImageUrl}
              alt={prompt}
              className="lightbox-img"
              style={{
                transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomScale})`,
                transition: pinchStartDistRef.current ? "none" : "transform 0.18s ease-out",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// 2. Speech Synthesis Audio Speaker Helper & Component
export function speakTextWithPreferences(
  text: string,
  opts?: {
    voiceName?: string;
    voiceSpeed?: number;
    voiceLanguage?: string;
    onEnd?: () => void;
  }
): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return false;
  }
  window.speechSynthesis.cancel();
  const cleanText = text.replace(/[*#`_~[\]()]/g, "").slice(0, 600);
  if (!cleanText.trim()) return false;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const voices = window.speechSynthesis.getVoices();
  const desiredName = opts?.voiceName;
  const desiredLang = opts?.voiceLanguage;

  let chosen = desiredName ? voices.find((v) => v.name === desiredName) : undefined;
  if (!chosen && desiredLang) {
    chosen = voices.find((v) => v.lang.toLowerCase().startsWith(desiredLang.toLowerCase()));
  }
  if (!chosen) {
    chosen =
      voices.find((v) => v.lang.startsWith("en-IN")) ||
      voices.find((v) => v.lang.startsWith("hi")) ||
      voices.find((v) => v.lang.startsWith("en"));
  }
  if (chosen) utterance.voice = chosen;
  if (desiredLang) utterance.lang = desiredLang;
  utterance.rate = typeof opts?.voiceSpeed === "number" ? Math.min(2, Math.max(0.5, opts.voiceSpeed)) : 1.0;

  if (opts?.onEnd) {
    utterance.onend = opts.onEnd;
    utterance.onerror = opts.onEnd;
  }
  window.speechSynthesis.speak(utterance);
  return true;
}

export const SpeechAudioButton: React.FC<{
  text: string;
  voiceName?: string;
  voiceSpeed?: number;
  voiceLanguage?: string;
}> = ({ text, voiceName, voiceSpeed, voiceLanguage }) => {
  const [isSpeaking, setIsSpeaking] = useState(false);

  if (typeof window !== "undefined" && !("speechSynthesis" in window)) {
    return null;
  }

  const toggleSpeech = () => {
    if (!("speechSynthesis" in window)) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);
    const started = speakTextWithPreferences(text, {
      voiceName,
      voiceSpeed,
      voiceLanguage,
      onEnd: () => setIsSpeaking(false),
    });
    if (!started) setIsSpeaking(false);
  };

  return (
    <button
      type="button"
      className={`msg-action-btn ${isSpeaking ? "speaking-active" : ""}`}
      onClick={toggleSpeech}
      title={isSpeaking ? "Stop listening" : "Listen to response"}
    >
      <IconVolume size={14} />
      <span>{isSpeaking ? "Speaking..." : "Listen"}</span>
    </button>
  );
};
