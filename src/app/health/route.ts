export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public health check for the host and keep-alive pingers. Reveals nothing.
export async function GET() {
  return Response.json({ status: "ok", uptimeSec: Math.round(process.uptime()) });
}
