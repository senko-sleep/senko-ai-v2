import { requireChat } from "@/lib/server/chats";
import { route } from "@/lib/server/identity";
import { signedLiveEnabled, signLive } from "@/lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ chatId: string }> };

// GET -> { url } a direct live-view stream link on the agent computer, or { url: null }
// to use the normal /stream path. On Wasmer this request is forwarded to the agent
// computer, so the link it returns points straight at the machine running the browser.
export const GET = route<Ctx>(async (req, who, { params }) => {
  const { chatId } = await params;
  await requireChat(who.ownerId, chatId);
  if (!signedLiveEnabled()) return Response.json({ url: null });
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) return Response.json({ url: null });
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = process.env.AGENT_PUBLIC_URL?.trim().replace(/\/+$/, "") || `${proto}://${host}`;
  const token = await signLive(chatId, who.ownerId, Date.now() + 10 * 60_000);
  return Response.json({ url: `${origin}/api/sessions/${chatId}/stream?t=${encodeURIComponent(token)}` });
});
