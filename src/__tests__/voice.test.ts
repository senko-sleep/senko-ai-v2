import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/server/db", () => ({ newId: vi.fn(), q: vi.fn() }));
vi.mock("@/lib/server/voice-policy", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/server/voice-policy")>();
  return { ...original, withVoiceBudget: async (_owner: string, _signal: AbortSignal | undefined, work: (s: AbortSignal) => Promise<unknown>) => work(new AbortController().signal) };
});
import { voiceEngines, synthesizeVoice, type VoiceEngine } from "@/lib/server/voice";
import { detectVoiceRequest } from "@/lib/voice/intent";

afterEach(() => vi.unstubAllEnvs());
const custom: VoiceEngine = { id: "custom", available: () => true, synthesize: vi.fn(async () => { throw new Error("offline"); }) };
const preset: VoiceEngine = { id: "elevenlabs", available: () => true, synthesize: vi.fn() };

describe("original voice identity", () => {
  it("keeps a strict original-only configuration when fallback is disabled", async () => {
    vi.stubEnv("SENKO_VOICE_ENGINE", "custom");
    vi.stubEnv("SENKO_VOICE_FALLBACK", "none");
    const engines = voiceEngines([custom, preset]);
    expect(engines.map(e => e.id)).toEqual(["custom"]);
    await expect(synthesizeVoice({ text: "Hello", ownerId: "owner" }, engines)).rejects.toThrow("Speech generation failed");
    expect(preset.synthesize).not.toHaveBeenCalled();
  });
  it("does not select an available preset when the original model is absent", () => {
    vi.stubEnv("SENKO_VOICE_ENGINE", "custom");
    expect(voiceEngines([preset])).toEqual([]);
  });
  it("recognizes new replies and repeats, and respects refusal", () => {
    expect(detectVoiceRequest("send me an audio response")).toEqual({ mode: "reply" });
    expect(detectVoiceRequest("say that out loud", true)).toEqual({ mode: "repeat" });
    expect(detectVoiceRequest("don't send me a voice message")).toBeNull();
  });
});
