import type { VoiceProduction } from "./production";

export interface VoiceProgress {
  phase: "preparing" | "queued" | "synthesizing" | "assembling" | "ready" | "error";
  completed: number;
  total: number;
  seconds?: number;
  message?: string;
  /** Measured per-section state of a sectioned recording. */
  production?: VoiceProduction;
}
