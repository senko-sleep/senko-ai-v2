import { HttpError, route } from "@/lib/server/identity";
import { screenshotData } from "@/lib/agent/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ params: Promise<{ chatId: string; shotId: string }> }>(async (_req, who, { params }) => {
  const { chatId, shotId } = await params;
  const data = await screenshotData(chatId, who.ownerId, shotId);
  if (!data) throw new HttpError(404, "Screenshot not found.");
  return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
});
