import { API_BASE_URL } from "../config";

export interface ChatMessagePayload {
  role: "user" | "assistant";
  content: string;
}

export async function postChatMessage(
  messages: ChatMessagePayload[],
  userMemory?: string
): Promise<string> {
  const url = `${API_BASE_URL}/chat`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        user_memory: userMemory || undefined,
      }),
    });

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
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        user_memory: userMemory || undefined,
      }),
    });

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
