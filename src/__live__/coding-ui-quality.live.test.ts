import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { processEnv } from "@next/env";

/** Opt-in real-model benchmark. Never part of the offline regression suite. */
it("measures real image layout, dynamic UI, coding latency, and bounded API usage", async () => {
  processEnv([{ path: ".env.local", contents: await fs.readFile(".env.local", "utf8"), env: {} }], process.cwd(), undefined, true);
  process.env.DATA_DIR = ":memory:"; delete process.env.DATABASE_URL;
  process.env.BROWSER_PROVIDER = "local";
  for (const key of ["BROWSERBASE_API_KEY", "STEEL_API_KEY", "BROWSERLESS_TOKEN", "BROWSER_CDP_URL"]) delete process.env[key];
  const { CodingWorkspaceRuntime } = await import("@/lib/agent/coding-runtime");
  const { runCodingToolLoop } = await import("@/lib/agent/coding-loop");
  const { evaluateImageGallery } = await import("@/lib/agent/coding-ui-quality");
  const { getBrowser } = await import("@/lib/agent/browser");
  const label = (process.env.QUALITY_BENCHMARK_LABEL || "").replace(/[^a-z0-9_-]/gi, "");
  const output = path.resolve("artifacts/image-ui-quality", label);
  await fs.mkdir(output, { recursive: true });
  const nativeFetch = globalThis.fetch;
  const network: { method: string; host: string; path: string; status: number; durationMs: number }[] = [];
  globalThis.fetch = async (input, init) => {
    const began = performance.now(); const url = new URL(input instanceof Request ? input.url : String(input));
    let status = 0;
    try { const response = await nativeFetch(input, init); status = response.status; return response; }
    finally { network.push({ method: init?.method || (input instanceof Request ? input.method : "GET"), host: url.hostname, path: url.pathname, status, durationMs: Math.round(performance.now() - began) }); }
  };
  const runs: Record<string, unknown>[] = [];
  const sources: { id: string; title: string; credit: string; url: string; localPath: string }[] = [];
  let setupError: string | undefined;
  try {
    for (const [id, nasaId] of [["earth", "PIA00342"], ["mars", "PIA00407"], ["moon", "PIA12235"]]) {
      const response = await fetch(`https://images-api.nasa.gov/search?nasa_id=${nasaId}&media_type=image&page_size=1`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`NASA image search ${id}: HTTP ${response.status}`);
      const data = await response.json();
      const item = data.collection?.items?.[0];
      const url = item?.links?.find((link: { render?: string }) => link.render === "image")?.href;
      if (!url || new URL(url).hostname !== "images-assets.nasa.gov") throw new Error(`No NASA image asset for ${id}`);
      const image = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!image.ok || !image.headers.get("content-type")?.startsWith("image/")) throw new Error(`Image ${id}: HTTP ${image.status}`);
      const bytes = Buffer.from(await image.arrayBuffer());
      if (bytes.length > 5_000_000) throw new Error("Benchmark image exceeded the 5 MB staging bound.");
      await fs.writeFile(path.join(output, `${id}.jpg`), bytes);
      sources.push({ id, title: item.data?.[0]?.title || id, credit: item.data?.[0]?.photographer || item.data?.[0]?.center || "NASA", url, localPath: `assets/${id}.jpg` });
    }
    await fs.writeFile(path.join(output, "sources.json"), JSON.stringify(sources, null, 2));
    const selected = process.env.QUALITY_BENCHMARK_MODEL ? [{ provider: process.env.QUALITY_BENCHMARK_PROVIDER || "groq", model: process.env.QUALITY_BENCHMARK_MODEL }] : [{ provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "cloudflare", model: "@cf/meta/llama-3.2-3b-instruct" }];
    for (const [index, model] of selected.entries()) {
      const runtime = new CodingWorkspaceRuntime(`quality-gallery-${Date.now()}-${index}`);
      await runtime.ensureWorkspace();
      await fs.mkdir(path.join(runtime.workspaceDir, "assets"), { recursive: true });
      for (const source of sources) await fs.copyFile(path.join(output, `${source.id}.jpg`), path.join(runtime.workspaceDir, source.localPath));
      await runtime.writeFile("image-sources.json", JSON.stringify(sources, null, 2));
      const goal = `Build a polished, responsive planetary photo gallery website using the three provided real NASA raster images and image-sources.json. Use plain HTML/CSS/JS and no dependencies. Create index.html, styles.css and app.js in one useful batch. Use an editorial science-magazine composition, strong typography, careful spacing, real images with descriptive alt text and source credit. Do not invent image URLs or use placeholders. Three columns at desktop; one column at 390px; object-fit cover/contain; no overflow or overlapping images. Implement functional Mars/All filters, persistent Earth favorite using localStorage, and an accessible Earth detail dialog closed by Escape. Acceptance selectors: each of three cards data-testid="card"; filter buttons data-testid="filter-mars" and "filter-all"; Earth favorite data-testid="favorite-earth" with aria-pressed; detail button data-testid="detail-earth"; dialog role="dialog". Selectors are a test contract, not styling instructions. Inspect desktop and mobile and test actual actions. Batch writes; do not repeatedly read files already supplied; do not call a model for deterministic verification. Finish only after real browser checks. Sources: ${JSON.stringify(sources)}`;
      const networkStart = network.length;
      const result = await runCodingToolLoop({ ...model, runtime, goal, maxSteps: 6, maxInferenceRequests: 8, signal: AbortSignal.timeout(90_000) });
      const browser = await getBrowser(); const context = await browser.newContext(); const page = await context.newPage();
      let quality: Awaited<ReturnType<typeof evaluateImageGallery>> | undefined; let inspectionError: string | undefined;
      try {
        if ((await runtime.listFiles()).some((file) => file.path === "index.html")) {
          const server = await runtime.startServer({ command: "static" });
          quality = await evaluateImageGallery(page, server.url, async (name) => { await page.screenshot({ path: path.join(output, `${model.provider}-${name}.png`), fullPage: true }); });
        } else inspectionError = "Model did not create index.html; image/UI acceptance could not run.";
      } catch (error) { inspectionError = error instanceof Error ? error.message : String(error); }
      finally { await context.close(); await runtime.stopAllServers(); }
      const files = await runtime.listFiles();
      await fs.mkdir(path.join(output, `${model.provider}-source`), { recursive: true });
      for (const file of files.filter((file) => /\.(html|css|js)$/.test(file.path))) {
        const target = path.join(output, `${model.provider}-source`, file.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.code);
      }
      runs.push({ requested: model, actualModel: result.task.model, workspaceDir: runtime.workspaceDir, status: result.task.status, metrics: result.task.metrics,
        quality, inspectionError, task: result.task, network: network.slice(networkStart),
        targets: { firstFileWriteMs: 15_000, totalMs: 90_000, maxInferenceRequests: 8 },
        targetResults: { firstFileWithin15s: (result.task.metrics?.firstFileWriteMs ?? Infinity) <= 15_000, functionalityPassed: quality?.passed === true, inferenceWithinBudget: (result.task.metrics?.inferenceRequests || 0) <= 8 } });
      await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ timestamp: new Date().toISOString(), sources, runs, network,
        caveats: ["Single runs, not a statistical model ranking.", "NASA assets were staged by the harness. This tests image use/layout, not autonomous image discovery or generation.", "Latency targets are explicit benchmark targets, not a promise of instant coding.", "Browser requests are separate from Node fetch telemetry; no fabricated token/cost totals.", "Visual creativity requires screenshot review independently of functional pass/fail."] }, null, 2));
    }
  } catch (error) { setupError = error instanceof Error ? error.message : String(error); await fs.writeFile(path.join(output, "setup-failure.json"), JSON.stringify({ setupError, network }, null, 2)); }
  finally { globalThis.fetch = nativeFetch; }
  console.log(JSON.stringify({ setupError, runs: runs.map((run) => ({ requested: run.requested, status: run.status, metrics: run.metrics, quality: run.quality })) }));
  expect(setupError).toBeUndefined();
  expect(runs).toHaveLength(process.env.QUALITY_BENCHMARK_MODEL ? 1 : 2);
  expect(runs.every((run) => (run.targetResults as { functionalityPassed: boolean }).functionalityPassed)).toBe(true);
}, 300_000);
