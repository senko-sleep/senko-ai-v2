import { requireChat } from "@/lib/server/chats";
import { route } from "@/lib/server/identity";
import { stopRun } from "@/lib/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST -> stop the agent for this chat (the browser session stays open).
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, who, { params }) => {
  const { id } = await params;
  await requireChat(who.ownerId, id);
  return Response.json({ stopped: stopRun(id) });
});
