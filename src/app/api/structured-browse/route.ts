import { NextRequest } from "next/server";
import { validateOrReject } from "@/lib/url-validator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  const ssrfBlock = validateOrReject(url);
  if (ssrfBlock) return ssrfBlock;

  // Proxy to Render search-api
  const searchApiUrl = process.env.SEARCH_API_URL;
  if (!searchApiUrl) {
    return Response.json({ error: "SEARCH_API_URL not configured" }, { status: 500 });
  }

  try {
    const proxyRes = await fetch(`${searchApiUrl}/structured-browse?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(35000),
    });

    if (!proxyRes.ok) {
      const errorText = await proxyRes.text().catch(() => "Unknown error");
      return Response.json({ error: `Upstream error: ${proxyRes.status}`, details: errorText, url }, { status: proxyRes.status });
    }

    const data = await proxyRes.json();
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message, url }, { status: 500 });
  }
}
