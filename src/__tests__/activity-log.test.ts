import { describe, expect, it } from "vitest";
import { applyStep, categorizeStage, filterActivity, formatActivityText, redactSecrets, summarizeActivity, type ActivityEntry } from "@/lib/agent/activity-log";

describe("activity log", () => {
  it("redacts credential-shaped text", () => {
    expect(redactSecrets("key sk-abcdefghijklmnopqrstuvwx")).not.toContain("abcdefghijkl");
    expect(redactSecrets("GROQ_API_KEY=gsk_abcdefghijklmnop1234")).not.toContain("abcdefghijklmnop");
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuv")).toContain("Bearer [redacted]");
    expect(redactSecrets("postgres://user:hunter22@host/db")).toBe("postgres://user:[redacted]@host/db");
    expect(redactSecrets("npm test passed")).toBe("npm test passed");
  });

  it("categorizes stages", () => {
    expect(categorizeStage("execute")).toBe("terminal");
    expect(categorizeStage("test")).toBe("testing");
    expect(categorizeStage("implement", [{}])).toBe("files");
    expect(categorizeStage("implement")).toBe("agent");
  });

  it("upserts by step id and keeps order", () => {
    let log: ActivityEntry[] = [];
    log = applyStep(log, "r1", { id: 1, stage: "install", label: "npm i", status: "running" }, 100);
    log = applyStep(log, "r1", { id: 2, stage: "test", label: "npm test", status: "running" }, 200);
    log = applyStep(log, "r1", { id: 1, stage: "install", label: "npm i", status: "done" }, 300);
    expect(log.map((e) => e.key)).toEqual(["r1:1", "r1:2"]);
    expect(log[0]).toMatchObject({ status: "done", startedAt: 100, updatedAt: 300 });
  });

  it("keeps runs with the same step id separate and bounds size", () => {
    let log: ActivityEntry[] = [];
    log = applyStep(log, "a", { id: 1, stage: "test", label: "x", status: "done" });
    log = applyStep(log, "b", { id: 1, stage: "test", label: "x", status: "done" });
    expect(log).toHaveLength(2);
    for (let i = 0; i < 600; i++) log = applyStep(log, "c", { id: i, stage: "test", label: `s${i}`, status: "done" });
    expect(log).toHaveLength(500);
    expect(log[log.length - 1].label).toBe("s599");
  });

  it("redacts and clips stored output", () => {
    const log = applyStep([], "r", { id: 1, stage: "execute", label: "run", status: "error", detail: `TOKEN=abcdef123456\n${"x".repeat(5000)}` });
    expect(log[0].detail).not.toContain("abcdef123456");
    expect(log[0].detail!.length).toBeLessThan(2100);
  });

  it("filters by category, query and errors", () => {
    let log: ActivityEntry[] = [];
    log = applyStep(log, "r", { id: 1, stage: "install", label: "npm install", status: "done" });
    log = applyStep(log, "r", { id: 2, stage: "test", label: "vitest", status: "error", detail: "AssertionError in cart.test.ts" });
    log = applyStep(log, "r", { id: 3, stage: "implement", label: "Write", status: "done", fileOps: [{ action: "Edited", path: "src/cart.ts" }] });
    expect(filterActivity(log, { categories: new Set(["terminal"]) })).toHaveLength(1);
    expect(filterActivity(log, { query: "CART" })).toHaveLength(2);
    expect(filterActivity(log, { errorsOnly: true }).map((e) => e.label)).toEqual(["vitest"]);
    expect(summarizeActivity(log)).toMatchObject({ terminal: 1, testing: 1, files: 1, errors: 1, running: 0 });
    expect(formatActivityText(log)).toContain("[testing/test] ERROR vitest");
  });
});
