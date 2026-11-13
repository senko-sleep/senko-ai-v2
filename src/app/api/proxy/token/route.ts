import { signProxyToken } from "@/lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> { token, expiresAt }. Behind the normal API gate, so only signed-in devices get one.
export async function GET() {
  const token = await signProxyToken();
  return Response.json({ token, expiresAt: Number(token.split(".")[0]) * 1000 }, { headers: { "Cache-Control": "no-store" } });
}
