import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cseAvailable, cseImageSearch, cseKeys, msUntilPacificMidnight, resetCseQuota } from "@/lib/server/google-cse";

const KEYS = ["GOOGLE_CSE_KEY", "GOOGLE_CSE_KEY_2", "GOOGLE_CSE_KEYS", "GOOGLE_SEARCH_API_KEY", "GOOGLE_CSE_ID"];
const saved: Record<string, string | undefined> = {};

describe("Google search key rotation", () => {
  beforeEach(() => {
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.GOOGLE_CSE_ID = "cx";
    process.env.GOOGLE_CSE_KEY = "key-one";
    process.env.GOOGLE_CSE_KEY_2 = "key-two";
    process.env.GOOGLE_CSE_KEYS = "key-three, key-one";
    resetCseQuota();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    resetCseQuota();
  });

  it("collects every key once", () => {
    expect(cseKeys()).toEqual(["key-one", "key-two", "key-three"]);
  });

  it("moves to the next key when one is out of quota, and remembers it", async () => {
    const used: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const key = new URL(url).searchParams.get("key")!;
      used.push(key);
      if (key === "key-one") return new Response('{"error":{"code":429,"message":"Quota exceeded"}}', { status: 429 });
      return new Response(JSON.stringify({ items: [{ link: `https://img.example/${key}.jpg` }] }), { status: 200 });
    }));
    expect((await cseImageSearch("fox"))[0].link).toBe("https://img.example/key-two.jpg");
    await cseImageSearch("fox again");
    expect(used).toEqual(["key-one", "key-two", "key-two"]);
  });

  it("returns nothing (no throw) once every key is used up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Quota exceeded for quota metric 'Queries'", { status: 429 })));
    expect(await cseImageSearch("fox")).toEqual([]);
    expect(cseAvailable()).toBe(false);
  });

  it("waits until midnight Pacific", () => {
    // 2026-11-09 23:00 Pacific (PST, UTC-8) → 1 hour left.
    expect(msUntilPacificMidnight(new Date("2026-11-10T07:00:00Z"))).toBe(3_600_000);
  });
});
