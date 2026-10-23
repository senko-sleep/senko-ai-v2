import type { NextRequest } from "next/server";
import { requireChat } from "@/lib/server/chats";
import { HttpError, errorResponse, route } from "@/lib/server/identity";
import { verifyLive } from "@/lib/auth-token";
import { sessions, type InputEvent } from "@/lib/agent/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ chatId: string }> };

async function apply(chatId: string, req: NextRequest) {
  const s = sessions.get(chatId);
  if (!s) throw new HttpError(404, "The browser session isn't open.");
  if (!s.takeover) throw new HttpError(409, "Press “Take control” first.");
  // Parsed whatever the content type: direct links send text/plain to skip the CORS preflight.
  const ev = (await req.json().catch(() => null)) as InputEvent | null;
  if (!ev || typeof ev.type !== "string") throw new HttpError(400, "Bad input event.");
  await s.input(ev);
  return Response.json({ ok: true });
}

const viaHost = route<Ctx>(async (req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  return apply(chatId, req);
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
