import { describe, expect, it, vi } from "vitest";
import { StrategyMonitor } from "@/lib/agent/strategy";

vi.mock("@/lib/server/db", () => ({ q: vi.fn(async () => []) }));
import { fingerprintKey, memoryHints, preferredMethod, type ElementFingerprint, type MemoryRow } from "@/lib/agent/nav-memory";

const act = (over: Partial<Parameters<StrategyMonitor["record"]>[0]> = {}) => ({ action: "click", ok: true, effect: true, ms: 100, ...over });

describe("strategy monitor", () => {
  it("warns about a loop, then stops it", () => {
    const m = new StrategyMonitor();
    for (const st of ["A", "B", "A", "B", "A", "B", "A"]) { m.observe(st); m.record(act({ target: `next@${st}` })); }
    expect(m.advice()).toContain("LOOP");
    expect(m.stuck()).toBeNull();
    for (const st of ["B", "A", "B", "A"]) m.observe(st);
    expect(m.stuck()).toMatch(/same page \(5 times\)/);
  });

  it("does not treat returning to a results list after each new result as a loop", () => {
    const m = new StrategyMonitor();
    for (let i = 1; i <= 8; i++) { m.observe("results"); m.record(act()); m.observe(`result-${i}`); m.record(act({ action: "back" })); }
    m.observe("results");
    expect(m.stuck()).toBeNull();
    expect(m.advice()).not.toContain("LOOP");
  });

  it("doesn't count passive work (fetching images, screenshots) as lack of progress", () => {
    const m = new StrategyMonitor();
    m.observe("gallery");
    for (let i = 0; i < 12; i++) m.record(act({ action: "fetch_image" }));
    expect(m.stuck()).toBeNull();
  });

  it("blocks a third attempt at a target that failed or did nothing twice, and forgives after a success", () => {
    const m = new StrategyMonitor();
    m.record(act({ target: "el:buy", label: '[3] "Buy"', effect: false, why: "no visible effect" }));
    expect(m.blocked("el:buy")).toBeNull();
    m.record(act({ target: "el:buy", label: '[3] "Buy"', ok: false, why: "covered by banner" }));
    expect(m.blocked("el:buy")).toMatch(/failed 2x/);
    expect(m.advice()).toContain("DON'T RETRY");
    m.record(act({ target: "el:buy", label: '[3] "Buy"' }));
    expect(m.blocked("el:buy")).toBeNull();
    expect(m.stats.recovered).toBe(1);
  });

  it("calls out scroll hunting and stagnation without being noisy on normal progress", () => {
    const m = new StrategyMonitor();
    for (let i = 0; i < 4; i++) { m.observe(`s${i}`); m.record(act()); }
    expect(m.advice()).toBe("");
    for (let i = 0; i < 5; i++) { m.observe("same"); m.record(act({ action: "scroll" })); }
    expect(m.advice()).toContain("SCROLL HUNTING");
    expect(m.advice()).toContain("NO PROGRESS");
  });
});

describe("adaptive memory", () => {
  const fp: ElementFingerprint = { tag: "button", text: "Checkout", href: "", role: "", ctx: "", nth: 0 };
  const row = (over: Partial<MemoryRow>): MemoryRow => ({ kind: "element", key: fingerprintKey(fp), data: {}, successes: 1, failures: 0, lastError: null, ...over });

  it("prefers the keyboard only while it keeps working", () => {
    expect(preferredMethod([row({ data: { method: "keyboard (pointer blocked by div)" } })], fp)).toBe("keyboard");
    expect(preferredMethod([row({ data: { method: "keyboard" }, successes: 1, failures: 3 })], fp)).toBeNull();
    expect(preferredMethod([row({ data: { method: "pointer" } })], fp)).toBeNull();
  });

  it("drops a search URL that stopped working and offers the one that replaced it", () => {
    const rows: MemoryRow[] = [
      { kind: "search_url", key: "https://s.test/results?q={query}", data: {}, successes: 2, failures: 2, lastError: "HTTP 404" },
      { kind: "search_url", key: "https://s.test/find?query={query}", data: {}, successes: 1, failures: 0, lastError: null },
    ];
    const text = memoryHints(rows, { host: "s.test", goal: "", elements: [] });
    expect(text).toContain("Search URL on s.test: https://s.test/find?query={query}");
    expect(text).toContain("OUTDATED (stopped working: HTTP 404): https://s.test/results?q={query}");
  });
});
