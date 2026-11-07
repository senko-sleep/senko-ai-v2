import { expect, it } from "vitest";
import fs from "node:fs/promises";
import { processEnv } from "@next/env";

it("records real inference health separately from configured provider metadata", async () => {
  processEnv([{ path: ".env.local", contents: await fs.readFile(".env.local", "utf8"), env: {} }], process.cwd(), undefined, true);
  process.env.DATA_DIR = ":memory:"; delete process.env.DATABASE_URL;
  const { listProviders, probeProvider } = await import("@/lib/llm");
  const reports = [];
  // Bounded diagnostic: inspect selected configured providers and retain all failures.
  for (const id of ["deepseek", "gemini", "groq", "cloudflare", "sambanova"]) {
    const discovered = (await listProviders()).find((provider) => provider.id === id);
    if (!discovered?.model) continue;
    try { reports.push(await probeProvider(id, discovered.model, AbortSignal.timeout(15_000))); }
    catch (error) { reports.push({ id, model: discovered.model, available: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  await fs.mkdir("artifacts", { recursive: true });
  await fs.writeFile("artifacts/coding-provider-health.json", JSON.stringify({ timestamp: new Date().toISOString(), reports }, null, 2));
  console.log(JSON.stringify(reports.map((r) => ({ id: r.id, model: r.model, available: r.available }))));
  expect(reports.length).toBeGreaterThan(0);
}, 120_000);
