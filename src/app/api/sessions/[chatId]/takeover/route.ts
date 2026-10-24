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
  let s = sessions.get(chatId);
  if (!s && (await sessions.status(chatId)).status !== "closed") s = await sessions.open(chatId, who.ownerId);
  if (!s) throw new HttpError(404, "The browser session isn't open.");
  const { on, resetInput, control, sessionId } = (await req.json().catch(() => ({}))) as { on?: boolean; resetInput?: boolean; control?: number; sessionId?: string };
  if (typeof on !== "boolean") throw new HttpError(400, "Specify whether to take control.");
  if (sessionId !== undefined && sessionId !== s.sessionId) return Response.json({ error: "The browser session changed.", code: "SESSION_CHANGED" }, { status: 409 });
  if (control !== undefined && control !== s.controlVersion) return Response.json({ error: "Browser control changed.", code: "STALE_CONTROL", control: s.controlVersion, epoch: s.viewEpoch, takeover: s.takeover }, { status: 409 });
  if (on) pauseAgentForTakeover(chatId);
  s.setTakeover(on, resetInput === true);
  return Response.json({ takeover: s.takeover, running: s.running, epoch: s.viewEpoch, control: s.controlVersion, sessionId: s.sessionId });
});
