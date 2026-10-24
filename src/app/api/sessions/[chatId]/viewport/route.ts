import { requireChat } from "@/lib/server/chats";
import { HttpError, route } from "@/lib/server/identity";
import { sessions } from "@/lib/agent/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { width, height } -> size the real browser page to the live view panel (CSS px).
export const POST = route<{ params: Promise<{ chatId: string }> }>(async (req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  const { width, height } = (await req.json().catch(() => ({}))) as { width?: number; height?: number };
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new HttpError(400, "Specify width and height.");
  const s = sessions.get(chatId);
  if (!s) return Response.json({ ok: false, code: "SESSION_MISSING" });
  await s.setViewport(width!, height!);
  return Response.json({ ok: true, viewport: s.viewport() });
});
