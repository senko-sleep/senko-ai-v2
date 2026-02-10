import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const scrapeUrl = req.nextUrl.searchParams.get("url");

  if (!query && !scrapeUrl) {
    return Response.json({ error: "q or url required" }, { status: 400 });
  }

  const baseUrl = config.searchApiUrl;
  if (!baseUrl) {
    return Response.json({ error: "SEARCH_API_URL not configured", images: [] }, { status: 500 });
  }

  try {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (scrapeUrl) params.set("url", scrapeUrl);

    const res = await fetch(`${baseUrl}/images?${params.toString()}`, {
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : "Images API request failed",
      images: [],
    });
  }
}
