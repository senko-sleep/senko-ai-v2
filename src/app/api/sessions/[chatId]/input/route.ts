import type { NextRequest } from "next/server";
import { requireChat } from "@/lib/server/chats";
import { errorResponse, route } from "@/lib/server/identity";
import { verifyLive } from "@/lib/auth-token";
import { BrowserInputConflict, sessions } from "@/lib/agent/sessions";
import { INPUT_BATCH_SIZE, INPUT_PROTOCOL_VERSION, isBrowserInput } from "@/lib/live-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ chatId: string }> };

async function apply(chatId: string, req: NextRequest, ownerId?: string) {
  let s = sessions.get(chatId);
  if (!s && ownerId && (await sessions.status(chatId)).status !== "closed") s = await sessions.open(chatId, ownerId);
  if (!s) return Response.json({ error: "The browser session isn't open.", code: "SESSION_MISSING" }, { status: 404 });
  // Parsed whatever the content type: direct links send text/plain to skip the CORS preflight.
  const body: unknown = await req.json().catch(() => null);
  const events = body && typeof body === "object" && "events" in body ? body.events : [body];
  const protocol = body && typeof body === "object" && "protocol" in body ? body.protocol : undefined;
  if (protocol !== undefined && protocol !== INPUT_PROTOCOL_VERSION) {
    return Response.json({ error: "The browser input protocol changed. Reconnect the browser view.", code: "INPUT_PROTOCOL_MISMATCH", protocol: INPUT_PROTOCOL_VERSION }, { status: 409 });
  }
  if (!Array.isArray(events) || events.length === 0 || events.length > INPUT_BATCH_SIZE || !events.every(isBrowserInput)) {
    return Response.json({ error: "Invalid browser input payload.", code: "INVALID_INPUT" }, { status: 400 });
  }
  const epoch = body && typeof body === "object" && "epoch" in body ? body.epoch : undefined;
  const sessionId = body && typeof body === "object" && "sessionId" in body ? body.sessionId : undefined;
  if (sessionId !== undefined && sessionId !== s.sessionId) {
    return Response.json({ error: "The saved browser session was restored on another host. Reconnecting the view.", code: "SESSION_CHANGED" }, { status: 409 });
  }
  const control = body && typeof body === "object" && "control" in body ? body.control : undefined;
  if (control !== undefined && (!Number.isInteger(control) || control !== s.controlVersion)) {
    return Response.json({ error: "Browser control changed.", code: "STALE_CONTROL", epoch: s.viewEpoch, control: s.controlVersion, takeover: s.takeover }, { status: 409 });
  }
  if (epoch !== undefined && (!Number.isInteger(epoch) || epoch !== s.viewEpoch)) {
    return Response.json({ error: "The browser view changed. Input is ready on the current page.", code: "STALE_VIEW", epoch: s.viewEpoch }, { status: 409 });
  }
  // Repair idle ownership left behind by an older host or an interrupted task.
  const recoveredIdle = !s.takeover && !s.running;
  if (recoveredIdle) s.setTakeover(true);
  if (!s.takeover) return Response.json({ error: "The agent is using this browser. Take control to pause it.", code: "CONTROL_REQUIRED", epoch: s.viewEpoch }, { status: 409 });
  try {
    await s.inputBatch(events, epoch as number | undefined, recoveredIdle ? s.controlVersion : control as number | undefined);
  } catch (e) {
    if (e instanceof BrowserInputConflict) return Response.json({ error: e.message, code: e.code, epoch: e.epoch, control: e.control }, { status: 409 });
    throw e;
  }
  return Response.json({ ok: true, epoch: s.viewEpoch, control: s.controlVersion, takeover: s.takeover });
}

const viaHost = route<Ctx>(async (req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  return apply(chatId, req, who.ownerId);
});

// POST InputEvent -> your own clicks/typing in the live view (takeover mode).
// ?t= is the signed direct link from /live (cross-origin, straight to the agent computer).
export async function POST(req: NextRequest, ctx: Ctx) {
  const t = req.nextUrl.searchParams.get("t");
  if (!t) return viaHost(req, ctx);
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const { chatId } = await ctx.params;
    if (!(await verifyLive(t, chatId))) return Response.json({ error: "This live link expired." }, { status: 401, headers: cors });
    const res = await apply(chatId, req);
    res.headers.set("Access-Control-Allow-Origin", "*");
    return res;
  } catch (e) {
    const res = errorResponse(e);
    res.headers.set("Access-Control-Allow-Origin", "*");
    return res;
  }
}
