import { requireChat } from "@/lib/server/chats";
import { HttpError, route } from "@/lib/server/identity";
import { httpSession } from "@/lib/agent/http-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// GET -> the page this chat's HTTP browser is on (reader view), or { page: null }.
export const GET = route<Ctx>(async (_req, who, { params }) => {
  const { id } = await params;
  await requireChat(who.ownerId, id);
  return Response.json({ page: httpSession(id).current() });
});

// POST { op: "goto" | "click" | "submit" | "back", url?, link?, form?, values? } -> { page }
// Your own clicks in the reader view, on the same session the agent uses.
export const POST = route<Ctx>(async (req, who, { params }) => {
  const { id } = await params;
  await requireChat(who.ownerId, id);
  const b = (await req.json().catch(() => null)) as { op?: string; url?: string; link?: number; form?: number; values?: Record<string, string> } | null;
  if (!b?.op) throw new HttpError(400, "Say what to do.");
  const web = httpSession(id);
  try {
    let page;
    if (b.op === "goto" && b.url) page = await web.goto(String(b.url).trim(), req.signal);
    else if (b.op === "click" && Number.isFinite(Number(b.link))) page = await web.click(Number(b.link), req.signal);
    else if (b.op === "submit" && Number.isFinite(Number(b.form))) {
      const values = Object.fromEntries(Object.entries(b.values || {}).map(([k, v]) => [k, String(v)]));
      page = await web.submit(Number(b.form), values, req.signal);
    } else if (b.op === "back") page = web.back();
    else throw new HttpError(400, "Unknown action.");
    return Response.json({ page });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, e instanceof Error ? e.message : String(e));
  }
});
