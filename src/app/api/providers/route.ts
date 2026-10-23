import { listProviders } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> which AI providers are usable right now, and with which model.
export async function GET() {
  const providers = await listProviders();
  return Response.json({ providers });
}
