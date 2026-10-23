import { route } from "@/lib/server/identity";
import { getSuggestions } from "@/lib/server/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET ?mode=chat|agent&refresh=1&provider=id&hour=0-23&weekday=Monday -> AI-written conversation starters.
// Personalization follows the owner's "personalizedSuggestions" setting (on by default).
export const GET = route(async (req, who) => {
  const p = req.nextUrl.searchParams;
  const result = await getSuggestions(who.ownerId, {
    mode: p.get("mode") === "agent" ? "agent" : "chat",
    refresh: p.get("refresh") === "1",
    provider: p.get("provider") || undefined,
    // The viewer's own clock, so "tonight" ideas show up at night for them.
    local: {
      hour: p.has("hour") ? Math.min(23, Math.max(0, Number(p.get("hour")) || 0)) : undefined,
      weekday: /^[A-Za-z]{3,12}$/.test(p.get("weekday") || "") ? p.get("weekday")! : undefined,
    },
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});
