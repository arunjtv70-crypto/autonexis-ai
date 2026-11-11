import React, { useCallback, useEffect, useRef, useState } from "react";
import { useChats } from "../state/chats";
import { transcribeVoiceAudioApi } from "../api/client";
import {
  compressAudioBlobIfNeeded,
  computeTimeDomainRms,
  detectAudioRoutingLabel,
  getSupportedRecorderMimeType,
  isProbableSelfEcho,
  requestVoiceMicrophone,
} from "../utils/voiceAudio";
import {
  cleanTextForSpeech,
  SentenceStreamChunker,
  VoicePlaybackQueue,
} from "../utils/voiceSpeech";
import {
  IconCaptions,
  IconMic,
  IconMicOff,
  IconPhoneOff,
  IconVolume,
  IconVolumeX,
} from "./Icons";
import "./VoiceCallModal.css";

interface VoiceCallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type CallStage = "ready" | "requesting" | "active" | "paused" | "denied" | "error";
type TurnPhase = "listening" | "thinking" | "speaking";

interface IWindow extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

const FIRST_USE_TIP_KEY = "autonexis_voice_call_tip_seen";

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const VoiceCallModal: React.FC<VoiceCallModalProps> = ({ isOpen, onClose }) => {
  const { preferences, runVoiceCallTurn } = useChats();

  const [stage, setStage] = useState<CallStage>("ready");
  const [phase, setPhase] = useState<TurnPhase>("listening");
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [showCaptions, setShowCaptions] = useState<boolean>(preferences.voiceCallCaptions !== false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [micLive, setMicLive] = useState(false);
  const [audioRoute, setAudioRoute] = useState<"bluetooth" | "headset" | "speaker">("speaker");
  const [userCaption, setUserCaption] = useState("");
  const [assistantCaption, setAssistantCaption] = useState("");
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const [deniedDetail, setDeniedDetail] = useState("");
  const [pausedReason, setPausedReason] = useState("");
  const [sttMode, setSttMode] = useState<"browser" | "cloud-fallback">("browser");
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [showFirstUseTip, setShowFirstUseTip] = useState(false);

  // Refs synced cleanly across async callbacks & RAF loops
  const stageRef = useRef<CallStage>("ready");
  const phaseRef = useRef<TurnPhase>("listening");
  const isMutedRef = useRef(false);
  const isSpeakerMutedRef = useRef(false);
  const sttModeRef = useRef<"browser" | "cloud-fallback">("browser");
  const orbCircleRef = useRef<HTMLDivElement>(null);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const wakeLockRef = useRef<any>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderDiscardRef = useRef(false);
  const recorderStartTsRef = useRef(0);
  const vadActiveSpeechMsRef = useRef(0);
  const vadSpeechActiveRef = useRef(false);
  const vadLastSpeechFrameTsRef = useRef(0);
  const vadConsecutiveActiveFramesRef = useRef(0);
  const vadNoiseFloorRef = useRef(0.012);

  const bargeInFramesMsRef = useRef(0);
  const speakingStartedTsRef = useRef(0);
  const speakingAmbientFloorRef = useRef(0.02);
  const playbackEndedTsRef = useRef(0);
  const lastAssistantSpokenRef = useRef("");

  const turnAbortRef = useRef<AbortController | null>(null);
  const activeCallChatIdRef = useRef<string | null>(null);
  const speechEndPerfTsRef = useRef<number>(0);

  const speechEndDebounceRef = useRef<number | null>(null);
  const pendingRecognizedRef = useRef<string>("");
  const lastActivityTsRef = useRef<number>(Date.now());
  const silenceWarningSentRef = useRef(false);
  const echoFallbackPausedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  stageRef.current = stage;
  phaseRef.current = phase;
  isMutedRef.current = isMuted;
  isSpeakerMutedRef.current = isSpeakerMuted;
  sttModeRef.current = sttMode;

  const playbackRef = useRef<VoicePlaybackQueue | null>(null);
  if (!playbackRef.current) {
    playbackRef.current = new VoicePlaybackQueue({
      voiceName: preferences.voiceName,
      voiceSpeed: preferences.voiceSpeed,
      defaultLanguage: preferences.voiceLanguage || preferences.micLanguage || "en-IN",
      cloudTtsEnabled: !!preferences.voiceCallCloudTts,
      isSpeakerMuted: () => isSpeakerMutedRef.current,
    });
  }

  useEffect(() => {
    playbackRef.current?.updateOptions({
      voiceName: preferences.voiceName,
      voiceSpeed: preferences.voiceSpeed,
      defaultLanguage: preferences.voiceLanguage || preferences.micLanguage || "en-IN",
      cloudTtsEnabled: !!preferences.voiceCallCloudTts,
      isSpeakerMuted: () => isSpeakerMutedRef.current,
    });
  }, [
    preferences.voiceName,
    preferences.voiceSpeed,
    preferences.voiceLanguage,
    preferences.micLanguage,
    preferences.voiceCallCloudTts,
  ]);

  const stopSpeechRecognition = useCallback(() => {
    if (speechEndDebounceRef.current !== null) {
      window.clearTimeout(speechEndDebounceRef.current);
      speechEndDebounceRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
  }, []);

  const stopMediaRecorder = useCallback((discard = true) => {
    recorderDiscardRef.current = discard;
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      if (discard) {
        mediaRecorderRef.current = null;
      }
    }
  }, []);

  const releaseHardware = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    stopSpeechRecognition();
    stopMediaRecorder(true);

    try {
      turnAbortRef.current?.abort();
    } catch {}
    turnAbortRef.current = null;

    playbackRef.current?.cancelAll();

    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      micStreamRef.current = null;
    }

    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setMicLive(false);

    if (wakeLockRef.current) {
      try {
        void wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
  }, [stopMediaRecorder, stopSpeechRecognition]);

  // Ref declarations for mutually recursive turn helpers
  const startListeningRef = useRef<() => void>(() => {});
  const commitTurnRef = useRef<(text: string, endPerfTs?: number) => void>(() => {});

  const handleCloseCleanly = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    releaseHardware();
    onClose();
  }, [onClose, releaseHardware]);

  // Execute turn against streaming /api/chat/stream with voice=true and queue sentence TTS immediately
  commitTurnRef.current = async (spokenText: string, endPerfTs?: number) => {
    const cleanInput = spokenText.trim();
    if (!cleanInput || stageRef.current !== "active") return;

    if (Date.now() - playbackEndedTsRef.current < 1400) {
      if (isProbableSelfEcho(cleanInput, lastAssistantSpokenRef.current)) {
        if (!isMutedRef.current && stageRef.current === "active") {
          startListeningRef.current();
        }
        return;
      }
    }

    stopSpeechRecognition();
    stopMediaRecorder(true);
    pendingRecognizedRef.current = "";
    lastActivityTsRef.current = Date.now();
    silenceWarningSentRef.current = false;

    const turnEndTs = endPerfTs || performance.now();
    speechEndPerfTsRef.current = turnEndTs;

    setPhase("thinking");
    phaseRef.current = "thinking";
    setUserCaption(cleanInput);
    setAssistantCaption("");
    setNoticeText(null);

    try {
      turnAbortRef.current?.abort();
    } catch {}
    const abortCtrl = new AbortController();
    turnAbortRef.current = abortCtrl;

    const queue = playbackRef.current!;
    queue.resetTurnMetrics();
    queue.updateOptions({
      onFirstAudioStarted: () => {
        if (speechEndPerfTsRef.current > 0) {
          setLastLatencyMs(Math.max(50, Math.round(performance.now() - speechEndPerfTsRef.current)));
        }
      },
      onStartSpeaking: () => {
        if (stageRef.current === "active") {
          speakingStartedTsRef.current = performance.now();
          speakingAmbientFloorRef.current = Math.max(0.018, vadNoiseFloorRef.current);
          bargeInFramesMsRef.current = 0;
          setPhase("speaking");
          phaseRef.current = "speaking";
          stopSpeechRecognition();
          stopMediaRecorder(true);
        }
      },
      onStopSpeaking: () => {
        playbackEndedTsRef.current = Date.now();
        lastActivityTsRef.current = Date.now();
        if (stageRef.current === "active" && !isMutedRef.current) {
          // 260ms acoustic cooldown prevents room speaker tail from re-triggering mic
          window.setTimeout(() => {
            if (
              stageRef.current === "active" &&
              phaseRef.current !== "thinking" &&
              !queue.getIsSpeaking() &&
              !isMutedRef.current
            ) {
              setPhase("listening");
              phaseRef.current = "listening";
              startListeningRef.current();
            }
          }, 260);
        } else if (stageRef.current === "active") {
          setPhase("listening");
          phaseRef.current = "listening";
        }
      },
    });

    const chunker = new SentenceStreamChunker((sentence) => {
      queue.enqueue(sentence);
    });

    let rawFull = "";
    const result = await runVoiceCallTurn(cleanInput, {
      signal: abortCtrl.signal,
      chatIdOverride: activeCallChatIdRef.current,
      onToken: (chunk) => {
        if (abortCtrl.signal.aborted) return;
        rawFull += chunk;
        chunker.push(chunk);
        const markerPos = rawFull.indexOf("[CHAT_CONTENT]");
        const displayLive =
          markerPos !== -1
            ? `${rawFull.slice(0, markerPos).trim()} (Full text written in chat)`
            : cleanTextForSpeech(rawFull) || rawFull;
        setAssistantCaption(displayLive);
      },
      onRateLimited: (msg) => {
        setNoticeText(msg || "Voice is busy, please try again shortly");
      },
    });

    if (result.chatId) {
      activeCallChatIdRef.current = result.chatId;
    }

    if (abortCtrl.signal.aborted) return;

    chunker.flush();
    lastAssistantSpokenRef.current = cleanTextForSpeech(rawFull || result.fullText);

    if (result.rateLimited) {
      setPhase("listening");
      phaseRef.current = "listening";
      if (!isMutedRef.current) {
        window.setTimeout(() => startListeningRef.current(), 600);
      }
      return;
    }

    if (!queue.getIsSpeaking()) {
      // Wait briefly if queue just emptied synchronously or was muted
      window.setTimeout(() => {
        if (
          stageRef.current === "active" &&
          !queue.getIsSpeaking() &&
          phaseRef.current !== "speaking"
        ) {
          setPhase("listening");
          phaseRef.current = "listening";
          if (!isMutedRef.current) startListeningRef.current();
        }
      }, 280);
    }
  };

  const beginFallbackRecorderTurn = useCallback(() => {
    const stream = micStreamRef.current;
    if (!stream || stageRef.current !== "active" || isMutedRef.current || phaseRef.current !== "listening") {
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setNoticeText("Microphone speech capture is unavailable on this browser.");
      return;
    }

    stopMediaRecorder(true);

    const mimeType = getSupportedRecorderMimeType();
    let rec: MediaRecorder;
    try {
      rec = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 })
        : new MediaRecorder(stream);
    } catch {
      try {
        rec = new MediaRecorder(stream);
      } catch {
        setNoticeText("Could not record audio in this browser.");
        return;
      }
    }

    recorderChunksRef.current = [];
    recorderDiscardRef.current = false;
    recorderStartTsRef.current = performance.now();
    vadSpeechActiveRef.current = false;
    vadActiveSpeechMsRef.current = 0;
    vadConsecutiveActiveFramesRef.current = 0;

    rec.ondataavailable = (evt) => {
      if (evt.data && evt.data.size > 0) {
        recorderChunksRef.current.push(evt.data);
      }
    };

    rec.onstop = async () => {
      const shouldDiscard = recorderDiscardRef.current;
      const chunks = recorderChunksRef.current;
      recorderChunksRef.current = [];
      mediaRecorderRef.current = null;

      if (shouldDiscard || stageRef.current !== "active" || isMutedRef.current) {
        return;
      }

      const clipMs = performance.now() - recorderStartTsRef.current;
      const hadSpeechMs = vadActiveSpeechMsRef.current;
      const rawBlob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });

      // Discard clips < 400ms or pure ambient noise without sustained vocal energy
      if (clipMs < 400 || hadSpeechMs < 240 || rawBlob.size < 800) {
        if (stageRef.current === "active" && phaseRef.current === "listening" && !isMutedRef.current) {
          beginFallbackRecorderTurn();
        }
        return;
      }

      const tEnd = performance.now();
      setPhase("thinking");
      phaseRef.current = "thinking";
      setUserCaption("Listening completed — transcribing...");

      const uploadBlob = await compressAudioBlobIfNeeded(rawBlob);
      const res = await transcribeVoiceAudioApi(
        uploadBlob,
        preferences.micLanguage || "en-IN",
        clipMs / 1000
      );

      if (stageRef.current !== "active") return;

      if (res.rateLimited || res.error) {
        setNoticeText(res.error || "Voice is busy, please try again shortly");
        setPhase("listening");
        phaseRef.current = "listening";
        if (!isMutedRef.current) {
          window.setTimeout(() => startListeningRef.current(), 700);
        }
        return;
      }

      const transcript = (res.text || "").trim();
      if (!transcript || isProbableSelfEcho(transcript, lastAssistantSpokenRef.current)) {
        setUserCaption("");
        setPhase("listening");
        phaseRef.current = "listening";
        if (!isMutedRef.current) startListeningRef.current();
        return;
      }

      void commitTurnRef.current(transcript, tEnd);
    };

    mediaRecorderRef.current = rec;
    try {
      rec.start(250);
    } catch {
      mediaRecorderRef.current = null;
    }
  }, [preferences.micLanguage, stopMediaRecorder]);

  startListeningRef.current = () => {
    if (stageRef.current !== "active" || isMutedRef.current || phaseRef.current !== "listening") {
      return;
    }

    lastActivityTsRef.current = Math.max(lastActivityTsRef.current, Date.now());
    const win = window as unknown as IWindow;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (sttModeRef.current === "browser" && SpeechRec) {
      stopSpeechRecognition();
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = preferences.micLanguage || "en-IN";
      pendingRecognizedRef.current = "";

      const pauseMs = preferences.voiceCallEndPauseMs || 1000;

      const scheduleCommit = (textToCommit: string) => {
        if (speechEndDebounceRef.current !== null) {
          window.clearTimeout(speechEndDebounceRef.current);
        }
        speechEndDebounceRef.current = window.setTimeout(() => {
          speechEndDebounceRef.current = null;
          const finalStr = textToCommit.trim();
          if (
            finalStr &&
            stageRef.current === "active" &&
            phaseRef.current === "listening" &&
            !isMutedRef.current
          ) {
            void commitTurnRef.current(finalStr, performance.now());
          }
        }, pauseMs);
      };

      rec.onresult = (event: any) => {
        if (stageRef.current !== "active" || phaseRef.current !== "listening" || isMutedRef.current) {
          return;
        }
        let finals = "";
        let interims = "";
        for (let i = 0; i < event.results.length; i++) {
          const piece = event.results[i]?.[0]?.transcript || "";
          if (event.results[i]?.isFinal) {
            finals += (finals ? " " : "") + piece;
          } else {
            interims += (interims ? " " : "") + piece;
          }
        }
        const combined = `${finals} ${interims}`.replace(/\s+/g, " ").trim();
        if (!combined) return;

        if (
          Date.now() - playbackEndedTsRef.current < 1300 &&
          isProbableSelfEcho(combined, lastAssistantSpokenRef.current)
        ) {
          return;
        }

        lastActivityTsRef.current = Date.now();
        silenceWarningSentRef.current = false;
        pendingRecognizedRef.current = combined;
        setUserCaption(combined);
        scheduleCommit(combined);
      };

      rec.onerror = (evt: any) => {
        const code = String(evt?.error || "");
        if (code === "no-speech" || code === "aborted") {
          return;
        }
        if (code === "not-allowed" || code === "service-not-allowed" || code === "network" || code === "audio-capture") {
          // Gracefully switch to MediaRecorder + /voice/transcribe fallback without breaking call
          sttModeRef.current = "cloud-fallback";
          setSttMode("cloud-fallback");
          stopSpeechRecognition();
          if (stageRef.current === "active" && phaseRef.current === "listening" && !isMutedRef.current) {
            beginFallbackRecorderTurn();
          }
        }
      };

      rec.onend = () => {
        recognitionRef.current = null;
        if (stageRef.current !== "active" || phaseRef.current !== "listening" || isMutedRef.current) {
          return;
        }
        const buffered = pendingRecognizedRef.current.trim();
        if (buffered) {
          if (speechEndDebounceRef.current !== null) {
            window.clearTimeout(speechEndDebounceRef.current);
            speechEndDebounceRef.current = null;
          }
          void commitTurnRef.current(buffered, performance.now());
          return;
        }
        // Auto-restart browser SpeechRecognition when Chrome closes after idle window
        window.setTimeout(() => {
          if (stageRef.current === "active" && phaseRef.current === "listening" && !isMutedRef.current) {
            startListeningRef.current();
          }
        }, 90);
      };

      recognitionRef.current = rec;
      try {
        rec.start();
        return;
      } catch {
        sttModeRef.current = "cloud-fallback";
        setSttMode("cloud-fallback");
      }
    }

    // Fallback engine (Safari iOS or when SpeechRecognition unavailable/failed)
    beginFallbackRecorderTurn();
  };

  // Start / resume hardware microphone + audio analyzer loop
  const initializeCallMedia = useCallback(async () => {
    setStage("requesting");
    stageRef.current = "requesting";
    setDeniedDetail("");
    setPausedReason("");
    setNoticeText(null);

    playbackRef.current?.unlockAudio();

    try {
      localStorage.setItem(FIRST_USE_TIP_KEY, "1");
    } catch {}

    try {
      wakeLockRef.current = await (navigator as any).wakeLock?.request?.("screen");
    } catch {}

    let stream: MediaStream;
    try {
      stream = await requestVoiceMicrophone();
    } catch (err: any) {
      const name = String(err?.name || "");
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
        setStage("denied");
        stageRef.current = "denied";
        setDeniedDetail(
          "Microphone access is blocked. Open your browser site settings (lock or aA icon next to the address bar), set Microphone to Allow, and tap Try Again."
        );
      } else {
        setStage("error");
        stageRef.current = "error";
        setDeniedDetail(err?.message || "Could not access a working microphone on this device.");
      }
      return;
    }

    micStreamRef.current = stream;
    setMicLive(true);

    // Handle external headset disconnect gracefully
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (stageRef.current === "active" && !closingRef.current) {
          setMicLive(false);
          setStage("paused");
          stageRef.current = "paused";
          setPausedReason("Microphone disconnected. Tap Resume to reconnect.");
          stopSpeechRecognition();
          stopMediaRecorder(true);
        }
      };
    }

    try {
      const route = await detectAudioRoutingLabel();
      setAudioRoute(route);
    } catch {}

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.65;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      }
    } catch {}

    const win = window as unknown as IWindow;
    const hasNativeSpeech = !!(win.SpeechRecognition || win.webkitSpeechRecognition);
    const nextMode = hasNativeSpeech ? "browser" : "cloud-fallback";
    setSttMode(nextMode);
    sttModeRef.current = nextMode;

    lastActivityTsRef.current = Date.now();
    silenceWarningSentRef.current = false;
    setStage("active");
    stageRef.current = "active";
    setPhase("listening");
    phaseRef.current = "listening";
    startListeningRef.current();
  }, [stopMediaRecorder, stopSpeechRecognition]);

  // Reset modal state on open, cleanup completely on close/unmount
  useEffect(() => {
    if (!isOpen) {
      releaseHardware();
      return;
    }

    closingRef.current = false;
    activeCallChatIdRef.current = null;
    setStage("ready");
    stageRef.current = "ready";
    setPhase("listening");
    phaseRef.current = "listening";
    setIsMuted(false);
    isMutedRef.current = false;
    setIsSpeakerMuted(false);
    isSpeakerMutedRef.current = false;
    setShowCaptions(preferences.voiceCallCaptions !== false);
    setElapsedSec(0);
    setUserCaption("");
    setAssistantCaption("");
    setDeniedDetail("");
    setPausedReason("");
    setLastLatencyMs(null);
    lastAssistantSpokenRef.current = "";

    try {
      const tipSeen = localStorage.getItem(FIRST_USE_TIP_KEY) === "1";
      setShowFirstUseTip(!tipSeen);
    } catch {
      setShowFirstUseTip(true);
    }

    return () => {
      releaseHardware();
    };
  }, [isOpen, releaseHardware]); // eslint-disable-line react-hooks/exhaustive-deps

  // Call timer + Silence auto-end check + Visibility / Screen lock pause handler
  useEffect(() => {
    if (!isOpen) return;

    const timer = window.setInterval(() => {
      if (stageRef.current !== "active") return;
      setElapsedSec((prev) => prev + 1);

      if (phaseRef.current === "listening" && !isMutedRef.current && !vadSpeechActiveRef.current) {
        const limitMs = (preferences.voiceCallSilenceSec || 60) * 1000;
        const warnMs = Math.round(limitMs / 2);
        const idleMs = Date.now() - lastActivityTsRef.current;

        if (!silenceWarningSentRef.current && idleMs >= warnMs) {
          silenceWarningSentRef.current = true;
          const isHindi = (preferences.micLanguage || preferences.voiceLanguage || "").toLowerCase().startsWith("hi");
          const promptLine = isHindi ? "क्या आप अभी भी कॉल पर हैं?" : "Are you still there?";
          setAssistantCaption(promptLine);
          setNoticeText(promptLine);
          lastAssistantSpokenRef.current = promptLine;
          playbackRef.current?.enqueue(promptLine);
        } else if (idleMs >= limitMs) {
          handleCloseCleanly();
        }
      }
    }, 1000);

    const handleVisibilityChange = () => {
      if (document.hidden && stageRef.current === "active") {
        stopSpeechRecognition();
        stopMediaRecorder(true);
        try {
          turnAbortRef.current?.abort();
        } catch {}
        playbackRef.current?.cancelAll();
        try {
          void wakeLockRef.current?.release?.();
        } catch {}
        wakeLockRef.current = null;
        setMicLive(false);
        setStage("paused");
        stageRef.current = "paused";
        setPausedReason(
          "Call paused while the screen locked or app moved to the background. Browsers block background microphone access."
        );
      } else if (!document.hidden && stageRef.current === "paused") {
        // Attempt seamless resume only if stream remained active; otherwise present Resume button safely
        const tracks = micStreamRef.current?.getTracks() || [];
        const stillLive = tracks.some((t) => t.readyState === "live");
        if (stillLive && audioCtxRef.current && audioCtxRef.current.state === "running") {
          try {
            void (navigator as any).wakeLock?.request?.("screen").then((wl: any) => {
              wakeLockRef.current = wl;
            });
          } catch {}
          setMicLive(true);
          lastActivityTsRef.current = Date.now();
          silenceWarningSentRef.current = false;
          setStage("active");
          stageRef.current = "active";
          setPhase("listening");
          phaseRef.current = "listening";
          setPausedReason("");
          if (!isMutedRef.current) startListeningRef.current();
        }
      }
    };

    const handleDeviceChange = () => {
      void detectAudioRoutingLabel().then(setAudioRoute).catch(() => {});
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleCloseCleanly();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    handleCloseCleanly,
    isOpen,
    preferences.micLanguage,
    preferences.voiceCallSilenceSec,
    preferences.voiceLanguage,
    stopMediaRecorder,
    stopSpeechRecognition,
  ]);

  // 60fps Orb Volume Animation + Adaptive VAD / Barge-in Detector
  useEffect(() => {
    if (!isOpen || stage !== "active") return;

    const pcmBuf = new Float32Array(new ArrayBuffer(512 * 4));
    let lastVadTick = performance.now();

    const tick = (now: number) => {
      if (stageRef.current !== "active") return;

      let micRms = 0;
      if (analyserRef.current && !isMutedRef.current) {
        micRms = computeTimeDomainRms(analyserRef.current, pcmBuf);
      }

      const phaseNow = phaseRef.current;
      const dt = Math.min(120, Math.max(0, now - lastVadTick));

      // Update animated orb directly via DOM style to avoid React re-renders at 60fps
      if (orbCircleRef.current) {
        const outLvl = playbackRef.current?.getOutputLevel() || 0;
        let level = 0;
        if (phaseNow === "listening" && !isMutedRef.current) {
          level = Math.min(1, micRms * 7.5);
        } else if (phaseNow === "speaking") {
          level = outLvl || 0.45 + 0.15 * Math.sin(now * 0.008);
        } else if (phaseNow === "thinking") {
          level = 0.25 + 0.15 * Math.sin(now * 0.004);
        }
        const scale = 1 + level * 0.16;
        orbCircleRef.current.style.setProperty("--orb-scale", scale.toFixed(3));
        orbCircleRef.current.style.setProperty("--orb-glow", level.toFixed(3));
      }

      if (dt >= 45) {
        lastVadTick = now;

        // 1. Adaptive-energy VAD during Cloud-Fallback Listening
        if (
          sttModeRef.current === "cloud-fallback" &&
          phaseNow === "listening" &&
          !isMutedRef.current &&
          mediaRecorderRef.current?.state === "recording"
        ) {
          if (!vadSpeechActiveRef.current) {
            vadNoiseFloorRef.current = vadNoiseFloorRef.current * 0.92 + micRms * 0.08;
            const threshold = Math.max(
              vadNoiseFloorRef.current * 2.4,
              vadNoiseFloorRef.current + 0.018,
              0.028
            );
            if (micRms > threshold) {
              vadConsecutiveActiveFramesRef.current += 1;
              if (vadConsecutiveActiveFramesRef.current >= 2) {
                vadSpeechActiveRef.current = true;
                vadLastSpeechFrameTsRef.current = now;
                vadActiveSpeechMsRef.current = 100;
                lastActivityTsRef.current = Date.now();
                silenceWarningSentRef.current = false;
              }
            } else {
              vadConsecutiveActiveFramesRef.current = 0;
              // Prevent long idle buffers when silent
              if (now - recorderStartTsRef.current > 8000) {
                beginFallbackRecorderTurn();
              }
            }
          } else {
            const sustainThreshold = Math.max(
              vadNoiseFloorRef.current * 1.9,
              vadNoiseFloorRef.current + 0.012,
              0.02
            );
            if (micRms > sustainThreshold) {
              vadLastSpeechFrameTsRef.current = now;
              vadActiveSpeechMsRef.current += dt;
              lastActivityTsRef.current = Date.now();
            }
            const hangoverMs = now - vadLastSpeechFrameTsRef.current;
            const totalRecMs = now - recorderStartTsRef.current;
            if (hangoverMs >= 700 || totalRecMs >= 29500) {
              recorderDiscardRef.current = false;
              try {
                mediaRecorderRef.current?.stop();
              } catch {}
            }
          }
        }

        // 2. Barge-in detector during Speaking (higher threshold + 300ms sustained human voice)
        if (phaseNow === "speaking" && !isMutedRef.current) {
          const bargeEnabled = preferences.voiceCallBargeIn !== false && !echoFallbackPausedRef.current;
          if (bargeEnabled && analyserRef.current) {
            const sinceSpeakStart = now - speakingStartedTsRef.current;
            if (sinceSpeakStart < 280) {
              speakingAmbientFloorRef.current = speakingAmbientFloorRef.current * 0.8 + micRms * 0.2;
            } else {
              const bargeThreshold = Math.max(speakingAmbientFloorRef.current * 2.6, 0.085);
              if (micRms > bargeThreshold) {
                bargeInFramesMsRef.current += dt;
                if (bargeInFramesMsRef.current >= 300) {
                  // Genuine human interruption -> stop playback & AI stream immediately and listen
                  playbackRef.current?.cancelAll();
                  try {
                    turnAbortRef.current?.abort();
                  } catch {}
                  bargeInFramesMsRef.current = 0;
                  setPhase("listening");
                  phaseRef.current = "listening";
                  startListeningRef.current();
                }
              } else {
                bargeInFramesMsRef.current = Math.max(0, bargeInFramesMsRef.current - dt * 0.5);
              }
            }
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [beginFallbackRecorderTurn, isOpen, preferences.voiceCallBargeIn, stage]);

  if (!isOpen) return null;

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    isMutedRef.current = nextMuted;

    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getAudioTracks()) {
        track.enabled = !nextMuted;
      }
    }
    setMicLive(!nextMuted && !!micStreamRef.current);

    if (nextMuted) {
      stopSpeechRecognition();
      stopMediaRecorder(true);
    } else if (stage === "active" && phase === "listening") {
      lastActivityTsRef.current = Date.now();
      startListeningRef.current();
    }
  };

  const toggleSpeaker = () => {
    const nextSpeakerMuted = !isSpeakerMuted;
    setIsSpeakerMuted(nextSpeakerMuted);
    isSpeakerMutedRef.current = nextSpeakerMuted;
    if (nextSpeakerMuted) {
      playbackRef.current?.cancelAll();
    }
  };

  const handleResumeCall = async () => {
    releaseHardware();
    await initializeCallMedia();
  };

  const statusLabel =
    stage === "ready"
      ? "Tap Start Call to begin"
      : stage === "requesting"
      ? "Connecting microphone..."
      : stage === "denied"
      ? "Microphone permission needed"
      : stage === "error"
      ? "Microphone unavailable"
      : stage === "paused"
      ? "Paused"
      : isMuted
      ? "Muted"
      : phase === "thinking"
      ? "Thinking"
      : phase === "speaking"
      ? "Speaking"
      : "Listening";

  const orbPhaseClass =
    stage !== "active" || isMuted ? "orb-idle" : `orb-${phase}`;

  const routeLabel =
    audioRoute === "bluetooth"
      ? "Bluetooth audio"
      : audioRoute === "headset"
      ? "Headphones"
      : "Device speaker";

  return (
    <div
      className="voice-call-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Live Voice Call"
    >
      {/* Top Bar */}
      <header className="voice-call-header">
        <div className="voice-call-header-left">
          <div className={`voice-mic-indicator ${micLive ? "live" : "off"}`}>
            <span className="voice-mic-dot" aria-hidden="true" />
            <span>{micLive ? "Mic active" : isMuted ? "Mic muted" : "Mic off"}</span>
          </div>
          <span className="voice-call-subtitle">Live voice chat • Not recorded</span>
        </div>

        <div className="voice-call-header-right">
          {stage === "active" && (
            <>
              <span className="voice-route-pill">{routeLabel}</span>
              <span className="voice-timer-pill" aria-label="Call duration">
                {formatTimer(elapsedSec)}
              </span>
            </>
          )}
        </div>
      </header>

      {/* Center Brand Orb Stage */}
      <main className="voice-call-stage">
        {showFirstUseTip && (
          <div className="voice-tip-banner" role="note">
            <span>Use earphones for the best experience.</span>
            <button
              type="button"
              className="voice-tip-dismiss"
              onClick={() => {
                setShowFirstUseTip(false);
                try {
                  localStorage.setItem(FIRST_USE_TIP_KEY, "1");
                } catch {}
              }}
              aria-label="Dismiss tip"
            >
              Got it
            </button>
          </div>
        )}

        <div className={`voice-orb-shell ${orbPhaseClass}`} ref={orbCircleRef}>
          <div className="voice-orb-ring outer" aria-hidden="true" />
          <div className="voice-orb-ring inner" aria-hidden="true" />
          <div className="voice-orb-core">
            <img
              src="/brand/logo-mark.png"
              alt="AUTONEXIS"
              className="voice-orb-logo"
            />
          </div>
        </div>

        <div className="voice-status-text">{statusLabel}</div>

        {lastLatencyMs !== null && stage === "active" && (
          <div className="voice-latency-meta">
            Response latency: {(lastLatencyMs / 1000).toFixed(2)}s
          </div>
        )}

        {stage === "active" && phase === "speaking" && preferences.voiceCallBargeIn === false && (
          <div className="voice-notice-pill">
            Mic paused while speaking to avoid echo
          </div>
        )}

        {noticeText && stage === "active" && (
          <div className="voice-notice-pill" role="status">
            {noticeText}
          </div>
        )}

        {/* Pre-Call Tap Permission Card */}
        {stage === "ready" && (
          <div className="voice-state-card">
            <p className="voice-state-desc">
              AUTONEXIS Assistant needs your microphone to hear you during this live call. Audio is not stored.
            </p>
            <p className="voice-state-meta">
              Call pauses if your screen locks or the app goes to the background, because browsers pause microphone access in the background.
            </p>
            <div className="voice-state-actions">
              <button
                type="button"
                className="voice-primary-cta"
                onClick={() => void initializeCallMedia()}
              >
                Start Call
              </button>
              <button
                type="button"
                className="voice-secondary-cta"
                onClick={handleCloseCleanly}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Permission Denied / Hardware Error Recovery */}
        {(stage === "denied" || stage === "error") && (
          <div className="voice-state-card error">
            <p className="voice-state-desc">{deniedDetail}</p>
            <div className="voice-state-actions">
              <button
                type="button"
                className="voice-primary-cta"
                onClick={() => void initializeCallMedia()}
              >
                Try Again
              </button>
              <button
                type="button"
                className="voice-secondary-cta"
                onClick={handleCloseCleanly}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Background / Screen Lock Pause Recovery */}
        {stage === "paused" && (
          <div className="voice-state-card">
            <p className="voice-state-desc">{pausedReason}</p>
            <div className="voice-state-actions">
              <button
                type="button"
                className="voice-primary-cta"
                onClick={() => void handleResumeCall()}
              >
                Resume Call
              </button>
              <button
                type="button"
                className="voice-secondary-cta"
                onClick={handleCloseCleanly}
              >
                End Call
              </button>
            </div>
          </div>
        )}

        {/* Live Captions Panel */}
        {stage === "active" && showCaptions && (userCaption || assistantCaption) && (
          <div className="voice-captions-box" aria-live="polite">
            {userCaption && (
              <div className="voice-caption-line user">
                <span className="voice-caption-speaker">You</span>
                <span>{userCaption}</span>
              </div>
            )}
            {assistantCaption && (
              <div className="voice-caption-line assistant">
                <span className="voice-caption-speaker">AUTONEXIS</span>
                <span>{assistantCaption}</span>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Controls + Privacy Footer */}
      <footer className="voice-call-footer">
        <div className="voice-controls-bar">
          <button
            type="button"
            className={`voice-ctrl-btn ${isMuted ? "active-muted" : ""}`}
            onClick={toggleMute}
            disabled={stage !== "active"}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            title={isMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isMuted ? <IconMicOff size={20} /> : <IconMic size={20} />}
            <span>{isMuted ? "Unmute" : "Mute"}</span>
          </button>

          <button
            type="button"
            className={`voice-ctrl-btn ${isSpeakerMuted ? "active-off" : ""}`}
            onClick={toggleSpeaker}
            disabled={stage !== "active"}
            aria-label={isSpeakerMuted ? "Turn speaker on" : "Mute speaker"}
            title={isSpeakerMuted ? "Turn speaker on" : "Mute speaker"}
          >
            {isSpeakerMuted ? <IconVolumeX size={20} /> : <IconVolume size={20} />}
            <span>{isSpeakerMuted ? "Speaker off" : "Speaker"}</span>
          </button>

          <button
            type="button"
            className={`voice-ctrl-btn ${showCaptions ? "active-on" : ""}`}
            onClick={() => setShowCaptions((p) => !p)}
            aria-label={showCaptions ? "Hide captions" : "Show captions"}
            title={showCaptions ? "Hide captions" : "Show captions"}
          >
            <IconCaptions size={20} />
            <span>Captions</span>
          </button>

          <button
            type="button"
            className="voice-ctrl-btn end-call"
            onClick={handleCloseCleanly}
            aria-label="End call"
            title="End call"
          >
            <IconPhoneOff size={20} />
            <span>End</span>
          </button>
        </div>

        <p className="voice-privacy-footnote">
          Your voice is turned into text to answer you. Audio is not stored.{" "}
          {sttMode === "browser"
            ? "Browser speech recognition may send audio to your browser's speech service."
            : "Spoken turns are transcribed securely without storing audio."}
        </p>
      </footer>
    </div>
  );
};
