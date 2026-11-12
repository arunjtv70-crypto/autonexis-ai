import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  DEFAULT_IMAGE_EDITS,
  type ImageEditState,
  type PreparedImageAttachment,
  dataUrlToCanvas,
  renderEditedCanvas,
} from "../utils/imageIntake";

interface ImageEditorModalProps {
  isOpen: boolean;
  mode: "edit" | "askPart";
  fileName: string;
  /** High-resolution session original Data URL (or fallback display URL) */
  sourceUrl: string;
  initialEdits?: ImageEditState;
  onClose: () => void;
  onApplyEdit?: (edits: ImageEditState) => Promise<void> | void;
  onAskAboutPart?: (cropRect: { x: number; y: number; w: number; h: number }) => Promise<void> | void;
}

export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  isOpen,
  mode,
  fileName,
  sourceUrl,
  initialEdits,
  onClose,
  onApplyEdit,
  onAskAboutPart,
}) => {
  const [edits, setEdits] = useState<ImageEditState>(initialEdits || DEFAULT_IMAGE_EDITS);
  const [selectingArea, setSelectingArea] = useState<boolean>(mode === "askPart");
  const [draftCrop, setDraftCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(
    mode === "askPart" ? { x: 0.15, y: 0.15, w: 0.7, h: 0.7 } : initialEdits?.crop || null
  );
  const [isApplying, setIsApplying] = useState(false);

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEdits(initialEdits || DEFAULT_IMAGE_EDITS);
    setSelectingArea(mode === "askPart");
    setDraftCrop(mode === "askPart" ? { x: 0.15, y: 0.15, w: 0.7, h: 0.7 } : initialEdits?.crop || null);
    setIsApplying(false);
    sourceCanvasRef.current = null;
  }, [isOpen, mode, sourceUrl, initialEdits]);

  const drawPreview = useCallback(() => {
    const src = sourceCanvasRef.current;
    const outCanvas = previewCanvasRef.current;
    if (!src || !outCanvas) return;

    // In editor preview show uncropped rotated/filtered canvas when selecting area so user sees whole frame
    const previewEdits: ImageEditState =
      selectingArea || mode === "askPart" ? { ...edits, crop: null } : edits;

    const rendered = renderEditedCanvas(src, previewEdits);
    const maxPreviewSide = 760;
    const scale = Math.min(1, maxPreviewSide / Math.max(rendered.width, rendered.height));
    outCanvas.width = Math.max(1, Math.round(rendered.width * scale));
    outCanvas.height = Math.max(1, Math.round(rendered.height * scale));
    const ctx = outCanvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(rendered, 0, 0, outCanvas.width, outCanvas.height);
  }, [edits, selectingArea, mode]);

  useEffect(() => {
    if (!isOpen || !sourceUrl) return;
    let cancelled = false;
    dataUrlToCanvas(sourceUrl)
      .then((canvas) => {
        if (cancelled) return;
        sourceCanvasRef.current = canvas;
        drawPreview();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, sourceUrl, drawPreview]);

  useEffect(() => {
    if (isOpen) drawPreview();
  }, [isOpen, drawPreview]);

  if (!isOpen) return null;

  const getRelativePoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = previewCanvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectingArea) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativePoint(e);
    dragStartRef.current = pt;
    setDraftCrop({ x: pt.x, y: pt.y, w: 0.02, h: 0.02 });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectingArea || !dragStartRef.current) return;
    const pt = getRelativePoint(e);
    const start = dragStartRef.current;
    const x = Math.min(start.x, pt.x);
    const y = Math.min(start.y, pt.y);
    const w = Math.max(0.05, Math.abs(pt.x - start.x));
    const h = Math.max(0.05, Math.abs(pt.y - start.y));
    setDraftCrop({ x, y, w: Math.min(1 - x, w), h: Math.min(1 - y, h) });
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  const handleConfirm = async () => {
    if (isApplying) return;
    setIsApplying(true);
    try {
      if (mode === "askPart" && onAskAboutPart) {
        const box = draftCrop && draftCrop.w >= 0.05 && draftCrop.h >= 0.05
          ? draftCrop
          : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        await onAskAboutPart(box);
      } else if (onApplyEdit) {
        const finalCrop = selectingArea ? draftCrop : edits.crop;
        await onApplyEdit({ ...edits, crop: finalCrop });
      }
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="modal-backdrop image-editor-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={mode === "askPart" ? "Ask about part of image" : "Edit image"}>
      <div className="image-editor-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="image-editor-header">
          <div>
            <h3 className="image-editor-title">
              {mode === "askPart" ? "Ask about this part" : "Prepare image"}
            </h3>
            <span className="image-editor-subtitle">{fileName}</span>
          </div>
          <button type="button" className="image-editor-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="image-editor-stage" ref={stageRef}>
          <div
            className={`image-editor-canvas-wrap ${selectingArea ? "is-selecting" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <canvas ref={previewCanvasRef} className="image-editor-canvas" />
            {selectingArea && draftCrop && (
              <div
                className="image-editor-crop-box"
                style={{
                  left: `${draftCrop.x * 100}%`,
                  top: `${draftCrop.y * 100}%`,
                  width: `${draftCrop.w * 100}%`,
                  height: `${draftCrop.h * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        {selectingArea && (
          <div className="image-editor-hint">
            Drag across the image to select the area you want to focus on.
          </div>
        )}

        {mode === "edit" && (
          <div className="image-editor-controls">
            <div className="image-editor-btn-row">
              <button
                type="button"
                className="image-editor-tool-btn"
                onClick={() =>
                  setEdits((prev) => ({
                    ...prev,
                    rotateDeg: (((prev.rotateDeg + 90) % 360) as 0 | 90 | 180 | 270),
                  }))
                }
              >
                Rotate 90°
              </button>
              <button
                type="button"
                className={`image-editor-tool-btn ${selectingArea ? "active" : ""}`}
                onClick={() => {
                  setSelectingArea((prev) => !prev);
                  if (!draftCrop) setDraftCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
                }}
              >
                {selectingArea ? "Crop active" : "Select area"}
              </button>
              <button
                type="button"
                className={`image-editor-tool-btn ${edits.autoEnhance ? "active" : ""}`}
                onClick={() => setEdits((prev) => ({ ...prev, autoEnhance: !prev.autoEnhance }))}
              >
                Auto enhance
              </button>
              <button
                type="button"
                className="image-editor-tool-btn"
                onClick={() => {
                  setEdits(DEFAULT_IMAGE_EDITS);
                  setDraftCrop(null);
                  setSelectingArea(false);
                }}
              >
                Reset original
              </button>
            </div>

            <div className="image-editor-sliders">
              <label className="image-editor-slider-label">
                <span>Brightness ({edits.brightness > 0 ? `+${edits.brightness}` : edits.brightness})</span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={2}
                  value={edits.brightness}
                  onChange={(e) => setEdits((prev) => ({ ...prev, brightness: Number(e.target.value) }))}
                />
              </label>
              <label className="image-editor-slider-label">
                <span>Contrast ({edits.contrast > 0 ? `+${edits.contrast}` : edits.contrast})</span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={2}
                  value={edits.contrast}
                  onChange={(e) => setEdits((prev) => ({ ...prev, contrast: Number(e.target.value) }))}
                />
              </label>
            </div>
          </div>
        )}

        <div className="image-editor-footer">
          <button type="button" className="image-editor-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="image-editor-apply-btn"
            onClick={handleConfirm}
            disabled={isApplying}
          >
            {isApplying
              ? "Preparing..."
              : mode === "askPart"
              ? "Attach cropped region"
              : "Apply changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureFile: (file: File) => void;
  onFallbackSystemCamera: () => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCaptureFile,
  onFallbackSystemCamera,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      return;
    }
    let cancelled = false;
    setCameraError(null);
    setIsStarting(true);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setIsStarting(false);
      setCameraError("In-app camera is unavailable in this browser. You can use the system camera instead.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setIsStarting(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setIsStarting(false);
        setCameraError(err?.message || "Camera access was blocked or no camera was found.");
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [isOpen, facingMode, stopStream]);

  if (!isOpen) return null;

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        stopStream();
        onCaptureFile(file);
        onClose();
      },
      "image/jpeg",
      0.92
    );
  };

  return (
    <div className="modal-backdrop image-editor-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Camera capture">
      <div className="image-editor-sheet camera-capture-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="image-editor-header">
          <div>
            <h3 className="image-editor-title">Take a photo</h3>
            <span className="image-editor-subtitle">Point clearly at the text, object, or scene</span>
          </div>
          <button type="button" className="image-editor-close-btn" onClick={onClose} aria-label="Close camera">
            ✕
          </button>
        </div>

        <div className="camera-preview-stage">
          {cameraError ? (
            <div className="camera-error-box">
              <p>{cameraError}</p>
              <button
                type="button"
                className="image-editor-apply-btn"
                onClick={() => {
                  onClose();
                  onFallbackSystemCamera();
                }}
              >
                Open device camera
              </button>
            </div>
          ) : (
            <video ref={videoRef} playsInline muted className="camera-preview-video" />
          )}
          {isStarting && !cameraError && (
            <div className="camera-starting-overlay">Starting camera...</div>
          )}
        </div>

        <div className="image-editor-footer">
          <button
            type="button"
            className="image-editor-tool-btn"
            onClick={() => setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))}
          >
            Flip camera
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="image-editor-cancel-btn" onClick={onClose}>
              Cancel
            </button>
            {!cameraError && (
              <button type="button" className="image-editor-apply-btn" onClick={handleSnap} disabled={isStarting}>
                Capture
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
export type { PreparedImageAttachment };

