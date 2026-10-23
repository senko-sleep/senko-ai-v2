import { q } from "@/lib/server/db";
import { route } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No look-alike characters (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// POST -> a short code another device can enter (or scan as a QR link) to share this history.
export const POST = route(async (req, who) => {
  await q("DELETE FROM link_codes WHERE expires_at < now() OR owner_id = $1", [who.ownerId]);
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  await q("INSERT INTO link_codes (code, owner_id, expires_at) VALUES ($1, $2, now() + interval '10 minutes')", [
    code,
    who.ownerId,
  ]);
  const origin = req.headers.get("x-forwarded-host")
    ? `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("x-forwarded-host")}`
    : new URL(req.url).origin;
  return Response.json({ code, url: `${origin}/?link=${code}`, expiresInSec: 600 });
});
