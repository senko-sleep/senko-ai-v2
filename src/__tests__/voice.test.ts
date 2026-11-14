import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/server/db", () => ({ newId: vi.fn(), q: vi.fn() }));
vi.mock("@/lib/server/voice-policy", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/server/voice-policy")>();
  return { ...original, withVoiceBudget: async (_owner: string, _signal: AbortSignal | undefined, work: (s: AbortSignal) => Promise<unknown>) => work(new AbortController().signal) };
});
import { voiceEngines, synthesizeVoice, speechText, type VoiceEngine } from "@/lib/server/voice";
import { detectVoiceRequest } from "@/lib/voice/intent";
import { isActionBeat, neutralPlan, parseDirectorPlan, performanceInstruction, plainSpeech, segmentInstructions, directorPrompt } from "@/lib/voice/performance";

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
    expect(detectVoiceRequest("send me a audio message talking to me about a bed time story about a girl finding out about her sexuality make it fun and in japan should be a anime")).toEqual({ mode: "reply" });
    expect(detectVoiceRequest("send me an audio response")).toEqual({ mode: "reply" });
    expect(detectVoiceRequest("say that out loud", true)).toEqual({ mode: "repeat" });
    expect(detectVoiceRequest("don't send me a voice message")).toBeNull();
  });

  it("preserves standalone action beats in speechText while unwrapping inline emphasis, and strips beats for plain-text engines", () => {
    const raw = "Hmph, don't think I'm *really* doing this 'cause I like you... *pouts*";
    const cleaned = speechText(raw);
    expect(cleaned).toContain("really");
    expect(cleaned).not.toContain("*really*");
    expect(cleaned).toContain("*pouts*");
    expect(plainSpeech(cleaned)).not.toContain("pouts");
    expect(isActionBeat("pouts", "okay? ", "")).toBe(true);
    expect(isActionBeat("really", "I'm ", " doing this")).toBe(false);
  });

  it("validates LLM-directed performance plans without preset anchors and rejects word tampering", () => {
    const transcript = "Hmph, don't think I'm doing this because I like you... But maybe I'll chat a bit. *pouts*";
    const directorJson = JSON.stringify({
      character: "bratty tsundere — sharp defensive shell, secretly flustered",
      segments: [
        { kind: "vocal", description: "short annoyed nasal huff", text: "Hmph!", ipa: "hˈʌmf", emotion: "annoyed", pace: 1.05, energy: 1.0, pitch: 0.2, pauseAfterMs: 180, timbre: { warmth: 0.4, brightness: 0.5, breathiness: 0.1 } },
        { kind: "speech", text: "Hmph, don't think I'm doing this because I like you...", emotion: "defensive", delivery: "sharp, clipped, slightly defensive", pace: 1.08, energy: 1.08, pitch: 0.5, pauseAfterMs: 360, timbre: { warmth: 0.35, brightness: 0.55, breathiness: 0.1 } },
        { kind: "speech", text: "But maybe I'll chat a bit.", emotion: "shy, flustered", delivery: "quieter, hesitant, softer", pace: 0.9, energy: 0.82, pitch: 0.8, pauseAfterMs: 220, timbre: { warmth: 0.6, brightness: 0.2, breathiness: 0.45 } },
        { kind: "vocal", description: "pouty exhale", text: "", ipa: "hˈʌmf", breath: { kind: "exhale", ms: 380 }, emotion: "flustered", pace: 0.92, energy: 0.85, pitch: 0.4, pauseAfterMs: 0 },
      ],
    });
    const plan = parseDirectorPlan(directorJson, transcript);
    expect(plan).not.toBeNull();
    expect(plan!.source).toBe("director");
    expect(plan!.character).toContain("bratty tsundere");
    expect(plan!.segments).toHaveLength(4);
    expect(plan!.segments[3].kind).toBe("vocal");
    expect(performanceInstruction(plan!)).toContain("bratty tsundere");
    expect(segmentInstructions(plan!).length).toBeGreaterThanOrEqual(3);

    // Reject if the director drops or changes spoken words
    const tampered = JSON.stringify({
      character: "tsundere",
      segments: [{ kind: "speech", text: "I totally like you!", emotion: "happy", delivery: "bright", pace: 1, energy: 1, pitch: 0, pauseAfterMs: 0 }],
    });
    expect(parseDirectorPlan(tampered, transcript)).toBeNull();

    // Neutral fallback derives a continuous evolving linguistic contour across clauses and turns action beats into silent pauses
    const multiClause = "Wait, you actually thought that was going to work? Because honestly... I wasn't sure at all — until the very last second! *sighs* Still, we made it through.";
    const fallback = neutralPlan(multiClause);
    expect(fallback.source).toBe("neutral");
    const spokenSegs = fallback.segments.filter(s => s.kind === "speech");
    const spoken = spokenSegs.map(s => s.text).join(" ");
    expect(spoken).not.toContain("sighs");
    expect(fallback.segments.some(s => s.kind === "vocal")).toBe(true);
    // Verify continuous variation across clauses (not flat 1.0/0.0 across every segment)
    const paces = new Set(spokenSegs.map(s => s.prosody.pace));
    const pitches = new Set(spokenSegs.map(s => s.prosody.pitch));
    expect(paces.size).toBeGreaterThan(1);
    expect(pitches.size).toBeGreaterThan(1);
  });

  it("incorporates ambiguous user vocal cues and word-level emphasis into contextual speech planning", () => {
    const prompt = directorPrompt("Take a breath, we can figure this out together.", {
      request: "I thought I passed, but I didn't.",
      recent: ["user: My exam results come out today.", "senko: Fingers crossed for you!"],
      vocalCues: { pacing: "slow, hesitant pauses", tone: "quiet, low energy", confidence: 0.65 },
    });
    expect(prompt).toContain("ambiguous context");
    expect(prompt).toContain("slow, hesitant pauses");
    const raw = JSON.stringify({
      character: "Senko — warm, grounded, quietly reassuring",
      arc: "Starts gentle and unhurried, landing with steady reassurance",
      segments: [
        { kind: "speech", text: "Take a breath,", emotion: "gentle empathy", delivery: "soft, unhurried", pace: 0.88, energy: 0.82, pitch: -0.8, pauseAfterMs: 320, emphasis: ["breath"], timbre: { warmth: 0.7, brightness: 0.2, breathiness: 0.4 } },
        { kind: "speech", text: "we can figure this out together.", emotion: "steady warmth", delivery: "grounded, reassuring", pace: 0.92, energy: 0.88, pitch: -0.3, pauseAfterMs: 0, emphasis: ["together"], timbre: { warmth: 0.68, brightness: 0.28, breathiness: 0.3 } },
      ],
    });
    const plan = parseDirectorPlan(raw, "Take a breath, we can figure this out together.");
    expect(plan).not.toBeNull();
    expect(plan!.arc).toContain("gentle");
    expect(plan!.segments[0].prosody.emphasis).toEqual(["breath"]);
    expect(segmentInstructions(plan!)[0].emphasis).toEqual(["breath"]);
  });
});
