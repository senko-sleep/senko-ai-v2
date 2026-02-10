import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];

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
      max_tokens: 8192,
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

  const processLine = createLineProcessor();
  return new ReadableStream({
    async pull(controller) {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            for (const line of buffer.split("\n")) {
              processLine(line, controller, encoder);
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
          processLine(line, controller, encoder);
        }
      }
    },
  });
}

// Per-stream state for filtering <think> blocks (DeepSeek R1 reasoning tokens)
function createLineProcessor() {
  let insideThink = false;

  return function processLine(
    line: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ) {
    const trimmed = line.replace(/^data: /, "").trim();
    if (!trimmed || trimmed === "[DONE]") return;
    try {
      const json = JSON.parse(trimmed);
      let content = json.choices?.[0]?.delta?.content;
      if (!content) return;

      // Handle DeepSeek R1 <think>...</think> reasoning blocks — strip them
      if (insideThink) {
        const endIdx = content.indexOf("</think>");
        if (endIdx !== -1) {
          insideThink = false;
          content = content.slice(endIdx + 8);
          if (!content) return;
        } else {
          return; // Still inside think block, skip
        }
      }

      const startIdx = content.indexOf("<think>");
      if (startIdx !== -1) {
        const before = content.slice(0, startIdx);
        const after = content.slice(startIdx + 7);
        if (before) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: before, done: false })}\n\n`));
        }
        const endIdx = after.indexOf("</think>");
        if (endIdx !== -1) {
          const remaining = after.slice(endIdx + 8);
          if (remaining) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: remaining, done: false })}\n\n`));
          }
        } else {
          insideThink = true;
        }
        return;
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content, done: false })}\n\n`));
    } catch {
      // skip
    }
  };
}

// -- OpenRouter streaming (fallback - free models, OpenAI-compatible) --------

const OPENROUTER_FALLBACK_MODELS = [
  "deepseek/deepseek-r1-0528:free",
  "tngtech/deepseek-r1t2-chimera:free",
  "openai/gpt-oss-120b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "stepfun/step-3.5-flash:free",
];

async function streamOpenRouter(
  messages: ChatMessage[],
  signal?: AbortSignal,
  modelOverride?: string
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = config.openRouterApiKey;
  if (!apiKey) throw new Error("OpenRouter API key not configured");
  
  const model = modelOverride || config.openRouterModel;
  const res = await fetch(config.openRouterUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://senko-ai.vercel.app",
      "X-Title": "Senko AI",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 8192,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`OpenRouter ${res.status}: ${text}`) as Error & { status: number; body: string };
    err.status = res.status;
    err.body = text;
    throw err;
  }

  if (!res.body) throw new Error("No OpenRouter response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const processLine = createLineProcessor();
  return new ReadableStream({
    async pull(controller) {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            for (const line of buffer.split("\n")) {
              processLine(line, controller, encoder);
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
          processLine(line, controller, encoder);
        }
      }
    },
  });
}

// -- Ollama streaming (fallback - local, no internet needed) ----------------

function isVercel(): boolean {
  return !!process.env.VERCEL;
}

async function isOllamaUp(): Promise<boolean> {
  if (isVercel()) return false;
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
    const body = await req.json();
    const messages = body?.messages as { role: string; content: string }[] | undefined;
    const systemPrompt = body?.systemPrompt as string | undefined;

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

    // Strategy: Groq first (fastest ~500tok/s), Ollama fallback (local), OpenRouter last resort
    
    // 1. Try Groq (fastest inference available)
    if (config.groqApiKey) {
      const allGroqModels = [config.groqModel, ...GROQ_FALLBACK_MODELS.filter(m => m !== config.groqModel)];
      for (const model of allGroqModels) {
        try {
          console.log(`[chat] Trying Groq model: ${model}`);
          const stream = await streamGroq(chatMessages, undefined, model);
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-store",
              Connection: "keep-alive",
              "X-AI-Provider": `groq (${model})`,
            },
          });
        } catch (groqErr) {
          console.error(`[chat] Groq ${model} failed:`, groqErr instanceof Error ? groqErr.message : groqErr);
        }
      }
    }

    // 2. Try Ollama (local, offline-capable)
    const ollamaOk = await isOllamaUp();
    if (ollamaOk) {
      try {
        const stream = await streamOllama(chatMessages);
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store",
            Connection: "keep-alive",
            "X-AI-Provider": "ollama",
          },
        });
      } catch (ollamaErr) {
        console.error("[chat] Ollama failed:", ollamaErr instanceof Error ? ollamaErr.message : ollamaErr);
      }
    }

    // 3. Try OpenRouter (last resort — free but slower models)
    if (config.openRouterApiKey) {
      for (const orModel of OPENROUTER_FALLBACK_MODELS) {
        try {
          console.log(`[chat] Trying OpenRouter model: ${orModel}`);
          const stream = await streamOpenRouter(chatMessages, undefined, orModel);
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-store",
              Connection: "keep-alive",
              "X-AI-Provider": `openrouter (${orModel})`,
            },
          });
        } catch (orErr) {
          console.error(`[chat] OpenRouter ${orModel} failed:`, orErr instanceof Error ? orErr.message : orErr);
        }
      }
    }

    // Everything failed — provide a detailed, actionable error
    const hasAnyKey = !!(config.openRouterApiKey || config.groqApiKey);
    const ollamaChecked = !isVercel();
    
    let errorMsg: string;
    if (!hasAnyKey && !ollamaChecked) {
      errorMsg = "No AI providers configured. Please set OPENROUTER_API_KEY or GROQ_API_KEY in your .env.local file, or start Ollama locally (ollama serve).";
    } else if (!hasAnyKey && ollamaChecked && !ollamaOk) {
      errorMsg = "No cloud AI keys configured and Ollama is not running. Either set OPENROUTER_API_KEY or GROQ_API_KEY in .env.local, or start Ollama with: ollama serve";
    } else if (hasAnyKey && !ollamaOk) {
      errorMsg = "All cloud AI models are currently rate-limited or unavailable. Try again in a minute, or start Ollama locally as a fallback (ollama serve).";
    } else {
      errorMsg = "All AI providers failed. Please try again in a moment.";
    }
    
    return Response.json(
      { error: errorMsg },
      { status: 503 }
    );
  } catch (err) {
    console.error("[chat] Unhandled error:", err instanceof Error ? err.message : err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
