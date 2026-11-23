import { NextRequest } from "next/server";
import { getMessages, requireChat, updateMessage } from "@/lib/server/chats";
import { errorResponse, HttpError, identify } from "@/lib/server/identity";
import { personalityFor } from "@/lib/server/persona";
import { speechText } from "@/lib/server/voice";
import { runProduction } from "@/lib/server/voice-production";
import { createProduction, normalizeDirection } from "@/lib/voice/production";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const state = globalThis as typeof globalThis & { voiceRecordingBusy?: Set<string> };
const busy = (state.voiceRecordingBusy ??= new Set());

/**
 * POST { section?, direction? }: re-record one section (optionally with edited direction), or with
 * no section, retry whatever hasn't been recorded. Finished sections are never regenerated.
 * SSE events: voice_progress {progress} | done {message} | error {error}
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  let who, message;
  let body: { section?: unknown; direction?: unknown };
  try {
    who = await identify(req);
    const { id: chatId, messageId } = await params;
    await requireChat(who.ownerId, chatId);
    body = await req.json().catch(() => ({}));
    message = (await getMessages(chatId)).find(m => m.id === messageId && m.role === "assistant");
    if (!message?.content.trim()) throw new HttpError(404, "That voice message wasn't found.");
    if (busy.has(message.id)) throw new HttpError(409, "This recording is already being generated.");
  } catch (e) {
    return errorResponse(e);
  }

  const target = message;
  const ownerId = who.ownerId;
  const production = target.meta.voiceProduction ?? createProduction(speechText(target.content));
  let only: number[] | undefined;
  if (body.section !== undefined) {
    const section = production.sections.find(s => s.index === body.section);
    if (!section) return errorResponse(new HttpError(400, "That section doesn't exist."));
    only = [section.index];
    if (body.direction && typeof body.direction === "object") {
      section.direction = normalizeDirection(body.direction, section.direction);
      section.directionSource = "edited";
    }
  }

  busy.add(target.id);
  const encoder = new TextEncoder();
  const ctl = new AbortController();
  req.signal.addEventListener("abort", () => ctl.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (data: unknown) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { open = false; }
      };
      const ping = setInterval(() => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { open = false; }
      }, 15_000);
      try {
        const personality = await personalityFor(ownerId).catch(() => undefined);
        const result = await runProduction({
          ownerId, production, only, keepDirection: only !== undefined, mood: target.meta.mood, personality, signal: ctl.signal,
          onProgress: progress => send({ type: "voice_progress", progress }),
        });
        const meta = { ...target.meta, voiceProduction: result.production };
        if (result.voice) { meta.voice = result.voice; delete meta.voiceError; }
        else if (result.failure) meta.voiceError = result.failure;
        // Saved even after a failure or a closed tab, so finished sections are never lost.
        await updateMessage(target.id, target.content, meta);
        send({ type: "done", message: { ...target, meta } });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        busy.delete(target.id);
        clearInterval(ping);
        open = false;
        try { controller.close(); } catch { /* closed */ }
      }
    },
    cancel() { ctl.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
