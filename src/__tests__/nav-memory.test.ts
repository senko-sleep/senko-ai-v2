import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db", () => ({ q: vi.fn(async () => []) }));
import { fingerprintKey, goalKey, hostsInGoal, memoryHints, searchTemplate, type ElementFingerprint, type MemoryRow } from "@/lib/agent/nav-memory";

const fp = (text: string, extra: Partial<ElementFingerprint> = {}): ElementFingerprint => ({ tag: "button", text, href: "", role: "", ctx: "", nth: 0, ...extra });

describe("search URL learning", () => {
  it("turns a results URL into a template with only the query parameter", () => {
    expect(searchTemplate("https://shop.test/results?q=blue+widget&session=abc", "blue widget")).toBe("https://shop.test/results?q={query}");
    expect(searchTemplate("https://wiki.test/search/blue%20widget", "blue widget")).toBe("https://wiki.test/search/{query}");
  });
  it("learns nothing when the URL doesn't contain the query", () => {
    expect(searchTemplate("https://shop.test/results?id=42", "blue widget")).toBeNull();
    expect(searchTemplate("https://shop.test/results?q=a", "a")).toBeNull();
  });
});

describe("element fingerprints", () => {
  it("ignore counts, ids in paths and query strings so a control matches across visits", () => {
    const a = fingerprintKey(fp("Cart (3)", { tag: "a", href: "https://shop.test/cart/123?ref=x" }));
    const b = fingerprintKey(fp("Cart (5)", { tag: "a", href: "https://shop.test/cart/987?ref=y" }));
    expect(a).toBe(b);
  });
  it("keep repeated buttons apart by their item context", () => {
    expect(fingerprintKey(fp("Like", { ctx: "Post 3" }))).not.toBe(fingerprintKey(fp("Like", { ctx: "Post 4" })));
  });
});

describe("memory hints", () => {
  const rows: MemoryRow[] = [
    { kind: "element", key: fingerprintKey(fp("Checkout")), data: { text: "Checkout", method: "closed an overlay first" }, successes: 3, failures: 1, lastError: null },
    { kind: "element", key: fingerprintKey(fp("Sign in")), data: { text: "Sign in" }, successes: 0, failures: 2, lastError: "covered by div \"captcha\"" },
    { kind: "element", key: fingerprintKey(fp("Not on this page")), data: { text: "Not on this page" }, successes: 9, failures: 0, lastError: null },
    { kind: "search_url", key: "https://shop.test/results?q={query}", data: {}, successes: 1, failures: 0, lastError: null },
  ];
  it("only mentions remembered controls that are on the current page, with their current ids", () => {
    const text = memoryHints(rows, { host: "shop.test", goal: "buy it", elements: [{ id: 7, fp: fp("Checkout") }, { id: 9, fp: fp("Sign in") }] });
    expect(text).toContain('[7] "Checkout" worked 3x before (via closed an overlay first)');
    expect(text).toContain('AVOID [9] "Sign in"');
    expect(text).not.toContain("Not on this page");
    expect(text).toContain("https://shop.test/results?q={query}");
  });
  it("is empty when nothing applies", () => {
    expect(memoryHints([], { host: "x.test", goal: "", elements: [] })).toBe("");
  });
});

describe("goal parsing", () => {
  it("finds site names in a goal and builds an order-free goal key", () => {
    expect(hostsInGoal("Search www.Fixture.test for blue widget, then open image.png")).toEqual(["fixture.test"]);
    expect(goalKey("Open the Gaming Laptop page")).toBe(goalKey("gaming laptop page, open it"));
  });
});
