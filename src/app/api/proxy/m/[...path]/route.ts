// Proxied scripts at a path that mirrors the site's own: /api/proxy/m/<token>/<origin>/<path>.
// A module loaded from here resolves its relative imports ("./chunk-123.js") to this route too,
// instead of to our own server. Same handling as /api/proxy?asset=1&url=...
import { NextRequest } from "next/server";
import { GET as proxyGet } from "../../route";
import { scriptPathTarget } from "@/lib/server/proxy-rewrite";
import { PROXY_TOKEN_PARAM } from "@/lib/auth-token";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const target = scriptPathTarget(req.nextUrl.pathname, req.nextUrl.search);
  if (!target) return new Response("bad script path", { status: 400 });
  const q = new URLSearchParams({ asset: "1", ref: new URL(target.url).origin, url: target.url });
  if (target.token !== "_") q.set(PROXY_TOKEN_PARAM, target.token);
  return proxyGet(new NextRequest(new URL(`/api/proxy?${q}`, req.url), { headers: req.headers, signal: req.signal }));
}
