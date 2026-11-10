/** Node-only startup: keep Playwright out of the Edge instrumentation bundle. */
export function registerNodeInstrumentation() {
  // Fetch every AI provider's model list now (no chat quota used), so the first message after
  // a restart doesn't spend seconds discovering which models exist.
  setTimeout(() => {
    import("@/lib/llm")
      .then(({ listProviders }) => listProviders())
      .then((list) => console.log(`[startup] AI models ready: ${list.filter((p) => p.available).map((p) => p.label).join(", ") || "none"}`))
      .catch(() => {});
  }, 500);
  if (process.env.VERCEL || process.env.PREWARM_BROWSER === "0") return;
  if (process.env.NODE_ENV !== "production" && process.env.PREWARM_BROWSER !== "1") return;
  if (process.env.BROWSERBASE_API_KEY || process.env.BROWSERLESS_TOKEN || process.env.STEEL_API_KEY) return;
  setTimeout(() => {
    import("@/lib/agent/browser")
      .then(({ getBrowser }) => getBrowser())
      .then(() => console.log("[startup] browser ready"))
      .catch((error) => console.warn("[startup] browser prewarm failed:", error instanceof Error ? error.message : error));
  }, 1000);
}
