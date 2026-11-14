/**
 * Custom Voice Synthesizer for Senko AI
 * Uses ElevenLabs API for high-quality, natural-sounding TTS.
 * API key is kept server-side via /api/tts Next.js route.
 *
 * Voice IDs:
 *   senko        — 0pp5yzIOzec4Wxoq3nFk  (default cute female)
 *   senko_male   — lA7QNDnddpwf5IV5VYI9  (male)
 *   senko_female — u5WvEb7MmyzsxIMxJIYZ  (female alt)
 */

// ═══════════════════════════════════════════════════════════════════════════
// VOICE PRESETS — ElevenLabs voice IDs + voice settings
// stability:       0-1  (lower = more expressive/variable, higher = consistent)
// similarityBoost: 0-1  (how closely to match the original voice)
// style:           0-1  (style exaggeration — use sparingly, adds latency)
// ═══════════════════════════════════════════════════════════════════════════

export type VoiceGender = "female" | "male";

export interface VoicePreset {
  name: string;
  gender: VoiceGender;
  voiceId: string;
  stability: number;
  similarityBoost: number;
  style: number;
}

export const VOICE_PRESETS: Record<string, VoicePreset> = {
  // ── Senko: cute, expressive, playful ────────────────────────────────────
  // Low stability = more pitch variation and expressiveness (cute/lively)
  // High similarity = stays true to the voice character
  senko: {
    name: "Senko (Cute)",
    gender: "female",
    voiceId: "0pp5yzIOzec4Wxoq3nFk",
    stability: 0.35,        // Low = expressive, variable, playful
    similarityBoost: 0.85,
    style: 0.2,             // Slight style boost for extra character
  },
  // ── Senko Female alt ────────────────────────────────────────────────────
  senko_female: {
    name: "Senko (Female)",
    gender: "female",
    voiceId: "u5WvEb7MmyzsxIMxJIYZ",
    stability: 0.50,        // Balanced — natural and consistent
    similarityBoost: 0.80,
    style: 0.0,
  },
  // ── Senko Male ──────────────────────────────────────────────────────────
  senko_male: {
    name: "Senko (Male)",
    gender: "male",
    voiceId: "lA7QNDnddpwf5IV5VYI9",
    stability: 0.55,        // Slightly more stable = confident/grounded
    similarityBoost: 0.80,
    style: 0.0,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// TEXT CLEANING — strip markdown before sending to TTS
// ═══════════════════════════════════════════════════════════════════════════

function cleanTextForTTS(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/`[^`]+`/g, " code. ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " link. ")
    .replace(/[*_~#>]+/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// VOICE SYNTHESIZER CLASS — ElevenLabs via /api/tts proxy
// ═══════════════════════════════════════════════════════════════════════════

export type SynthState = "idle" | "loading" | "speaking" | "paused";
type StateListener = (state: SynthState) => void;

class VoiceSynthesizer {
  private currentPreset: VoicePreset = VOICE_PRESETS.senko;
  private state: SynthState = "idle";
  private listeners = new Set<StateListener>();
  private currentAudio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private controller: AbortController | null = null;
  private finishPlayback: (() => void) | null = null;
  private job = 0;
  private setState(state: SynthState) { this.state = state; this.listeners.forEach(l => l(state)); }
  subscribe(listener: StateListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  getState() { return this.state; }
  setVoice(key: string) { if (VOICE_PRESETS[key]) this.currentPreset = VOICE_PRESETS[key]; }
  getVoice() { return this.currentPreset; }
  getAvailableVoices() { return []; } // Engine availability and selection are server-owned.

  async speak(text: string): Promise<void> {
    if (this.state !== "idle") this.stop();
    const clean = cleanTextForTTS(text);
    if (!clean) return;
    const job = ++this.job;
    const controller = new AbortController();
    this.controller = controller;
    let url: string | undefined;
    this.setState("loading");
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean }), signal: controller.signal });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `Voice generation failed (${res.status})`);
      }
      const blob = await res.blob();
      if (controller.signal.aborted || job !== this.job) return;
      url = URL.createObjectURL(blob);
      this.currentObjectUrl = url;
      const audio = new Audio(url);
      this.currentAudio = audio;
      await new Promise<void>((resolve, reject) => {
        this.finishPlayback = resolve;
        audio.onplaying = () => { if (job === this.job) this.setState("speaking"); };
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback failed"));
        audio.play().catch(reject);
      });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (job === this.job) {
        this.currentAudio = null; this.currentObjectUrl = null; this.controller = null; this.finishPlayback = null;
        this.setState("idle");
      }
    }
  }
  pause() { if (this.state === "speaking") { this.currentAudio?.pause(); this.setState("paused"); } }
  resume() { if (this.state === "paused") void this.currentAudio?.play().catch(() => this.stop()); }
  stop() {
    this.job++;
    this.controller?.abort(); this.controller = null;
    this.currentAudio?.pause(); this.currentAudio = null;
    this.finishPlayback?.(); this.finishPlayback = null;
    if (this.currentObjectUrl) URL.revokeObjectURL(this.currentObjectUrl);
    this.currentObjectUrl = null;
    this.setState("idle");
  }
  async toggle(text: string) { if (this.state !== "idle") this.stop(); else await this.speak(text); }
}
export const voiceSynth = typeof window !== "undefined" ? new VoiceSynthesizer() : null;
