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
  if (process.env.PREWARM_BROWSER === "0") return;
  // Start Chrome now wherever this server runs its own (your PC in dev too, Docker): a cold
  // Chrome plus its first tab took ~4-8s, paid after the user pressed send. Hosts that only
  // use a managed browser (billed per session) warm it when Agent mode is picked instead
  // (POST /api/agent-host). PREWARM_BROWSER=0 turns this off on low-RAM machines.
  setTimeout(() => {
    import("@/lib/agent/browser")
      .then(async ({ canLaunchLocalBrowser, isLowMemoryHost, warmBrowser }) => {
        if (!canLaunchLocalBrowser()) return;
        if (isLowMemoryHost() && process.env.PREWARM_BROWSER !== "1") return;
        const t = Date.now();
        await warmBrowser();
        console.log(`[startup] browser ready in ${Date.now() - t}ms`);
      })
      .catch((error) => console.warn("[startup] browser prewarm failed:", error instanceof Error ? error.message : error));
  }, 1500);
}
