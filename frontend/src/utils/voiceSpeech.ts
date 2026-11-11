/**
 * AUTONEXIS Voice Call Speech Pipeline:
 * - Cleans text for natural spoken synthesis (removes markdown, tables, code, links, emojis)
 * - Extracts speakable sentences from streaming SSE tokens (including Devanagari danda `।`)
 * - Suppresses [CHAT_CONTENT] offloaded code/tables/long documents from being spoken
 * - Queues per-sentence TTS via browser speechSynthesis (hi-IN / en-IN) or optional /voice/speak (English only)
 */

import { synthesizeEnglishSpeechApi } from "../api/client";

const DEVANAGARI_RE = /[\u0900-\u097F]/;
const CHAT_CONTENT_MARKER = "[CHAT_CONTENT]";
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/gu;
const URL_RE = /https?:\/\/[^\s)]+/gi;
const ABBREVIATIONS = new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "sr",
  "jr",
  "vs",
  "etc",
  "eg",
  "ie",
  "st",
  "no",
]);

/**
 * Strips markdown syntax, code fences, tables, links, and emojis into crisp spoken plain text.
 */
export function cleanTextForSpeech(raw: string): string {
  if (!raw) return "";
  let text = raw;

  const markerIdx = text.indexOf(CHAT_CONTENT_MARKER);
  if (markerIdx !== -1) {
    text = text.slice(0, markerIdx);
  }

  // Strip fenced code blocks and inline code backticks
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]*)`/g, "$1");

  // Strip markdown table lines
  text = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line) && !/^\s*\|?[-:| ]+\|[-:| ]*$/.test(line))
    .join(" ");

  // Convert markdown links [label](url) -> label, then drop bare URLs
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]+\)/gi, "$1");
  text = text.replace(URL_RE, "");

  // Remove headings, emphasis markers, list bullets, emojis
  text = text.replace(/^[#>*-]+\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  text = text.replace(/[*_~>#]/g, "");
  text = text.replace(EMOJI_RE, "");

  return text.replace(/\s+/g, " ").trim();
}

export function detectSentenceLanguage(sentence: string, fallbackLang = "en-IN"): string {
  if (DEVANAGARI_RE.test(sentence)) return "hi-IN";
  return fallbackLang.toLowerCase().startsWith("hi") ? "en-IN" : fallbackLang || "en-IN";
}

function splitFirstReadySentence(buffer: string): { sentence: string; rest: string } | null {
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];

    if (ch === "\n") {
      const piece = buffer.slice(0, i).trim();
      const rest = buffer.slice(i + 1);
      if (piece) return { sentence: piece, rest };
      continue;
    }

    if (ch === "।" || ch === "॥") {
      const piece = buffer.slice(0, i + 1).trim();
      const rest = buffer.slice(i + 1);
      if (piece) return { sentence: piece, rest };
      continue;
    }

    if (ch === "!" || ch === "?") {
      const next = buffer[i + 1];
      if (!next || /\s/.test(next)) {
        const piece = buffer.slice(0, i + 1).trim();
        const rest = buffer.slice(i + 1);
        if (piece) return { sentence: piece, rest };
      }
      continue;
    }

    if (ch === ".") {
      const prev = buffer[i - 1] || "";
      const next = buffer[i + 1] || "";
      // Avoid breaking numbers like 3.14 or decimals/URLs
      if (/\d/.test(prev) && /\d/.test(next)) continue;
      if (!next || /\s/.test(next)) {
        const prefixWord = buffer.slice(0, i).split(/\s+/).pop()?.toLowerCase() || "";
        if (ABBREVIATIONS.has(prefixWord)) continue;
        const piece = buffer.slice(0, i + 1).trim();
        const rest = buffer.slice(i + 1);
        if (piece.length >= 2) return { sentence: piece, rest };
      }
    }
  }

  // Long clause split to avoid Chrome speechSynthesis 15s timeout on unpunctuated text
  if (buffer.length > 165) {
    const commaIdx = buffer.lastIndexOf(",", 155);
    const splitAt = commaIdx > 45 ? commaIdx + 1 : buffer.lastIndexOf(" ", 155);
    if (splitAt > 30) {
      return {
        sentence: buffer.slice(0, splitAt).trim(),
        rest: buffer.slice(splitAt),
      };
    }
  }

  return null;
}

/**
 * Incremental streaming sentence extractor with [CHAT_CONTENT] / code-fence suppression.
 */
export class SentenceStreamChunker {
  private buffer = "";
  private suppressed = false;
  private emittedCount = 0;
  private onSentence: (cleanSentence: string) => void;

  constructor(onSentence: (cleanSentence: string) => void) {
    this.onSentence = onSentence;
  }

  push(token: string): void {
    if (this.suppressed || !token) return;
    this.buffer += token;

    // Detect explicit offload marker or raw code/table start (partial tag safe)
    const markerPos = this.buffer.indexOf(CHAT_CONTENT_MARKER);
    const fencePos = this.buffer.indexOf("```");
    const tablePos = this.buffer.search(/\n\|\s*[^|\n]+\s*\|/);
    const cutCandidates = [markerPos, fencePos, tablePos].filter((p) => p !== -1);

    if (cutCandidates.length > 0) {
      const cutAt = Math.min(...cutCandidates);
      const before = this.buffer.slice(0, cutAt);
      this.buffer = "";
      this.suppressed = true;

      let remainder = before;
      while (true) {
        const split = splitFirstReadySentence(remainder);
        if (!split) break;
        const cleaned = cleanTextForSpeech(split.sentence);
        if (cleaned) {
          this.emittedCount++;
          this.onSentence(cleaned);
        }
        remainder = split.rest;
      }
      const tailClean = cleanTextForSpeech(remainder);
      if (tailClean) {
        this.emittedCount++;
        this.onSentence(tailClean);
      } else if (this.emittedCount === 0) {
        this.emittedCount++;
        this.onSentence("I've written the full details in the chat for you.");
      }
      return;
    }

    // Hold back potential partial "[CHAT_CONTENT]" prefix near buffer tail
    const partialBracket = this.buffer.lastIndexOf("[");
    const safeLimit =
      partialBracket !== -1 && "[CHAT_CONTENT]".startsWith(this.buffer.slice(partialBracket))
        ? partialBracket
        : this.buffer.length;

    let work = this.buffer.slice(0, safeLimit);
    const held = this.buffer.slice(safeLimit);

    while (true) {
      const split = splitFirstReadySentence(work);
      if (!split) break;
      const cleaned = cleanTextForSpeech(split.sentence);
      if (cleaned) {
        this.emittedCount++;
        this.onSentence(cleaned);
      }
      work = split.rest;
    }

    this.buffer = work + held;
  }

  flush(): void {
    if (this.suppressed) {
      this.buffer = "";
      return;
    }
    while (true) {
      const split = splitFirstReadySentence(this.buffer);
      if (!split) break;
      const cleaned = cleanTextForSpeech(split.sentence);
      if (cleaned) {
        this.emittedCount++;
        this.onSentence(cleaned);
      }
      this.buffer = split.rest;
    }
    const tail = cleanTextForSpeech(this.buffer);
    this.buffer = "";
    if (tail) {
      this.emittedCount++;
      this.onSentence(tail);
    }
  }
}

export function pickVoiceForLanguage(
  voices: SpeechSynthesisVoice[],
  targetLang: string,
  preferredVoiceName?: string
): SpeechSynthesisVoice | undefined {
  if (!voices.length) return undefined;
  const langLower = (targetLang || "en-IN").toLowerCase();
  const baseLang = langLower.split("-")[0];

  if (preferredVoiceName) {
    const exactPref = voices.find((v) => v.name === preferredVoiceName);
    if (exactPref && exactPref.lang.toLowerCase().startsWith(baseLang)) {
      return exactPref;
    }
  }

  return (
    voices.find((v) => v.lang.toLowerCase() === langLower) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(`${baseLang}-in`)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(baseLang)) ||
    voices[0]
  );
}

interface QueuedSpeechItem {
  text: string;
  lang: string;
  generation: number;
  cloudPromise?: Promise<{ audioBlob?: Blob; fallbackBrowser: boolean; rateLimited?: boolean }> | null;
  abortController: AbortController;
}

export interface VoicePlaybackOptions {
  voiceName?: string;
  voiceSpeed?: number;
  defaultLanguage?: string;
  cloudTtsEnabled?: boolean;
  isSpeakerMuted?: () => boolean;
  onStartSpeaking?: () => void;
  onStopSpeaking?: () => void;
  onFirstAudioStarted?: () => void;
}

/**
 * Sequential sentence speaker with mobile audio unlock, optional English cloud TTS prefetch,
 * Chrome long-utterance keepalive, and instant barge-in / hangup cancellation.
 */
export class VoicePlaybackQueue {
  private queue: QueuedSpeechItem[] = [];
  private isPlaying = false;
  private generation = 0;
  private activeAudioEl: HTMLAudioElement | null = null;
  private activeObjectUrl: string | null = null;
  private chromeWatchdogTimer: number | null = null;
  private audioCtx: AudioContext | null = null;
  private cloudDisabledUntil = 0;
  private turnFirstAudioReported = false;
  private opts: VoicePlaybackOptions;
  private outputPulseLevel = 0;

  constructor(opts: VoicePlaybackOptions) {
    this.opts = opts;
  }

  updateOptions(next: Partial<VoicePlaybackOptions>): void {
    this.opts = { ...this.opts, ...next };
  }

  resetTurnMetrics(): void {
    this.turnFirstAudioReported = false;
  }

  /**
   * Must be invoked inside a synchronous user tap ("Start Call") to satisfy iOS/Android autoplay rules.
   */
  unlockAudio(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (!this.audioCtx || this.audioCtx.state === "closed") {
          this.audioCtx = new AudioCtx();
        }
        if (this.audioCtx.state === "suspended") {
          void this.audioCtx.resume();
        }
        const buf = this.audioCtx.createBuffer(1, 1, 22050);
        const src = this.audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this.audioCtx.destination);
        src.start(0);
      }
    } catch {}

    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        // Pre-warm voices array cleanly on iOS/Chrome
        window.speechSynthesis.getVoices();
        const primer = new SpeechSynthesisUtterance(" ");
        primer.volume = 0;
        primer.rate = 1;
        window.speechSynthesis.speak(primer);
      }
    } catch {}
  }

  getIsSpeaking(): boolean {
    return this.isPlaying;
  }

  getOutputLevel(): number {
    return this.outputPulseLevel;
  }

  enqueue(sentence: string): void {
    const clean = cleanTextForSpeech(sentence);
    if (!clean) return;

    const lang = detectSentenceLanguage(clean, this.opts.defaultLanguage || "en-IN");
    const abortController = new AbortController();
    const canTryCloud =
      !!this.opts.cloudTtsEnabled &&
      !this.opts.isSpeakerMuted?.() &&
      lang.toLowerCase().startsWith("en") &&
      !DEVANAGARI_RE.test(clean) &&
      clean.length <= 195 &&
      Date.now() > this.cloudDisabledUntil;

    // Parallel prefetch cloud audio while earlier sentences speak for lower latency
    const cloudPromise = canTryCloud
      ? synthesizeEnglishSpeechApi(clean, "autumn", abortController.signal).catch(() => ({
          fallbackBrowser: true,
        }))
      : null;

    this.queue.push({
      text: clean,
      lang,
      generation: this.generation,
      cloudPromise,
      abortController,
    });

    if (!this.isPlaying) {
      void this.pump();
    }
  }

  cancelAll(): void {
    this.generation += 1;
    this.outputPulseLevel = 0;

    for (const item of this.queue) {
      try {
        item.abortController.abort();
      } catch {}
    }
    this.queue = [];

    if (this.chromeWatchdogTimer !== null) {
      window.clearInterval(this.chromeWatchdogTimer);
      this.chromeWatchdogTimer = null;
    }

    if (this.activeAudioEl) {
      try {
        this.activeAudioEl.pause();
        this.activeAudioEl.src = "";
      } catch {}
      this.activeAudioEl = null;
    }

    if (this.activeObjectUrl) {
      try {
        URL.revokeObjectURL(this.activeObjectUrl);
      } catch {}
      this.activeObjectUrl = null;
    }

    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch {}

    if (this.isPlaying) {
      this.isPlaying = false;
      this.opts.onStopSpeaking?.();
    }
  }

  private markFirstAudio(): void {
    if (!this.turnFirstAudioReported) {
      this.turnFirstAudioReported = true;
      this.opts.onFirstAudioStarted?.();
    }
  }

  private async pump(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.opts.onStartSpeaking?.();

    const startGen = this.generation;

    while (this.queue.length > 0 && this.generation === startGen) {
      const item = this.queue.shift()!;
      if (item.generation !== this.generation) continue;
      if (this.opts.isSpeakerMuted?.()) {
        // Estimate brief reading pause when speaker output is muted so captions stay readable
        this.markFirstAudio();
        continue;
      }

      let playedViaCloud = false;
      if (item.cloudPromise) {
        try {
          const timeoutRace = new Promise<{ fallbackBrowser: boolean }>((res) =>
            window.setTimeout(() => res({ fallbackBrowser: true }), 2600)
          );
          const res = await Promise.race([item.cloudPromise, timeoutRace]);
          if (this.generation !== startGen) break;
          if ("rateLimited" in res && res.rateLimited) {
            this.cloudDisabledUntil = Date.now() + 60_000;
          } else if (!res.fallbackBrowser && "audioBlob" in res && res.audioBlob) {
            playedViaCloud = await this.playAudioBlob(res.audioBlob, startGen);
          } else {
            // Brief cooldown when cloud TTS unavailable/disabled so browser voice stays instant
            this.cloudDisabledUntil = Date.now() + 30_000;
          }
        } catch {
          playedViaCloud = false;
        }
      }

      if (!playedViaCloud && this.generation === startGen && !this.opts.isSpeakerMuted?.()) {
        await this.playWithSpeechSynthesis(item.text, item.lang, startGen);
      }
    }

    if (this.generation === startGen) {
      this.outputPulseLevel = 0;
      this.isPlaying = false;
      this.opts.onStopSpeaking?.();
    }
  }

  private playAudioBlob(blob: Blob, gen: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.generation !== gen) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.activeObjectUrl = url;
      this.activeAudioEl = audio;
      audio.playbackRate = Math.min(2, Math.max(0.5, this.opts.voiceSpeed || 1.0));

      let finished = false;
      const done = (ok: boolean) => {
        if (finished) return;
        finished = true;
        this.outputPulseLevel = 0;
        if (this.activeAudioEl === audio) this.activeAudioEl = null;
        if (this.activeObjectUrl === url) {
          try {
            URL.revokeObjectURL(url);
          } catch {}
          this.activeObjectUrl = null;
        }
        resolve(ok);
      };

      audio.onplay = () => {
        this.outputPulseLevel = 0.65;
        this.markFirstAudio();
      };
      audio.onended = () => done(true);
      audio.onerror = () => done(false);

      audio.play().catch(() => done(false));
    });
  }

  private playWithSpeechSynthesis(text: string, lang: string, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (
        this.generation !== gen ||
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
      ) {
        resolve();
        return;
      }

      const synth = window.speechSynthesis;
      const utt = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      const chosen = pickVoiceForLanguage(voices, lang, this.opts.voiceName);
      if (chosen) utt.voice = chosen;
      utt.lang = chosen?.lang || lang;
      utt.rate = Math.min(2, Math.max(0.5, this.opts.voiceSpeed || 1.0));

      let finished = false;
      const maxWaitTimer = window.setTimeout(() => done(), Math.min(18000, Math.max(5000, text.length * 150)));

      const done = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(maxWaitTimer);
        this.outputPulseLevel = 0;
        if (this.chromeWatchdogTimer !== null) {
          window.clearInterval(this.chromeWatchdogTimer);
          this.chromeWatchdogTimer = null;
        }
        resolve();
      };

      utt.onstart = () => {
        this.outputPulseLevel = 0.58;
        this.markFirstAudio();
      };
      utt.onboundary = () => {
        // Gentle cadence modulation for the animated speaking orb
        this.outputPulseLevel = 0.45 + Math.random() * 0.42;
      };
      utt.onend = () => done();
      utt.onerror = () => done();

      // Workaround Chrome 15s speechSynthesis pause bug on longer utterances
      if (this.chromeWatchdogTimer !== null) {
        window.clearInterval(this.chromeWatchdogTimer);
      }
      this.chromeWatchdogTimer = window.setInterval(() => {
        try {
          if (synth.speaking && !synth.paused) {
            synth.pause();
            synth.resume();
          }
        } catch {}
      }, 9500);

      try {
        synth.speak(utt);
      } catch {
        done();
      }
    });
  }
}
