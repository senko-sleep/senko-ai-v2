import { NextRequest } from "next/server";
import { accessKey } from "@/lib/auth-token";
import { errorResponse, HttpError, identify } from "@/lib/server/identity";
import { q } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> who am I? 401 { needsKey: true } when this device hasn't entered the access key yet.
export async function GET(req: NextRequest) {
  try {
    const who = await identify(req);
    const devices = await q<{ id: string; last_seen: string }>(
      "SELECT id, last_seen FROM devices WHERE owner_id = $1 ORDER BY last_seen DESC",
      [who.ownerId]
    );
    return Response.json({
      deviceId: who.deviceId,
      accessKeyRequired: !!accessKey(),
      devices: devices.map((d) => ({ id: d.id.slice(0, 6), lastSeen: d.last_seen, current: d.id === who.deviceId })),
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      return Response.json({ error: e.message, needsKey: !!accessKey() }, { status: 401 });
    }
    return errorResponse(e);
  }
}
