import { requireChat } from "@/lib/server/chats";
import { HttpError, route } from "@/lib/server/identity";
import { sessions } from "@/lib/agent/sessions";
import { pauseAgentForTakeover } from "@/lib/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { on: boolean } -> take control of the browser yourself (pauses the agent), or hand it back.
export const POST = route<{ params: Promise<{ chatId: string }> }>(async (req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  const s = sessions.get(chatId);
  if (!s) throw new HttpError(404, "The browser session isn't open.");
  const { on } = (await req.json().catch(() => ({}))) as { on?: boolean };
  if (on) pauseAgentForTakeover(chatId);
  s.setTakeover(!!on);
  return Response.json({ takeover: s.takeover });
});
