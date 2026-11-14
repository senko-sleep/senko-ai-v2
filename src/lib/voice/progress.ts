export interface VoiceProgress {
  phase: "preparing" | "queued" | "synthesizing" | "assembling" | "ready" | "error";
  completed: number;
  total: number;
  seconds?: number;
  message?: string;
}
