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
  customStyle?: any
): Promise<string> {
  const url = `${API_BASE_URL}/chat`;
  try {
    const headers = await getAuthHeaders(isGuest);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        user_memory: userMemory || undefined,
        user_context: userContext || undefined,
        project_context: projectContext || undefined,
        relevant_past_chats: relevantPastChats || undefined,
        custom_style: customStyle || undefined,
      }),
    });

    if (res.status === 401) {
      await handleUnauthorized();
      throw new Error("Session expired. Please log in again.");
    }

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const data = await res.json();
    return data.reply || "I am here to help. What would you like to explore next?";
  } catch (err) {
    console.error("[AUTONEXIS API ERROR]", err);
    return "I am currently unable to reach the service. Please check your connection or try again in a moment.";
  }
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
  customStyle?: any
): Promise<void> {
  const url = `${API_BASE_URL}/chat/stream`;
  try {
    const headers = await getAuthHeaders(isGuest);
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        messages,
        user_memory: userMemory || undefined,
        user_context: userContext || undefined,
        project_context: projectContext || undefined,
        relevant_past_chats: relevantPastChats || undefined,
        custom_style: customStyle || undefined,
      }),
    });

    if (res.status === 401) {
      await handleUnauthorized();
      onError(new Error("Session expired. Please log in again."));
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
        customStyle
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
              if (parsed.error && parsed.content) {
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
      // Stream aborted intentionally during account switch or logout
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
