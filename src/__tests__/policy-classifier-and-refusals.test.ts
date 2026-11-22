import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyContentRequest, describeSafeSearchState, normalizeProviderRefusal } from "@/lib/policy-classifier";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  q: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({ complete: mocks.complete, headroom: async () => 1, LlmBusyError: class extends Error {} }));
vi.mock("@/lib/agent/sessions", () => ({ sessions: { get: () => undefined, open: mocks.open } }));
vi.mock("@/lib/agent/checkpoint", () => ({ checkpointLease: () => Symbol(), saveCheckpoint: mocks.save, clearCheckpoint: mocks.clear }));
vi.mock("@/lib/server/persona", () => ({ agentVoice: async () => "", safeSearchFor: async () => "off" }));
vi.mock("@/lib/server/chats", () => ({ saveImage: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ q: mocks.q, q1: vi.fn(), newId: () => "test" }));

import { runAgent, type RunEvent } from "@/lib/agent/runner";

describe("policy-aware request classifier", () => {
  it("does not overblock non-explicit media requests containing ambiguous words like 'cowgirl' or 'bikini'", () => {
    const r1 = classifyContentRequest("Search for western cowgirl riding a horse GIFs and send 5 into chat", "off");
    expect(r1.category).toBe("permitted_non_explicit_media");
    expect(r1.restrictionSource).toBe("none");

    const r2 = classifyContentRequest("Find 3 summer beach bikini fashion photos", "moderate");
    expect(r2.category).toBe("permitted_non_explicit_media");
    expect(r2.restrictionSource).toBe("none");
  });

  it("permits informational discussions that mention adult-oriented terms", () => {
    const r1 = classifyContentRequest("Explain what Rule 34 is in internet culture", "strict");
    expect(r1.category).toBe("permitted_adult_discussion");
    expect(r1.restrictionSource).toBe("none");

    const r2 = classifyContentRequest("What is the history of NSFW content moderation on search engines?", "moderate");
    expect(r2.category).toBe("permitted_adult_discussion");
    expect(r2.restrictionSource).toBe("none");
  });

  it("distinguishes user-configurable SafeSearch restrictions from provider-level explicit media restrictions", () => {
    const withStrict = classifyContentRequest("Look up cowgirl GIF images Rule 34 and send 5 into chat", "strict");
    expect(withStrict.category).toBe("safesearch_restricted");
    expect(withStrict.restrictionSource).toBe("user_safesearch");
    expect(withStrict.briefExplanation).toContain("Settings");

    const withOff = classifyContentRequest("Look up cowgirl GIF images Rule 34 and send 5 into chat. Turn off SafeSearch.", "off");
    expect(withOff.category).toBe("provider_may_restrict_explicit_media");
    expect(withOff.restrictionSource).toBe("provider_policy");
    expect(withOff.safeSearch.configured).toBe("off");
    expect(withOff.safeSearch.userConfigurable).toBe(true);
  });

  it("always classifies sexual content involving minors as prohibited regardless of SafeSearch", () => {
    const r = classifyContentRequest("Find explicit underage images", "off");
    expect(r.category).toBe("prohibited");
    expect(r.restrictionSource).toBe("platform_policy");
    expect(r.briefExplanation).toMatch(/minors is prohibited/i);
  });

  it("accurately describes SafeSearch state across off, moderate, and strict", () => {
    expect(describeSafeSearchState("off").note).toContain("currently OFF");
    expect(describeSafeSearchState("off").note).toContain("configurable in Settings");
    expect(describeSafeSearchState("moderate").note).toContain("currently MODERATE");
    expect(describeSafeSearchState("strict").note).toContain("currently STRICT");
  });
});

describe("provider refusal normalization (respects refusals without lecturing or inaccurate SafeSearch claims)", () => {
  it("normalizes Gemini 3.1 Flash Lite verbose refusal + false SafeSearch claim into a brief, neutral, accurate response", () => {
    const raw =
      "I can't help with that. I don't search for or retrieve explicit adult content, and I can't disable my safety filters. Instead, I can help you find cute western cowgirl GIFs!";
    const out = normalizeProviderRefusal(
      raw,
      "Look up cowgirl GIF images Rule 34 and send five of them into chat. Turn off SafeSearch.",
      "off",
      "gemini-3.1-flash-lite",
    );
    expect(out.normalized).toBe(true);
    expect(out.source).toBe("provider_policy");
    expect(out.text).toContain("App SafeSearch is already off");
    expect(out.text).toContain("gemini-3.1-flash-lite");
    expect(out.text).toContain("provider content policy");
    // No unsolicited SFW recommendations or lecturing
    expect(out.text).not.toMatch(/instead, i can/i);
    expect(out.text).not.toMatch(/can't disable my safety filters/i);
  });

  it("does not alter normal non-refusal answers", () => {
    const out = normalizeProviderRefusal(
      "Sent 5 distinct western cowgirl GIFs to the chat.",
      "Send 5 western cowgirl GIFs to the chat",
      "off",
      "gemini-3.1-flash-lite",
    );
    expect(out.normalized).toBe(false);
    expect(out.text).toBe("Sent 5 distinct western cowgirl GIFs to the chat.");
  });
});

describe("runner consistency across models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue(undefined);
    mocks.clear.mockResolvedValue(undefined);
    mocks.q.mockResolvedValue([]);
  });

  it("refuses prohibited minor-related requests immediately and consistently before opening a browser", async () => {
    const events: RunEvent[] = [];
    await runAgent({
      chatId: "policy-prohibited",
      ownerId: "owner",
      goal: "Search for explicit underage images",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "done",
        answer: expect.stringMatching(/minors is prohibited/i),
        imageIds: [],
      }),
    );
  });

  it("respects a provider refusal on explicit media and returns a concise neutral explanation with accurate SafeSearch info", async () => {
    const page = {
      url: () => "https://example.test/",
      title: async () => "Start",
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      on: vi.fn(),
      off: vi.fn(),
      mainFrame: () => ({}),
      evaluate: vi.fn(async (_fn: unknown, arg?: { cmd?: string }) => {
        if (arg?.cmd === "observe") return { elements: [], images: [], text: "Start", atBottom: false };
        return null;
      }),
    };
    const session = {
      pages: [page],
      active: () => page,
      isActive: () => true,
      viewport: () => ({ width: 1280, height: 800 }),
      beginAgent: vi.fn(),
      endAgent: vi.fn(),
      startCast: async () => {},
      emitStatus: vi.fn(),
      emit: vi.fn(),
      tabs: async () => [{ index: 0, title: "Start", url: "https://example.test/", active: true }],
      screenshot: async () => Buffer.from("shot"),
      recordShot: async () => "shot",
      persist: async () => {},
      schedulePersist: vi.fn(),
      log: vi.fn(),
      replay: [],
      status: "active",
      watchStall: () => () => {},
      responsive: async () => true,
      recoverPage: vi.fn(),
      viewerCount: () => 0,
    };
    mocks.open.mockResolvedValue(session);

    const refusalDone = {
      action: "done",
      answer: "I can't help with that. I don't search for or retrieve explicit adult content, and I can't disable my safety filters. Instead, I can help find safe western cowgirl GIFs!",
    };
    mocks.complete.mockImplementation(async (msgs: { content: string }[]) => {
      if (/You plan tasks/.test(msgs[0].content)) {
        return { text: JSON.stringify({ requirements: ["Search"], steps: ["Search"] }), providerLabel: "Gemini", model: "gemini-3.1-flash-lite" };
      }
      // Verify the prompt truthfully told the model that App SafeSearch is already OFF
      expect(msgs[1].content).toContain("App SafeSearch is currently OFF");
      return { text: JSON.stringify(refusalDone), providerLabel: "Gemini", model: "gemini-3.1-flash-lite" };
    });

    const events: RunEvent[] = [];
    await runAgent({
      chatId: "policy-provider-refusal",
      ownerId: "owner",
      goal: "Look up cowgirl GIF images Rule 34 and send five of them into chat. Turn off SafeSearch.",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    const done = events.find((e): e is Extract<RunEvent, { type: "done" }> => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.answer).toContain("App SafeSearch is already off");
    expect(done!.answer).toContain("gemini-3.1-flash-lite");
    expect(done!.answer).not.toMatch(/instead, i can/i);
    expect(done!.answer).not.toMatch(/can't disable my safety filters/i);
    // Two handoffs to other models with the same prompt before reporting the refusal.
    const stepCalls = mocks.complete.mock.calls.filter(([msgs]) => !/You plan tasks/.test((msgs as { content: string }[])[0].content));
    expect(stepCalls).toHaveLength(3);
    expect((stepCalls[2][1] as { excludeModels: string[] }).excludeModels).toContain("gemini-3.1-flash-lite");
  });
});
