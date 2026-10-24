import { json, q, q1 } from "@/lib/server/db";
import { normalizeSafeSearch } from "@/lib/content-policy";
import { route } from "@/lib/server/identity";
import { clearSuggestionCache } from "@/lib/server/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-owner settings (model choice, mode, live view on/off, ...), shared by linked devices.
export const GET = route(async (_req, who) => {
  const row = await q1<{ data: unknown }>("SELECT data FROM settings WHERE owner_id = $1", [who.ownerId]);
  return Response.json({ settings: json(row?.data, {}) });
});

export const PUT = route(async (req, who) => {
  const body = (await req.json().catch(() => ({}))) as { settings?: Record<string, unknown> };
  const incoming = body.settings && typeof body.settings === "object" ? body.settings : {};
  const row = await q1<{ data: unknown }>("SELECT data FROM settings WHERE owner_id = $1", [who.ownerId]);
  if ("safeSearch" in incoming) incoming.safeSearch = normalizeSafeSearch(incoming.safeSearch);
  const merged = { ...json<Record<string, unknown>>(row?.data, {}), ...incoming };
  await q(
    "INSERT INTO settings (owner_id, data) VALUES ($1, $2) ON CONFLICT (owner_id) DO UPDATE SET data = EXCLUDED.data",
    [who.ownerId, JSON.stringify(merged)]
  );
  // A changed personalization choice should show up on the next welcome screen right away.
  if ("personalizedSuggestions" in incoming) clearSuggestionCache(who.ownerId);
  return Response.json({ settings: merged });
});
