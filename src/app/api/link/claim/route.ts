import { NextRequest } from "next/server";
import { DEVICE_ID_RE } from "@/lib/auth-token";
import { q, q1 } from "@/lib/server/db";
import { authCookies, ensureDevice, errorResponse, isSecure, tooManyAttempts } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { code, deviceId } -> joins this device to the owner that made the code.
// A valid code also counts as the access key, since only an allowed device can create one.
export async function POST(req: NextRequest) {
  try {
    if (tooManyAttempts(req, "link")) {
      return Response.json({ error: "Too many tries. Wait 10 minutes and try again." }, { status: 429 });
    }
    const { code, deviceId } = (await req.json().catch(() => ({}))) as { code?: string; deviceId?: string };
    if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
      return Response.json({ error: "Invalid device id. Reload the page." }, { status: 400 });
    }
    const clean = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const row = await q1<{ owner_id: string }>("SELECT owner_id FROM link_codes WHERE code = $1 AND expires_at > now()", [clean]);
    if (!row) return Response.json({ error: "That code is wrong or expired. Make a new one on your other device." }, { status: 400 });

    const me = await ensureDevice(deviceId);
    if (me.ownerId !== row.owner_id) {
      // Bring along anything this device already had, if no other device shares it.
      const others = await q1<{ n: number }>("SELECT count(*)::int AS n FROM devices WHERE owner_id = $1 AND id <> $2", [me.ownerId, deviceId]);
      if (!others?.n) {
        for (const table of ["chats", "images", "browser_sessions"]) {
          await q(`UPDATE ${table} SET owner_id = $1 WHERE owner_id = $2`, [row.owner_id, me.ownerId]);
        }
      }
      await q("UPDATE devices SET owner_id = $1 WHERE id = $2", [row.owner_id, deviceId]);
    }
    await q("DELETE FROM link_codes WHERE code = $1", [clean]);

    const headers = new Headers({ "Content-Type": "application/json" });
    for (const c of await authCookies(deviceId, isSecure(req))) headers.append("Set-Cookie", c);
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
