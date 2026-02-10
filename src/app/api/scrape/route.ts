import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  const baseUrl = config.searchApiUrl;
  if (!baseUrl) {
    return Response.json({ error: "SEARCH_API_URL not configured", content: "" }, { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/scrape?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : "Scrape API request failed",
      content: "",
    });
  }
}
