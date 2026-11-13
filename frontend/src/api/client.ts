import { API_BASE_URL } from "../config";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

export type MultimodalPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type MessageContent = string | MultimodalPart[];

export interface ChatMessagePayload {
  role: "user" | "assistant";
  content: MessageContent;
}

export interface VisionDebugInfo {
  payload_kb: number;
  image_count: number;
  route: string;
  fallback_used: boolean;
  attempts: number;
  latency_ms: number;
  status: number | string;
  error: string | null;
}

export type VisionStage = "preparing" | "reading" | "checking" | "writing";

export const MAX_CHAT_REQUEST_BYTES = Math.floor(2.85 * 1024 * 1024);

function isVisionDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

function pruneClientHistoricalImages(messages: ChatMessagePayload[]): ChatMessagePayload[] {
  if (!messages.length) return messages;
  const lastIdx = messages.length - 1;
  return messages.map((m, idx) => {
    if (idx === lastIdx || !Array.isArray(m.content)) return m;
    let hadImg = false;
    const kept: MultimodalPart[] = [];
    for (const p of m.content) {
      if (p.type === "image_url") {
        hadImg = true;
      } else {
        kept.push(p);
      }
    }
    if (hadImg) {
      kept.push({ type: "text", text: "[image sent earlier]" });
    }
    return { ...m, content: kept };
  });
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function buildBoundedChatBody(rawBody: Record<string, any>): { json: string; bytes: number } {
  const sanitizedMessages = pruneClientHistoricalImages(rawBody.messages || []);
  let candidate: Record<string, any> = { ...rawBody, messages: sanitizedMessages };
  let json = JSON.stringify(candidate);
  let bytes = utf8ByteLength(json);

  if (bytes > MAX_CHAT_REQUEST_BYTES && candidate.relevant_past_chats) {
    candidate = { ...candidate, relevant_past_chats: undefined };
    json = JSON.stringify(candidate);
    bytes = utf8ByteLength(json);
  }

  if (bytes > MAX_CHAT_REQUEST_BYTES && candidate.project_context) {
    candidate = { ...candidate, project_context: undefined };
    json = JSON.stringify(candidate);
    bytes = utf8ByteLength(json);
  }

  // Progressively trim older turns while keeping the latest message intact
  while (bytes > MAX_CHAT_REQUEST_BYTES && Array.isArray(candidate.messages) && candidate.messages.length > 1) {
    candidate = { ...candidate, messages: candidate.messages.slice(1) };
    json = JSON.stringify(candidate);
    bytes = utf8ByteLength(json);
  }

  if (bytes > Math.floor(2.98 * 1024 * 1024)) {
    throw new Error(
      `Attached image payload (${(bytes / (1024 * 1024)).toFixed(2)} MB) exceeds the 3 MB request limit. Try fewer images or a smaller crop.`
    );
  }

  return { json, bytes };
}

/**
 * Returns authorization headers with the fresh Firebase ID token,
 * or the X-Guest header when in guest mode.
 */
async function getAuthHeaders(isGuest = false): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (isGuest) {
    headers["X-Guest"] = "1";
    return headers;
  }

  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const idToken = await currentUser.getIdToken();
      headers["Authorization"] = `Bearer ${idToken}`;
    } catch (err) {
      console.error("[AUTONEXIS] Failed to get Firebase ID token:", err);
    }
  }
  return headers;
}

/**
 * Global handler for 401 Unauthorized responses.
 * Immediately signs out and triggers login view.
 */
async function handleUnauthorized(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[AUTONEXIS] Error during sign out:", err);
  }
  window.dispatchEvent(new CustomEvent("autonexis:unauthorized"));
}

export async function postChatMessage(
  messages: ChatMessagePayload[],
  userMemory?: string,
  userContext?: any,
  isGuest = false,
  projectContext?: any,
  relevantPastChats?: any[],
  customStyle?: any,
  voice = false,
  chatContext?: string,
  clientTime?: string,
  timezone?: string
): Promise<string> {
  const url = `${API_BASE_URL}/chat${isVisionDebugEnabled() ? "?debug=1" : ""}`;
  try {
    const headers = await getAuthHeaders(isGuest);
    const { json } = buildBoundedChatBody({
      messages,
      user_memory: userMemory || undefined,
      user_context: userContext || undefined,
      project_context: projectContext || undefined,
      relevant_past_chats: relevantPastChats || undefined,
      custom_style: customStyle || undefined,
      chat_context: chatContext || undefined,
      client_time: clientTime || undefined,
      timezone: timezone || undefined,
      voice: voice || undefined,
      debug: isVisionDebugEnabled() || undefined,
    });
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: json,
    });

    if (res.status === 401) {
      await handleUnauthorized();
      throw new Error("Session expired. Please log in again.");
    }

    if (!res.ok) {
      let detail = `Server returned ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.detail) detail = String(errJson.detail);
      } catch {}
      throw new Error(detail);
    }

    const data = await res.json();
    return data.reply || "I am here to help. What would you like to explore next?";
  } catch (err: any) {
    console.error("[AUTONEXIS API ERROR]", err);
    if (err?.message && !/failed to fetch/i.test(err.message)) {
      return err.message;
    }
    return "I am currently unable to reach the service. Please check your connection or try again in a moment.";
  }
}

export interface ImageRouterMeta {
  intent: "image" | "image_edit" | "chat";
  confidence: number;
  reason: string;
}

export interface ImageGenerationResultPayload {
  image_data_url: string;
  original_request: string;
  subject: string;
  final_prompt: string;
  style: string;
  aspect: string;
  width: number;
  height: number;
  seed: number;
  model: string;
  caption: string;
  anonymous_mode: boolean;
  warnings: string[];
  router?: ImageRouterMeta;
}

export interface StreamChatOptions {
  recentContext?: Array<Record<string, any>>;
  forceImageMode?: boolean;
  imageStyle?: string;
  imageAspect?: string;
  imageSeed?: number;
  chatContext?: string;
  clientTime?: string;
  timezone?: string;
  onRouterMeta?: (meta: ImageRouterMeta) => void;
  onImageStatus?: (status: { stage: string; aspect?: string; style?: string; router?: ImageRouterMeta }) => void;
  onImageResult?: (payload: ImageGenerationResultPayload) => void;
  onImageBlocked?: (payload: { message: string; category?: string; moderation_log?: any; router?: ImageRouterMeta }) => void;
  onImageError?: (payload: { message: string; rate_limited?: boolean; retry_after?: number; router?: ImageRouterMeta }) => void;
  onVisionStage?: (stage: VisionStage) => void;
  onVisionDebug?: (debug: VisionDebugInfo) => void;
}

export async function streamChatMessage(
  messages: ChatMessagePayload[],
  userMemory: string | undefined,
  userContext: any | undefined,
  onChunk: (token: string) => void,
  onDone: () => void,
  onError: (err: any) => void,
  isGuest = false,
  signal?: AbortSignal,
  projectContext?: any,
  relevantPastChats?: any[],
  customStyle?: any,
  voice = false,
  options?: StreamChatOptions
): Promise<void> {
  const debugOn = isVisionDebugEnabled();
  const url = `${API_BASE_URL}/chat/stream${debugOn ? "?debug=1" : ""}`;
  try {
    const headers = await getAuthHeaders(isGuest);
    const { json } = buildBoundedChatBody({
      messages,
      user_memory: userMemory || undefined,
      user_context: userContext || undefined,
      project_context: projectContext || undefined,
      relevant_past_chats: relevantPastChats || undefined,
      custom_style: customStyle || undefined,
      chat_context: options?.chatContext || undefined,
      client_time: options?.clientTime || undefined,
      timezone: options?.timezone || undefined,
      voice: voice || undefined,
      recent_context: options?.recentContext || undefined,
      force_image_mode: options?.forceImageMode || undefined,
      image_style: options?.imageStyle || undefined,
      image_aspect: options?.imageAspect || undefined,
      image_seed: options?.imageSeed ?? undefined,
      debug: debugOn || undefined,
    });
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal,
      body: json,
    });

    const routerHdr = res.headers.get("X-Autonexis-Router");
    if (routerHdr && options?.onRouterMeta) {
      try {
        options.onRouterMeta(JSON.parse(routerHdr));
      } catch {}
    }

    if (res.status === 401) {
      await handleUnauthorized();
      onError(new Error("Session expired. Please log in again."));
      return;
    }

    if (res.status === 429) {
      onError(Object.assign(new Error(voice ? "Voice is busy, please try again shortly" : "Too many requests right now. Please wait a few seconds and try again."), { rateLimited: true }));
      return;
    }

    if (res.status === 413 || res.status === 400 || res.status === 403) {
      let detail = `Server returned HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.detail) detail = String(errJson.detail);
      } catch {}
      onError(new Error(detail));
      return;
    }

    if (!res.ok || !res.body) {
      // Fallback to non-streaming if stream is unsupported
      const directReply = await postChatMessage(
        messages,
        userMemory,
        userContext,
        isGuest,
        projectContext,
        relevantPastChats,
        customStyle,
        voice
      );
      onChunk(directReply);
      onDone();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        onDone();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      // Standard SSE event boundary
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";

      for (const event of events) {
        if (!event) continue;
        const lines = event.split(/\r?\n/);
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr.trim() === "[DONE]") {
              onDone();
              return;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === "router_meta" && parsed.router) {
                options?.onRouterMeta?.(parsed.router);
              } else if (parsed.type === "vision_stage" && parsed.stage) {
                options?.onVisionStage?.(parsed.stage as VisionStage);
              } else if (parsed.type === "vision_debug" && parsed.debug) {
                options?.onVisionDebug?.(parsed.debug as VisionDebugInfo);
              } else if (parsed.type === "image_status") {
                options?.onImageStatus?.(parsed);
              } else if (parsed.type === "image_result") {
                options?.onImageResult?.(parsed);
              } else if (parsed.type === "image_blocked" || parsed.type === "image_guest_blocked") {
                if (parsed.type === "image_blocked" && options?.onImageBlocked) {
                  options.onImageBlocked(parsed);
                } else if (typeof parsed.content === "string") {
                  onChunk(parsed.content);
                }
              } else if (parsed.type === "image_error") {
                if (options?.onImageError) {
                  options.onImageError(parsed);
                } else if (typeof parsed.message === "string") {
                  onError(new Error(parsed.message));
                  return;
                }
              } else if (parsed.rate_limited) {
                onError(Object.assign(new Error(parsed.content || "Voice is busy, please try again shortly"), { rateLimited: true }));
                return;
              } else if (parsed.error && parsed.content) {
                onChunk(parsed.content);
              } else if (typeof parsed.content === "string") {
                // NEVER trim chunks - preserve spaces, code indentation, and newlines!
                onChunk(parsed.content);
              }
            } catch {
              // Ignore non-json chunk
            }
          }
        }
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      // Stream aborted intentionally during account switch, barge-in, or logout
      return;
    }
    onError(err);
  }
}

export interface MemoryExtractAction {
  action: "add" | "update" | "none";
  text?: string;
  target_id?: string;
}

export async function extractMemoriesApi(
  messages: Array<{ role: string; content: any }>,
  existingMemories?: Array<{ id?: string; text: string }>,
  isGuest = false
): Promise<MemoryExtractAction[]> {
  const url = `${API_BASE_URL}/memory/extract`;
  try {
    const headers = await getAuthHeaders(isGuest);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        existing_memories: existingMemories || [],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.changes) ? data.changes : [];
  } catch (err) {
    console.warn("[AUTONEXIS] Memory extraction API call error:", err);
    return [];
  }
}

export async function createCustomStyleApi(
  sample: string
): Promise<{ description: string; error?: string }> {
  const url = `${API_BASE_URL}/style/create`;
  try {
    const headers = await getAuthHeaders(false);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ sample: sample.slice(0, 2000) }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return { description: "", error: "Please log in again to analyze styles." };
    }
    if (res.status === 429) {
      return { description: "", error: "Rate limit reached. Please wait before creating another style." };
    }
    if (!res.ok) {
      return { description: "", error: "Could not analyze writing style right now." };
    }
    const data = await res.json();
    return { description: (data?.description || "").slice(0, 300) };
  } catch (err) {
    console.warn("[AUTONEXIS] Style analysis error:", err);
    return { description: "", error: "Network error while analyzing style." };
  }
}

export async function transcribeVoiceAudioApi(
  audioBlob: Blob,
  language: string,
  durationSec: number,
  signal?: AbortSignal
): Promise<{ text: string; rateLimited?: boolean; error?: string }> {
  const url = `${API_BASE_URL}/voice/transcribe`;
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return { text: "", error: "Please log in to use voice calls." };
    }
    const idToken = await currentUser.getIdToken();
    const mime = (audioBlob.type || "audio/webm").toLowerCase();
    const ext = mime.includes("mp4") || mime.includes("m4a")
      ? "mp4"
      : mime.includes("ogg")
      ? "ogg"
      : mime.includes("wav")
      ? "wav"
      : "webm";

    const form = new FormData();
    form.append("file", audioBlob, `speech.${ext}`);
    form.append("language", language || "en-IN");
    form.append("duration_sec", String(Math.max(0.4, Math.min(35, durationSec))));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      body: form,
      signal,
    });

    if (res.status === 401) {
      await handleUnauthorized();
      return { text: "", error: "Session expired. Please log in again." };
    }

    if (res.status === 429 || res.status === 503) {
      let detail = "Voice is busy, please try again shortly";
      try {
        const j = await res.json();
        if (j?.detail) detail = j.detail;
      } catch {}
      return { text: "", rateLimited: true, error: detail };
    }

    if (!res.ok) {
      let detail = "Could not transcribe your voice turn right now.";
      try {
        const j = await res.json();
        if (j?.detail) detail = j.detail;
      } catch {}
      return { text: "", error: detail };
    }

    const plainText = (await res.text()).trim();
    return { text: plainText };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { text: "" };
    }
    return { text: "", error: "Network error while sending audio." };
  }
}

export async function synthesizeEnglishSpeechApi(
  text: string,
  voice = "autumn",
  signal?: AbortSignal
): Promise<{ audioBlob?: Blob; fallbackBrowser: boolean; rateLimited?: boolean }> {
  const url = `${API_BASE_URL}/voice/speak`;
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return { fallbackBrowser: true };
    const idToken = await currentUser.getIdToken();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        text: text.slice(0, 200),
        voice,
        language: "en-IN",
      }),
      signal,
    });

    if (res.status === 429) {
      return { fallbackBrowser: true, rateLimited: true };
    }
    if (!res.ok) {
      return { fallbackBrowser: true };
    }
    const blob = await res.blob();
    if (!blob || blob.size < 64) {
      return { fallbackBrowser: true };
    }
    return { audioBlob: blob, fallbackBrowser: false };
  } catch {
    return { fallbackBrowser: true };
  }
}

export async function generateImageApi(params: {
  prompt: string;
  style?: string;
  aspect?: string;
  seed?: number;
  previousPrompt?: string;
  isEdit?: boolean;
  explicitMode?: boolean;
  signal?: AbortSignal;
}): Promise<{
  ok: boolean;
  data?: ImageGenerationResultPayload;
  blocked?: boolean;
  category?: string;
  moderation_log?: any;
  rate_limited?: boolean;
  retry_after?: number;
  error?: string;
  router?: ImageRouterMeta;
}> {
  const url = `${API_BASE_URL}/image/generate?format=json`;
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return { ok: false, error: "Please log in to create images." };
    }
    const headers = await getAuthHeaders(false);
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: params.signal,
      body: JSON.stringify({
        prompt: params.prompt,
        style: params.style || undefined,
        aspect: params.aspect || undefined,
        seed: params.seed ?? undefined,
        previous_prompt: params.previousPrompt || undefined,
        is_edit: !!params.isEdit,
        explicit_mode: !!params.explicitMode,
      }),
    });

    if (res.status === 401) {
      await handleUnauthorized();
      return { ok: false, error: "Session expired. Please log in again." };
    }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.ok) {
      return {
        ok: false,
        blocked: !!payload?.blocked,
        category: payload?.category,
        moderation_log: payload?.moderation_log,
        rate_limited: !!payload?.rate_limited || res.status === 429 || res.status === 503,
        retry_after: payload?.retry_after,
        error: payload?.message || payload?.detail || "Could not create this image right now. Please try again.",
        router: payload?.router,
      };
    }
    return {
      ok: true,
      data: payload as ImageGenerationResultPayload,
      router: payload.router,
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, error: "Cancelled" };
    }
    return { ok: false, error: "Network issue while creating image. Please try again." };
  }
}

/**
 * Calls backend POST /api/chat/summarize to refresh in-chat memory (summary, facts, timeline, open threads).
 * Strictly non-blocking and safe against rate limits.
 */
export async function summarizeChatMemory(
  chatId: string,
  oldState: any,
  newMessages: any[],
  clientTime?: string,
  timezone?: string
): Promise<any> {
  const url = `${API_BASE_URL}/chat/summarize`;
  try {
    const headers = await getAuthHeaders(false);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chat_id: chatId,
        old_state: oldState || undefined,
        new_messages: newMessages,
        client_time: clientTime || new Date().toISOString(),
        timezone: timezone || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"),
      }),
    });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn("[AUTONEXIS] Chat summarize request failed:", err);
    return null;
  }
}

