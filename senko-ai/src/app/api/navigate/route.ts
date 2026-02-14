import { NextRequest } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const click = req.nextUrl.searchParams.get("click");

  if (!url) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
  }
  if (!click) {
    return Response.json({ error: "click parameter required" }, { status: 400 });
  }

  const baseUrl = config.searchApiUrl;
  if (!baseUrl) {
    return Response.json({ error: "SEARCH_API_URL not configured" }, { status: 500 });
  }

  try {
    const params = new URLSearchParams({ url, click });
    const res = await fetch(`${baseUrl}/navigate?${params.toString()}`, {
      signal: AbortSignal.timeout(40000),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message, url }, { status: 500 });
  }
}
