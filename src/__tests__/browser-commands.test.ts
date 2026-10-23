import { describe, it, expect } from "vitest";
import { parseBrowserCommand, extractOpenTags } from "@/lib/browser-commands";

describe("parseBrowserCommand", () => {
  const cases: [string, string | null][] = [
    ["Open YouTube in a new tab and search MrBeast", "https://www.youtube.com/results?search_query=mrbeast"],
    ["Open Crunchyroll and play Spy x Family", "https://www.crunchyroll.com/search?q=spy%20x%20family"],
    ["can you please open up youtube and look up lofi beats", "https://www.youtube.com/results?search_query=lofi%20beats"],
    ["put on spy x family on crunchyroll", "https://www.crunchyroll.com/search?q=spy%20x%20family"],
    ["search mrbeast on youtube", "https://www.youtube.com/results?search_query=mrbeast"],
    ["search reddit for mechanical keyboards", "https://www.reddit.com/search/?q=mechanical%20keyboards"],
    ["go to youtube then search for minecraft speedruns", "https://www.youtube.com/results?search_query=minecraft%20speedruns"],
    ["hey take me to netflix", "https://www.netflix.com"],
    ["open youtube", "https://www.youtube.com"],
    ["open google images and search cats", "https://www.google.com/search?tbm=isch&q=cats"],
    ["go to example.com", "https://example.com/"],
    ["Open Wikipedia's page on Japan", "https://en.wikipedia.org/wiki/Special:Search?go=Go&search=japan"],
    ["open the japan page on wikipedia", "https://en.wikipedia.org/wiki/Special:Search?go=Go&search=japan"],
    ["what is the capital of france", null],
    ["tell me about youtube's history", null],
    ["Look up Spy x Family, find where I can watch it free, and open episode 2", null],
  ];

  for (const [input, url] of cases) {
    it(input, () => {
      const r = parseBrowserCommand(input);
      expect(r?.url ?? null).toBe(url);
    });
  }
});

describe("extractOpenTags", () => {
  it("pulls actions out and strips them from text", () => {
    const { clean, actions } = extractOpenTags("Sure! [[open: https://tubitv.com/search/naruto | Tubi: Naruto]]");
    expect(clean).toBe("Sure!");
    expect(actions).toEqual([{ url: "https://tubitv.com/search/naruto", label: "Tubi: Naruto" }]);
  });

  it("ignores non-http urls", () => {
    expect(extractOpenTags("[[open: javascript:alert(1)]]").actions).toEqual([]);
  });
});
