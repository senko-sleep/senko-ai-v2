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

export type SynthState = "idle" | "speaking" | "paused";
type StateListener = (state: SynthState) => void;

class VoiceSynthesizer {
  private currentPreset: VoicePreset = VOICE_PRESETS.senko;
  private state: SynthState = "idle";
  private listeners: Set<StateListener> = new Set();
  private currentAudio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private stopRequested = false;

  private setState(state: SynthState) {
    this.state = state;
    this.listeners.forEach((l) => l(state));
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): SynthState { return this.state; }

  setVoice(presetKey: string) {
    if (VOICE_PRESETS[presetKey]) {
      this.currentPreset = VOICE_PRESETS[presetKey];
    }
  }

  getVoice(): VoicePreset { return this.currentPreset; }

  getAvailableVoices(): { key: string; preset: VoicePreset }[] {
    return Object.entries(VOICE_PRESETS).map(([key, preset]) => ({ key, preset }));
  }

  private revokeObjectUrl() {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }

  // -- Web Speech API fallback (free, built into browser) -------------------
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  private speakWithWebSpeech(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error("Web Speech API not available"));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.1;
      utterance.volume = 1;
      // Pick a female voice if available
      const voices = window.speechSynthesis.getVoices();
      const female = voices.find(
        (v) => v.lang.startsWith("en") && /female|woman|girl|zira|hazel|susan|samantha/i.test(v.name)
      ) || voices.find((v) => v.lang.startsWith("en")) || voices[0];
      if (female) utterance.voice = female;

      this.currentUtterance = utterance;
      utterance.onend = () => { this.currentUtterance = null; resolve(); };
      utterance.onerror = (e) => { this.currentUtterance = null; reject(new Error(e.error)); };
      window.speechSynthesis.speak(utterance);
    });
  }

  async speak(text: string): Promise<void> {
    this.stop();
    this.stopRequested = false;

    const clean = cleanTextForTTS(text);
    if (!clean) return;

    this.setState("speaking");

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clean,
          voiceId: this.currentPreset.voiceId,
          stability: this.currentPreset.stability,
          similarityBoost: this.currentPreset.similarityBoost,
          style: this.currentPreset.style,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const status = res.status;
        // 429 = quota exceeded, 401/403 = key invalid — fall back to Web Speech
        if (status === 429 || status === 401 || status === 403) {
          console.warn(`[VoiceSynth] ElevenLabs ${status}, falling back to Web Speech API`);
          if (this.stopRequested) { this.setState("idle"); return; }
          await this.speakWithWebSpeech(clean);
          return;
        }
        throw new Error(err.error || `TTS request failed: ${status}`);
      }

      if (this.stopRequested) { this.setState("idle"); return; }

      const blob = await res.blob();
      if (this.stopRequested) { this.setState("idle"); return; }

      const url = URL.createObjectURL(blob);
      this.currentObjectUrl = url;

      const audio = new Audio(url);
      this.currentAudio = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback error"));
        audio.play().catch(reject);
      });
    } catch (err) {
      if (!this.stopRequested) {
        console.error("[VoiceSynth] ElevenLabs error:", err);
        throw err;
      }
    } finally {
      this.revokeObjectUrl();
      this.currentAudio = null;
      if (!this.stopRequested) this.setState("idle");
    }
  }

  pause() {
    if (this.state !== "speaking") return;
    if (this.currentAudio) {
      this.currentAudio.pause();
    } else if (this.currentUtterance && window.speechSynthesis) {
      window.speechSynthesis.pause();
    }
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    if (this.currentAudio) {
      this.currentAudio.play().catch(() => {});
    } else if (window.speechSynthesis) {
      window.speechSynthesis.resume();
    }
    this.setState("speaking");
  }

  stop() {
    this.stopRequested = true;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
    this.revokeObjectUrl();
    this.setState("idle");
  }

  async toggle(text: string): Promise<void> {
    if (this.state === "speaking") { this.stop(); }
    else { await this.speak(text); }
  }
}

// Singleton instance
export const voiceSynth = typeof window !== "undefined" ? new VoiceSynthesizer() : null;
