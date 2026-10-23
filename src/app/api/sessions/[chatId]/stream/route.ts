import { requireChat } from "@/lib/server/chats";
import { errorResponse, identify } from "@/lib/server/identity";
import { verifyLive } from "@/lib/auth-token";
import { sessions, type BusEvent } from "@/lib/agent/sessions";
import type { NextRequest } from "next/server";
import { forwardAgentRequest } from "@/lib/server/agent-forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET (SSE) -> live view: frames, cursor, tabs/status, steps, logs, screenshots.
// ?restore=1 reopens a saved session (after a restart or eviction) before streaming.
export async function GET(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const forwarded = await forwardAgentRequest(req);
  if (forwarded) return forwarded;
  let s;
  // ?t= is a signed direct link from /live (cross-origin, no cookies): it names the chat and owner.
  const live = req.nextUrl.searchParams.get("t");
  const cors: Record<string, string> = live ? { "Access-Control-Allow-Origin": "*" } : {};
  try {
    const { chatId } = await params;
    let ownerId: string;
    if (live) {
      const owner = await verifyLive(live, chatId);
      if (!owner) return Response.json({ error: "This live link expired. Reopen the browser panel." }, { status: 401, headers: cors });
      ownerId = owner;
    } else {
      ownerId = (await identify(req)).ownerId;
      await requireChat(ownerId, chatId);
    }
    s = sessions.get(chatId);
    if (!s && req.nextUrl.searchParams.get("restore") === "1") {
      const st = await sessions.status(chatId);
      if (st.status !== "closed") s = await sessions.open(chatId, ownerId);
    }
    if (!s) return Response.json({ error: "No open browser session for this chat." }, { status: 404, headers: cors });
  } catch (e) {
    return errorResponse(e);
  }

  const session = s;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (e: BusEvent | { type: "ping" }) => {
        if (!open) return;
        // Viewer falling behind (slow network): skip this frame rather than queue it,
        // so what you see stays live instead of drifting seconds behind.
        if (e.type === "frame" && controller.desiredSize !== null && controller.desiredSize <= -4) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          open = false;
          unsubscribe();
        }
      };
      unsubscribe = session.subscribe(send);
      ping = setInterval(() => send({ type: "ping" }), 20_000);
      req.signal.addEventListener("abort", () => {
        open = false;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
    cancel() {
      clearInterval(ping);
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no", ...cors },
  });
}
