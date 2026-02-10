import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  const baseUrl = config.searchApiUrl;
  if (!baseUrl) {
    return Response.json({ error: "SEARCH_API_URL not configured", results: [] }, { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : "Search API request failed",
      results: [],
    });
  }
}
