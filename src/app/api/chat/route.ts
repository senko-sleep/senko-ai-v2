import { NextRequest } from "next/server";
import { openStream, type LlmMessage } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { messages, systemPrompt?, provider? } -> text/event-stream of
//   data: {"content": "..."}      (text chunks)
//   data: {"error": "..."}        (failure after streaming started)
//   data: [DONE]
// Errors before streaming starts come back as JSON { error } with a 4xx/5xx status.

export async function POST(req: NextRequest) {
  let body: { messages?: { role: string; content: string }[]; systemPrompt?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (!incoming.length) return Response.json({ error: "messages required" }, { status: 400 });

  const messages: LlmMessage[] = [];
  if (body.systemPrompt) messages.push({ role: "system", content: body.systemPrompt });
  for (const m of incoming) {
    if ((m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content) {
      messages.push({ role: m.role, content: m.content });
    }
  }

  let opened;
  try {
    opened = await openStream(messages, { provider: body.provider, signal: req.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chat]", msg);
    return Response.json({ error: msg }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, data: unknown) =>
    c.enqueue(encoder.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`));

  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Keep proxies from closing the connection while a slow local model warms up.
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* closed */
        }
      }, 15_000);
      try {
        for await (const chunk of opened.stream) send(controller, { content: chunk });
        send(controller, "[DONE]");
      } catch (e) {
        if (!req.signal.aborted) {
          send(controller, { error: e instanceof Error ? e.message : "Stream failed" });
        }
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-AI-Provider": `${opened.provider} (${opened.model})`,
    },
  });
}
