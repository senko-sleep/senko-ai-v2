// Central request scheduler for every LLM call (chat, agent, suggestions).
//
// It keeps a per-model ledger of requests and tokens in the last minute, plus how many
// requests each provider has in flight, and answers one question before any request is
// sent: "can this go out now without breaking the provider's limits, and if not, when?"
// That turns rate limits from errors we react to into a queue we pace ourselves through.
//
// Limits come from three places, most trusted last:
//   1. built-in defaults for each provider's free tier (conservative),
//   2. LLM_LIMITS_<PROVIDER> env overrides, e.g. LLM_LIMITS_GEMINI="rpm=15,tpm=250000,concurrency=2",
//   3. what the provider itself reports in x-ratelimit-* response headers (Groq, OpenRouter, OpenAI).
// A 429 still happens sometimes (other processes share the key, defaults can be off). Then the
// model's effective limit shrinks (AIMD: x0.6 per 429, +10% back per success) and it backs off
// exponentially with jitter, honoring Retry-After when given.

export type Priority = "interactive" | "background";

export interface Limits {
  /** Requests per minute. */
  rpm?: number;
  /** Tokens (input + output) per minute. */
  tpm?: number;
  /** Requests per day (rolling 24h). */
  rpd?: number;
  /** Requests in flight at once, per provider. */
  concurrency?: number;
}

interface Event {
  at: number;
  tokens: number;
}

interface Learned {
  /** From x-ratelimit-*-tokens: what the provider says is left, and when it refills. */
  tokens?: { remaining: number; resetAt: number; spentSince: number };
  requests?: { remaining: number; resetAt: number; spentSince: number };
  /** The provider's real per-minute token limit, when it says so. */
  tpm?: number;
}

interface ModelState {
  events: Event[];
  day: number[];
  learned: Learned;
  /** AIMD multiplier on rpm/tpm (0.2..1). */
  factor: number;
  strikes: number;
  backoffUntil: number;
}

interface Ticket {
  id: number;
  provider: string;
  at: number;
  event: Event;
  released: boolean;
}

export interface TicketHandle {
  /** Call once the request is over. `tokens` replaces the reserved estimate (input + output used). */
  release(tokens?: number): void;
}

export interface SchedulerOptions {
  now?: () => number;
  random?: () => number;
  env?: (key: string) => string | undefined;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A ticket that was never released (caller dropped the stream) stops counting after this. */
const TICKET_TTL = 5 * MINUTE;
const MAX_BACKOFF = 5 * MINUTE;

/** Free-tier defaults. Headers and 429s refine these at runtime. */
const DEFAULTS: { provider: string; model?: RegExp; limits: Limits }[] = [
  { provider: "gemini", model: /flash-lite/, limits: { rpm: 15, tpm: 250_000, concurrency: 3 } },
  { provider: "gemini", model: /pro/, limits: { rpm: 5, tpm: 250_000, concurrency: 2 } },
  { provider: "gemini", limits: { rpm: 10, tpm: 250_000, concurrency: 3 } },
  { provider: "groq", model: /llama-4-scout/, limits: { rpm: 30, tpm: 30_000, concurrency: 2 } },
  { provider: "groq", model: /gpt-oss/, limits: { rpm: 30, tpm: 8_000, concurrency: 2 } },
  { provider: "groq", limits: { rpm: 30, tpm: 6_000, concurrency: 2 } },
  { provider: "openrouter", limits: { rpm: 20, concurrency: 2 } },
  { provider: "llm7", limits: { concurrency: 2 } },
  { provider: "sambanova", limits: { concurrency: 2 } },
  { provider: "cloudflare", limits: { concurrency: 2 } },
  { provider: "deepseek", limits: { concurrency: 4 } },
  { provider: "senko", limits: { concurrency: 1 } },
  { provider: "ollama", limits: { concurrency: 1 } },
  { provider: "paid", limits: { concurrency: 4 } },
];

/** Parse "rpm=15,tpm=250000,rpd=1000,concurrency=2". */
export function parseLimits(spec: string | undefined): Limits {
  const out: Limits = {};
  for (const part of (spec || "").split(",")) {
    const [k, v] = part.split("=").map((s) => s.trim().toLowerCase());
    const n = Number(v);
    if (!k || !Number.isFinite(n) || n <= 0) continue;
    if (k === "rpm" || k === "tpm" || k === "rpd" || k === "concurrency") out[k] = n;
  }
  return out;
}

/**
 * Parse a rate-limit reset value into ms from now: "1m2.5s", "7.66s", "292ms", "30" (seconds),
 * or an epoch timestamp in seconds or milliseconds.
 */
export function parseReset(v: string | null | undefined, now: number): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 1e12) return Math.max(0, n - now); // epoch ms
    if (n > 1e9) return Math.max(0, n * 1000 - now); // epoch s
    return Math.ceil(n * 1000);
  }
  const m = s.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/);
  if (m && (m[1] || m[2] || m[3] || m[4])) {
    return Math.ceil(Number(m[1] || 0) * 3_600_000 + Number(m[2] || 0) * 60_000 + Number(m[3] || 0) * 1000 + Number(m[4] || 0));
  }
  return null;
}

export class Scheduler {
  private models = new Map<string, ModelState>();
  private tickets = new Map<string, Set<Ticket>>();
  private waiters = new Set<() => void>();
  private nextId = 1;
  private now: () => number;
  private random: () => number;
  private env: (key: string) => string | undefined;

  constructor(o: SchedulerOptions = {}) {
    this.now = o.now ?? (() => Date.now());
    this.random = o.random ?? (() => Math.random());
    this.env = o.env ?? ((k) => process.env[k]);
  }

  /** Background work (agent steps) leaves this share of every limit for interactive chat. */
  private backgroundShare() {
    const v = Number(this.env("LLM_BACKGROUND_SHARE"));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.85;
  }

  limitsFor(provider: string, model: string): Limits {
    const base: Limits = {};
    for (const d of DEFAULTS) {
      if (d.provider !== provider || (d.model && !d.model.test(model))) continue;
      Object.assign(base, d.limits);
      break;
    }
    const env = parseLimits(this.env(`LLM_LIMITS_${provider.toUpperCase()}`));
    const out = { ...base, ...env };
    // The provider's own number beats our guess when it's lower; a lower configured limit is a choice.
    const learned = this.models.get(key(provider, model))?.learned.tpm;
    if (learned) out.tpm = out.tpm ? Math.min(out.tpm, learned) : learned;
    return out;
  }

  private state(provider: string, model: string): ModelState {
    const k = key(provider, model);
    let s = this.models.get(k);
    if (!s) {
      s = { events: [], day: [], learned: {}, factor: 1, strikes: 0, backoffUntil: 0 };
      this.models.set(k, s);
    }
    const t = this.now();
    while (s.events.length && s.events[0].at <= t - MINUTE) s.events.shift();
    while (s.day.length && s.day[0] <= t - DAY) s.day.shift();
    return s;
  }

  private live(provider: string): Set<Ticket> {
    let set = this.tickets.get(provider);
    if (!set) {
      set = new Set();
      this.tickets.set(provider, set);
    }
    const t = this.now();
    for (const tk of set) if (tk.released || t - tk.at > TICKET_TTL) set.delete(tk);
    return set;
  }

  /** The largest request (input + output tokens) this model can take at all right now. */
  maxRequestTokens(provider: string, model: string, priority: Priority = "interactive"): number {
    const lim = this.limitsFor(provider, model);
    if (!lim.tpm) return Infinity;
    const s = this.state(provider, model);
    return Math.floor(lim.tpm * s.factor * (priority === "background" ? this.backgroundShare() : 1));
  }

  /**
   * How long until a request of `tokens` (input + max output) could start on this model:
   * 0 = now, Infinity = never (bigger than its whole per-minute budget).
   */
  delayFor(provider: string, model: string, tokens: number, priority: Priority = "interactive"): number {
    const t = this.now();
    const s = this.state(provider, model);
    const lim = this.limitsFor(provider, model);
    const share = priority === "background" ? this.backgroundShare() : 1;
    let wait = Math.max(0, s.backoffUntil - t);

    if (lim.concurrency && this.live(provider).size >= lim.concurrency) wait = Math.max(wait, 400);

    if (lim.rpm) {
      const cap = Math.max(1, Math.floor(lim.rpm * s.factor * share));
      if (s.events.length >= cap) wait = Math.max(wait, s.events[s.events.length - cap].at + MINUTE - t);
    }
    if (lim.tpm) {
      const cap = Math.floor(lim.tpm * s.factor * share);
      if (tokens > cap) return Infinity;
      let used = s.events.reduce((n, e) => n + e.tokens, 0);
      // Wait until enough old tokens leave the window.
      for (let i = 0; used + tokens > cap && i < s.events.length; i++) {
        used -= s.events[i].tokens;
        wait = Math.max(wait, s.events[i].at + MINUTE - t);
      }
    }
    if (lim.rpd && s.day.length >= Math.floor(lim.rpd * share)) {
      wait = Math.max(wait, s.day[s.day.length - Math.floor(lim.rpd * share)] + DAY - t);
    }

    // What the provider told us is left (more accurate than our own count: other processes share the key).
    const lt = s.learned.tokens;
    if (lt && lt.resetAt > t && lt.remaining - lt.spentSince < tokens) wait = Math.max(wait, lt.resetAt - t);
    const lr = s.learned.requests;
    if (lr && lr.resetAt > t && lr.remaining - lr.spentSince < 1) wait = Math.max(wait, lr.resetAt - t);
    return Math.ceil(wait);
  }

  /** How full this model's window is (0 = idle, 1 = at its limit). Used to decide on backup requests. */
  pressure(provider: string, model: string): number {
    const s = this.state(provider, model);
    const lim = this.limitsFor(provider, model);
    let p = 0;
    if (lim.rpm) p = Math.max(p, s.events.length / Math.max(1, lim.rpm * s.factor));
    if (lim.tpm) p = Math.max(p, s.events.reduce((n, e) => n + e.tokens, 0) / Math.max(1, lim.tpm * s.factor));
    if (lim.concurrency) p = Math.max(p, this.live(provider).size / lim.concurrency);
    if (s.backoffUntil > this.now()) p = 1;
    return Math.min(1, p);
  }

  /** Reserve a slot. Always pair with release(). */
  acquire(provider: string, model: string, tokens: number): TicketHandle {
    const s = this.state(provider, model);
    const event: Event = { at: this.now(), tokens };
    s.events.push(event);
    s.day.push(event.at);
    if (s.learned.tokens) s.learned.tokens.spentSince += tokens;
    if (s.learned.requests) s.learned.requests.spentSince += 1;
    const tk: Ticket = { id: this.nextId++, provider, at: event.at, event, released: false };
    this.live(provider).add(tk);
    return {
      release: (actual?: number) => {
        if (tk.released) return;
        tk.released = true;
        if (typeof actual === "number" && Number.isFinite(actual) && actual >= 0) {
          if (s.learned.tokens) s.learned.tokens.spentSince += actual - event.tokens;
          event.tokens = actual;
        }
        this.tickets.get(provider)?.delete(tk);
        this.notify();
      },
    };
  }

  /** Learn real limits from x-ratelimit-* headers (Groq, OpenRouter, OpenAI-style APIs). */
  observeHeaders(provider: string, model: string, headers: { get(name: string): string | null }) {
    const t = this.now();
    const s = this.state(provider, model);
    const num = (n: string) => {
      const v = headers.get(n);
      const x = v == null ? NaN : Number(v);
      return Number.isFinite(x) ? x : null;
    };
    const remTok = num("x-ratelimit-remaining-tokens");
    const resetTok = parseReset(headers.get("x-ratelimit-reset-tokens"), t);
    if (remTok != null && resetTok != null) s.learned.tokens = { remaining: remTok, resetAt: t + resetTok, spentSince: 0 };
    const limTok = num("x-ratelimit-limit-tokens");
    // Only a per-minute token limit (its reset is within a minute) is a TPM.
    if (limTok && resetTok != null && resetTok <= MINUTE) s.learned.tpm = limTok;

    const remReq = num("x-ratelimit-remaining-requests") ?? num("x-ratelimit-remaining");
    const resetReq = parseReset(headers.get("x-ratelimit-reset-requests") ?? headers.get("x-ratelimit-reset"), t);
    if (remReq != null && resetReq != null) s.learned.requests = { remaining: remReq, resetAt: t + resetReq, spentSince: 0 };
  }

  /**
   * A 429: shrink this model's effective limit and back off. Returns the backoff in ms:
   * the provider's Retry-After when given, else exponential (5s, 10s, 20s, … ≤5min), with ±20% jitter.
   */
  onRateLimited(provider: string, model: string, retryAfterMs: number | null): number {
    const s = this.state(provider, model);
    s.factor = Math.max(0.2, s.factor * 0.6);
    s.strikes++;
    const base = retryAfterMs != null && retryAfterMs > 0 ? retryAfterMs : Math.min(MAX_BACKOFF, 5000 * 2 ** (s.strikes - 1));
    // Jitter spreads retries out so processes sharing a key don't all come back at once.
    // A provider-given Retry-After is a floor, so only add to it.
    const jitter = retryAfterMs ? base * 0.2 * this.random() : base * 0.4 * (this.random() - 0.5);
    const ms = Math.ceil(base + jitter);
    s.backoffUntil = Math.max(s.backoffUntil, this.now() + ms);
    this.notify();
    return ms;
  }

  /** A request went through: recover the limit slowly. */
  onSuccess(provider: string, model: string) {
    const s = this.state(provider, model);
    s.strikes = 0;
    s.factor = Math.min(1, Math.round((s.factor + 0.1) * 100) / 100);
  }

  inFlight(provider: string): number {
    return this.live(provider).size;
  }

  /** Resolve after `ms`, or sooner when a slot frees up (a request finished). */
  waitForChange(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      this.waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  private notify() {
    for (const w of [...this.waiters]) w();
  }

  /** For diagnostics and tests. */
  snapshot(provider: string, model: string) {
    const s = this.state(provider, model);
    return {
      requestsLastMinute: s.events.length,
      tokensLastMinute: s.events.reduce((n, e) => n + e.tokens, 0),
      inFlight: this.inFlight(provider),
      factor: s.factor,
      backoffMs: Math.max(0, s.backoffUntil - this.now()),
      limits: this.limitsFor(provider, model),
    };
  }

  reset() {
    this.models.clear();
    this.tickets.clear();
  }
}

function key(provider: string, model: string) {
  return `${provider}|${model}`;
}

const g = globalThis as unknown as { __llmScheduler?: Scheduler };
/** The process-wide scheduler every LLM request goes through. */
export const scheduler = (g.__llmScheduler ??= new Scheduler());
