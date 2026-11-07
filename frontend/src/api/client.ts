import { API_BASE_URL } from "../config";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { getOrCreateSessionId } from "./settings";

export interface ChatMessagePayload {
  role: "user" | "assistant";
  content: string;
}

/**
 * Returns authorization headers with the fresh Firebase ID token.
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Session-Id": getOrCreateSessionId(),
  };
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
  userMemory?: string
): Promise<string> {
  const url = `${API_BASE_URL}/chat`;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        user_memory: userMemory || undefined,
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
  onChunk: (token: string) => void,
  onDone: () => void,
  onError: (err: any) => void
): Promise<void> {
  const url = `${API_BASE_URL}/chat/stream`;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        user_memory: userMemory || undefined,
      }),
    });

    if (res.status === 401) {
      await handleUnauthorized();
      onError(new Error("Session expired. Please log in again."));
      return;
    }

    if (!res.ok || !res.body) {
      // Fallback to non-streaming if stream is unsupported
      const directReply = await postChatMessage(messages, userMemory);
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
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("data: ")) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === "[DONE]") {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.content) {
              onChunk(parsed.content);
            }
          } catch {
            // Ignore non-json chunk
          }
        }
      }
    }
  } catch (err) {
    onError(err);
  }
}
