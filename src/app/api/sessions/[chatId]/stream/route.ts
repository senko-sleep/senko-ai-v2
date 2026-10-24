import { requireChat } from "@/lib/server/chats";
import { errorResponse, identify } from "@/lib/server/identity";
import { verifyLive } from "@/lib/auth-token";
import { sessions } from "@/lib/agent/sessions";
import { createLiveStream } from "@/lib/server/live-stream";
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
  const refreshRate = Number(req.nextUrl.searchParams.get("fps")) || undefined;
  const stream = createLiveStream(send => session.subscribe(send, refreshRate), req.signal);
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no", ...cors },
  });
}
