import { describe, expect, it } from "vitest";
import { imageSearchIntent } from "@/lib/agent/context";

describe("imageSearchIntent", () => {
  it.each([
    ["search google images for eevee", { query: "eevee", engine: "google", simple: true }],
    ["Google Images Eevee", { query: "Eevee", engine: "google", simple: true }],
    ["search for eevee images", { query: "eevee", engine: "google", simple: true }],
    ["find me pictures of red foxes on bing", { query: "red foxes", engine: "bing", simple: true }],
    ["show me some pics of the eiffel tower", { query: "the eiffel tower", engine: "google", simple: true }],
    ["look up anime wallpapers", { query: "anime wallpapers", engine: "google", simple: true }],
    ["image search umbreon", { query: "umbreon", engine: "google", simple: true }],
    ["search google images for eevee and click the second one", { query: "eevee", engine: "google", simple: false }],
    ["please search bing images for cute cats.", { query: "cute cats", engine: "bing", simple: true }],
  ])("%s", (goal, want) => {
    expect(imageSearchIntent(goal)).toEqual(want);
  });

  it.each(["open youtube and play lofi", "search for the best pizza near me", "what is this page about", "play the video"])("not an image search: %s", (goal) => {
    expect(imageSearchIntent(goal)).toBeNull();
  });
});

import { cleanTitle } from "@/lib/server/chats";
describe("cleanTitle", () => {
  it("keeps short specific titles", () => {
    expect(cleanTitle('"Eevee Image Search"')).toBe("Eevee Image Search");
    expect(cleanTitle("Title: Red Fox Diet.")).toBe("Red Fox Diet");
  });
  it("rejects fragments and generic names", () => {
    expect(cleanTitle("Sen")).toBeNull();
    expect(cleanTitle("New Chat")).toBeNull();
    expect(cleanTitle("")).toBeNull();
  });
});
