import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperationManager } from "@/lib/operation-manager";

describe("OperationManager", () => {
  let mgr: OperationManager;

  beforeEach(() => {
    mgr = new OperationManager();
  });

  it("starts idle with no operations", () => {
    expect(mgr.currentPhase).toBe("idle");
    expect(mgr.activeOps).toHaveLength(0);
    expect(mgr.isActive).toBe(false);
  });

  it("transitions to the started phase", () => {
    mgr.startOp("searching", "Searching the web");
    expect(mgr.currentPhase).toBe("searching");
    expect(mgr.isActive).toBe(true);
    expect(mgr.activeOps).toHaveLength(1);
  });

  it("returns to idle after completing an operation", () => {
    const { id } = mgr.startOp("generating", "Writing response");
    expect(mgr.currentPhase).toBe("generating");
    mgr.completeOp(id);
    expect(mgr.currentPhase).toBe("idle");
    expect(mgr.isActive).toBe(false);
  });

  it("each operation gets its own AbortController (no clobbering)", () => {
    const op1 = mgr.startOp("searching", "Search 1");
    const op2 = mgr.startOp("generating", "Generate 1");

    // Both signals should be independent
    expect(op1.signal).not.toBe(op2.signal);
    expect(op1.signal.aborted).toBe(false);
    expect(op2.signal.aborted).toBe(false);

    // Aborting op1 should not affect op2
    mgr.abortOp(op1.id);
    expect(op1.signal.aborted).toBe(true);
    expect(op2.signal.aborted).toBe(false);
    expect(mgr.activeOps).toHaveLength(1);
  });

  it("abortAll cancels all operations", () => {
    const op1 = mgr.startOp("searching", "Search");
    const op2 = mgr.startOp("browsing", "Browse");
    const op3 = mgr.startOp("generating", "Generate");

    mgr.abortAll();

    expect(op1.signal.aborted).toBe(true);
    expect(op2.signal.aborted).toBe(true);
    expect(op3.signal.aborted).toBe(true);
    expect(mgr.currentPhase).toBe("idle");
    expect(mgr.activeOps).toHaveLength(0);
  });

  it("highest-priority phase wins when multiple ops are active", () => {
    mgr.startOp("generating", "Generate");
    expect(mgr.currentPhase).toBe("generating");

    mgr.startOp("searching", "Search");
    // searching has higher priority than generating
    expect(mgr.currentPhase).toBe("searching");
  });

  it("notifies listeners on phase changes", () => {
    const listener = vi.fn();
    mgr.subscribe(listener);

    const { id } = mgr.startOp("searching", "Search");
    expect(listener).toHaveBeenCalledWith("searching", expect.any(Array));

    mgr.completeOp(id);
    expect(listener).toHaveBeenCalledWith("idle", []);
  });

  it("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsub = mgr.subscribe(listener);

    mgr.startOp("searching", "Search");
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    mgr.startOp("generating", "Generate");
    expect(listener).toHaveBeenCalledTimes(1); // Not called again
  });

  it("updateLabel changes the operation label", () => {
    const { id } = mgr.startOp("searching", "Initial");
    mgr.updateLabel(id, "Updated label");
    expect(mgr.activeOps[0].label).toBe("Updated label");
  });

  it("updatePhase changes the operation phase", () => {
    const { id } = mgr.startOp("searching", "Search");
    mgr.updatePhase(id, "reading");
    expect(mgr.activeOps[0].phase).toBe("reading");
    expect(mgr.currentPhase).toBe("reading");
  });

  it("failOp removes the operation", () => {
    const { id } = mgr.startOp("searching", "Search");
    mgr.failOp(id, "Network error");
    expect(mgr.activeOps).toHaveLength(0);
    expect(mgr.currentPhase).toBe("idle");
  });

  it("stall detection auto-aborts after timeout", async () => {
    vi.useFakeTimers();
    const { id, signal } = mgr.startOp("generating", "Generate");

    expect(signal.aborted).toBe(false);

    // Advance past stall timeout (60s)
    vi.advanceTimersByTime(61_000);

    expect(signal.aborted).toBe(true);
    expect(mgr.activeOps).toHaveLength(0);

    vi.useRealTimers();
  });

  it("touchOp resets the stall timer", async () => {
    vi.useFakeTimers();
    const { id, signal } = mgr.startOp("generating", "Generate");

    // Advance 50s, then touch
    vi.advanceTimersByTime(50_000);
    expect(signal.aborted).toBe(false);
    mgr.touchOp(id);

    // Advance another 50s — should NOT have timed out because we touched at 50s
    vi.advanceTimersByTime(50_000);
    expect(signal.aborted).toBe(false);

    // Advance past the new stall timeout
    vi.advanceTimersByTime(11_000);
    expect(signal.aborted).toBe(true);

    vi.useRealTimers();
  });

  it("destroy cleans up everything", () => {
    const op1 = mgr.startOp("searching", "Search");
    const listener = vi.fn();
    mgr.subscribe(listener);

    mgr.destroy();

    expect(op1.signal.aborted).toBe(true);
    expect(mgr.activeOps).toHaveLength(0);
    // Listener should not be called after destroy (cleared)
    const callCount = listener.mock.calls.length;
    // Starting a new op after destroy should not notify old listeners
    mgr.startOp("generating", "test");
    expect(listener).toHaveBeenCalledTimes(callCount);
  });

  it("completeOp on non-existent ID is a no-op", () => {
    expect(() => mgr.completeOp("nonexistent")).not.toThrow();
  });

  it("abortOp on non-existent ID is a no-op", () => {
    expect(() => mgr.abortOp("nonexistent")).not.toThrow();
  });
});
