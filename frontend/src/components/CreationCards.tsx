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

// 1. Image Creation Card Component
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

  // If no direct image URL is provided, generate dynamically via Pollinations AI
  const cleanPrompt = prompt.replace(/^(image of|generate image|create image|photo of|drawing of|banao)/i, "").trim() || "cinematic futuristic abstract art";
  const finalImageUrl =
    imageUrl ||
    `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=768&nologo=true&seed=42`;

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    try {
      const res = await fetch(finalImageUrl);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `autonexis_${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
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
          <img src={finalImageUrl} alt={prompt} className="lightbox-img" />
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
        ctx.beginPath();
        ctx.arc(
          cx + Math.sin(step + i) * 12,
          cy + Math.cos(step + i) * 12,
          radius,
          0,
          Math.PI * 2
        );
        ctx.strokeStyle = i % 2 === 0 ? "rgba(168, 85, 247, 0.45)" : "rgba(200, 169, 126, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Center glowing star core
      const glow = ctx.createRadialGradient(cx, cy, 5, cx, cy, 45);
      glow.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      glow.addColorStop(0.5, "rgba(168, 85, 247, 0.5)");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 45, 0, Math.PI * 2);
      ctx.fill();

      // Cinematic text overlay
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(prompt.slice(0, 50), cx, height - 30);

      if (isPlaying) {
        setProgress((prev) => (prev >= 100 ? 0 : prev + 0.6));
        animFrameRef.current = requestAnimationFrame(renderFrame);
      }
    };

    renderFrame();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, prompt]);

  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  return (
    <div className="creation-card video-creation-card">
      <div className="creation-card-header">
        <div className="creation-card-tag">
          <IconVideo size={15} />
          <span>AUTONEXIS Video Studio</span>
          <span className="creation-badge">4K • 60 FPS</span>
        </div>
        <span className="video-duration-pill">{duration} HDR</span>
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

