import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { q } from "@/lib/server/db";
import { validateVoiceInput, withVoiceBudget } from "@/lib/server/voice-policy";
import { verifyVoiceAudio } from "@/lib/server/voice-audio";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("DATA_DIR", ":memory:");
  await q("SELECT 1");
});
afterEach(() => vi.unstubAllEnvs());

it("validates duration, raw text and estimated speech before spending quota", () => {
  expect(validateVoiceInput("Hello there")).toBe(60);
  expect(validateVoiceInput("Hello there", 5)).toBe(5);
  for (const duration of [0, 4, 1801, "30", NaN]) expect(() => validateVoiceInput("Hello", duration)).toThrow("Choose a voice duration");
  expect(() => validateVoiceInput("x".repeat(15001), 1200)).toThrow("15000");
  expect(() => validateVoiceInput("long sentence ".repeat(20), 5)).toThrow("estimated");
});

it("enforces persistent minute and hour quotas and retry periods", async () => {
  for (let i = 0; i < 3; i++) await withVoiceBudget("minute", undefined, async () => "audio");
  await expect(withVoiceBudget("minute", undefined, async () => "bad")).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfter: expect.any(Number) });
  vi.stubEnv("SENKO_VOICE_PER_MINUTE", "100");
  await q("INSERT INTO voice_usage (owner_id, attempts) VALUES ($1, $2)", ["hour", Array.from({ length: 20 }, () => Date.now() - 120000)]);
  await expect(withVoiceBudget("hour", undefined, async () => "bad")).rejects.toMatchObject({ status: 429 });
});

it("serializes per user, bounds queues, and cleans up on cancellation", async () => {
  vi.stubEnv("SENKO_VOICE_PER_MINUTE", "100");
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const first = withVoiceBudget("concurrency", undefined, async () => { entered(); await new Promise<void>(r => { release = r; }); });
  await ready;
  const a = new AbortController(), b = new AbortController();
  const second = withVoiceBudget("concurrency", a.signal, async () => { throw new Error("must never run"); });
  const third = withVoiceBudget("concurrency", b.signal, async () => { throw new Error("must never run"); });
  const rejectionA = expect(second).rejects.toMatchObject({ code: "cancelled" });
  const rejectionB = expect(third).rejects.toMatchObject({ code: "cancelled" });
  await expect(withVoiceBudget("concurrency", undefined, async () => "bad")).rejects.toMatchObject({ status: 429, code: "queue_full" });
  a.abort(); b.abort(); release();
  await Promise.all([first, rejectionA, rejectionB]);
  expect(await q("SELECT slot FROM voice_slots WHERE slot LIKE '%concurrency%'" )).toEqual([]);
  expect(await withVoiceBudget("concurrency", undefined, async () => "recovered")).toBe("recovered");
});

it("times out and releases leases even if a worker does not settle", async () => {
  vi.stubEnv("SENKO_VOICE_TIMEOUT_MS", "100");
  await expect(withVoiceBudget("timeout", undefined, () => new Promise(() => {}))).rejects.toMatchObject({ status: 504, code: "timeout" });
  expect(await q("SELECT slot FROM voice_slots WHERE slot LIKE '%timeout%'" )).toEqual([]);
});

function wav(seconds: number) {
  const data = Buffer.alloc(44 + seconds * 16000);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}
it("verifies decoded duration including the exact 120-second boundary and rejects malformed audio", async () => {
  expect((await verifyVoiceAudio(wav(120), 120)).seconds).toBe(120);
  await expect(verifyVoiceAudio(wav(121), 120)).rejects.toMatchObject({ code: "duration_limit" });
  const malformed = wav(1); malformed.writeUInt32LE(90000, 40);
  await expect(verifyVoiceAudio(malformed, 30)).rejects.toMatchObject({ code: "malformed_audio" });
});
