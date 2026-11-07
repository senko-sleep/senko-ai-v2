import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processEnv } from "@next/env";

// Explicit live benchmark; never part of npm test. Uses existing provider credentials.
// CODING_BENCHMARK_MODELS='[{"provider":"groq","model":"openai/gpt-oss-120b"},...]'
// npx vitest run --config vitest.live.config.ts src/__live__/coding-models.live.test.ts
it("compares the same real development task across explicitly pinned supported models", async () => {
  // Next deliberately skips .env.local under NODE_ENV=test; this explicit live run opts in.
  const contents = await fs.readFile(".env.local", "utf8").catch(() => "");
  processEnv([{ path: ".env.local", contents, env: {} }], process.cwd(), undefined, true);
  process.env.DATA_DIR = ":memory:";
  delete process.env.DATABASE_URL;
  process.env.BROWSER_PROVIDER = "local";
  for (const key of ["BROWSERBASE_API_KEY", "STEEL_API_KEY", "BROWSERLESS_TOKEN", "BROWSER_CDP_URL"]) delete process.env[key];
  const { CodingWorkspaceRuntime } = await import("@/lib/agent/coding-runtime");
  const { runCodingToolLoop } = await import("@/lib/agent/coding-loop");
  const models: { provider: string; model: string }[] = JSON.parse(process.env.CODING_BENCHMARK_MODELS || JSON.stringify([
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "cloudflare", model: "@cf/meta/llama-3.2-3b-instruct" },
  ]));
  const goal = "Build a working full-stack notes application using only Node.js built-ins (no dependencies). Create server.js with an HTTP API POST /api/notes and GET /api/notes, persist notes in notes.json, and serve index.html at /. The UI must have a labelled text input and Save button; saving sends a real request and displays the persisted notes. Include node:test tests for validation and storage, a package.json test script, and run them. Start with node server.js (use process.env.PORT), then inspect in Chromium: type a note, click Save, and assert that the saved note appears. Empty note input must be rejected. Use structured tool operations; finish only with current passing tests and browser evidence.";
  const runs = [];
  for (const selected of models) {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "senko-model-benchmark-"));
    const runtime = new CodingWorkspaceRuntime("notes-benchmark", base);
    const started = performance.now();
    let peakRssBytes = process.memoryUsage().rss;
    const sample = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 200);
    try {
      const result = await runCodingToolLoop({ ...selected, runtime, goal, maxSteps: 10, signal: AbortSignal.timeout(150_000) });
      runs.push({ requested: selected, actualModel: result.task.model || null, status: result.task.status,
        completionRate: result.task.status === "verified" ? 1 : 0, durationMs: Math.round(performance.now() - started),
        processPeakRssBytes: peakRssBytes, steps: result.task.step, commands: runtime.ledger.commands.map((c) => ({ command: c.command, exitCode: c.exitCode, durationMs: c.durationMs })),
        testStatus: runtime.ledger.testStatus, browser: runtime.ledger.browserInspections.map((b) => ({ passed: b.passed, pageErrors: b.pageErrors, interactions: b.interactions })),
        lastFeedback: result.task.history.slice(-2),
      });
    } finally {
      clearInterval(sample);
      await runtime.stopAllServers();
      await fs.rm(base, { recursive: true, force: true });
    }
  }
  await fs.mkdir("artifacts", { recursive: true });
  await fs.writeFile("artifacts/coding-model-benchmark.json", JSON.stringify({ timestamp: new Date().toISOString(), goal,
    caveats: ["One task and one run per model; not a general capability ranking.", "RSS measures this Node process; browser/child-process memory is excluded.", "No VS Code or Claude Code performance baseline was run."], runs }, null, 2));
  console.log(JSON.stringify(runs.map(({ requested, actualModel, status, durationMs, testStatus }) => ({ requested, actualModel, status, durationMs, testStatus }))));
  expect(runs.every((run) => run.status === "verified")).toBe(true);
}, 360_000);
