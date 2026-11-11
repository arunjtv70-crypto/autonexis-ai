/**
 * AUTONEXIS Voice Call Audio Utilities:
 * - getUserMedia with AEC/NS/AGC + Bluetooth / wired headset label detection
 * - MediaRecorder MIME selection (WebM/Opus -> MP4/AAC -> fallback)
 * - Client-side downsampling compression (to 16 kHz mono WAV) if blob approaches Vercel's 4.5 MB cap
 * - RMS energy analyzer & assistant-self-echo text guard
 */

export const MAX_VOICE_UPLOAD_BYTES = 3_400_000; // Comfortably below Vercel's 4.5 MB limit

export function getSupportedRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {}
  }
  return "";
}

export async function requestVoiceMicrophone(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    const err = new Error("Microphone capture is unavailable in this browser.");
    err.name = "NotSupportedError";
    throw err;
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 16000 },
    },
    video: false,
  });
}

export async function detectAudioRoutingLabel(): Promise<"bluetooth" | "headset" | "speaker"> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return "speaker";
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputsAndInputs = devices.filter(
      (d) => d.kind === "audiooutput" || d.kind === "audioinput"
    );
    const labels = outputsAndInputs.map((d) => (d.label || "").toLowerCase()).join(" | ");
    if (/bluetooth|airpods|buds|wf-|wh-|jbl|bose|sony/i.test(labels)) {
      return "bluetooth";
    }
    if (/headset|headphone|earphone|wired|usb audio/i.test(labels)) {
      return "headset";
    }
  } catch {}
  return "speaker";
}

export function computeTimeDomainRms(analyser: AnalyserNode, buffer: Float32Array): number {
  analyser.getFloatTimeDomainData(buffer as any);
  let sumSq = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / buffer.length);
}

/**
 * Prevents the assistant from replying to speaker bleed echoing back through the mic.
 */
export function isProbableSelfEcho(transcript: string, lastAssistantSpoken: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const a = norm(transcript);
  const b = norm(lastAssistantSpoken);
  if (!a || !b || a.length < 4) return false;
  if (b.includes(a) && a.length >= 6) return true;

  const wordsA = a.split(" ").filter((w) => w.length > 1);
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 1));
  if (wordsA.length < 2 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / wordsA.length >= 0.78;
}

function encodeMonoWav16k(samples: Float32Array, sampleRate = 16000): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Downsamples and converts large recordings to 16 kHz mono WAV if needed to stay under Vercel's body limit.
 */
export async function compressAudioBlobIfNeeded(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_VOICE_UPLOAD_BYTES) return blob;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx || typeof OfflineAudioContext === "undefined") return blob;

    const ctx = new AudioCtx();
    try {
      const arrayBuf = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      const targetRate = 16000;
      const targetLen = Math.max(1, Math.round(decoded.duration * targetRate));
      const offline = new OfflineAudioContext(1, targetLen, targetRate);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      return encodeMonoWav16k(rendered.getChannelData(0), targetRate);
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch {
    return blob;
  }
}
