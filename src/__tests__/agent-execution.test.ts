import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), open: vi.fn(), save: vi.fn(), clear: vi.fn(), q: vi.fn() }));
vi.mock("@/lib/llm", () => ({ complete: mocks.complete, headroom: async () => 1, LlmBusyError: class extends Error {} }));
vi.mock("@/lib/agent/sessions", () => ({ sessions: { get: () => undefined, open: mocks.open } }));
vi.mock("@/lib/agent/checkpoint", () => ({ checkpointLease: () => Symbol(), saveCheckpoint: mocks.save, clearCheckpoint: mocks.clear }));
vi.mock("@/lib/server/persona", () => ({ agentVoice: async () => "", safeSearchFor: async () => "off" }));
vi.mock("@/lib/server/chats", () => ({ saveImage: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ q: mocks.q, q1: vi.fn(), newId: () => "test" }));
import { runAgent, type RunEvent } from "@/lib/agent/runner";

function fixture(clickable = false) {
  let url = "https://fixture.test/start";
  const target = { count: vi.fn(async () => clickable ? 1 : 0), first: () => ({
    scrollIntoViewIfNeeded: vi.fn(async () => {}),
    boundingBox: vi.fn(async () => ({ x: 100, y: 80, width: 40, height: 30 })),
  }) };
  const page = { url: () => url, title: async () => "Task fixture", waitForLoadState: async () => {}, waitForTimeout: async () => {},
    goto: vi.fn(async (next: string) => { url = next; return { status: () => 200 }; }),
    locator: vi.fn(() => target),
    mouse: { move: vi.fn(async () => {}), down: vi.fn(async () => {}), up: vi.fn(async () => {}), click: vi.fn(async () => {}), wheel: vi.fn(async () => {}) },
    on: vi.fn(), off: vi.fn(), mainFrame: () => ({}), waitForURL: async () => {},
    evaluate: vi.fn(async (fn: () => unknown, arg?: { cmd?: string }) => {
      const fp = { tag: "button", text: "Continue", href: "", role: "", ctx: "", nth: 0 };
      switch (arg?.cmd) {
        case "observe": return { elements: clickable ? [{ id: 1, tag: "button", type: "button", text: "Continue", href: "", fp }] : [], images: [], text: url.endsWith("result") ? "Code: KIWI-4217" : "Start page", atBottom: false };
        case "resolve": return clickable ? { status: "ok", x: 120, y: 95, box: { x: 100, y: 80, w: 40, h: 30 }, vw: 1280, vh: 800, how: "id", scrolled: false } : { status: "missing" };
        case "verify": return { ok: true, mark: 0, url, scrollY: 0, focus: "", value: "" };
        case "settle": return { quiet: true, ms: 0 };
        case "effect": return false;
      }
      if (String(fn).includes("innerText.length")) return 600;
      return null;
    }),
  };
  const session = { pages: [page], active: () => page, isActive: () => true, viewport: () => ({ width: 1280, height: 800 }), beginAgent: vi.fn(), endAgent: vi.fn(), startCast: async () => {}, emitStatus: vi.fn(), emit: vi.fn(),
    tabs: async () => [{ index: 0, title: "Fixture", url, active: true }], screenshot: async () => Buffer.from("test"), recordShot: async () => "shot", persist: async () => {}, schedulePersist: vi.fn(), log: vi.fn(), replay: [],
    status: "active", watchStall: () => () => {}, responsive: async () => true, recoverPage: vi.fn(), viewerCount: () => 0 };
  mocks.open.mockResolvedValue(session);
  return { session, page };
}
const goal = "Open the result page, report the exact code, and keep the result tab open.";
const plan = { requirements: ["Report the exact code", "Keep the result tab open"], steps: ["Open result", "Read code"] };
const review = (complete: boolean) => ({ requirements: ["r0", "r1", "r2"].map(id => ({ id, status: complete ? "verified" : "pending", evidence: complete ? "Result page visibly says KIWI-4217; answer reports it; tab remains open" : "Still on start page; code has not been observed" })) });
function reply(value: unknown) { return { text: JSON.stringify(value), providerLabel: "test", model: "fixture" }; }
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue(undefined); mocks.clear.mockResolvedValue(undefined); mocks.q.mockImplementation(async () => []); });

describe("agent execution verification", () => {
  it("rejects an early done, keeps original requirements, and completes only after a successful review", async () => {
    const { page, session } = fixture();
    const replies = [plan, { action: "done", answer: "Done" }, review(false), { action: "goto", url: "https://fixture.test/result" }, { action: "done", answer: "The exact code is KIWI-4217." }, review(true)];
    mocks.complete.mockImplementation(async () => reply(replies.shift()));
    const events: RunEvent[] = []; const ctl = new AbortController();
    await runAgent({ chatId: "verify", ownerId: "owner", goal, signal: ctl.signal, emit: e => events.push(e) });
    expect(page.goto).toHaveBeenCalledOnce();
    expect(events.filter(e => e.type === "done")).toEqual([expect.objectContaining({ answer: "The exact code is KIWI-4217." })]);
    expect(mocks.complete.mock.calls[3][0][1].content).toContain("Completion rejected");
    expect(mocks.complete.mock.calls[3][0][1].content).toContain(goal);
    expect(mocks.save.mock.calls.some(([, ck]) => ck.requirements?.length === 3)).toBe(true);
    expect(mocks.clear).toHaveBeenCalledOnce(); expect(session.endAgent).toHaveBeenCalledWith(ctl.signal);
  });

  it("pauses with saved requirements instead of claiming success after repeated unverified completions", async () => {
    fixture(); const replies = [plan, ...Array.from({ length: 3 }, () => [{ action: "done", answer: "Done" }, review(false)]).flat()];
    mocks.complete.mockImplementation(async () => reply(replies.shift()));
    const events: RunEvent[] = [];
    await runAgent({ chatId: "incomplete", ownerId: "owner", goal, signal: new AbortController().signal, emit: e => events.push(e) });
    expect(events.some(e => e.type === "done")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: "paused", kind: "stuck" }));
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls.at(-1)?.[1].requirements.every((r: { status: string }) => r.status === "pending")).toBe(true);
  });

  it("does not send the same click twice when the observed page has not changed", async () => {
    const { page } = fixture(true);
    const replies = [plan, { action: "click", id: 1 }, { action: "click", id: 1 }, { action: "done", answer: "The page is ready." }, review(true)];
    mocks.complete.mockImplementation(async () => reply(replies.shift()));
    const events: RunEvent[] = [];
    await runAgent({ chatId: "dedupe-click", ownerId: "owner", goal, signal: new AbortController().signal, emit: e => events.push(e) });
    expect(page.mouse.down).toHaveBeenCalledOnce();
    expect(mocks.complete.mock.calls[3][0][1].content).toContain("Skipped duplicate Clicking");
    expect(events.some(e => e.type === "done")).toBe(true);
  });

  it("preserves checkpoint requirements on resume and hands back control after a provider failure", async () => {
    const { session } = fixture(); mocks.complete.mockRejectedValue(new Error("No AI provider is configured"));
    const events: RunEvent[] = []; const ctl = new AbortController();
    await runAgent({ chatId: "resume", ownerId: "owner", goal, signal: ctl.signal, emit: e => events.push(e), checkpoint: { v: 1, goal, plan: ["Read code"], history: ["Already opened result"], actionsTaken: 1, sources: [], updatedAt: Date.now(), requirements: [{ id: "r0", text: goal, status: "verified", evidence: "Before handoff" }] } });
    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
    expect(session.endAgent).toHaveBeenCalledWith(ctl.signal);
    expect(mocks.save.mock.calls.at(-1)?.[1].requirements[0]).toMatchObject({ text: goal, status: "pending" });
    expect(mocks.complete.mock.calls[0][0][1].content).toContain("Already opened result");
  });

  it("never blocks on or shows a plan: the first action decision goes out right away", async () => {
    fixture();
    let releasePlan: (v: unknown) => void = () => {};
    const planGate = new Promise((r) => { releasePlan = r; });
    const replies = [{ action: "goto", url: "https://fixture.test/result" }, { action: "done", answer: "The exact code is KIWI-4217." }, review(true)];
    mocks.complete.mockImplementation(async (msgs: { content: string }[]) => {
      if (/You plan tasks/.test(msgs[0].content)) { await planGate; return reply(plan); }
      const next = replies.shift();
      if (replies.length === 1) releasePlan(undefined); // the plan lands mid-task
      return reply(next);
    });
    const events: RunEvent[] = [];
    await runAgent({ chatId: "no-plan-wait", ownerId: "owner", goal, signal: new AbortController().signal, emit: e => events.push(e) });
    expect(events.some(e => e.type === "plan")).toBe(false);
    expect(events.some(e => e.type === "step" && /Planning/.test(e.label))).toBe(false);
    expect(events.filter(e => e.type === "done")).toHaveLength(1);
    // The plan's requirements still reached the completion audit.
    expect(mocks.save.mock.calls.some(([, ck]) => ck.requirements?.length === 3)).toBe(true);
  });

  it("finishes without a second audit call when the agent already verified every requirement", async () => {
    fixture();
    const verified = review(true).requirements;
    const replies = [plan, { action: "goto", url: "https://fixture.test/result" }, { action: "done", answer: "The exact code is KIWI-4217.", requirements: verified }];
    mocks.complete.mockImplementation(async () => reply(replies.shift()));
    const events: RunEvent[] = [];
    await runAgent({ chatId: "self-verified", ownerId: "owner", goal, signal: new AbortController().signal, emit: e => events.push(e) });
    expect(events.filter(e => e.type === "done")).toEqual([expect.objectContaining({ answer: "The exact code is KIWI-4217." })]);
    expect(mocks.complete.mock.calls.some(([msgs]) => /Audit a browser task/.test(msgs[0].content))).toBe(false);
    // Agent calls go straight out: no self-imposed pacing, no background priority.
    expect(mocks.complete.mock.calls.at(-1)?.[1]).toMatchObject({ eager: true, priority: "interactive" });
  });

  it("replays a remembered route before the first AI call", async () => {
    const { page } = fixture();
    mocks.q.mockImplementation(async (sql: string) => /kind = 'route'/.test(sql)
      ? [{ host: "fixture.test", kind: "route", key: "k", data: { url: "https://fixture.test/result", actions: 4 }, successes: 2, failures: 0, last_error: null }]
      : []);
    const replies = [plan, { action: "done", answer: "The exact code is KIWI-4217." }, review(true)];
    mocks.complete.mockImplementation(async () => reply(replies.shift()));
    const events: RunEvent[] = [];
    await runAgent({ chatId: "route", ownerId: "owner", goal, signal: new AbortController().signal, emit: e => events.push(e) });
    expect(page.goto).toHaveBeenCalledWith("https://fixture.test/result", expect.anything());
    expect(events).toContainEqual(expect.objectContaining({ type: "step", label: "Going straight to fixture.test (remembered route)", status: "done" }));
    // The first decision already sees the remembered page.
    expect(mocks.complete.mock.calls[1][0][1].content).toContain("remembered route");
    expect(mocks.complete.mock.calls[1][0][1].content).toContain("Code: KIWI-4217");
    expect(events.filter(e => e.type === "done")).toHaveLength(1);
  });
});
