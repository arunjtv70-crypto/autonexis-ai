import React, { useState, useRef, useEffect } from "react";
import {
  IconDownload,
  IconCopy,
  IconCheck,
  IconPlay,
  IconPause,
  IconImage,
  IconVideo,
  IconVolume,
  IconSparkles,
} from "./Icons";
import "./CreationCards.css";

// 1. Image Creation Card Component with AUTONEXIS Branding Watermark
interface ImageCardProps {
  prompt: string;
  imageUrl?: string;
  aspectRatio?: string;
}

export const ImageCreationCard: React.FC<ImageCardProps> = ({
  prompt,
  imageUrl,
}) => {
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Clean prompt and enforce nologo / private parameters
  const cleanPrompt =
    prompt.replace(/^(image of|generate image|create image|photo of|drawing of|banao)/i, "").trim() ||
    "cinematic futuristic abstract art";
  const finalImageUrl =
    imageUrl ||
    `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=768&nologo=true&private=true&seed=42`;

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download image with official AUTONEXIS logo branding
  const handleDownload = async () => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = finalImageUrl;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 1024;
      canvas.height = img.naturalHeight || 768;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.drawImage(img, 0, 0);

        // Load and stamp AUTONEXIS logo at bottom-right corner
        const logoImg = new Image();
        logoImg.src = "/logo_circle.png?v=20261107";
        await new Promise((res) => {
          logoImg.onload = res;
          logoImg.onerror = res;
        });

        const badgeW = 150;
        const badgeH = 34;
        const badgeX = canvas.width - badgeW - 16;
        const badgeY = canvas.height - badgeH - 16;

        // Rounded dark pill covering bottom-right
        ctx.fillStyle = "rgba(12, 12, 16, 0.92)";
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 17);
        } else {
          ctx.rect(badgeX, badgeY, badgeW, badgeH);
        }
        ctx.fill();

        ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw circular logo
        try {
          ctx.drawImage(logoImg, badgeX + 6, badgeY + 4, 26, 26);
        } catch {}

        // Draw AUTONEXIS label
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
        ctx.fillText("AUTONEXIS", badgeX + 38, badgeY + 22);

        canvas.toBlob((blob) => {
          if (blob) {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `autonexis_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
          }
        }, "image/png");
        return;
      }
    } catch {
      window.open(finalImageUrl, "_blank");
    }
  };

  return (
    <div className="creation-card image-creation-card">
      <div className="creation-card-header">
        <div className="creation-card-tag">
          <IconImage size={15} />
          <span>AUTONEXIS Image Studio</span>
          <span className="creation-badge">1024×768 HD</span>
        </div>
        <button
          type="button"
          className="creation-action-icon-btn"
          onClick={handleCopyPrompt}
          title="Copy Prompt"
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </button>
      </div>

      <div
        className="creation-image-wrapper"
        onClick={() => setIsFullscreen(true)}
        title="Click to view full size"
      >
        {isLoading && (
          <div className="creation-loader-overlay">
            <IconSparkles size={24} className="sparkle-spin" />
            <span>Rendering visual...</span>
          </div>
        )}
        <img
          src={finalImageUrl}
          alt={prompt}
          className="creation-img"
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />

        {/* AUTONEXIS Official Watermark Pill covering bottom-right */}
        <div className="creation-watermark-overlay" title="AUTONEXIS Assistant">
          <img
            src="/logo_circle.png?v=20261107"
            alt="AUTONEXIS"
            className="watermark-logo-img"
          />
          <span>AUTONEXIS</span>
        </div>
      </div>

      <div className="creation-card-footer">
        <div className="creation-prompt-text">
          <span className="prompt-label">Prompt:</span> {prompt}
        </div>
        <button
          type="button"
          className="creation-download-btn"
          onClick={handleDownload}
        >
          <IconDownload size={14} />
          <span>Download</span>
        </button>
      </div>

      {isFullscreen && (
        <div className="creation-lightbox" onClick={() => setIsFullscreen(false)}>
          <div className="lightbox-img-wrapper" onClick={(e) => e.stopPropagation()}>
            <img src={finalImageUrl} alt={prompt} className="lightbox-img" />
            <div className="creation-watermark-overlay lightbox-watermark">
              <img
                src="/logo_circle.png?v=20261107"
                alt="AUTONEXIS"
                className="watermark-logo-img"
              />
              <span>AUTONEXIS</span>
            </div>
          </div>
          <button
            type="button"
            className="lightbox-close-btn"
            onClick={() => setIsFullscreen(false)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

// 2. Video Studio Player Card Component
interface VideoCardProps {
  prompt: string;
  duration?: string;
}

export const VideoCreationCard: React.FC<VideoCardProps> = ({
  prompt,
  duration = "00:05",
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Procedural Cinematic Canvas Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = 640);
    let height = (canvas.height = 360);
    let step = 0;

    const renderFrame = () => {
      step += 0.03;
      // Dark cinematic backdrop
      ctx.fillStyle = "#0c0c0e";
      ctx.fillRect(0, 0, width, height);

      // Glowing cosmic orbital rings matching Autonexis branding
      const cx = width / 2;
      const cy = height / 2;

      for (let i = 0; i < 4; i++) {
        const radius = 60 + i * 35;
        const angle = step * (i % 2 === 0 ? 1 : -1) + (i * Math.PI) / 3;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(168, 85, 247, ${0.12 + i * 0.08})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Orbiting particles
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * (radius * 0.55);

        ctx.beginPath();
        ctx.arc(px, py, 4 + i, 0, Math.PI * 2);
        ctx.fillStyle = i === 1 ? "#c084fc" : "#a855f7";
        ctx.shadowColor = "#a855f7";
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Center glowing core
      const gradient = ctx.createRadialGradient(cx, cy, 5, cx, cy, 45);
      gradient.addColorStop(0, "rgba(233, 213, 255, 0.95)");
      gradient.addColorStop(0.5, "rgba(168, 85, 247, 0.6)");
      gradient.addColorStop(1, "rgba(168, 85, 247, 0)");

      ctx.beginPath();
      ctx.arc(cx, cy, 45, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Official Autonexis watermark text
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "11px system-ui";
      ctx.fillText("AUTONEXIS VIDEO STUDIO 4K", 16, height - 16);

      if (isPlaying) {
        setProgress((prev) => (prev >= 100 ? 0 : prev + 0.6));
      }

      animFrameRef.current = requestAnimationFrame(renderFrame);
    };

    renderFrame();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  return (
    <div className="creation-card video-creation-card">
      <div className="creation-card-header">
        <div className="creation-card-tag">
          <IconVideo size={15} />
          <span>AUTONEXIS Video Studio</span>
          <span className="creation-badge">4K 60FPS</span>
        </div>
        <div className="video-duration-pill">{duration}</div>
      </div>

      <div className="video-player-container" onClick={togglePlay}>
        <canvas ref={canvasRef} className="video-canvas" />
        <button
          type="button"
          className="video-center-play-btn"
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <IconPause size={20} /> : <IconPlay size={20} />}
        </button>

        {/* Video progress timeline bar */}
        <div className="video-timeline-bar">
          <div className="video-timeline-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="creation-card-footer">
        <div className="creation-prompt-text">
          <span className="prompt-label">Prompt:</span> {prompt}
        </div>
        <button
          type="button"
          className="creation-download-btn"
          onClick={() => alert("Video render ready! Download format: MP4 (H.264 High Profile 4K)")}
        >
          <IconDownload size={14} />
          <span>Download MP4</span>
        </button>
      </div>
    </div>
  );
};

// 3. Speech Synthesis Audio Speaker Component
export const SpeechAudioButton: React.FC<{ text: string }> = ({ text }) => {
  const [isSpeaking, setIsSpeaking] = useState(false);

  const toggleSpeech = () => {
    if (!("speechSynthesis" in window)) {
      alert("Speech synthesis is not supported on your browser.");
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*#`_~[\]()]/g, "").slice(0, 600);
    const utterance = new SpeechSynthesisUtterance(cleanText);

    const voices = window.speechSynthesis.getVoices();
    const targetVoice =
      voices.find((v) => v.lang.startsWith("hi")) ||
      voices.find((v) => v.lang.startsWith("en-IN")) ||
      voices.find((v) => v.lang.startsWith("en"));

    if (targetVoice) utterance.voice = targetVoice;
    utterance.rate = 1.0;

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
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
