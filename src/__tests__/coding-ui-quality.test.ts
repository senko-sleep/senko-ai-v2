import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodingWorkspaceRuntime } from "@/lib/agent/coding-runtime";
import { getBrowser } from "@/lib/agent/browser";
import { evaluateImageGallery } from "@/lib/agent/coding-ui-quality";
import { galleryQualityFixture } from "./fixtures/gallery-quality-fixture";
import { runCodingToolLoop } from "@/lib/agent/coding-loop";

it("observes static UI crashes before spending the next model call", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "senko-ui-smoke-"));
  const runtime = new CodingWorkspaceRuntime("automatic-smoke-fixture", base);
  let calls = 0;
  try {
    const result = await runCodingToolLoop({ runtime, goal: "Build a gallery website", maxSteps: 2, modelCall: async (request) => {
      calls++;
      if (calls === 1) return { model: "labelled-browser-feedback-adapter", text: JSON.stringify({ ops: [{ op: "write", path: "index.html", content: '<!doctype html><h1>Broken fixture</h1><script>document.getElementById("missing").textContent="crash"</script>' }] }) };
      expect(request.history.join(" ")).toContain("Automatic browser smoke check");
      expect(request.history.join(" ")).toContain("null");
      return { model: "labelled-browser-feedback-adapter", text: '{"ops":[],"done":true}' };
    } });
    expect(calls).toBe(2);
    expect(result.task.status).toBe("incomplete");
    expect(runtime.ledger.browserInspections[0].pageErrors.length).toBeGreaterThan(0);
  } finally { await runtime.stopAllServers(); await fs.rm(base, { recursive: true, force: true }); }
}, 30_000);

it("checks actual raster layout and dynamic behavior, rejecting broken images and label-only filters", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "senko-gallery-verifier-"));
  const runtime = new CodingWorkspaceRuntime("controlled-gallery-fixture", base);
  await runtime.ensureWorkspace();
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 160, height: 120 });
    for (const [name, color] of [["earth", "#4584aa"], ["mars", "#b95d3d"], ["moon", "#777777"]]) {
      await page.setContent(`<body style="margin:0;background:${color}"><p>Labelled ${name} test raster</p>`);
      await fs.writeFile(path.join(runtime.workspaceDir, `${name}.png`), await page.screenshot());
    }
    await runtime.writeFile("index.html", galleryQualityFixture());
    const server = await runtime.startServer();
    const positive = await evaluateImageGallery(page, server.url);
    expect(positive.passed, JSON.stringify(positive.checks)).toBe(true);
    await runtime.writeFile("index.html", galleryQualityFixture(true, true));
    const negative = await evaluateImageGallery(page, server.url);
    expect(negative.passed).toBe(false);
    expect(negative.checks.find((check) => check.name === "desktop: real images and accessible descriptions")?.passed).toBe(false);
    expect(negative.checks.find((check) => check.name === "filter changes the rendered card collection")?.passed).toBe(false);
  } finally {
    await context.close(); await runtime.stopAllServers(); await fs.rm(base, { recursive: true, force: true });
  }
}, 45_000);
