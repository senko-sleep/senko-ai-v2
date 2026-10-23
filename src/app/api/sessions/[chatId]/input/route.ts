import { requireChat } from "@/lib/server/chats";
import { HttpError, route } from "@/lib/server/identity";
import { sessions, type InputEvent } from "@/lib/agent/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST InputEvent -> your own clicks/typing in the live view (takeover mode).
export const POST = route<{ params: Promise<{ chatId: string }> }>(async (req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  const s = sessions.get(chatId);
  if (!s) throw new HttpError(404, "The browser session isn't open.");
  if (!s.takeover) throw new HttpError(409, "Press “Take control” first.");
  const ev = (await req.json().catch(() => null)) as InputEvent | null;
  if (!ev || typeof ev.type !== "string") throw new HttpError(400, "Bad input event.");
  await s.input(ev);
  return Response.json({ ok: true });
});
