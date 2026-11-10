import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db", () => ({
  q: async () => { throw new Error("no database in tests"); },
  q1: async () => { throw new Error("no database in tests"); },
}));

const { wantsVerificationSkipped } = await import("@/lib/agent/runner");

describe("wantsVerificationSkipped", () => {
  it.each([
    "send me a random video, if you need to fill out a captcha then skip that website",
    "skip any site with a captcha",
    "find a recipe but avoid cloudflare checks",
    "download it, don't solve captchas",
    "get prices, no captchas please",
    "if a site shows a bot check, try another one",
  ])("yes: %s", (goal) => expect(wantsVerificationSkipped(goal)).toBe(true));

  it.each([
    "play lofi music on youtube",
    "solve the captcha on this page for me",
    "sign me up on example.com",
  ])("no: %s", (goal) => expect(wantsVerificationSkipped(goal)).toBe(false));
});
