import { q, newId } from "./db";
import { HttpError } from "./identity";

const setting = (name: string, fallback: number, max = 1000000) => {
  const n = Number(process.env[`SENKO_VOICE_${name}`]);
  return Number.isFinite(n) && n >= 1 ? Math.min(max, Math.floor(n)) : fallback;
};
export function voiceLimits() {
  const maxSeconds = setting("MAX_SECONDS", 1200, 1800);
  const minSeconds = Math.min(maxSeconds, setting("MIN_SECONDS", 5, 1800));
  return {
    minSeconds, maxSeconds, defaultSeconds: Math.max(minSeconds, Math.min(maxSeconds, setting("DEFAULT_SECONDS", 60, 1800))),
    maxChars: setting("MAX_CHARS", 15000, 15000), perMinute: setting("PER_MINUTE", 3), perHour: setting("PER_HOUR", 20),
    perUser: setting("PER_USER_CONCURRENT", 1, 8), global: setting("GLOBAL_CONCURRENT", 2, 32),
    queue: setting("QUEUE_PER_USER", 2, 10), globalQueue: setting("GLOBAL_QUEUE", 32, 128), timeoutMs: setting("TIMEOUT_MS", 600000, 900000),
  };
}
export class VoiceError extends HttpError {
  constructor(status: number, public code: string, message: string, public retryAfter?: number) { super(status, message); }
}
export function validateVoiceInput(text: unknown, duration?: unknown) {
  const limits = voiceLimits();
  const seconds = duration === undefined ? limits.defaultSeconds : duration;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < limits.minSeconds || seconds > limits.maxSeconds) throw new VoiceError(400, "duration_limit", `Choose a voice duration from ${limits.minSeconds} to ${limits.maxSeconds} seconds.`);
  if (typeof text !== "string" || !text.trim()) throw new VoiceError(400, "invalid_input", "There is no spoken text to generate.");
  if (text.length > limits.maxChars) throw new VoiceError(413, "text_limit", `Voice messages allow at most ${limits.maxChars} characters. Ask for a shorter message.`);
  const estimate = text.trim().split(/\s+/).length / 2.5;
  if (estimate > seconds) throw new VoiceError(422, "duration_limit", `This text is estimated to need ${Math.ceil(estimate)} seconds, exceeding your ${seconds}-second limit. Shorten it or select a longer duration.`);
  return seconds;
}

async function rateLimit(ownerId: string) {
  const limits = voiceLimits();
  const now = Date.now();
  const result = await q(`INSERT INTO voice_usage (owner_id, attempts) VALUES ($1, ARRAY[$2::bigint])
    ON CONFLICT (owner_id) DO UPDATE SET attempts = ARRAY(SELECT t FROM unnest(voice_usage.attempts) t WHERE t > $2::bigint - 3600000) || $2::bigint
    WHERE (SELECT count(*) FROM unnest(voice_usage.attempts) t WHERE t > $2::bigint - 60000) < $3
      AND (SELECT count(*) FROM unnest(voice_usage.attempts) t WHERE t > $2::bigint - 3600000) < $4
    RETURNING owner_id`, [ownerId, now, limits.perMinute, limits.perHour]);
  if (result.length) return;
  const rows = await q<{ attempts: string[] }>("SELECT attempts FROM voice_usage WHERE owner_id = $1", [ownerId]);
  const times = (rows[0]?.attempts || []).map(Number).sort((a, b) => a - b);
  const minute = times.filter(t => t > now - 60000);
  const hour = times.filter(t => t > now - 3600000);
  const retry = Math.max(minute.length >= limits.perMinute ? minute[minute.length - limits.perMinute] + 60000 - now : 0,
    hour.length >= limits.perHour ? hour[hour.length - limits.perHour] + 3600000 - now : 0);
  throw new VoiceError(429, "rate_limited", `Voice limit reached (${limits.perMinute}/minute, ${limits.perHour}/hour). Try again in ${Math.max(1, Math.ceil(retry / 1000))} seconds.`, Math.max(1, Math.ceil(retry / 1000)));
}

async function lease(prefix: string, count: number, token: string, ttl: number) {
  for (let i = 0; i < count; i++) {
    const rows = await q(`INSERT INTO voice_slots (slot, token, expires_at) VALUES ($1, $2, $3)
      ON CONFLICT (slot) DO UPDATE SET token = $2, expires_at = $3 WHERE voice_slots.expires_at < $4 RETURNING slot`, [`${prefix}:${i}`, token, Date.now() + ttl, Date.now()]);
    if (rows.length) return true;
  }
  return false;
}
const state = globalThis as typeof globalThis & { voiceWaiting?: Map<string, number> };
const waiting = state.voiceWaiting ||= new Map();
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new VoiceError(499, "cancelled", "Voice generation cancelled.")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 100);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Persistent rate history and expiring DB leases protect all app instances and survive restarts. */
export async function withVoiceBudget<T>(ownerId: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const limits = voiceLimits();
  const pending = waiting.get(ownerId) || 0;
  if (pending >= limits.perUser + limits.queue || [...waiting.values()].reduce((a, b) => a + b, 0) >= limits.global + limits.globalQueue) throw new VoiceError(429, "queue_full", "Voice queue is full. Try again shortly.", 2);
  waiting.set(ownerId, pending + 1);
  const token = newId("voice_");
  const deadline = AbortSignal.timeout(limits.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    combined.throwIfAborted();
    if (!await lease(`queue:user:${ownerId}`, limits.perUser + limits.queue, token, limits.timeoutMs + 5000) || !await lease("queue:global", limits.global + limits.globalQueue, token, limits.timeoutMs + 5000)) throw new VoiceError(429, "queue_full", "Voice queue is full. Try again shortly.", 2);
    await rateLimit(ownerId); // Failed/abandoned attempts still consume quota; no free retry loops.
    while (true) {
      combined.throwIfAborted();
      if (await lease(`user:${ownerId}`, limits.perUser, token, limits.timeoutMs + 5000)) {
        if (await lease("global", limits.global, token, limits.timeoutMs + 5000)) break;
        await q("DELETE FROM voice_slots WHERE token = $1 AND slot NOT LIKE 'queue:%'", [token]);
      }
      await delay(combined);
    }
    let abort: () => void = () => {};
    try {
      return await Promise.race([work(combined), new Promise<never>((_, reject) => {
        abort = () => reject(new VoiceError(499, "cancelled", "Voice generation cancelled."));
        combined.addEventListener("abort", abort, { once: true });
        if (combined.aborted) abort();
      })]);
    } finally { combined.removeEventListener("abort", abort); }
  } catch (error) {
    if (deadline.aborted) throw new VoiceError(504, "timeout", "Voice generation exceeded its time limit. Try a shorter message.");
    if (signal?.aborted) throw new VoiceError(499, "cancelled", "Voice generation cancelled.");
    throw error;
  } finally {
    const left = (waiting.get(ownerId) || 1) - 1;
    if (left) waiting.set(ownerId, left); else waiting.delete(ownerId);
    await q("DELETE FROM voice_slots WHERE token = $1", [token]);
  }
}
