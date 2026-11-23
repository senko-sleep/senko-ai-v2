import { describe, expect, it } from "vitest";
import { imageSearchIntent } from "@/lib/agent/context";
import { detectImageIntentQuery } from "@/lib/server/images";
import { detectSearchRequest } from "@/lib/search/intent";

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
    ["Send 5 images of a tsundere", { query: "tsundere", engine: "google", simple: true }],
    ["send me three pictures of red foxes", { query: "red foxes", engine: "google", simple: true }],
    ["send me 4 eevee pics", { query: "eevee", engine: "google", simple: true }],
  ])("%s", (goal, want) => {
    expect(imageSearchIntent(goal)).toEqual(want);
  });

  it.each(["open youtube and play lofi", "search for the best pizza near me", "what is this page about", "play the video", "send an email with pictures of my dog", "send 3 photos of cats to jordan"])("not an image search: %s", (goal) => {
    expect(imageSearchIntent(goal)).toBeNull();
  });
});

describe("image requests stay out of web-results routing", () => {
  it("recognizes an image request even when it also asks for an explanation and layout", () => {
    const request = "look up images of Anya Forger make a dynamic layout explaining who she is";
    expect(detectImageIntentQuery(request)).toBeTruthy();
    // The general search parser also sees this as a search; reply routing must prioritize the image intent.
    expect(detectSearchRequest(request)).toBeTruthy();
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
