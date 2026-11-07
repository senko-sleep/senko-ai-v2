import { route } from "@/lib/server/identity";
import { runCodingResearch } from "@/lib/agent/coding-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async (req) => {
  const body = await req.json().catch(() => null) as { tool?: unknown; url?: unknown; query?: unknown } | null;
  const op = body?.tool === "fetch" && typeof body.url === "string" ? { op: "fetch" as const, url: body.url } :
    (body?.tool === "search" || body?.tool === "youtube") && typeof body.query === "string" && body.query.trim() ? { op: body.tool as "search" | "youtube", query: body.query.slice(0, 500) } : null;
  if (!op) return Response.json({ error: "A supported tool with valid arguments is required." }, { status: 400 });
  try { return Response.json(await runCodingResearch(op, req.signal)); }
  catch (error) { return Response.json({ ok: false, result: `Lookup failed: ${error instanceof Error ? error.message : String(error)}`, sources: [] }); }
});
