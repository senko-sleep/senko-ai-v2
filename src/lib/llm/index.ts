// Server-only LLM layer with automatic fallback.
//
// Default order: Senko LLM gateway -> Ollama (if reachable) -> Gemini -> Groq -> OpenRouter (free models) -> your paid key.
// - Every request is fitted to the provider's token budget (long chats are trimmed, and a compact
//   persona is used for local models), so a long conversation can't lock out a free tier.
// - Each provider can offer several models; requests with images only go to vision models.
// - A provider that rate-limits (429) or errors is put on a short "cooldown" and skipped,
//   so the next one answers without the user noticing.
// - If a stream fails before its first token, the next candidate takes over.
// Keys come from environment variables only and never reach the browser.

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

const cooldowns = new Map<string, { until: number; reason: string }>();
function coolKey(provider: string, model: string) {
  return `${provider}|${model}`;
}
function isCooling(provider: string, model: string) {
  const c = cooldowns.get(coolKey(provider, model));
  return c && c.until > Date.now() ? c : null;
}
function coolDown(provider: string, model: string, ms: number, reason: string) {
  cooldowns.set(coolKey(provider, model), { until: Date.now() + ms, reason });
}

class ProviderError extends Error {
  constructor(message: string, public status = 0, public retryMs: number | null = null) {
    super(message);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
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
  candidates(needVision: boolean): Promise<Candidate[]>;
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

// ---- OpenAI-compatible (Gemini, Groq, OpenRouter, DeepSeek, paid key) ----

interface CompatConfig {
  id: string;
  label: string;
  baseUrl: () => string;
  key: () => string;
  envModel: () => string;
  envVisionModel?: () => string;
  preferred: string[];
  preferredVision?: string[];
  /** Chooses usable chat models from the live /models list. */
  filter?: (m: LiveModel) => boolean;
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
        data?: { id: string; active?: boolean; architecture?: { input_modalities?: string[] } }[];
      };
      return (j.data || [])
        .filter((m) => m.active !== false)
        .map((m) => ({
          id: m.id.replace(/^models\//, ""),
          vision: !!m.architecture?.input_modalities?.includes("image"),
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
    async candidates(needVision) {
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
    preferred: ["gemini-3.8-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    preferredVision: ["gemini-3.8-flash", "gemini-3-flash", "gemini-2.5-flash"],
    // Prefer stable "flash" models: they have the most generous free limits.
    filter: (m) => isGeminiChat(m.id) && /flash/.test(m.id),
    isVision: (m) => isGeminiChat(m.id),
    extras: () => ({ reasoning_effort: "low" }),
    maxModels: 3,
    missingDetail: "Add GEMINI_API_KEY (free at aistudio.google.com/apikey)",
    budget: () => ({ input: num("GEMINI_TOKEN_BUDGET", 60_000), output: 4096 }),
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
    preferred: ["openai/gpt-oss-120b:free", "google/gemma-4-31b-it:free", "minimax/minimax-m3.1-flash:free"],
    preferredVision: ["google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-26b-a4b-it:free"],
    // Only free models: never spend credit by surprise.
    filter: (m) => m.id.endsWith(":free") && !/safety|guard/i.test(m.id),
    headers: () => ({ "HTTP-Referer": "https://github.com/senko-sleep/senko-ai-v2", "X-Title": "Senko AI" }),
    maxModels: 3,
    missingDetail: "Add OPENROUTER_API_KEY (free at openrouter.ai/keys)",
    budget: () => ({ input: num("OPENROUTER_TOKEN_BUDGET", 16_000), output: 2048 }),
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
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Stream a reply, falling back across providers/models until one answers.
 * Throws only when every option failed, with each reason listed.
 */
export async function openStream(messages: LlmMessage[], opts: LlmOptions = {}): Promise<OpenedStream> {
  const needVision = messages.some((m) => m.images?.length);
  const errors: string[] = [];
  const skipped: string[] = [];

  for (let round = 0; round < 2; round++) {
    let soonest = Infinity;
    for (const p of orderedProviders(opts.provider)) {
      if (!p.configured()) continue;
      let cands: Candidate[] = [];
      try {
        cands = await p.candidates(needVision);
      } catch {
        cands = [];
      }
      for (const c of cands) {
        if (opts.signal?.aborted) throw new Error("Aborted");
        if (needVision && !c.vision) continue;
        const cool = isCooling(c.provider, c.model);
        if (cool) {
          soonest = Math.min(soonest, cool.until - Date.now());
          if (round === 0) skipped.push(`${c.label} (${c.model}): ${cool.reason}`);
          continue;
        }
        try {
          if (opts.simulateFail?.includes(c.provider)) {
            throw new ProviderError(`${c.label} (${c.model}): simulated failure for testing`, 503, null);
          }
          const budget = p.budget();
          // Fit the conversation to this provider. If it still says "too large" (our estimate
          // was off), try once more at half the size before moving on.
          let gen: AsyncGenerator<string> | null = null;
          for (const scale of [1, 0.5]) {
            const fitted = fitMessages(messages, Math.floor(budget.input * scale), opts.compactSystem, !!p.local || scale < 1);
            const maxTokens = Math.min(opts.maxTokens ?? budget.output, budget.output);
            try {
              gen = await p.open(c, fitted, { ...opts, maxTokens });
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
          const stream = prepend(head, gen);
          return { provider: c.provider, providerLabel: c.label, model: c.model, stream, skipped };
        } catch (e) {
          if (opts.signal?.aborted) throw e;
          const pe = e instanceof ProviderError ? e : null;
          const status = pe?.status ?? 0;
          if (!opts.simulateFail?.includes(c.provider)) {
            const daily = /per day|daily|RPD|quota/i.test(pe?.message || "");
            const ms =
              isTooLarge(e) ? 5_000 // not the provider's fault; a smaller request may work right away
              : status === 429 ? Math.max(pe?.retryMs ?? 30_000, daily ? 60 * 60_000 : 15_000)
              : status === 401 || status === 403 ? 10 * 60_000
              : status === 404 ? 60 * 60_000
              : status === 422 ? 2_000
              : 30_000;
            coolDown(c.provider, c.model, ms, status === 429 ? "rate limited" : `error ${status || "network"}`);
          }
          const msg = friendly(e);
          console.warn(`[llm] ${msg}`);
          errors.push(msg);
          skipped.push(msg);
        }
      }
    }
    // Everything is cooling down briefly: wait for the first to free up, once.
    if (round === 0 && soonest < 25_000 && errors.length === 0) {
      await sleep(soonest + 250, opts.signal);
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
  throw new Error(`Every AI provider is busy or failing right now:\n- ${reasons.join("\n- ")}`);
}

/** Non-streaming helper (collects the whole reply). */
export async function complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<Answered & { text: string }> {
  const { stream, provider, providerLabel, model } = await openStream(messages, opts);
  let text = "";
  for await (const c of stream) text += c;
  return { text, provider, providerLabel, model };
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
  return PROVIDERS.some((p) => p.configured() && (p.id === "gemini" || p.id === "openrouter" || p.id === "paid" || p.id === "ollama" || p.id === "senko"));
}
