import { NextRequest } from "next/server";
import { executeSearch } from "@/lib/search-orchestrator";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  const { results, log } = await executeSearch(query);

  // Return structured response with full cascade diagnostics
  if (results.length > 0) {
    return Response.json({
      results,
      query,
      resolvedBy: log.resolvedBy,
      totalTimeMs: log.totalTimeMs,
      attempts: log.attempts,
    });
  }

  // All fallbacks exhausted — return error payload with full diagnostics
  return Response.json({
    success: false,
    results: [],
    query,
    error: log.error,
    attempts: log.attempts,
    totalTimeMs: log.totalTimeMs,
  });
}
