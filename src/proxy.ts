import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, accessKey, verifyDeviceToken } from "@/lib/auth-token";

// Gate for every API call: when APP_ACCESS_KEY is set, the device must have
// entered it once (signed cookie). Pages themselves load freely; the app shows
// the access-key screen when the API says 401.
const PUBLIC_API = new Set(["/api/health", "/api/access", "/api/link/claim", "/api/me"]);

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
  if (accessKey() && path.startsWith("/api/") && !PUBLIC_API.has(path)) {
    const deviceId = await verifyDeviceToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!deviceId) {
      return NextResponse.json({ error: "Enter your access key on this device first.", needsKey: true }, { status: 401 });
    }
  }
  return (await forwardToAgentHost(req)) ?? NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
