import { createChat, listChats } from "@/lib/server/chats";
import { route } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, who) => {
  const chats = await listChats(who.ownerId);
  return Response.json({ chats: chats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at })) });
});

export const POST = route(async (req, who) => {
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  return Response.json({ chat: await createChat(who.ownerId, title || "New chat") });
});
