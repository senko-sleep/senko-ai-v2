import { describe, it, expect, vi } from "vitest";

// Store app_kv rows in memory, like the real table.
const kv = new Map<string, string>();
vi.mock("@/lib/server/db", () => ({
  q: async (sql: string, params: string[]) => {
    if (sql.startsWith("INSERT")) kv.set(params[0], params[1]);
    if (sql.startsWith("DELETE")) kv.delete(params[0]);
    return [];
  },
  q1: async (_sql: string, params: string[]) => (kv.has(params[0]) ? { value: kv.get(params[0]) } : null),
}));

import { checkpointLease, saveCheckpoint, loadCheckpoint, clearCheckpoint } from "@/lib/agent/checkpoint";

const progress = {
  goal: "make a collage of 5 eevee images",
  plan: ["open safebooru", "fetch 5 images", "make the collage"],
  history: ["1. {\"action\":\"goto\"} -> Opened safebooru.org", "2. {\"action\":\"fetch_image\"} -> Stashed image img_1"],
  actionsTaken: 2,
  sources: [["https://safebooru.org/", { title: "Safebooru", images: [] }]] as [string, { title: string; images: [] }][],
  reason: "the AI usage limits were used up",
};

describe("agent checkpoints", () => {
  it("preserves the checklist across a restart and fences saves from an older run", async () => {
    const first = checkpointLease("lease-test");
    await saveCheckpoint("lease-test", progress, first);
    const next = checkpointLease("lease-test");
    const requirements = [{ id: "r0", text: progress.goal, status: "pending" as const }, { id: "r1", text: "five images", status: "verified" as const, evidence: "five stored image ids" }];
    await saveCheckpoint("lease-test", { ...progress, goal: "new task", requirements }, next);
    await saveCheckpoint("lease-test", progress, first);
    await clearCheckpoint("lease-test", first);
    (globalThis as { __agentCheckpoints?: Map<string, unknown> }).__agentCheckpoints?.clear();
    const restored = await loadCheckpoint("lease-test");
    expect(restored?.goal).toBe("new task"); expect(restored?.requirements).toEqual(requirements);
  });
  it("saves progress after a step and loads it back to resume", async () => {
    await saveCheckpoint("chat-1", progress);
    const ck = await loadCheckpoint("chat-1");
    expect(ck?.history).toEqual(progress.history);
    expect(ck?.plan).toEqual(progress.plan);
    expect(ck?.actionsTaken).toBe(2);
    expect(ck?.reason).toBe(progress.reason);
  });

  it("survives a restart (memory gone, database copy kept)", async () => {
    await saveCheckpoint("chat-2", progress);
    (globalThis as { __agentCheckpoints?: Map<string, unknown> }).__agentCheckpoints?.clear();
    expect((await loadCheckpoint("chat-2"))?.goal).toBe(progress.goal);
  });

  it("is gone once the task finishes, and ignores day-old progress", async () => {
    await saveCheckpoint("chat-3", progress);
    await clearCheckpoint("chat-3");
    expect(await loadCheckpoint("chat-3")).toBeNull();

    await saveCheckpoint("chat-4", progress);
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60_000);
    expect(await loadCheckpoint("chat-4")).toBeNull();
    spy.mockRestore();
  });
});
