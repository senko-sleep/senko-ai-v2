import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Senko AI - Single Unified API
// Groq (primary, ~500 tok/s) -> Ollama (fallback, local) -> Error
// Everything lives in this one file. No external lib imports.
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// -- Groq streaming (primary - fastest inference available) -----------------

// Fallback models when primary hits rate limits (ordered by preference)
const GROQ_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "gemma2-9b-it",
  "llama-3.1-8b-instant",
];

function isRateLimitError(text: string, status: number): boolean {
  return status === 429 || text.includes("rate_limit") || text.includes("Rate limit");
}

async function streamGroq(
  messages: ChatMessage[],
  signal?: AbortSignal,
  modelOverride?: string
): Promise<ReadableStream<Uint8Array>> {
  const model = modelOverride || config.groqModel;
  const res = await fetch(config.groqUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Groq ${res.status}: ${text}`) as Error & { status: number; body: string };
    err.status = res.status;
    err.body = text;
    throw err;
  }

  if (!res.body) throw new Error("No Groq response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async pull(controller) {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            for (const line of buffer.split("\n")) {
              processGroqLine(line, controller, encoder);
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          processGroqLine(line, controller, encoder);
        }
      }
    },
  });
}

function processGroqLine(
  line: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  const trimmed = line.replace(/^data: /, "").trim();
  if (!trimmed || trimmed === "[DONE]") return;
  try {
    const json = JSON.parse(trimmed);
    const content = json.choices?.[0]?.delta?.content;
    if (content) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ content, done: false })}\n\n`)
      );
    }
  } catch {
    // skip
  }
}

// -- Ollama streaming (fallback - local, no internet needed) ----------------

async function isOllamaUp(): Promise<boolean> {
  try {
    const r = await fetch(`${config.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(800),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function streamOllama(
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.ollamaModel, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${text}`);
  }

  if (!res.body) throw new Error("No Ollama response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async pull(controller) {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            for (const line of buffer.split("\n")) {
              processOllamaLine(line, controller, encoder);
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          processOllamaLine(line, controller, encoder);
        }
      }
    },
  });
}

function processOllamaLine(
  line: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  if (!line.trim()) return;
  try {
    const json = JSON.parse(line);
    if (json.message?.content) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ content: json.message.content, done: !!json.done })}\n\n`
        )
      );
    }
  } catch {
    // skip
  }
}

// -- Unified handler --------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt } = (await req.json()) as {
      messages: { role: string; content: string }[];
      systemPrompt?: string;
    };

    if (!messages?.length) {
      return Response.json({ error: "messages required" }, { status: 400 });
    }

    const chatMessages: ChatMessage[] = [];
    if (systemPrompt) {
      chatMessages.push({ role: "system", content: systemPrompt });
    }
    for (const m of messages) {
      if (m.role === "user" || m.role === "assistant") {
        chatMessages.push({ role: m.role, content: m.content });
      }
    }

    let stream!: ReadableStream<Uint8Array>;
    let provider!: string;

    // Strategy: Groq first (fastest), fallback models on rate limit, Ollama last
    if (config.groqApiKey) {
      try {
        stream = await streamGroq(chatMessages);
        provider = "groq";
      } catch (groqErr) {
        const errAny = groqErr as Error & { status?: number; body?: string };
        const isRateLimit = isRateLimitError(errAny.body || errAny.message || "", errAny.status || 0);

        // If rate limited, try fallback models before giving up
        if (isRateLimit) {
          let fallbackWorked = false;
          for (const fallbackModel of GROQ_FALLBACK_MODELS) {
            if (fallbackModel === config.groqModel) continue;
            try {
              stream = await streamGroq(chatMessages, undefined, fallbackModel);
              provider = `groq (${fallbackModel})`;
              fallbackWorked = true;
              break;
            } catch {
              // This fallback model also failed, try next
            }
          }
          if (!fallbackWorked) {
            // All Groq models exhausted, try Ollama
            const ollamaOk = await isOllamaUp();
            if (ollamaOk) {
              stream = await streamOllama(chatMessages);
              provider = "ollama";
            } else {
              return Response.json(
                { error: "AI provider rate limited on all models. Please try again later or start Ollama locally." },
                { status: 429 }
              );
            }
          }
        } else {
          // Non-rate-limit Groq error, try Ollama
          const ollamaOk = await isOllamaUp();
          if (ollamaOk) {
            stream = await streamOllama(chatMessages);
            provider = "ollama";
          } else {
            const msg = groqErr instanceof Error ? groqErr.message : "Groq unavailable";
            return Response.json({ error: msg }, { status: 502 });
          }
        }
      }
    } else {
      // No Groq key, go straight to Ollama
      const ollamaOk = await isOllamaUp();
      if (ollamaOk) {
        stream = await streamOllama(chatMessages);
        provider = "ollama";
      } else {
        return Response.json(
          {
            error:
              "No AI provider available. Set GROQ_API_KEY in .env.local for instant cloud inference, or start Ollama locally.",
          },
          { status: 503 }
        );
      }
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
        "X-AI-Provider": provider,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
