// Runs once when the server starts. Launch the agent's browser right away so the first
// agent task doesn't wait ~15s for Chrome to boot (skipped on Vercel, which can't run it).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import("./instrumentation-node");
    registerNodeInstrumentation();
  }
}
