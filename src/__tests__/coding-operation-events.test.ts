import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CodingWorkspaceRuntime } from "@/lib/agent/coding-runtime";
import { runCodingToolLoop, type CodingOperationEvent } from "@/lib/agent/coding-loop";

// Deterministic adapter: verifies that streamed events mirror real operations, not model quality.
it("emits start and outcome events for real file and command operations", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "senko-events-"));
  const runtime = new CodingWorkspaceRuntime("events", base);
  const events: CodingOperationEvent[] = [];
  let step = 0;
  try {
    await runCodingToolLoop({
      runtime, goal: "Write a script and run it", maxSteps: 3,
      onOperation: (event) => events.push(event),
      modelCall: async () => {
        const responses = [
          { ops: [{ op: "write", path: "ok.js", content: "console.log('hello-from-real-run')" }, { op: "write", path: "bad.js", content: "process.exit(3)" }] },
          { ops: [{ op: "run", cmd: "node ok.js" }, { op: "run", cmd: "node bad.js" }] },
          { ops: [], done: true, summary: "stop" },
        ];
        return { model: "deterministic-events-adapter", text: JSON.stringify(responses[Math.min(step++, responses.length - 1)]) };
      },
    });
    const finished = events.filter((e) => e.status !== "running");
    expect(events.filter((e) => e.status === "running")).toHaveLength(4);
    expect(finished.map((e) => e.status)).toEqual(["done", "done", "done", "error"]);
    expect(finished[2].detail).toContain("cwd: .");
    expect(finished[2].detail).toContain("hello-from-real-run");
    expect(finished[3].detail).toMatch(/exit 3/);
    expect(new Set(events.map((e) => e.id)).size).toBe(4);
  } finally {
    await runtime.stopAllServers();
    await fs.rm(base, { recursive: true, force: true });
  }
}, 60_000);
