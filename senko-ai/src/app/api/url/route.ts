import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const raw = req.nextUrl.searchParams.get("raw");
  const maxContent = req.nextUrl.searchParams.get("maxContent");

  if (!url) {
    return Response.json({ error: "url parameter required. Usage: /api/url?url=https://example.com" }, { status: 400 });
  }

  const baseUrl = config.searchApiUrl;
  if (!baseUrl) {
    return Response.json({ error: "SEARCH_API_URL not configured" }, { status: 500 });
  }

  try {
    const params = new URLSearchParams({ url });
    if (raw) params.set("raw", raw);
    if (maxContent) params.set("maxContent", maxContent);

    const res = await fetch(`${baseUrl}/url?${params.toString()}`, {
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message, url }, { status: 500 });
  }
}
