import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  const baseUrl = config.searchApiUrl;
  if (!baseUrl) {
    return Response.json({ error: "SEARCH_API_URL not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/screenshot?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : "Screenshot failed",
    }, { status: 500 });
  }
}
