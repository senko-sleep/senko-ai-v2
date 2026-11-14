export function senkoSpeech(input: {
  text: string;
  emotion?: string;
  bank: unknown;
  maxSeconds?: number;
  signal?: AbortSignal;
}): Promise<{ audio: Buffer; mime: string; seconds: number; model: string; fingerprint: string; mood: string; voice: string }>;
