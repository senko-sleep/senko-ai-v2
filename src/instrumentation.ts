// Runs once when the server starts. Launch the agent's browser right away so the first
// agent task doesn't wait ~15s for Chrome to boot (skipped on Vercel, which can't run it).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL || process.env.PREWARM_BROWSER === "0") return;
  if (process.env.NODE_ENV !== "production" && process.env.PREWARM_BROWSER !== "1") return;
  // Don't consume a Browserbase session just because an app instance started.
  // The first real browser task creates the cloud browser on demand.
  if (process.env.BROWSERBASE_API_KEY || process.env.BROWSERLESS_TOKEN || process.env.STEEL_API_KEY) return;
  setTimeout(() => {
    import("@/lib/agent/browser")
      .then(({ getBrowser }) => getBrowser())
      .then(() => console.log("[startup] browser ready"))
      .catch((e) => console.warn("[startup] browser prewarm failed:", e instanceof Error ? e.message : e));
  }, 1000);
}
