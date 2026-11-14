import { q1, toBuffer } from "@/lib/server/db";
import { HttpError, route } from "@/lib/server/identity";
import { byteRange } from "@/lib/server/byte-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Uploaded images and Senko's voice messages. Audio answers Range requests: Safari won't play
// (and no browser can seek) an <audio> source without them.
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, who, { params }) => {
  const { id } = await params;
  const row = await q1<{ mime: string; data: unknown }>("SELECT mime, data FROM images WHERE id = $1 AND owner_id = $2", [id, who.ownerId]);
  if (!row) throw new HttpError(404, "File not found.");
  const data = toBuffer(row.data);
  const headers: Record<string, string> = { "Content-Type": row.mime, "Cache-Control": "private, max-age=31536000, immutable", "Accept-Ranges": "bytes" };
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const r = byteRange(rangeHeader, data.length);
    if (!r) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${data.length}` } });
    const [start, end] = r;
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.length) } });
});
