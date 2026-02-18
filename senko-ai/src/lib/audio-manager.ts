/**
 * Global Audio Manager for Senko AI
 * Uses ElevenLabs TTS via voice-synth singleton.
 * Ensures only one voice plays at a time (no overlapping).
 */

import { voiceSynth, VOICE_PRESETS, type VoicePreset } from "./voice-synth";

type AudioState = "idle" | "loading" | "playing";
type StateListener = (state: AudioState, messageId: string | null) => void;

class AudioManager {
  private currentMessageId: string | null = null;
  private state: AudioState = "idle";
  private listeners: Set<StateListener> = new Set();

  constructor() {
    if (voiceSynth) {
      voiceSynth.subscribe((synthState) => {
        const newState = synthState === "speaking" ? "playing" : "idle";
        this.setState(newState, newState === "playing" ? this.currentMessageId : null);
      });
    }
  }

  private setState(state: AudioState, messageId: string | null) {
    this.state = state;
    this.currentMessageId = messageId;
    this.listeners.forEach((listener) => listener(state, messageId));
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): { state: AudioState; messageId: string | null } {
    return { state: this.state, messageId: this.currentMessageId };
  }

  isActive(messageId: string): boolean {
    return this.currentMessageId === messageId && this.state !== "idle";
  }

  /**
   * Get available voice presets
   */
  getVoices(): { key: string; preset: VoicePreset }[] {
    return Object.entries(VOICE_PRESETS).map(([key, preset]) => ({ key, preset }));
  }

  /**
   * Set voice preset
   */
  setVoice(presetKey: string): void {
    if (voiceSynth) {
      voiceSynth.setVoice(presetKey);
      console.log("[AudioManager] Voice changed to:", presetKey);
    }
  }

  /**
   * Get current voice preset
   */
  getCurrentVoice(): VoicePreset | null {
    return voiceSynth?.getVoice() || null;
  }

  /**
   * Play TTS for a message. Stops any currently playing audio.
   */
  async play(messageId: string, text: string): Promise<void> {
    if (!voiceSynth) {
      throw new Error("Voice synthesis not available");
    }

    // Stop any current playback
    this.stop();

    this.setState("loading", messageId);
    this.currentMessageId = messageId;

    try {
      await voiceSynth.speak(text);
    } catch (error) {
      console.error("[AudioManager] Speech error:", error);
      this.setState("idle", null);
      throw error;
    }
  }

  /**
   * Stop current playback
   */
  stop(): void {
    if (voiceSynth) {
      voiceSynth.stop();
    }
    this.setState("idle", null);
  }

  /**
   * Toggle playback for a message
   */
  async toggle(messageId: string, text: string): Promise<void> {
    if (this.isActive(messageId)) {
      this.stop();
    } else {
      await this.play(messageId, text);
    }
  }
}

// Singleton instance
export const audioManager = typeof window !== "undefined" ? new AudioManager() : null;
