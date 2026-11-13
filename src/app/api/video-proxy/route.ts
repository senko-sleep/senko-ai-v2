import { NextRequest } from "next/server";
import { config } from "@/lib/config";
import { validateOrReject } from "@/lib/url-validator";
import { rewritePlaylist } from "@/lib/chat-video";
import { withProxyToken } from "@/lib/server/proxy-rewrite";
import { PROXY_TOKEN_PARAM } from "@/lib/auth-token";

export const runtime = "nodejs";
export const maxDuration = 60;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
// Media only: never let a response render as a page on our address.
const CORS = {
  "Content-Security-Policy": "sandbox",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};

const isPlaylist = (url: string, type: string | null) => /mpegurl/i.test(type || "") || /\.m3u8(?:[?#]|$)/i.test(url);

/** Fetch the video ourselves, as if the page it came from were playing it. */
async function direct(req: NextRequest, url: string, referer?: string): Promise<Response> {
  let origin = "";
  try {
    origin = new URL(referer || url).origin;
  } catch {
    /* bad referer: send none */
  }
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9" };
  if (referer) headers.Referer = referer;
  if (origin) headers.Origin = origin;
  const range = req.headers.get("range");
  if (range) headers.Range = range;

  const upstream = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(55_000) });
  if (validateOrReject(upstream.url || url)) return Response.json({ error: "Redirected to a blocked address" }, { status: 400 });
  if (!upstream.ok && upstream.status !== 206) return Response.json({ error: `Upstream returned ${upstream.status}` }, { status: upstream.status, headers: CORS });

  const type = upstream.headers.get("content-type");
  if (isPlaylist(url, type)) {
    // Keep the embed's signed token on every piece, for streams inside sandboxed embeds.
    const body = withProxyToken(rewritePlaylist(await upstream.text(), upstream.url || url, referer), req.nextUrl.searchParams.get(PROXY_TOKEN_PARAM) || undefined);
    return new Response(body, { status: 200, headers: { ...CORS, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
  }
  const out = new Headers(CORS);
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has("accept-ranges")) out.set("Accept-Ranges", "bytes");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const referer = req.nextUrl.searchParams.get("referer") || undefined;
  if (!url) return Response.json({ error: "url parameter required" }, { status: 400 });

  // SSRF protection
  const ssrfBlock = validateOrReject(url);
  if (ssrfBlock) return ssrfBlock;

  const baseUrl = config.searchApiUrl;
  try {
    // We know the page the video came from (agent-sent videos), or there's no search API: fetch it here.
    if (referer || !baseUrl) return await direct(req, url, referer);

    const headers: Record<string, string> = {};
    // Forward Range header for seeking
    const range = req.headers.get("range");
    if (range) headers["Range"] = range;

    const upstream = await fetch(`${baseUrl}/video-proxy?url=${encodeURIComponent(url)}`, {
      headers,
      signal: AbortSignal.timeout(55000),
    });

    if (!upstream.ok && upstream.status !== 206) {
      return Response.json({ error: `Upstream returned ${upstream.status}` }, { status: upstream.status });
    }

    const responseHeaders = new Headers(CORS);
    const contentType = upstream.headers.get("content-type");
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (contentType) responseHeaders.set("Content-Type", contentType);
    if (contentLength) responseHeaders.set("Content-Length", contentLength);
    if (contentRange) responseHeaders.set("Content-Range", contentRange);
    if (acceptRanges) responseHeaders.set("Accept-Ranges", acceptRanges);

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
    },
  });
}
