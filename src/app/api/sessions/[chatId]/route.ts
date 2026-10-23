import { requireChat } from "@/lib/server/chats";
import { route } from "@/lib/server/identity";
import { liveInfo, sessions } from "@/lib/agent/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ chatId: string }> };

// GET -> { status: active|restoring|suspended|closed, tabs, live }
export const GET = route<Ctx>(async (_req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  return Response.json({ ...(await sessions.status(chatId)), live: liveInfo() });
});

// POST { action: "open" | "new" } -> opens (restoring if saved) or starts a fresh session.
export const POST = route<Ctx>(async (req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const s = await sessions.open(chatId, who.ownerId, { fresh: action === "new" });
  return Response.json({ status: s.status, tabs: await s.tabs(), live: liveInfo() });
});

// DELETE -> closes the browser for this chat and forgets its saved state.
export const DELETE = route<Ctx>(async (_req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  await sessions.close(chatId);
  return Response.json({ status: "closed" });
});
