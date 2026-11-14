import { describe, expect, it, vi } from "vitest";
import { prepareSpokenReply, spokenDraftIssue } from "@/lib/voice/reply";
import { suggestedVoiceSeconds, requestedVoiceSeconds } from "@/lib/voice/intent";

describe("spoken replies before synthesis", () => {
  it("gives audio stories a longer default without changing ordinary replies or explicit budgets", () => {
    expect(suggestedVoiceSeconds("send me an audio bedtime story about a girl in Japan")).toBe(600);
    expect(suggestedVoiceSeconds("send me an audio message about cats")).toBeUndefined();
    expect(suggestedVoiceSeconds("write a story about cats")).toBeUndefined();
    expect(requestedVoiceSeconds("send me a ten second story")).toBeUndefined();
    expect(requestedVoiceSeconds("send me a 30 second audio story") ?? suggestedVoiceSeconds("send me a 30 second audio story")).toBe(30);
  });
  it("rewrites a plot summary that is too short for a requested story", async () => {
    const rewrite = vi.fn(async () => "Aoi smiled. ".repeat(70));
    await expect(prepareSpokenReply("Aoi came out. The end.", 192, 15000, rewrite, 138)).resolves.toContain("Aoi smiled.");
    expect(rewrite).toHaveBeenCalledWith(expect.stringContaining("too short"));
  });
  it("runs an earnest narrative polish pass on story drafts before synthesis", async () => {
    const rewrite = vi.fn();
    const polish = vi.fn(async (draft: string) => `${draft} Beneath the cherry blossoms, Haru finally spoke from the heart. `.repeat(3));
    const polished = await prepareSpokenReply("In Tokyo, Haru opened her sketchbook and smiled at Yuki.", 500, 15000, rewrite, 20, polish);
    expect(polish).toHaveBeenCalledTimes(1);
    expect(rewrite).not.toHaveBeenCalled();
    expect(polished).toContain("Beneath the cherry blossoms");
  });
  it.each([
    "I can't actually send audio, so read this in your head.",
    "I cannot record a voice message.",
    "My voice doesn't come out as a file.",
    "Audio is not supported here.",
    "I can only provide text.",
  ])("rejects a false capability disclaimer: %s", text => {
    expect(spokenDraftIssue(text, 100, 1500)).toContain("capability");
  });
  it("preserves a complete valid story without rewriting", async () => {
    const text = "In Kyoto, Aoi confessed her crush. Mizuki smiled and took her hand. Beneath the lanterns, Aoi finally felt at home.";
    const rewrite = vi.fn();
    expect(await prepareSpokenReply(text, 42, 1500, rewrite)).toBe(text);
    expect(rewrite).not.toHaveBeenCalled();
  });
  it.each(["I can't send audio.", "A story. ".repeat(100), "**A bedtime story**"])("repairs an invalid draft once", async text => {
    const rewrite = vi.fn(async () => "Aoi told Mizuki she loved her. Mizuki smiled. Under Kyoto's stars, they held hands.");
    expect(await prepareSpokenReply(text, 42, 1500, rewrite)).toContain("held hands");
    expect(rewrite).toHaveBeenCalledTimes(1);
  });
  it("fails explicitly if the rewrite is still invalid, without clipping", async () => {
    const rewrite = vi.fn(async () => "long ".repeat(100));
    await expect(prepareSpokenReply("I can't send audio.", 42, 1500, rewrite)).rejects.toThrow("speaking budget");
    expect(rewrite).toHaveBeenCalledTimes(1);
  });
});
