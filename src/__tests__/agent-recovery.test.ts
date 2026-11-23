import { describe, expect, it } from "vitest";
import { isCookieBanner, RecoveryLadder } from "@/lib/agent/recovery-ladder";
import { StrategyMonitor } from "@/lib/agent/strategy";

describe("recovery ladder", () => {
  it("escalates through different tactics, then gives up", () => {
    const ladder = new RecoveryLadder();
    const seen = new Set<string>();
    for (let i = 0; i < ladder.maxAttempts; i++) seen.add(ladder.next()!.instruction);
    expect(seen.size).toBe(ladder.maxAttempts);
    expect(ladder.next()).toBeNull();
  });

  it("starts over after real progress", () => {
    const ladder = new RecoveryLadder();
    ladder.next();
    ladder.next();
    ladder.reset();
    expect(ladder.next()?.attempt).toBe(1);
  });

  it("clears loop counters but remembers what failed", () => {
    const strategy = new StrategyMonitor();
    for (let i = 0; i < 6; i++) strategy.observe("same-state", "https://a.example/page");
    expect(strategy.stuck()).toBeTruthy();
    strategy.recordFailedUrl("https://a.example/x.jpg", "http_403", "forbidden");
    strategy.clearStuck();
    expect(strategy.stuck()).toBeNull();
    expect(strategy.failedUrlReason("https://a.example/x.jpg")).toBeTruthy();
  });
});

describe("cookie banner detection", () => {
  it("recognizes plain cookie and privacy banners", () => {
    expect(isCookieBanner("We use cookies to improve your experience")).toBe(true);
    expect(isCookieBanner("Your privacy choices")).toBe(true);
  });

  it("never treats binding or gated dialogs as cookie banners", () => {
    expect(isCookieBanner("Accept our terms and cookies")).toBe(false);
    expect(isCookieBanner("Cookies and subscription billing")).toBe(false);
    expect(isCookieBanner("Are you 18+? This site uses cookies")).toBe(false);
    expect(isCookieBanner("Sign up for our newsletter")).toBe(false);
    expect(isCookieBanner(null)).toBe(false);
  });
});
