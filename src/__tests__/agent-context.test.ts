import { describe, it, expect } from "vitest";
import { compactSources, historyLine, isSimpleGoal, parseMediaCommand, shortUrl, type SourcePage } from "@/lib/agent/context";
import { estimateTokens } from "@/lib/llm";

/** 12 booru-style result pages with 24 images each, like an image-collage task builds up. */
function visitedPages(): Map<string, SourcePage> {
  const m = new Map<string, SourcePage>();
  for (let p = 0; p < 12; p++) {
    m.set(`https://safebooru.org/index.php?page=post&s=list&tags=eevee&pid=${p * 40}`, {
      title: `Eevee | Safebooru page ${p + 1}`,
      images: Array.from({ length: 24 }, (_, i) => ({
        url: `https://safebooru.org//samples/4${p}${i}/sample_${"a1b2c3d4e5f6".repeat(3)}${p}${i}.jpg?${4000000 + p * 100 + i}`,
        alt: `eevee pokemon solo smile open mouth looking at viewer fluffy ${"tag ".repeat(20)}`.slice(0, 160),
        col: i % 4,
        row: Math.floor(i / 6),
      })),
    });
  }
  return m;
}

describe("agent prompt size", () => {
  it("sends a fraction of the tokens the old JSON dump of every source page did", () => {
    const visited = visitedPages();
    const current = [...visited.keys()].pop();
    const before = JSON.stringify([...visited.entries()].slice(-12).map(([url, data]) => ({ url, ...data })));
    const after = compactSources(visited, current);
    // Measured on this data: ~22k tokens per step before, ~1.6k after.
    expect(estimateTokens(before)).toBeGreaterThan(12_000);
    expect(estimateTokens(after)).toBeLessThan(2_000);
    // Still enough for the final answer: every earlier page link plus real image URLs.
    expect(after.split("\n- ").length).toBe(8);
    expect(after).toContain("https://safebooru.org//samples/");
    expect(after).not.toContain(current!); // the current page is described in full elsewhere
  });

  it("shortens long redirect links and caps history lines", () => {
    const bing = `https://www.bing.com/ck/a?!&&p=${"9f8e7d6c".repeat(70)}&ptn=3&ver=2`;
    expect(shortUrl(bing).length).toBe(161);
    expect(shortUrl("https://example.com/a")).toBe("https://example.com/a");
    const line = historyLine(3, { action: "type", id: 4, text: "x".repeat(2000), thought: "t", check: { ok: true } }, "Typed " + "y".repeat(2000));
    expect(line.length).toBeLessThan(620);
    expect(line).not.toContain('"thought"');
    expect(line.startsWith("3. ")).toBe(true);
  });
});

describe("skipping AI calls that aren't needed", () => {
  it("knows which goals need no separate planning call", () => {
    for (const g of ["pause", "next episode", "what is this site?", "scroll down a bit", "open youtube", "summarize this page"]) {
      expect(isSimpleGoal(g), g).toBe(true);
    }
    for (const g of [
      "download the top 5 eevee images and make a collage",
      "find the cheapest flight to tokyo and compare three airlines",
      "open youtube and then play lofi hip hop radio",
      "graph a 3D torus in desmos with sliders for both radii",
    ]) {
      expect(isSimpleGoal(g), g).toBe(false);
    }
  });

  it("recognizes plain media commands, and nothing more", () => {
    expect(parseMediaCommand("pause")).toBe("pause");
    expect(parseMediaCommand("Pause it.")).toBe("pause");
    expect(parseMediaCommand("please resume the video")).toBe("play");
    expect(parseMediaCommand("play")).toBe("play");
    expect(parseMediaCommand("mute")).toBe("mute");
    expect(parseMediaCommand("unmute it")).toBe("unmute");
    expect(parseMediaCommand("go fullscreen")).toBe("fullscreen");
    expect(parseMediaCommand("exit fullscreen")).toBe("exit_fullscreen");
    expect(parseMediaCommand("play the next episode")).toBeNull();
    expect(parseMediaCommand("play lofi hip hop")).toBeNull();
    expect(parseMediaCommand("pause and tell me the time")).toBeNull();
  });
});
