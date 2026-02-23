/**
 * Streaming chat client — extracted from page.tsx
 * Handles SSE streaming from /api/chat endpoint
 */

export async function streamChat(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  signal?: AbortSignal
) {
  const id = Math.random().toString(36).slice(2, 6);
  let finished = false;
  const finish = () => { if (!finished) { finished = true; onDone(); } };

  console.log(`%c[stream:${id}] 📤 Starting fetch to /api/chat`, "color: #00bfff; font-weight: bold", {
    messageCount: messages.length,
    systemPromptLength: systemPrompt?.length || 0,
    totalChars: messages.reduce((a, m) => a + m.content.length, 0),
  });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, systemPrompt }),
      signal,
    });

    console.log(`%c[stream:${id}] 📥 Response: ${res.status} ${res.statusText}`, 
      res.ok ? "color: #00ff88; font-weight: bold" : "color: #ff4444; font-weight: bold",
      { provider: res.headers.get("X-AI-Provider") });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const serverMsg = data.error || "";
      console.error(`%c[stream:${id}] ❌ Server error:`, "color: #ff4444; font-weight: bold", { status: res.status, error: serverMsg });
      let friendly = "";
      if (res.status === 502 || res.status === 503) {
        friendly = serverMsg
          ? `AI provider error (${res.status}): ${serverMsg}`
          : `AI provider unavailable (${res.status}). The GROQ_API_KEY may not be set or the model is down.`;
      } else if (res.status === 429) {
        friendly = serverMsg || "AI rate limited. Please try again in a minute.";
      } else if (res.status === 500) {
        friendly = `Server error: ${serverMsg || "Internal error in chat API"}`;
      } else if (res.status === 400) {
        friendly = `Bad request: ${serverMsg || "Invalid message format"}`;
      } else {
        friendly = serverMsg || `Request failed with status ${res.status}`;
      }
      onError(friendly);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      console.error(`%c[stream:${id}] ❌ No response body reader`, "color: #ff4444");
      onError("No response stream");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`%c[stream:${id}] ✅ Stream complete (${chunkCount} chunks)`, "color: #00ff88; font-weight: bold");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          // Skip SSE keepalive comment lines (": ping")
          if (line.startsWith(":")) continue;
          const trimmed = line.replace(/^data: /, "").trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.error) {
              console.error(`%c[stream:${id}] ❌ Stream error:`, "color: #ff4444", parsed.error);
              onError(parsed.error);
              return;
            }
            if (parsed.content) {
              chunkCount++;
              onChunk(parsed.content);
            }
          } catch {
            // skip malformed
          }
        }
      }
    } catch (streamErr) {
      // If we already received content, treat mid-stream network errors as graceful completion
      // (ERR_INCOMPLETE_CHUNKED_ENCODING after partial response)
      if (chunkCount > 0 && !signal?.aborted) {
        console.warn(`%c[stream:${id}] ⚠️ Stream cut short after ${chunkCount} chunks — treating as done`, "color: #ffaa00; font-weight: bold", streamErr);
        finish();
        return;
      }
      throw streamErr;
    }
    finish();
  } catch (err) {
    if (signal?.aborted) {
      console.log(`%c[stream:${id}] ⚠️ Aborted by user`, "color: #ffaa00");
      finish();
      return;
    }
    console.error(`%c[stream:${id}] 💥 Fetch exception:`, "color: #ff0000; font-weight: bold", err);
    onError(err instanceof Error ? err.message : "Stream failed");
  }
}
