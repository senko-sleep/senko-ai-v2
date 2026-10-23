// Who is calling? Every API route resolves the device (from its signed cookie)
// to an "owner": the shared identity that linked devices have in common.
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, DEVICE_COOKIE, DEVICE_ID_RE, accessKey, signDevice, verifyDeviceToken } from "@/lib/auth-token";
import { newId, q, q1 } from "./db";

export interface Identity {
  deviceId: string;
  ownerId: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const lastSeenWrites = new Map<string, number>();

/** Make sure the device exists (creating its own owner the first time). */
export async function ensureDevice(deviceId: string): Promise<Identity> {
  const row = await q1<{ owner_id: string }>("SELECT owner_id FROM devices WHERE id = $1", [deviceId]);
  if (row) {
    const now = Date.now();
    if ((lastSeenWrites.get(deviceId) || 0) < now - 60_000) {
      lastSeenWrites.set(deviceId, now);
      await q("UPDATE devices SET last_seen = now() WHERE id = $1", [deviceId]);
    }
    return { deviceId, ownerId: row.owner_id };
  }
  const ownerId = newId("o_");
  await q("INSERT INTO owners (id) VALUES ($1) ON CONFLICT DO NOTHING", [ownerId]);
  await q("INSERT INTO devices (id, owner_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [deviceId, ownerId]);
  const again = await q1<{ owner_id: string }>("SELECT owner_id FROM devices WHERE id = $1", [deviceId]);
  return { deviceId, ownerId: again?.owner_id || ownerId };
}

/** Resolve the caller, or throw HttpError(401). */
export async function identify(req: NextRequest | Request): Promise<Identity> {
  const cookies = parseCookies(req.headers.get("cookie"));
  let deviceId: string | null = null;
  if (accessKey()) {
    deviceId = await verifyDeviceToken(cookies[AUTH_COOKIE]);
    if (!deviceId) throw new HttpError(401, "Enter your access key on this device first.");
  } else {
    const raw = cookies[DEVICE_COOKIE] || req.headers.get("x-device-id") || "";
    deviceId = DEVICE_ID_RE.test(raw) ? raw : null;
    if (!deviceId) throw new HttpError(401, "Missing device id. Reload the page.");
  }
  return ensureDevice(deviceId);
}

/** Wrap a route handler: resolves identity and turns thrown errors into JSON responses. */
export function route<Ctx>(
  handler: (req: NextRequest, who: Identity, ctx: Ctx) => Promise<Response>
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const who = await identify(req);
      return await handler(req, who, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error("[api]", e);
  const msg = e instanceof Error ? e.message : String(e);
  return Response.json({ error: `Server error: ${msg}` }, { status: 500 });
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Set-Cookie headers that mark this device as allowed in (10 years). */
export async function authCookies(deviceId: string, secure: boolean): Promise<string[]> {
  const age = 60 * 60 * 24 * 365 * 10;
  const flags = `Path=/; Max-Age=${age}; SameSite=Lax${secure ? "; Secure" : ""}`;
  return [
    `${AUTH_COOKIE}=${encodeURIComponent(await signDevice(deviceId))}; HttpOnly; ${flags}`,
    `${DEVICE_COOKIE}=${deviceId}; ${flags}`,
  ];
}

export function isSecure(req: Request): boolean {
  return (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")) === "https";
}

// Tiny in-memory brute-force guard for the access key / link code endpoints.
const attempts = new Map<string, { n: number; reset: number }>();
export function tooManyAttempts(req: Request, bucket: string, max = 10, windowMs = 10 * 60_000): boolean {
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  a.n++;
  return a.n > max;
}
