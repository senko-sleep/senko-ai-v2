import { listProviders, probeProvider } from "@/lib/llm";
import { route } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> which AI providers are usable right now, and with which model.
export async function GET() {
  const providers = await listProviders();
  return Response.json({ providers });
}

export const POST = route(async (req) => {
  const body = await req.json().catch(() => null) as { provider?: unknown; model?: unknown } | null;
  if (typeof body?.provider !== "string" || typeof body?.model !== "string") return Response.json({ error: "provider and model are required." }, { status: 400 });
  const provider = await probeProvider(body.provider, body.model, AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]));
  return Response.json({ provider }, { headers: { "Cache-Control": "no-store" } });
});
