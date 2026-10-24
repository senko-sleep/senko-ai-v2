// Server-only LLM layer with automatic fallback.
//
// Default order: Senko LLM gateway -> Ollama (if reachable) -> Gemini -> Groq -> OpenRouter (free models) -> LLM7 -> your paid key.
// - Every request is fitted to the provider's token budget (long chats are trimmed, and a compact
//   persona is used for local models), so a long conversation can't lock out a free tier.
// - Each provider can offer several models; requests with images only go to vision models.
// - A provider that rate-limits (429) or errors is put on a short "cooldown" and skipped,
//   so the next one answers without the user noticing.
// - If a stream fails before its first token, the next candidate takes over.
// Keys come from environment variables only and never reach the browser.
// - Every request is paced by the central scheduler (./scheduler.ts) so it doesn't break a
//   provider's per-minute limits in the first place.
import { scheduler, type Priority } from "./scheduler";
export { scheduler } from "./scheduler";

export type Role = "system" | "user" | "assistant";
export interface ImagePart {
  mime: string;
  /** base64 (no data: prefix) */
  data: string;
}
export interface LlmMessage {
  role: Role;
  content: string;
  images?: ImagePart[];
}

export interface LlmOptions {
  /** Provider id to try first ("auto" = configured order). */
  provider?: string;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** Ask for JSON output where the provider supports it (Ollama). */
  json?: boolean;
  /**
   * A shorter system prompt to use instead of the first system message when a request
   * wouldn't fit a provider's budget, or the model is local (where every token costs time).
   */
  compactSystem?: string;
  /** Tests only: pretend these providers fail. */
  simulateFail?: string[];
  /**
   * When every provider is rate-limited, wait up to this long (total) for the first one to
   * free up instead of failing. Default 30s; background agents can afford longer.
   */
  maxWaitMs?: number;
  /** Called before waiting out a rate limit (e.g. to show "waiting ~20s…"). */
  onWait?: (ms: number) => void;
  /** Latency over cleverness: try each provider's quickest models first (browser agent steps). */
  fast?: boolean;
  /**
   * "background" work (agent steps) only uses part of each provider's limits, so a chat
   * message sent while the agent runs still gets through. Default "interactive".
   */
  priority?: Priority;
  /** Allow a backup request on another provider when the first is slow (default true). */
  hedge?: boolean;
  /** Reuse an identical request's answer for this long (and share one in flight). */
  cacheTtlMs?: number;
  /** Internal: sees each provider response's headers (rate-limit learning). */
  onResponse?: (headers: Headers) => void;
}

/** Every provider is rate-limited or failing; `retryInMs` says when the first frees up (if known). */
export class LlmBusyError extends Error {
  constructor(message: string, public retryInMs: number | null, public reasons: string[]) {
    super(message);
    this.name = "LlmBusyError";
  }
}

// ---------------------------------------------------------------------------
// Fitting a conversation into a provider's budget
// ---------------------------------------------------------------------------

/** Token budget for one request: how much input to send, and the most output to ask for. */
export interface Budget {
  input: number;
  output: number;
}

const IMAGE_TOKENS = 800;
/** Rough token count (~3.6 characters per token for English chat). Good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}
function msgTokens(m: LlmMessage): number {
  return estimateTokens(m.content) + (m.images?.length || 0) * IMAGE_TOKENS + 4;
}
export function totalTokens(messages: LlmMessage[]): number {
  return messages.reduce((n, m) => n + msgTokens(m), 0);
}

/**
 * Shrink a conversation to fit `budget` input tokens, in order of least harm:
 *  1. swap in the compact system prompt (if given and `compact` or still too big),
 *  2. shorten older long messages (the newest 4 stay whole),
 *  3. drop the oldest turns (the latest user message is always kept).
 * Returns a new array; the input is not modified.
 */
export function fitMessages(messages: LlmMessage[], budget: number, compactSystem?: string, compact = false): LlmMessage[] {
  let msgs = messages.map((m) => ({ ...m }));
  const hasSystem = msgs[0]?.role === "system";
  if (compactSystem && hasSystem && (compact || totalTokens(msgs) > budget)) msgs[0] = { ...msgs[0], content: compactSystem };
  if (totalTokens(msgs) <= budget) return msgs;

  const start = hasSystem ? 1 : 0;
  const keepWhole = 4;
  for (let i = start; i < msgs.length - keepWhole; i++) {
    const m = msgs[i];
    if (m.content.length > 700) msgs[i] = { ...m, content: `${m.content.slice(0, 600).trimEnd()} …[shortened]` };
    // Old images are the most expensive part; describe instead of resending.
    if (m.images?.length) msgs[i] = { ...msgs[i], images: undefined, content: `${msgs[i].content}\n[image shared earlier]` };
  }

  while (totalTokens(msgs) > budget && msgs.length - start > 1) {
    msgs = [...msgs.slice(0, start), ...msgs.slice(start + 1)];
    // A conversation should start with the user, not a dangling reply.
    while (msgs.length - start > 1 && msgs[start].role === "assistant") msgs = [...msgs.slice(0, start), ...msgs.slice(start + 1)];
  }

  // Still too big (one giant message): cut the last message's middle, keeping both ends.
  const last = msgs[msgs.length - 1];
  const over = totalTokens(msgs) - budget;
  if (over > 0 && last && last.content.length > 2000) {
    const keep = Math.max(1000, last.content.length - Math.ceil(over * 3.6) - 200);
    msgs[msgs.length - 1] = {
      ...last,
      content: `${last.content.slice(0, keep / 2)}\n…[middle cut to fit]…\n${last.content.slice(-keep / 2)}`,
    };
  }
  return msgs;
}

export interface Answered {
  provider: string;
  providerLabel: string;
  model: string;
}

export interface OpenedStream extends Answered {
  stream: AsyncGenerator<string>;
  /** Providers that were skipped or failed before this one answered. */
  skipped: string[];
}

export interface ProviderStatus {
  id: string;
  label: string;
  available: boolean;
  model?: string;
  visionModel?: string;
  detail?: string;
  coolingUntil?: number;
}

function env(key: string, fallback = ""): string {
  return (process.env[key] || fallback).trim();
}

// ---------------------------------------------------------------------------
// Caches and cooldowns
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const cooldowns = new Map<string, { until: number; reason: string; retryable: boolean }>();
function coolKey(provider: string, model: string) {
  return `${provider}|${model}`;
}
function isCooling(provider: string, model: string) {
  const c = cooldowns.get(coolKey(provider, model));
  return c && c.until > Date.now() ? c : null;
}
function coolDown(provider: string, model: string, ms: number, reason: string, retryable = false) {
  const c = { until: Date.now() + ms, reason, retryable };
  cooldowns.set(coolKey(provider, model), c);
  // Long cooldowns (daily caps, no credit) are shared through the database, so every server
  // process (and the agent computer) skips that model instead of each finding out again.
  if (ms >= SHARED_COOL_MS) {
    void import("@/lib/server/db")
      .then(({ q }) =>
        q(
          "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
          [`llm.cool:${coolKey(provider, model)}`, JSON.stringify(c)]
        )
      )
      .catch(() => {});
  }
}

const SHARED_COOL_MS = 5 * 60_000;
let sharedSyncedAt = 0;
/** Pull long cooldowns other processes recorded (at most every 30s; never blocks for long). */
async function syncSharedCooldowns() {
  if (Date.now() - sharedSyncedAt < 30_000) return;
  sharedSyncedAt = Date.now();
  try {
    const { q } = await import("@/lib/server/db");
    const rows = await Promise.race([
      q<{ key: string; value: string }>("SELECT key, value FROM app_kv WHERE key LIKE 'llm.cool:%'"),
      new Promise<never>((_, no) => setTimeout(() => no(new Error("slow")), 1500)),
    ]);
    for (const r of rows) {
      const c = JSON.parse(r.value) as { until: number; reason: string; retryable: boolean };
      const k = r.key.slice("llm.cool:".length);
      if (c.until > Date.now() && (cooldowns.get(k)?.until ?? 0) < c.until) cooldowns.set(k, c);
    }
  } catch {
    /* no database or slow: local cooldowns still work */
  }
}

class ProviderError extends Error {
  constructor(message: string, public status = 0, public retryMs: number | null = null) {
    super(message);
  }
}

/** Read "Retry-After" or "try again in 1m2.5s / 292.5ms / retry in 40s" hints. */
export function retryDelayMs(header: string | null, body: string): number | null {
  if (header && /^\d+(\.\d+)?$/.test(header)) return Math.ceil(parseFloat(header) * 1000);
  const m = body.match(/(?:try again|retry)\s+(?:in|after)\s+(?:(\d+)m)?\s*(?:([\d.]+)s)?\s*(?:([\d.]+)ms)?/i);
  if (m && (m[1] || m[2] || m[3])) {
    return Math.ceil((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 1000 + Number(m[3] || 0));
  }
  const delay = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (delay) return Math.ceil(parseFloat(delay[1]) * 1000);
  return null;
}

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

interface Candidate {
  provider: string;
  label: string;
  model: string;
  vision: boolean;
}

interface Provider {
  id: string;
  label: string;
  configured(): boolean;
  /** Models to try, best first. */
  candidates(needVision: boolean, fast?: boolean): Promise<Candidate[]>;
  open(c: Candidate, messages: LlmMessage[], opts: LlmOptions): Promise<AsyncGenerator<string>>;
  missingDetail: string;
  /** What one request may use. Free tiers count input + max output against a per-minute limit. */
  budget(): Budget;
  /** Local models: every prompt token costs real time, so always use the compact system prompt. */
  local?: boolean;
}

const num = (key: string, fallback: number) => {
  const v = Number(env(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

// ---- OpenAI-compatible (Gemini, Groq, OpenRouter, DeepSeek, LLM7, paid key) ----

interface CompatConfig {
  id: string;
  label: string;
  baseUrl: () => string;
  key: () => string;
  envModel: () => string;
  envVisionModel?: () => string;
  preferred: string[];
  preferredVision?: string[];
  /** Quickest good models, tried first when speed matters more than depth. */
  fastPreferred?: string[];
  /** Chooses usable chat models from the live /models list. */
  filter?: (m: LiveModel) => boolean;
  /** Use a configured alias directly when the API's model list omits aliases such as "default". */
  modelFallbackOnly?: boolean;
  isVision?: (m: LiveModel) => boolean;
  headers?: () => Record<string, string>;
  extras?: (model: string) => Record<string, unknown>;
  /** How many models from this provider to try per request. */
  maxModels?: number;
  missingDetail: string;
  budget: () => Budget;
  local?: boolean;
}

interface LiveModel {
  id: string;
  vision: boolean;
}

async function liveModels(c: CompatConfig): Promise<LiveModel[]> {
  const key = `models:${c.id}`;
  const ttl = 15 * 60_000;
  const list = await fetchLiveModels(c, key, ttl);
  // An empty list usually means "couldn't reach it" (e.g. your local gateway isn't started
  // yet): check again in 20s instead of ignoring it for 15 minutes.
  const entry = cache.get(key);
  if (!list.length && entry && Date.now() - entry.at < 1000) entry.at = Date.now() - ttl + 20_000;
  return list;
}

async function fetchLiveModels(c: CompatConfig, key: string, ttl: number): Promise<LiveModel[]> {
  return cached(key, ttl, async () => {
    try {
      const r = await fetch(`${c.baseUrl()}/models`, {
        headers: { Authorization: `Bearer ${c.key()}`, ...(c.headers ? c.headers() : {}) },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const j = (await r.json()) as {
        data?: { id: string; active?: boolean; input_modalities?: string[]; architecture?: { input_modalities?: string[] } }[];
      };
      return (j.data || [])
        .filter((m) => m.active !== false)
        .map((m) => ({
          id: m.id.replace(/^models\//, ""),
          vision: !!(m.architecture?.input_modalities ?? m.input_modalities)?.includes("image"),
        }));
    } catch {
      return [];
    }
  });
}

function compatProvider(c: CompatConfig): Provider {
  return {
    id: c.id,
    label: c.label,
    missingDetail: c.missingDetail,
    budget: c.budget,
    local: c.local,
    configured: () => !!c.key(),
    async candidates(needVision, fast) {
      if (c.modelFallbackOnly) {
        const model = c.envModel();
        return model ? [{ provider: c.id, label: c.label, model, vision: false }] : [];
      }
      const live = await liveModels(c);
      const has = (id: string) => live.length === 0 || live.some((m) => m.id === id);
      const isVision = (id: string) => {
        const m = live.find((x) => x.id === id);
        return c.isVision ? (m ? c.isVision(m) : false) : !!m?.vision;
      };
      const out: Candidate[] = [];
      const push = (model: string, vision: boolean) => {
        if (model && !out.some((o) => o.model === model)) out.push({ provider: c.id, label: c.label, model, vision });
      };
      if (fast && c.fastPreferred) {
        for (const f of c.fastPreferred) {
          if (!has(f)) continue;
          const v = isVision(f) || (c.preferredVision || []).includes(f);
          if (!needVision || v) push(f, v);
        }
      }
      if (needVision) {
        const ev = c.envVisionModel?.();
        if (ev) push(ev, true);
        for (const p of c.preferredVision || []) if (has(p)) push(p, true);
        for (const m of live) if ((c.filter ? c.filter(m) : true) && isVision(m.id)) push(m.id, true);
      } else {
        const em = c.envModel();
        if (em && has(em)) push(em, isVision(em));
        for (const p of c.preferred) if (has(p)) push(p, isVision(p));
        for (const m of live) if (c.filter ? c.filter(m) : true) push(m.id, isVision(m.id));
        if (!out.length && em) push(em, false);
      }
      return out.slice(0, c.maxModels ?? 2);
    },
    async open(cand, messages, opts) {
      const body = {
        model: cand.model,
        stream: true,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? c.budget().output,
        messages: messages.map((m) =>
          m.images?.length
            ? {
                role: m.role,
                content: [
                  { type: "text", text: m.content || " " },
                  ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } })),
                ],
              }
            : { role: m.role, content: m.content }
        ),
      };
      const extras = c.extras ? c.extras(cand.model) : {};
      let res = await connect(`${c.baseUrl()}/chat/completions`, { ...body, ...extras }, {
        Authorization: `Bearer ${c.key()}`,
        ...(c.headers ? c.headers() : {}),
      }, opts.signal);
      if (res.status === 400 && Object.keys(extras).length) {
        res = await connect(`${c.baseUrl()}/chat/completions`, body, {
          Authorization: `Bearer ${c.key()}`,
          ...(c.headers ? c.headers() : {}),
        }, opts.signal);
      }
      opts.onResponse?.(res.headers);
      await throwIfBad(res, c.label, cand.model);
      return stripThink(sseContent(res.body!));
    },
  };
}

/** POST with a 45s limit on *connecting* only (long answers can keep streaming). */
async function connect(url: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), 45_000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ProviderError(`couldn't connect (${e instanceof Error ? e.message : e})`, 0, 30_000);
  } finally {
    clearTimeout(timer);
  }
}

async function throwIfBad(res: Response, label: string, model: string) {
  if (res.ok && res.body) return;
  const text = await res.text().catch(() => "");
  let msg = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    msg = j.error?.message || j.error || j[0]?.error?.message || msg;
  } catch {
    /* not json */
  }
  const retry = retryDelayMs(res.headers.get("retry-after"), text);
  throw new ProviderError(`${label} ${res.status} (${model}): ${String(msg).slice(0, 240)}`, res.status, retry);
}

async function* sseContent(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let j: { error?: { message?: string } | string; choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) {
          const m = typeof j.error === "string" ? j.error : j.error.message || JSON.stringify(j.error);
          throw new ProviderError(`stream error: ${m}`, /rate|quota|429/i.test(m) ? 429 : 500, null);
        }
        const fr = j.choices?.[0]?.finish_reason;
        if (fr && /content_filter|safety|prohibited/i.test(fr)) {
          throw new ProviderError("stream blocked by provider content filter", 422, null);
        }
        const c = j.choices?.[0]?.delta?.content;
        if (c) yield c;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---- Ollama (local, your own server, or Ollama Cloud with OLLAMA_API_KEY) ----

const ollamaUrl = () => env("OLLAMA_URL").replace(/\/$/, "");
const ollamaHeaders = (): Record<string, string> =>
  env("OLLAMA_API_KEY") ? { Authorization: `Bearer ${env("OLLAMA_API_KEY")}` } : {};

async function ollamaModels(): Promise<{ name: string; vision: boolean }[] | null> {
  return cached("ollama-models", 30_000, async () => {
    try {
      const r = await fetch(`${ollamaUrl()}/api/tags`, { headers: ollamaHeaders(), signal: AbortSignal.timeout(2500) });
      if (!r.ok) return null;
      const j = (await r.json()) as { models?: { name: string }[] };
      const names = (j.models || []).map((m) => m.name).filter((n) => !/embed/i.test(n));
      const withCaps = await Promise.all(
        names.slice(0, 30).map(async (name) => {
          const caps = await cached(`ollama-caps:${name}`, 60 * 60_000, async () => {
            try {
              const s = await fetch(`${ollamaUrl()}/api/show`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...ollamaHeaders() },
                body: JSON.stringify({ model: name }),
                signal: AbortSignal.timeout(4000),
              });
              const sj = (await s.json()) as { capabilities?: string[] };
              return sj.capabilities || [];
            } catch {
              return [] as string[];
            }
          });
          return { name, vision: caps.includes("vision") };
        })
      );
      return withCaps;
    } catch {
      return null;
    }
  });
}

async function* ollamaLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let j: { error?: string; message?: { content?: string } };
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j.error) throw new ProviderError(`Ollama: ${j.error}`, 500);
        if (j.message?.content) yield j.message.content;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Ollama's default context is only 2–4k tokens and it silently drops the start of longer
// prompts (your system prompt!). Ask for a real window; 8k fits a 4B model in ~1 GB extra RAM.
const ollamaCtx = () => num("OLLAMA_NUM_CTX", 8192);
const isOllamaCloud = () => /ollama\.com/.test(ollamaUrl());

const ollama: Provider = {
  id: "ollama",
  label: "Ollama",
  missingDetail: "Set OLLAMA_URL (and OLLAMA_API_KEY for Ollama Cloud)",
  configured: () => !!ollamaUrl(),
  // Ollama Cloud runs big models on fast hardware; a local one runs on your CPU/GPU.
  get local() {
    return !isOllamaCloud();
  },
  budget: () => {
    const output = num("OLLAMA_MAX_OUTPUT", 1024);
    return { input: Math.max(1024, ollamaCtx() - output), output };
  },
  async candidates(needVision) {
    const models = await ollamaModels();
    if (!models?.length) return [];
    const wanted = env("OLLAMA_MODEL");
    const wantedVision = env("OLLAMA_VISION_MODEL");
    const pick = (name: string) => models.find((m) => m.name === name || m.name === `${name}:latest`);
    const out: Candidate[] = [];
    const add = (m?: { name: string; vision: boolean }) => {
      if (m && !out.some((o) => o.model === m.name)) out.push({ provider: "ollama", label: "Ollama", model: m.name, vision: m.vision });
    };
    if (needVision) {
      add(wantedVision ? pick(wantedVision) : undefined);
      models.filter((m) => m.vision).forEach(add);
    } else {
      add(wanted ? pick(wanted) : undefined);
      add(models[0]);
    }
    return out.slice(0, 1);
  },
  async open(cand, messages, opts) {
    const payload = (think: boolean) => ({
      model: cand.model,
      stream: true,
      ...(think ? { think: false } : {}),
      ...(opts.json ? { format: "json" } : {}),
      // Stay loaded between messages so replies start fast (and the prompt cache is reused).
      keep_alive: env("OLLAMA_KEEP_ALIVE", "2h"),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images?.length ? { images: m.images.map((i) => i.data) } : {}),
      })),
      options: {
        temperature: opts.temperature ?? 0.7,
        num_predict: opts.maxTokens ?? ollama.budget().output,
        ...(isOllamaCloud() ? {} : { num_ctx: ollamaCtx() }),
      },
    });
    let res = await connect(`${ollamaUrl()}/api/chat`, payload(true), ollamaHeaders(), opts.signal);
    if (res.status === 400) res = await connect(`${ollamaUrl()}/api/chat`, payload(false), ollamaHeaders(), opts.signal);
    opts.onResponse?.(res.headers);
    await throwIfBad(res, "Ollama", cand.model);
    return stripThink(ollamaLines(res.body!));
  },
};

// ---- The provider list ----

const isGeminiChat = (id: string) =>
  /^gemini-/.test(id) && !/image|tts|audio|live|embedding|veo|imagen|learnlm|computer-use|robotics/i.test(id);

// Ollama first: when it is reachable (your PC, your server, or Ollama Cloud) it is free and uncapped.
const PROVIDERS: Provider[] = [
  // Your own production gateway (the senko-llm repo): local model, API key, queue, rate limits.
  compatProvider({
    id: "senko",
    label: "Senko LLM",
    baseUrl: () => `${env("SENKO_LLM_URL").replace(/\/$/, "")}/v1`,
    // The gateway may run without a key on a private network.
    key: () => (env("SENKO_LLM_URL") ? env("SENKO_LLM_KEY") || "none" : ""),
    envModel: () => env("SENKO_LLM_MODEL"),
    envVisionModel: () => env("SENKO_LLM_VISION_MODEL"),
    preferred: [],
    isVision: (m) => m.vision,
    maxModels: 1,
    local: true,
    missingDetail: "Optional: run the senko-llm gateway and set SENKO_LLM_URL (+ SENKO_LLM_KEY)",
    budget: () => ({ input: num("SENKO_LLM_TOKEN_BUDGET", 7000), output: num("SENKO_LLM_MAX_OUTPUT", 1024) }),
  }),
  ollama,
  compatProvider({
    id: "gemini",
    label: "Gemini",
    baseUrl: () => "https://generativelanguage.googleapis.com/v1beta/openai",
    key: () => env("GEMINI_API_KEY") || env("GOOGLE_API_KEY"),
    envModel: () => env("GEMINI_MODEL"),
    envVisionModel: () => env("GEMINI_MODEL"),
    // Newer API keys can't use the 2.5 models (404), so try the current previews first.
    preferred: ["gemini-3.8-flash", "gemini-3-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-3.5-flash-lite"],
    preferredVision: ["gemini-3.8-flash", "gemini-3-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-2.5-flash"],
    // Measured: flash-lite answers in ~0.6s, the bigger previews in 0.6-4s.
    fastPreferred: ["gemini-3.1-flash-lite-preview", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"],
    // Prefer stable "flash" models: they have the most generous free limits.
    filter: (m) => isGeminiChat(m.id) && /flash/.test(m.id),
    isVision: (m) => isGeminiChat(m.id),
    extras: () => ({ reasoning_effort: "low" }),
    maxModels: 3,
    missingDetail: "Add GEMINI_API_KEY (free at aistudio.google.com/apikey)",
    budget: () => ({ input: num("GEMINI_TOKEN_BUDGET", 60_000), output: 4096 }),
  }),
  // Paid, but cheap and without hard per-minute caps: what keeps the agent fast when the
  // free tiers are used up. DeepSeek-V4.1-Flash also reads screenshots.
  compatProvider({
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: () => "https://api.deepseek.com",
    key: () => env("DEEPSEEK_API_KEY"),
    envModel: () => (env("DEEPSEEK_MODEL") === "deepseek-chat" ? "" : env("DEEPSEEK_MODEL")),
    envVisionModel: () => env("DEEPSEEK_VISION_MODEL"),
    preferred: ["deepseek-flash", "deepseek-v4-pro"],
    preferredVision: ["deepseek-flash"],
    fastPreferred: ["deepseek-flash"],
    isVision: (m) => m.vision,
    extras: () => ({ reasoning_effort: "low" }),
    maxModels: 2,
    missingDetail: "Add DEEPSEEK_API_KEY (platform.deepseek.com, pay as you go)",
    budget: () => ({ input: num("DEEPSEEK_TOKEN_BUDGET", 60_000), output: 4096 }),
  }),
  compatProvider({
    id: "groq",
    label: "Groq",
    baseUrl: () => "https://api.groq.com/openai/v1",
    key: () => env("GROQ_API_KEY"),
    envModel: () => env("GROQ_MODEL"),
    envVisionModel: () => env("GROQ_VISION_MODEL"),
    preferred: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
    preferredVision: ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"],
    fastPreferred: ["openai/gpt-oss-120b", "meta-llama/llama-4-scout-17b-16e-instruct"],
    filter: (m) => !/whisper|guard|orpheus|tts|allam|safeguard/i.test(m.id),
    isVision: (m) => /llama-4|vision|-vl/i.test(m.id),
    extras: (model) => (/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {}),
    maxModels: 2,
    missingDetail: "Add GROQ_API_KEY (free at console.groq.com/keys)",
    // Groq's free tier allows ~6–8k tokens per minute *including* the reply it reserves,
    // so long chats used to be rejected outright. Keep each request well under that.
    budget: () => ({ input: num("GROQ_TOKEN_BUDGET", 5000), output: 1200 }),
  }),
  compatProvider({
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: () => "https://openrouter.ai/api/v1",
    key: () => env("OPENROUTER_API_KEY"),
    envModel: () => env("OPENROUTER_MODEL"),
    envVisionModel: () => env("OPENROUTER_VISION_MODEL"),
    // openai/gpt-oss-120b:free and minimax/minimax-m3.1-flash:free were retired (404) in Oct 2026.
    preferred: ["google/gemma-4-31b-it:free"],
    preferredVision: ["google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-26b-a4b-it:free"],
    // Only free models: never spend credit by surprise.
    filter: (m) => m.id.endsWith(":free") && !/safety|guard/i.test(m.id),
    headers: () => ({ "HTTP-Referer": "https://github.com/senko-sleep/senko-ai-v2", "X-Title": "Senko AI" }),
    maxModels: 3,
    missingDetail: "Add OPENROUTER_API_KEY (free at openrouter.ai/keys)",
    budget: () => ({ input: num("OPENROUTER_TOKEN_BUDGET", 16_000), output: 2048 }),
  }),
  compatProvider({
    id: "llm7",
    label: "LLM7",
    baseUrl: () => "https://api.llm7.io/v1",
    key: () => env("LLM7_API_KEY"),
    envModel: () => env("LLM7_MODEL", "default"),
    preferred: ["default"],
    modelFallbackOnly: true,
    maxModels: 1,
    missingDetail: "Add LLM7_API_KEY (api.llm7.io)",
    budget: () => ({ input: num("LLM7_TOKEN_BUDGET", 12_000), output: num("LLM7_MAX_OUTPUT", 2048) }),
  }),
  compatProvider({
    id: "sambanova",
    label: "SambaNova",
    baseUrl: () => env("SAMBANOVA_BASE_URL", "https://api.sambanova.ai/v1").replace(/\/$/, ""),
    key: () => env("SAMBANOVA_API_KEY"),
    envModel: () => env("SAMBANOVA_MODEL"),
    envVisionModel: () => env("SAMBANOVA_VISION_MODEL"),
    // Discover current models from SambaNova instead of pinning a model that may be retired.
    preferred: [],
    preferredVision: [],
    isVision: (m) => m.vision,
    maxModels: 2,
    missingDetail: "Add SAMBANOVA_API_KEY (cloud.sambanova.ai)",
    budget: () => ({ input: num("SAMBANOVA_TOKEN_BUDGET", 24_000), output: num("SAMBANOVA_MAX_OUTPUT", 2048) }),
  }),
  compatProvider({
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    baseUrl: () => `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/ai/v1`,
    key: () => env("CLOUDFLARE_ACCOUNT_ID") && env("CLOUDFLARE_API_TOKEN"),
    envModel: () => env("CLOUDFLARE_MODEL", "@cf/meta/llama-3.1-8b-instruct"),
    envVisionModel: () => env("CLOUDFLARE_VISION_MODEL"),
    preferred: ["@cf/meta/llama-3.1-8b-instruct"],
    preferredVision: [],
    maxModels: 2,
    missingDetail: "Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI)",
    budget: () => ({ input: num("CLOUDFLARE_TOKEN_BUDGET", 12_000), output: num("CLOUDFLARE_MAX_OUTPUT", 2048) }),
  }),
  compatProvider({
    id: "paid",
    label: "Your API key",
    baseUrl: () => env("PAID_API_BASE_URL", env("OPENAI_BASE_URL", "https://api.openai.com/v1")).replace(/\/$/, ""),
    key: () => env("PAID_API_KEY") || env("OPENAI_API_KEY"),
    envModel: () => env("PAID_MODEL", env("OPENAI_MODEL", "gpt-4o-mini")),
    envVisionModel: () => env("PAID_VISION_MODEL", env("PAID_MODEL", env("OPENAI_MODEL", "gpt-4o-mini"))),
    preferred: [],
    filter: () => false,
    isVision: () => true,
    maxModels: 1,
    missingDetail: "Optional: PAID_API_KEY (+ PAID_API_BASE_URL, PAID_MODEL) as a last resort",
    budget: () => ({ input: num("PAID_TOKEN_BUDGET", 60_000), output: 4096 }),
  }),
];

function orderedProviders(first?: string): Provider[] {
  const custom = env("LLM_ORDER")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let list = custom.length
    ? [...custom.map((id) => PROVIDERS.find((p) => p.id === id)).filter((p): p is Provider => !!p), ...PROVIDERS.filter((p) => !custom.includes(p.id))]
    : [...PROVIDERS];
  if (first && first !== "auto") list = [...list.filter((p) => p.id === first), ...list.filter((p) => p.id !== first)];
  return list;
}

// ---------------------------------------------------------------------------
// Strip <think>...</think> blocks some models emit inline
// ---------------------------------------------------------------------------

async function* stripThink(src: AsyncGenerator<string>): AsyncGenerator<string> {
  let inside = false;
  let pending = "";
  for await (const chunk of src) {
    pending += chunk;
    let out = "";
    while (pending) {
      if (inside) {
        const end = pending.indexOf("</think>");
        if (end === -1) {
          pending = pending.slice(-8);
          break;
        }
        pending = pending.slice(end + 8);
        inside = false;
      } else {
        const start = pending.indexOf("<think>");
        if (start === -1) {
          const lt = pending.lastIndexOf("<");
          if (lt !== -1 && pending.length - lt < 7) {
            out += pending.slice(0, lt);
            pending = pending.slice(lt);
          } else {
            out += pending;
            pending = "";
          }
          break;
        }
        out += pending.slice(0, start);
        pending = pending.slice(start + 7);
        inside = true;
      }
    }
    if (out) yield out;
  }
  if (!inside && pending) yield pending;
}

/** Re-yield a generator whose first chunk we've already pulled. */
async function* prepend(first: string, rest: AsyncGenerator<string>): AsyncGenerator<string> {
  yield first;
  yield* rest;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The provider rejected the request for its size (not for being busy). */
function isTooLarge(e: unknown): boolean {
  const pe = e instanceof ProviderError ? e : null;
  if (pe?.status === 413) return true;
  return /too large|context length|maximum context|context window|reduce the length|prompt is too long|tokens per minute \(TPM\): Limit \d+, Requested/i.test(
    e instanceof Error ? e.message : String(e)
  );
}

function friendly(e: unknown): string {
  if (e instanceof ProviderError) {
    // Messages look like "<Label> <status> (<model>): <details>"; model ids can contain ":".
    const who = e.message.match(/^(.*?\))(?=:)/)?.[1] || e.message.split(": ")[0];
    if (e.status === 429) return `${who}: rate limit reached${e.retryMs ? ` (free again in ~${Math.ceil(e.retryMs / 1000)}s)` : ""}`;
    if (e.status === 401 || e.status === 403) return `${who}: API key rejected`;
    if (e.status === 402) return `${who}: out of credit`;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Start a backup model if the current one hasn't started answering after this long.
 * Screenshots make models slower to start, so those get more patience. Every backup is a
 * real request against someone's quota, so it only goes out when that model has plenty of
 * headroom (scheduler pressure below HEDGE_MAX_PRESSURE) and at most MAX_PARALLEL run at once.
 */
const HEDGE_MS = (vision = false) => (vision ? num("LLM_HEDGE_VISION_MS", 7000) : num("LLM_HEDGE_MS", 3500));
const MAX_PARALLEL = () => Math.max(1, num("LLM_MAX_PARALLEL", 2));
const HEDGE_MAX_PRESSURE = 0.5;
/** Give up on a model that hasn't sent its first words after this long. */
const FIRST_TOKEN_MS = () => num("LLM_FIRST_TOKEN_MS", 20_000);

interface QueueEntry {
  p: Provider;
  c: Candidate;
  /** Input + output tokens this request reserves in the scheduler. */
  est: number;
  /** Fit the input to this many tokens (the provider's budget, or less when its per-minute limit is smaller). */
  inputBudget: number;
  maxTokens: number;
}

/**
 * Open one model and read the first words, so empty replies, refusals and stalls are
 * caught before we commit to it. Rejects with a ProviderError on any problem.
 */
async function tryCandidate(q: QueueEntry, messages: LlmMessage[], opts: LlmOptions, signal: AbortSignal): Promise<{ stream: AsyncGenerator<string>; inputTokens: number }> {
  const { p, c } = q;
  if (opts.simulateFail?.includes(c.provider)) {
    throw new ProviderError(`${c.label} (${c.model}): simulated failure for testing`, 503, null);
  }
  // Fit the conversation to this provider. If it still says "too large" (our estimate
  // was off), try once more at half the size before moving on.
  let gen: AsyncGenerator<string> | null = null;
  let inputTokens = 0;
  for (const scale of [1, 0.5]) {
    const fitted = fitMessages(messages, Math.floor(q.inputBudget * scale), opts.compactSystem, !!p.local || scale < 1);
    inputTokens = totalTokens(fitted);
    try {
      gen = await p.open(c, fitted, {
        ...opts,
        signal,
        maxTokens: q.maxTokens,
        onResponse: (h) => scheduler.observeHeaders(c.provider, c.model, h),
      });
      break;
    } catch (err) {
      if (scale === 1 && isTooLarge(err)) {
        console.warn(`[llm] ${c.label} (${c.model}): request too large, retrying smaller`);
        continue;
      }
      throw err;
    }
  }
  if (!gen) throw new ProviderError(`${c.label} (${c.model}): request too large even after trimming`, 413, null);
  // Pull initial chunks so an empty stream or canned refusal falls back to the next model.
  let head = "";
  while (head.length < 72) {
    const step = await gen.next();
    if (step.done) break;
    head += step.value;
  }
  if (!head.trim()) {
    throw new ProviderError(`${c.label} (${c.model}): empty response`, 422, null);
  }
  if (/^\s*(?:i'm sorry,? (?:but )?i (?:cannot|can't|am unable|won't)|i (?:cannot|can't|am unable to|must decline to) (?:fulfill|assist|help|provide|comply|search|open|generate)|as an ai(?: language model)?,? i (?:cannot|can't|do not))/i.test(head)) {
    throw new ProviderError(`${c.label} (${c.model}): model refused request`, 422, null);
  }
  return { stream: prepend(head, gen), inputTokens };
}

/** Pass a stream through, then tell the scheduler what it really used. */
async function* metered(src: AsyncGenerator<string>, done: (outChars: number) => void): AsyncGenerator<string> {
  let out = 0;
  try {
    for await (const chunk of src) {
      out += chunk.length;
      yield chunk;
    }
  } finally {
    done(out);
  }
}

/**
 * Try models best-first, but don't wait on a slow one: if it hasn't started answering
 * within HEDGE_MS, a backup starts in parallel (only where there's headroom) and whichever
 * answers first wins. Every attempt holds a scheduler ticket. Returns null when none answered.
 */
async function raceCandidates(
  queue: QueueEntry[],
  messages: LlmMessage[],
  opts: LlmOptions,
  onFail: (q: QueueEntry, e: unknown) => void,
  onPaced: (waitMs: number) => void = () => {}
): Promise<{ c: Candidate; stream: AsyncGenerator<string> } | null> {
  if (!queue.length) return null;
  const priority = opts.priority ?? "interactive";
  return new Promise((resolve) => {
    const started = new Array(queue.length).fill(false);
    const live = new Set<string>();
    let running = 0;
    let done = false;
    let hedge: ReturnType<typeof setTimeout> | null = null;
    const attempts: { ctl: AbortController; timer: ReturnType<typeof setTimeout> }[] = [];

    const finish = (result: { c: Candidate; stream: AsyncGenerator<string> } | null, keep?: AbortController) => {
      if (done) return;
      done = true;
      if (hedge) clearTimeout(hedge);
      for (const a of attempts) {
        clearTimeout(a.timer);
        if (a.ctl !== keep) a.ctl.abort();
      }
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => finish(null);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const scheduleHedge = () => {
      if (hedge) clearTimeout(hedge);
      if (opts.hedge === false) return;
      const ms = HEDGE_MS(messages.some((m) => m.images?.length));
      if (ms > 0 && started.includes(false) && running < MAX_PARALLEL()) hedge = setTimeout(() => launch(true), ms);
    };

    function launch(asBackup = false): void {
      if (done) return;
      // A backup only while fewer than MAX_PARALLEL are in flight; failures still move on at once.
      if (asBackup && running >= MAX_PARALLEL()) return;
      // A backup should come from another provider (one provider is often slow as a whole)
      // and only where it won't eat into a nearly used-up limit.
      let i = -1;
      if (asBackup) {
        i = queue.findIndex(
          (q, n) => !started[n] && !live.has(q.p.id) && scheduler.pressure(q.c.provider, q.c.model) < HEDGE_MAX_PRESSURE && scheduler.delayFor(q.c.provider, q.c.model, q.est, priority) === 0
        );
        if (i < 0) return; // nothing with headroom: keep waiting on the first one
      } else {
        i = started.indexOf(false);
      }
      if (i < 0) {
        if (running === 0) finish(null);
        return;
      }
      started[i] = true;
      const q = queue[i];
      const { p, c } = q;
      // Time has passed since the queue was built (hedge timer, earlier failures): re-check.
      const late = scheduler.delayFor(c.provider, c.model, q.est, priority);
      if (late > 0) {
        onPaced(late);
        return launch(asBackup);
      }
      live.add(p.id);
      running++;
      const ticket = scheduler.acquire(c.provider, c.model, q.est);
      const ctl = new AbortController();
      // The winner must still stop when the caller aborts.
      opts.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
      let slow = false;
      const timer = setTimeout(() => {
        slow = true;
        ctl.abort();
      }, FIRST_TOKEN_MS());
      attempts.push({ ctl, timer });
      tryCandidate(q, messages, opts, ctl.signal).then(
        ({ stream, inputTokens }) => {
          clearTimeout(timer);
          running--;
          live.delete(p.id);
          scheduler.onSuccess(c.provider, c.model);
          if (done) {
            ticket.release(inputTokens);
            void stream.return(undefined).catch(() => {});
            return;
          }
          finish({ c, stream: metered(stream, (out) => ticket.release(inputTokens + Math.ceil(out / 3.6))) }, ctl);
        },
        (e) => {
          clearTimeout(timer);
          running--;
          live.delete(p.id);
          const status = e instanceof ProviderError ? e.status : 0;
          // A rejected request (rate limit, connection failure) used no tokens; an aborted or failed one may have.
          ticket.release(status === 429 || status === 0 || status === 401 || status === 403 ? 0 : undefined);
          if (done) return;
          const err = slow ? new ProviderError(`${c.label} (${c.model}): no answer within ${Math.round(FIRST_TOKEN_MS() / 1000)}s`, 408, null) : e;
          onFail(q, err);
          // Failed: move to the next model right away instead of waiting for the hedge timer.
          launch();
        }
      );
      scheduleHedge();
    }

    launch();
  });
}

/**
 * Stream a reply, falling back across providers/models until one answers.
 * Requests are paced: a model whose limits are full is skipped until it frees up, and when
 * every model is full the call waits (up to maxWaitMs) for the first free slot.
 * Throws LlmBusyError when everything stayed rate-limited, Error when everything failed.
 */
export async function openStream(messages: LlmMessage[], opts: LlmOptions = {}): Promise<OpenedStream> {
  const needVision = messages.some((m) => m.images?.length);
  const priority = opts.priority ?? "interactive";
  let errors: string[] = [];
  let skipped: string[] = [];
  const deadline = Date.now() + (opts.maxWaitMs ?? 30_000);
  const inputTokens = totalTokens(messages);
  let soonest = Infinity;

  await syncSharedCooldowns();
  // Bounded by the deadline; the cap is just a guard against a busy loop.
  for (let round = 0; round < 200; round++) {
    // Each round reports fresh reasons (retry times change between rounds).
    errors = [];
    skipped = [];
    /** Soonest moment a rate-limited / temporarily failing model should be usable again. */
    soonest = Infinity;

    const ready: (QueueEntry & { whole: boolean })[] = [];
    let providers = orderedProviders(opts.provider).filter((p) => p.configured());
    if (opts.fast && !needVision && (!opts.provider || opts.provider === "auto")) {
      providers = [...providers.filter((p) => p.id === "groq"), ...providers.filter((p) => p.id !== "groq")];
    }
    const lists = await Promise.all(providers.map((p) => p.candidates(needVision, opts.fast).catch(() => [] as Candidate[])));
    providers.forEach((p, i) => {
      for (const c of lists[i]) {
        if (needVision && !c.vision) continue;
        const cool = isCooling(c.provider, c.model);
        if (cool) {
          if (cool.retryable) soonest = Math.min(soonest, cool.until - Date.now());
          skipped.push(`${c.label} (${c.model}): ${cool.reason}`);
          continue;
        }
        const budget = p.budget();
        const maxTokens = Math.min(opts.maxTokens ?? budget.output, budget.output);
        // A model whose per-minute token limit is smaller than its request budget gets a smaller request.
        const cap = scheduler.maxRequestTokens(c.provider, c.model, priority);
        const inputBudget = Math.min(budget.input, cap - maxTokens - 200);
        if (inputBudget < 1500) {
          skipped.push(`${c.label} (${c.model}): its per-minute token limit is too small for this request`);
          continue;
        }
        const est = Math.min(inputTokens, inputBudget) + maxTokens;
        const wait = scheduler.delayFor(c.provider, c.model, est, priority);
        if (wait > 0) {
          if (Number.isFinite(wait)) soonest = Math.min(soonest, wait);
          skipped.push(`${c.label} (${c.model}): pacing to stay under its rate limit (free in ~${Math.ceil(wait / 1000)}s)`);
          continue;
        }
        // Prefer models that take the whole request; heavy trimming loses the context a good answer needs.
        ready.push({ p, c, est, inputBudget, maxTokens, whole: inputTokens <= inputBudget * 1.6 });
      }
    });
    const queue = [...ready.filter((r) => r.whole), ...ready.filter((r) => !r.whole)];

    const onFail = (q: QueueEntry, e: unknown) => {
      const { c } = q;
      const pe = e instanceof ProviderError ? e : null;
      const status = pe?.status ?? 0;
      if (!opts.simulateFail?.includes(c.provider)) {
        // Only real daily caps get the long cooldown. Gemini says "exceeded your current quota" for
        // per-minute limits too, so "quota" alone isn't a sign; trust its retry hint instead.
        const daily = /per ?day|daily|RPD|free-models-per-day/i.test(pe?.message || "") || (pe?.retryMs ?? 0) > 60 * 60_000;
        // A 429 shrinks the model's limit in the scheduler and backs off exponentially with jitter.
        const backoff = status === 429 ? scheduler.onRateLimited(c.provider, c.model, pe?.retryMs ?? null) : 0;
        const ms =
          isTooLarge(e) ? 5_000 // not the provider's fault; a smaller request may work right away
          : status === 429 ? (daily ? Math.max(backoff, 60 * 60_000) : backoff)
          : status === 402 ? 60 * 60_000 // out of credit
          : status === 401 || status === 403 ? 10 * 60_000
          : status === 404 ? 60 * 60_000
          : status === 422 ? 2_000
          : status === 408 ? 20_000 // too slow to answer: let faster models take over for a bit
          : 30_000;
        // Worth waiting for: rate limits, network blips and server errors (not refusals/bad keys).
        const retryable = status === 429 || status === 0 || status === 408 || status >= 500;
        coolDown(c.provider, c.model, ms, status === 429 ? (daily ? "daily limit reached" : "rate limited") : status === 408 ? "too slow" : `error ${status || "network"}`, retryable);
        if (retryable) soonest = Math.min(soonest, ms);
      }
      const msg = friendly(e);
      console.warn(`[llm] ${msg}`);
      errors.push(msg);
      skipped.push(msg);
    };

    const won = await raceCandidates(queue, messages, opts, onFail, (w) => (soonest = Math.min(soonest, w)));
    if (won) return { provider: won.c.provider, providerLabel: won.c.label, model: won.c.model, stream: won.stream, skipped };
    if (opts.signal?.aborted) throw new Error("Aborted");

    // Everything is paced or rate-limited for now: wait for the first model to free up
    // (within the caller's patience) and try again, instead of failing the whole request.
    if (Number.isFinite(soonest) && Date.now() + soonest <= deadline) {
      const wait = Math.max(250, soonest + 100);
      if (wait >= 1500) {
        console.warn(`[llm] all providers busy, waiting ${Math.ceil(wait / 1000)}s for the next free one`);
        opts.onWait?.(wait);
      }
      // Wakes early when another request finishes and frees a slot.
      await scheduler.waitForChange(wait, opts.signal);
      if (opts.signal?.aborted) throw new Error("Aborted");
      continue;
    }
    break;
  }

  const configured = PROVIDERS.filter((p) => p.configured());
  if (!configured.length) {
    throw new Error("No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY on the server.");
  }
  if (needVision && !errors.length && !skipped.length) {
    throw new Error("No image-capable model is available. Add GEMINI_API_KEY (free) to analyze images.");
  }
  const reasons = [...new Set([...errors, ...skipped])];
  const text = `Every AI provider is busy or failing right now:\n- ${reasons.join("\n- ")}`;
  if (Number.isFinite(soonest)) throw new LlmBusyError(text, Math.max(0, Math.ceil(soonest)), reasons);
  throw new Error(text);
}

// ---- identical-request sharing --------------------------------------------------------

const answers = new Map<string, { at: number; ttl: number; value: Promise<Answered & { text: string }> }>();

/** FNV-1a over the request (cheap, no crypto needed; collisions only cost a wrong cache hit at ~2^-32). */
function requestKey(messages: LlmMessage[], opts: LlmOptions): string {
  let h = 0x811c9dc5;
  const add = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  add(JSON.stringify([opts.provider, opts.json, opts.maxTokens, opts.temperature, opts.compactSystem]));
  for (const m of messages) {
    add(m.role);
    add(m.content);
    for (const i of m.images || []) add(i.data);
  }
  return `${(h >>> 0).toString(36)}:${messages.length}`;
}

/**
 * Non-streaming helper (collects the whole reply).
 * With cacheTtlMs, identical requests share one in-flight call and reuse its answer.
 */
export async function complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<Answered & { text: string }> {
  const run = async () => {
    const { stream, provider, providerLabel, model } = await openStream(messages, opts);
    let text = "";
    for await (const c of stream) text += c;
    return { text, provider, providerLabel, model };
  };
  if (!opts.cacheTtlMs || opts.simulateFail?.length) return run();
  const now = Date.now();
  for (const [k, v] of answers) if (now - v.at > v.ttl) answers.delete(k);
  const k = requestKey(messages, opts);
  const hit = answers.get(k);
  if (hit) return hit.value;
  const value = run();
  answers.set(k, { at: now, ttl: opts.cacheTtlMs, value });
  // Failures aren't worth remembering.
  value.catch(() => answers.delete(k));
  return value;
}

/**
 * Spare capacity right now (0 = everything is at its limit or cooling down, 1 = idle) across the
 * configured models that could take a request. Lets the agent skip optional work (a sanity-check
 * screenshot needs the scarcest kind of model) before it causes a rate limit.
 */
export async function headroom(needVision: boolean): Promise<number> {
  let best = 0;
  const providers = PROVIDERS.filter((p) => p.configured());
  const lists = await Promise.all(providers.map((p) => p.candidates(needVision).catch(() => [] as Candidate[])));
  for (const list of lists) {
    for (const c of list) {
      if (needVision && !c.vision) continue;
      if (isCooling(c.provider, c.model)) continue;
      best = Math.max(best, 1 - scheduler.pressure(c.provider, c.model));
      if (best >= 1) return 1;
    }
  }
  return best;
}

export async function listProviders(): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  for (const p of orderedProviders()) {
    if (!p.configured()) {
      out.push({ id: p.id, label: p.label, available: false, detail: p.missingDetail });
      continue;
    }
    const [text, vision] = await Promise.all([p.candidates(false).catch(() => []), p.candidates(true).catch(() => [])]);
    const model = text[0]?.model;
    const cool = model ? isCooling(p.id, model) : null;
    out.push({
      id: p.id,
      label: p.label,
      available: !!model,
      model,
      visionModel: vision[0]?.model,
      detail: model ? (cool ? `cooling down: ${cool.reason}` : undefined) : p.id === "ollama" ? `Can't reach Ollama at ${ollamaUrl()}` : p.id === "senko" ? `Can't reach the Senko LLM gateway at ${env("SENKO_LLM_URL")}` : "No usable model found",
      coolingUntil: cool?.until,
    });
  }
  return out;
}

export function hasVisionProvider(): boolean {
  return PROVIDERS.some((p) => p.configured() && (p.id === "gemini" || p.id === "openrouter" || p.id === "paid" || p.id === "ollama" || p.id === "senko" || p.id === "sambanova" || (p.id === "cloudflare" && !!env("CLOUDFLARE_VISION_MODEL"))));
}
