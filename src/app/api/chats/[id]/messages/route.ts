import { NextRequest } from "next/server";
import { addMessage, maybeTitle, requireChat, truncateMessagesFrom, type TruncateTarget } from "@/lib/server/chats";
import { errorResponse, HttpError, identify } from "@/lib/server/identity";
import { reply } from "@/lib/server/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST { content, imageIds?, provider?, record?, truncateFrom? }
 *  - normal: saves your message, streams the AI reply word by word (SSE), saves the reply.
 *  - record: { content, actions } just saves a reply the app produced itself (quick browser commands).
 *  - truncateFrom: { messageId?, index? } rewinds chat history from that message onward before saving.
 * SSE events: start {userMessageId, assistantMessageId, provider, providerLabel, model}
 *             delta {text} | done {message} | error {error, assistantMessageId}
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let who;
  let chatId: string;
  let body: {
    content?: string;
    imageIds?: string[];
    provider?: string;
    timeZone?: string;
    record?: { content: string; actions?: { url: string; label: string }[] };
    truncateFrom?: TruncateTarget;
  };
  try {
    who = await identify(req);
    chatId = (await params).id;
    await requireChat(who.ownerId, chatId);
    body = await req.json().catch(() => ({}));
  } catch (e) {
    return errorResponse(e);
  }

  const content = String(body.content || "").slice(0, 100_000);
  const imageIds = Array.isArray(body.imageIds) ? body.imageIds.filter((x) => typeof x === "string").slice(0, 20) : [];
  if (!content.trim() && !imageIds.length) return errorResponse(new HttpError(400, "Message is empty."));

  if (body.truncateFrom && typeof body.truncateFrom === "object") {
    await truncateMessagesFrom(chatId, body.truncateFrom);
  }

  if (body.record) {
    const userMessageId = await addMessage(chatId, "user", content, imageIds);
    await maybeTitle(chatId, content);
    const id = await addMessage(chatId, "assistant", String(body.record.content || ""), [], { actions: body.record.actions || [] });
    return Response.json({ userMessageId, assistantMessageId: id });
  }

  const encoder = new TextEncoder();
  const ctl = new AbortController();
  req.signal.addEventListener("abort", () => ctl.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          open = false;
        }
      }, 15_000);
      try {
        const message = await reply({
          ownerId: who.ownerId,
          chatId,
          content,
          imageIds,
          provider: body.provider,
          timeZone: typeof body.timeZone === "string" ? body.timeZone.slice(0, 64) : undefined,
          signal: ctl.signal,
          onStart: (info) => send({ type: "start", ...info }),
          onDelta: (text) => send({ type: "delta", text }),
          onImages: (info) => send({ type: "images", ...info }),
        });
        if (message.meta.error && !message.content) send({ type: "error", error: message.meta.error, assistantMessageId: message.id });
        else send({ type: "done", message });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(ping);
        open = false;
        try {
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
    cancel() {
      ctl.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
