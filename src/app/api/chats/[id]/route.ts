import { getMessages, requireChat } from "@/lib/server/chats";
import { q } from "@/lib/server/db";
import { route } from "@/lib/server/identity";
import { sessions } from "@/lib/agent/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, who, { params }) => {
  const { id } = await params;
  const chat = await requireChat(who.ownerId, id);
  return Response.json({ chat, messages: await getMessages(id) });
});

export const PATCH = route<Ctx>(async (req, who, { params }) => {
  const { id } = await params;
  await requireChat(who.ownerId, id);
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  if (title?.trim()) await q("UPDATE chats SET title = $2 WHERE id = $1", [id, title.trim().slice(0, 120)]);
  return Response.json({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, who, { params }) => {
  const { id } = await params;
  await requireChat(who.ownerId, id);
  await sessions.close(id).catch(() => {});
  for (const sql of [
    "DELETE FROM messages WHERE chat_id = $1",
    "DELETE FROM screenshots WHERE chat_id = $1",
    "DELETE FROM browser_sessions WHERE chat_id = $1",
    "DELETE FROM chats WHERE id = $1",
  ]) {
    await q(sql, [id]);
  }
  return Response.json({ ok: true });
});
