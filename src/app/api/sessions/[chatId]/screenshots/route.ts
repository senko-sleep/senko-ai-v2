import { requireChat } from "@/lib/server/chats";
import { q } from "@/lib/server/db";
import { route } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> the screenshot timeline for this chat's browser (newest last).
export const GET = route<{ params: Promise<{ chatId: string }> }>(async (_req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  const rows = await q<{ id: string; label: string; url: string; created_at: string }>(
    "SELECT id, label, url, created_at FROM (SELECT * FROM screenshots WHERE chat_id = $1 ORDER BY seq DESC LIMIT 500) t ORDER BY seq ASC",
    [chatId]
  );
  return Response.json({ shots: rows.map((r) => ({ id: r.id, label: r.label, url: r.url, at: r.created_at })) });
});
