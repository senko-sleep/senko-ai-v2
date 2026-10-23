import { q } from "@/lib/server/db";
import { route } from "@/lib/server/identity";
import { memoriesFor } from "@/lib/server/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What Senko remembers about you ([MEMORY:key:value] facts), shared across your devices.
export const GET = route(async (_req, who) => Response.json({ memories: await memoriesFor(who.ownerId) }));

// DELETE ?key=name -> forget one fact; no key -> forget everything.
export const DELETE = route(async (req, who) => {
  const key = req.nextUrl.searchParams.get("key");
  if (key) await q("DELETE FROM memories WHERE owner_id = $1 AND key = $2", [who.ownerId, key]);
  else await q("DELETE FROM memories WHERE owner_id = $1", [who.ownerId]);
  return Response.json({ ok: true });
});
