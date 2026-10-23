export const runtime = "nodejs";

// Used by the host's health check. Public (skips the password gate), so it reveals nothing.
export async function GET() {
  return Response.json({
    status: "ok",
    agentBackendConfigured: !!process.env.AGENT_BACKEND_URL,
    wasmerRuntime: !!process.env.WASMER_APP_ID,
  });
}
