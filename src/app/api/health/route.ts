import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  const key = config.groqApiKey;
  return Response.json({
    status: "ok",
    groqKeySet: !!key,
    groqKeyLength: key.length,
  });
}
