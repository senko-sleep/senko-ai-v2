import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, PROXY_TOKEN_PARAM, accessKey, liveToken, verifyDeviceToken, verifyProxyToken } from "@/lib/auth-token";

// Gate for every API call: when APP_ACCESS_KEY is set, the device must have
// entered it once (signed cookie). Pages themselves load freely; the app shows
// the access-key screen when the API says 401.
const PUBLIC_API = new Set(["/api/health", "/api/access", "/api/link/claim", "/api/me"]);
const SIGNED_LIVE_PATH = /^\/api\/sessions\/[^/]+\/(stream|input)$/;
const PROXY_PATH = /^\/api\/(?:proxy|video-proxy)$/;

// Calls that need the real browser. With AGENT_HOST=sandbox they go to the agent
// computer (a Vercel Sandbox running this same app); see src/lib/server/agent-host.ts.
const AGENT_PATH = /^\/api\/(chats\/[^/]+\/agent(\/.*)?|sessions\/.+)$/;

// Hosts that can't run a browser at all (Wasmer, plain Vercel) hand every browser call,
// plus the "wake the agent computer" call, to a deploy that can (AGENT_BACKEND_URL).
// Read at runtime, unlike next.config rewrites, so it works with prebuilt bundles.
const BACKEND_PATH = /^\/api\/(chats\/[^/]+\/agent(\/.*)?|sessions\/.+|agent-host)$/;

async function forwardToAgentHost(req: NextRequest): Promise<NextResponse | null> {
  const backend = (process.env.AGENT_BACKEND_URL || "").trim().replace(/\/+$/, "");
  if (backend && process.env.AGENT_HOST !== "sandbox" && BACKEND_PATH.test(req.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, backend));
  }
  if (process.env.AGENT_HOST !== "sandbox" || !AGENT_PATH.test(req.nextUrl.pathname)) return null;
  const { currentHost } = await import("@/lib/server/agent-host");
  const host = await currentHost().catch(() => null);
  if (!host) {
    return NextResponse.json(
      { error: "The agent computer is asleep. Starting it…", needsHost: true },
      { status: 503, headers: { "Retry-After": "2" } }
    );
  }
  return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, host.url));
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // The stream and input handlers validate the chat-scoped token on direct links.
  const signedLive = SIGNED_LIVE_PATH.test(path) && (req.method === "OPTIONS" || liveToken(req));
  // Sandboxed embed pages send no cookie; their proxy requests carry a signed token instead.
  const signedProxy = PROXY_PATH.test(path) && (await verifyProxyToken(req.nextUrl.searchParams.get(PROXY_TOKEN_PARAM)));
  if (accessKey() && path.startsWith("/api/") && !PUBLIC_API.has(path) && !signedLive && !signedProxy) {
    const deviceId = await verifyDeviceToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!deviceId) {
      return NextResponse.json({ error: "Enter your access key on this device first.", needsKey: true }, { status: 401 });
    }
  }
  const forwarded = await forwardToAgentHost(req);
  if (forwarded) return forwarded;
  const response = NextResponse.next();
  response.headers.set("x-senko-proxy", "1");
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
