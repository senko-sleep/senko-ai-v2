// Health check is no longer needed - single unified API handles everything
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ status: "ok" });
}
