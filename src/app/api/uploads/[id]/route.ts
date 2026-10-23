import { q1, toBuffer } from "@/lib/server/db";
import { HttpError, route } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, who, { params }) => {
  const { id } = await params;
  const row = await q1<{ mime: string; data: unknown }>("SELECT mime, data FROM images WHERE id = $1 AND owner_id = $2", [id, who.ownerId]);
  if (!row) throw new HttpError(404, "Image not found.");
  return new Response(new Uint8Array(toBuffer(row.data)), {
    headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=31536000, immutable" },
  });
});
