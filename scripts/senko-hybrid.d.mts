export function hybridAvailable(): boolean;
export function hybridPython(): string;
export function hybridSpeech(input: { text: string; emotion?: string; plan?: import("../src/lib/voice/performance").PerformancePlan; durationSeconds?: number; signal?: AbortSignal; onProgress?: (progress: import("../src/lib/voice/progress").VoiceProgress) => void }): Promise<{
  audio: Buffer; mime: string; seconds: number; mood: string; model: string; modelKind: "pretrained-neural-blend";
  baseModel: string; fingerprint: string; voice: string; synthesisMs: number; textureCorrelation: number; segments: number;
  character?: string; performance?: "director" | "neutral";
}>;
