import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyExactEdit, completionBlockers, parseStep, readablePath, selectProjectContext, validateStepRequest, writablePath } from "@/lib/code-job";
import { CodingWorkspaceRuntime, resetVerificationLedger, resolveSafeWorkspacePath } from "@/lib/agent/coding-runtime";
import { runCodingToolLoop } from "@/lib/agent/coding-loop";
import { createWorkspaceCheckpoint, listWorkspaceCheckpoints, restoreWorkspaceCheckpoint } from "@/lib/agent/workspace-checkpoints";
import { detectWorkspaceTestCommand } from "@/lib/agent/coding-agent";

const roots: string[] = [];
async function workspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "senko-infrastructure-"));
  roots.push(base);
  const runtime = new CodingWorkspaceRuntime("test", base);
  await runtime.ensureWorkspace();
  return runtime;
}
afterEach(async () => {
  // Every recursive cleanup target came directly from mkdtemp under the OS temp directory.
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("model-independent coding contracts", () => {
  it("keeps image bytes out of model text context and restores binary checkpoints exactly", async () => {
    const runtime = await workspace();
    const original = Buffer.from([0xff, 0xd8, 0, 1, 128, 255, 0xff, 0xd9]);
    await fs.writeFile(path.join(runtime.workspaceDir, "photo.jpg"), original);
    const image = (await runtime.listFiles()).find((file) => file.path === "photo.jpg");
    expect(image).toMatchObject({ binary: true, code: "", sizeBytes: original.length });
    const checkpoint = await createWorkspaceCheckpoint(runtime, "Binary round trip");
    await fs.writeFile(path.join(runtime.workspaceDir, "photo.jpg"), Buffer.from("changed"));
    await restoreWorkspaceCheckpoint(runtime, checkpoint.id);
    expect(await fs.readFile(path.join(runtime.workspaceDir, "photo.jpg"))).toEqual(original);
    await runCodingToolLoop({ runtime, goal: "Inspect available images", maxSteps: 1, modelCall: async (request) => {
      expect(request.files.some((file) => file.path === "photo.jpg")).toBe(true);
      expect(request.opened?.some((file) => file.path === "photo.jpg")).toBe(false);
      return { model: "labelled-context-test-adapter", text: '{"ops":[]}' };
    } });
  });
  it("stops repeated unchanged reads and records actual progress metrics", async () => {
    const runtime = await workspace();
    await runtime.writeFile("index.html", "<!doctype html><h1>Existing fixture</h1>");
    let calls = 0;
    const result = await runCodingToolLoop({ runtime, goal: "Improve this page", maxSteps: 12, modelCall: async (request, options) => {
      calls++;
      expect(options.hedge).toBe(false);
      if (calls === 2) { expect(request.opened?.[0].content).toContain("Existing fixture"); expect(request.history.join(" ")).toContain("full contents included"); }
      return { model: "labelled-stalled-test-adapter", text: '{"ops":[{"op":"read","path":"index.html"}]}' };
    } });
    expect(calls).toBe(3);
    expect(result.task.status).toBe("incomplete");
    expect(result.task.history.at(-1)).toContain("Stopped repeated reads");
    expect(result.task.metrics?.modelCalls).toBe(3);
    expect(result.task.metrics?.inferenceRequests).toBe(0); // This labelled adapter makes no provider HTTP requests.
    expect((await runtime.listFiles())[0].code).toContain("Existing fixture");
  });
  it("rejects malformed request arrays and step bounds before context construction", () => {
    expect(validateStepRequest({ goal: "app" })).toBe(false);
    expect(validateStepRequest({ goal: "app", files: [], history: [], canRun: true, step: 1, maxSteps: 24 })).toBe(true);
    expect(validateStepRequest({ goal: "app", files: [], history: [null], canRun: true, step: 1, maxSteps: 24 })).toBe(false);
  });

  it("reports rejected tools and refuses done when arguments were malformed", () => {
    const step = parseStep(JSON.stringify({ done: true, ops: [{ op: "write", path: "../escape", content: "bad" }, { op: "run" }] }));
    expect(step?.done).toBe(false);
    expect(step?.errors).toHaveLength(2);
    expect(step?.ops).toEqual([]);
    for (const value of ["C:\\escape", "\\outside", "src/../escape", ".env.local", ".senko/task.json"]) expect(writablePath(value)).toBe(false);
  });

  it("applies unique targeted edits and reports stale or ambiguous matches", () => {
    expect(applyExactEdit("const x = 1;", "x = 1", "x = 2")).toBe("const x = 2;");
    expect(() => applyExactEdit("x x", "x", "y")).toThrow(/ambiguous/);
    expect(() => applyExactEdit("x", "z", "y")).toThrow(/not found/);
    expect(readablePath("package-lock.json")).toBe(true);
    expect(writablePath("package-lock.json")).toBe(false);
    expect(parseStep('{"ops":[{"op":"edit","path":"src/a.ts","find":"old","replace":"new"}]}')?.ops[0].op).toBe("edit");
  });

  it("decodes a model response escaped once without guessing or executing text", () => {
    const document = JSON.stringify({ ops: [{ op: "write", path: "src/a.js", content: 'console.log("hello");\n' }] });
    const escaped = JSON.stringify(document).slice(1, -1);
    expect(parseStep(escaped)?.ops).toEqual([{ op: "write", path: "src/a.js", content: 'console.log("hello");\n' }]);
    expect(parseStep('{"ops": [')).toBeNull();
  });

  it("includes a relevant file late in a large project without truncating its contents", () => {
    const selected = selectProjectContext([
      { path: "irrelevant.ts", content: "x".repeat(200) },
      { path: "src/payment.ts", content: "export const payment = 1;" },
    ], "Fix src/payment.ts", 60);
    expect(selected.files.map((f) => f.path)).toEqual(["src/payment.ts"]);
    expect(selected.omitted).toEqual(["irrelevant.ts"]);
  });

  it("requires declared checks and browser evidence for the current source revision", () => {
    const files = [{ path: "package.json", code: JSON.stringify({ scripts: { build: "vite build", test: "vitest run" } }) }, { path: "src/App.tsx", code: "export default () => <h1>Hi</h1>" }];
    const evidence = [{ command: "npm run build", exitCode: 0, revision: 1 }, { command: "npm test", exitCode: 0, revision: 1 }, { command: "inspect", exitCode: 0, revision: 1, browserPassed: true }];
    expect(completionBlockers(files, evidence, 1, true)).toEqual([]);
    expect(completionBlockers(files, evidence, 2, true)).toHaveLength(4);
    expect(completionBlockers(files, [...evidence, { command: "npm test", exitCode: 1, revision: 1 }], 1, true).join(" ")).toContain("test");
  });

  it("restores a real multi-file checkpoint and invalidates old test results", async () => {
    const runtime = await workspace();
    await runtime.writeFile("src/a.ts", "export const value = 1;");
    const checkpoint = await createWorkspaceCheckpoint(runtime, "before change");
    await runtime.writeFile("src/a.ts", "export const value = 2;");
    await runtime.writeFile("src/b.ts", "export const extra = true;");
    runtime.ledger.testStatus = "passed";
    await restoreWorkspaceCheckpoint(runtime, checkpoint.id);
    expect(await runtime.readFile("src/a.ts")).toContain("= 1");
    expect((await runtime.listFiles()).map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(runtime.ledger.files["src/b.ts"]).toBeUndefined();
    expect(runtime.ledger.testStatus).toBe("not_run");
    expect(await listWorkspaceCheckpoints(runtime)).toHaveLength(2);
  });

  it("blocks writes through a symlinked parent even when the target file is new", async () => {
    const runtime = await workspace();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "senko-outside-")); roots.push(outside);
    await fs.symlink(outside, path.join(runtime.workspaceDir, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(() => resolveSafeWorkspacePath(runtime.workspaceDir, "linked/new.ts")).toThrow(/Symlink escape/);
  });

  it("honors a configured Vitest runner and discovers every Node test otherwise", async () => {
    const runtime = await workspace();
    await runtime.writeFile("a.test.ts", 'import test from "node:test"; test("a", () => {});');
    await runtime.writeFile("b.test.ts", 'import test from "node:test"; test("b", () => {});');
    const command = await detectWorkspaceTestCommand(runtime);
    expect(command).toBe("node --test a.test.ts b.test.ts");
    expect((await runtime.runCommand(command!)).exitCode).toBe(0);
    await runtime.writeFile("package.json", '{"scripts":{"test":"vitest run --config project.config.ts"}}');
    expect(await detectWorkspaceTestCommand(runtime)).toBe("npm test");
  });

  it("executes tools, repairs a real failed test, and saves task context with a deterministic test adapter", async () => {
    const runtime = await workspace();
    let calls = 0;
    const result = await runCodingToolLoop({ runtime, goal: "Implement add(a,b) and verify it", maxSteps: 8,
      modelCall: async (request) => {
        calls++;
        const steps = [
          { ops: [{ op: "write", path: "sum.cjs", content: "module.exports = (a,b) => a-b;" }, { op: "write", path: "sum.test.cjs", content: 'const test=require("node:test"); const assert=require("node:assert/strict"); test("sum",()=>assert.equal(require("./sum.cjs")(2,3),5));' }] },
          { ops: [{ op: "run", cmd: "node --test sum.test.cjs" }], done: true },
          { ops: [{ op: "write", path: "sum.cjs", content: "module.exports = (a,b) => a+b;" }] },
          { ops: [{ op: "run", cmd: "node --test sum.test.cjs" }], done: true, summary: "Implemented addition and verified its test." },
        ];
        if (calls === 3) expect(request.history.join("\n")).toContain("Completion rejected");
        return { model: "deterministic-test-adapter", text: JSON.stringify(steps[calls - 1]) };
      },
    });
    expect(result.task.status).toBe("verified");
    expect(runtime.ledger.commands.map((c) => c.exitCode)).toEqual([1, 0]);
    expect(result.task.model).toBe("deterministic-test-adapter");
    const journal = JSON.parse(await fs.readFile(path.join(runtime.workspaceDir, ".senko", "task.json"), "utf8"));
    expect(journal.status).toBe("verified");
    expect(result.changedFiles.map((f) => f.path)).toEqual(["sum.cjs", "sum.test.cjs"]);
    resetVerificationLedger(runtime.chatId, path.dirname(runtime.workspaceDir));
    const reader = new CodingWorkspaceRuntime(runtime.chatId, path.dirname(runtime.workspaceDir));
    await reader.listFiles(); await reader.refreshPersistedEvidence();
    expect(reader.ledger.codingTask?.status).toBe("verified");
    await reader.writeFile("sum.cjs", "module.exports = () => 0;");
    await reader.listFiles(); await reader.refreshPersistedEvidence();
    expect(reader.ledger.codingTask?.status).toBe("incomplete");
  }, 30_000);

  it("never calls a step-limit stop verified, and resumes saved context", async () => {
    const runtime = await workspace();
    const first = await runCodingToolLoop({ runtime, goal: "unfinished task", maxSteps: 1, modelCall: async () => ({ model: "test-adapter", text: '{"ops":[{"op":"write","path":"index.js","content":"console.log(1)"}]}' }) });
    expect(first.task.status).toBe("incomplete");
    const second = await runCodingToolLoop({ runtime, goal: "unfinished task", maxSteps: 1, modelCall: async (request) => {
      expect(request.history.join(" ")).toContain("Resuming");
      return { model: "test-adapter", text: '{"ops":[{"op":"run","cmd":"node index.js"}],"done":true}' };
    } });
    expect(second.task.status).toBe("verified");
    expect(second.task.step).toBe(2);
  }, 30_000);
});
