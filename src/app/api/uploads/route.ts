import { saveImage } from "@/lib/server/chats";
import { HttpError, route } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { mime, data (base64) } -> { id }. The app shrinks photos before uploading.
export const POST = route(async (req, who) => {
  const { mime, data } = (await req.json().catch(() => ({}))) as { mime?: string; data?: string };
  if (!mime || !data) throw new HttpError(400, "mime and data are required");
  const buf = Buffer.from(data.replace(/^data:[^,]+,/, ""), "base64");
  return Response.json({ id: await saveImage(who.ownerId, mime, buf) });
});
