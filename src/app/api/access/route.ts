import { NextRequest } from "next/server";
import { DEVICE_ID_RE, accessKey, safeEqual } from "@/lib/auth-token";
import { authCookies, ensureDevice, errorResponse, isSecure, tooManyAttempts } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { key, deviceId } -> remembers this device (cookie) if the access key is right.
export async function POST(req: NextRequest) {
  try {
    if (tooManyAttempts(req, "access")) {
      return Response.json({ error: "Too many tries. Wait 10 minutes and try again." }, { status: 429 });
    }
    const { key, deviceId } = (await req.json().catch(() => ({}))) as { key?: string; deviceId?: string };
    if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
      return Response.json({ error: "Invalid device id. Reload the page." }, { status: 400 });
    }
    const required = accessKey();
    if (required && !safeEqual(String(key || "").trim(), required)) {
      return Response.json({ error: "That access key isn't right." }, { status: 401 });
    }
    await ensureDevice(deviceId);
    const headers = new Headers({ "Content-Type": "application/json" });
    for (const c of await authCookies(deviceId, isSecure(req))) headers.append("Set-Cookie", c);
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
