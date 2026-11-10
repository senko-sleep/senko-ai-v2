import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchResearchPage, publicResearchUrl } from "@/lib/agent/coding-research";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodingWorkspaceRuntime } from "@/lib/agent/coding-runtime";
import { runCodingToolLoop } from "@/lib/agent/coding-loop";

vi.mock("node:dns/promises", () => ({ default: { lookup: vi.fn(async () => [{ address: "93.184.216.34" }]) } }));
afterEach(() => vi.unstubAllGlobals());
describe("public coding research", () => {
  it("reuses successful repeated research without another network request or duplicate provenance", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "senko-research-cache-"));
    const fetch = vi.fn(async () => Response.json({ title: "Explicit cached research fixture" }));
    vi.stubGlobal("fetch", fetch);
    const runtime = new CodingWorkspaceRuntime("research-cache", base);
    try {
      const result = await runCodingToolLoop({ runtime, goal: "Research this image API", maxSteps: 1, modelCall: async () => ({ model: "labelled-research-test-adapter", text: JSON.stringify({ ops: [{ op: "fetch", url: "https://example.com/image-api" }, { op: "fetch", url: "https://example.com/image-api" }] }) }) });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.task.metrics?.researchCacheHits).toBe(1);
      expect(result.task.sources).toHaveLength(1);
    } finally { await fs.rm(base, { recursive: true, force: true }); }
  });
  it("rejects private hosts and credentials, including the app's own localhost", () => {
    for (const url of ["http://localhost:3000/api/settings", "http://127.0.0.1:3000", "http://10.0.0.1", "http://169.254.169.254", "http://[::1]", "file:///etc/passwd", "https://user:password@example.com"]) expect(() => publicResearchUrl(url)).toThrow();
    expect(publicResearchUrl("https://example.com/docs").hostname).toBe("example.com");
  });
  it("rechecks redirect destinations before making another request", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3000/api/settings" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchResearchPage("https://example.com")).rejects.toThrow(/public HTTP/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
