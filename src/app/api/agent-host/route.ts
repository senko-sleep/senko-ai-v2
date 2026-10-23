import { NextRequest } from "next/server";
import { errorResponse, identify } from "@/lib/server/identity";
import { currentHost, ensureHost, sandboxMode } from "@/lib/server/agent-host";
import { forwardAgentRequest } from "@/lib/server/agent-forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET -> is the agent computer up?  { mode: "direct" | "sandbox", ready }
export async function GET(req: NextRequest) {
  try {
    const forwarded = await forwardAgentRequest(req);
    if (forwarded) return forwarded;
    await identify(req);
    if (!sandboxMode()) return Response.json({ mode: "direct", ready: true });
    const host = await currentHost();
    return Response.json({ mode: "sandbox", ready: !!host, expiresAt: host?.expiresAt });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST -> start it if needed and wait until it's ready.
export async function POST(req: NextRequest) {
  try {
    const forwarded = await forwardAgentRequest(req);
    if (forwarded) return forwarded;
    await identify(req);
    if (!sandboxMode()) return Response.json({ mode: "direct", ready: true });
    const host = await ensureHost();
    return Response.json({ mode: "sandbox", ready: true, expiresAt: host.expiresAt });
  } catch (e) {
    return errorResponse(e);
  }
}
