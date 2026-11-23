import { requireChat } from "@/lib/server/chats";
import { HttpError, route } from "@/lib/server/identity";
import { sessions } from "@/lib/agent/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { on } -> turn the live view's element annotations on or off. The browser keeps running.
export const POST = route<{ params: Promise<{ chatId: string }> }>(async (req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  const { on } = (await req.json().catch(() => ({}))) as { on?: unknown };
  if (typeof on !== "boolean") throw new HttpError(400, "Specify on as true or false.");
  const s = sessions.get(chatId);
  if (!s || s.ownerId !== who.ownerId) return Response.json({ ok: false, code: "SESSION_MISSING" });
  s.setAnnotations(on);
  return Response.json({ ok: true, on });
});
