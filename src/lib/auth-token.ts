// Signed device tokens, usable from both the proxy and route handlers (Web Crypto only).
// Token format: "<deviceId>.<base64url HMAC-SHA256(deviceId)>".

export const DEVICE_COOKIE = "senko_device";
export const AUTH_COOKIE = "senko_auth";
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** The private access key. Unset = the app is open (fine for local dev only). */
export function accessKey(): string {
  return (process.env.APP_ACCESS_KEY || process.env.APP_PASSWORD || "").trim();
}

function secret(): string {
  // Changing the access key signs everyone out, which is what you'd want.
  return (process.env.SESSION_SECRET || "").trim() || `senko:${accessKey()}`;
}

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signDevice(deviceId: string): Promise<string> {
  return `${deviceId}.${await hmac(deviceId)}`;
}

/** Returns the device id if the token is valid, else null. */
export async function verifyDeviceToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  if (!DEVICE_ID_RE.test(id)) return null;
  const expected = await hmac(id);
  const given = token.slice(dot + 1);
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? id : null;
}

// ---- Live-view links ---------------------------------------------------------------
// The agent computer hands the viewer a short-lived link so the browser can read live
// frames straight from it (no extra hop through the main host, which caused lag).
// Minted and checked on the same machine, so DATABASE_URL works as a fallback secret.

async function liveMac(data: string): Promise<string> {
  const enc = new TextEncoder();
  const raw = (process.env.SESSION_SECRET || "").trim() || `live:${process.env.DATABASE_URL || ""}:${accessKey()}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`live:${data}`)));
}

/** Token for streaming one chat's live view until `expiresAt` (ms). */
export async function signLive(chatId: string, ownerId: string, expiresAt: number): Promise<string> {
  const body = `${chatId}.${ownerId}.${expiresAt}`;
  return `${body}.${await liveMac(body)}`;
}

/** Returns the owner id if the token is valid for this chat and not expired, else null. */
export async function verifyLive(token: string | null, chatId: string): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [chat, owner, exp, mac] = parts;
  if (chat !== chatId || !(Number(exp) > Date.now())) return null;
  return safeEqual(mac, await liveMac(`${chat}.${owner}.${exp}`)) ? owner : null;
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
