// Real engines, real links. Run: npx vitest run --config vitest.live.config.ts (or the include override below).
import { describe, it, expect } from "vitest";
import { searchWeb } from "@/lib/server/web-search";

const cases: [string, "off" | "moderate" | "strict", number][] = [
  ["fnf hentai", "off", 20],
  ["fnf hentai", "strict", 20],
  ["rust borrow checker documentation", "off", 10],
  ["hollow knight silksong", "off", 10],
  ["friday night funkin fan art", "off", 10],
  ["best free online image editor", "off", 10],
];

describe.sequential("live search", () => {
  for (const [q, safe, n] of cases) {
    it(`${q} [${safe}]`, async () => {
      const run = await searchWeb(q, { safe, count: n });
      const cats: Record<string, number> = {};
      for (const r of run.results) cats[r.category] = (cats[r.category] || 0) + 1;
      console.log(`\n=== "${q}" safe=${safe}: ${run.results.length} results, engines=${run.engines.join(",")} hiddenAdult=${run.hiddenAdult}`);
      console.log("attempts:", run.attempts.map((a) => `${a.engine}:${a.count}/${a.relevant}${a.error ? ` ERR ${a.error}` : ""} ${a.ms}ms`).join(" | "));
      console.log("categories:", JSON.stringify(cats));
      for (const r of run.results) console.log(`  [${r.category}] [${r.link}] ${r.source} | ${r.title.slice(0, 70)}`);
      if (safe !== "off") expect(run.results.some((r) => r.category === "adult")).toBe(false);
      else expect(run.results.length).toBeGreaterThan(0);
    }, 60_000);
  }
});

describe("live chat turn", () => {
  it("writes the reply from real results", async () => {
    const { searchTurn } = await import("@/lib/server/search-reply");
    for (const text of ["top 20 sites for fnf hentai", "search nextjs app router documentation"]) {
      const turn = await searchTurn(text, "off", () => {});
      console.log(`\n>>> ${text}\n${turn?.content}\ncard: ${turn?.meta.search?.results.length} results, engines ${turn?.meta.search?.engines}`);
      expect(turn?.meta.search?.results.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
