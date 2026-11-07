import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { processEnv } from "@next/env";

it("runs the original Mixed Nuts request through the actual autonomous coding agent", async () => {
  processEnv([{ path: ".env.local", contents: await fs.readFile(".env.local", "utf8"), env: {} }], process.cwd(), undefined, true);
  process.env.DATA_DIR = ":memory:"; delete process.env.DATABASE_URL;
  process.env.BROWSER_PROVIDER = "local";
  for (const key of ["BROWSERBASE_API_KEY", "STEEL_API_KEY", "BROWSERLESS_TOKEN", "BROWSER_CDP_URL"]) delete process.env[key];
  const chatId = process.env.MUSIC_ACCEPTANCE_CHAT_ID;
  if (!chatId) throw new Error("MUSIC_ACCEPTANCE_CHAT_ID must identify a new isolated owned acceptance chat.");
  const { CodingWorkspaceRuntime } = await import("@/lib/agent/coding-runtime");
  const { runCodingToolLoop } = await import("@/lib/agent/coding-loop");
  const runtime = new CodingWorkspaceRuntime(chatId);
  const goal = "Build me a beautiful website where I can listen to 'Mixed Nuts' from SPY × FAMILY. Make it in my workspace.";
  const began = performance.now(); let last = "";
  const result = await runCodingToolLoop({ runtime, goal, primaryGoal: goal, maxSteps: 20, signal: AbortSignal.timeout(240_000),
    onProgress: (task) => {
      const activity = `${task.step}: ${task.activity || task.status}`;
      if (activity !== last) { console.log(activity); last = activity; }
    },
  });
  await fs.mkdir("artifacts/music-acceptance", { recursive: true });
  for (const [index, inspection] of runtime.ledger.browserInspections.entries()) if (inspection.screenshotBase64) await fs.writeFile(`artifacts/music-acceptance/browser-${index + 1}.jpg`, Buffer.from(inspection.screenshotBase64, "base64"));
  const report = { timestamp: new Date().toISOString(), goal, chatId, workspaceDir: runtime.workspaceDir, durationMs: Math.round(performance.now() - began), task: result.task,
    files: (await runtime.listFiles()).map((f) => f.path), commands: runtime.ledger.commands,
    browser: runtime.ledger.browserInspections.map(({ screenshotBase64: _screenshot, ...inspection }) => inspection), summary: result.summary };
  await fs.writeFile(path.join("artifacts/music-acceptance", "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: result.task.status, model: result.task.model, files: report.files, durationMs: report.durationMs }));
  expect(result.task.status).toBe("verified");
}, 300_000);
