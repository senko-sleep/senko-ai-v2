import { HttpError, route } from "@/lib/server/identity";
import { startRun } from "@/lib/testing/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { scenarioId, params? } -> starts a test in the background.
export const POST = route(async (req) => {
  const { scenarioId, params } = (await req.json().catch(() => ({}))) as { scenarioId?: string; params?: Record<string, string> };
  if (!scenarioId) throw new HttpError(400, "scenarioId required");
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const hostHeader = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  // The agent's browser runs on this same server, so point fixtures at the local port when possible.
  const base = process.env.APP_URL || `${proto}://${hostHeader}`;
  const run = startRun(scenarioId, base, params || {});
  return Response.json({ runId: run.id });
});
