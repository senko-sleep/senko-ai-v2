// Conversation starters for the welcome screen, written by the AI.
//  - Personalized (default): uses what Senko remembers + recent chat topics, as themes only.
//  - Off: no personal data is read at all; the AI writes general-purpose starters.
// Every suggestion gets an icon from a fixed set, so it always renders.
import { complete } from "@/lib/llm";
import { guessIcon, isSuggestionIcon, SUGGESTION_ICONS, type SuggestionIcon } from "@/lib/suggestion-icons";
import { json, q, q1 } from "./db";
import { memoriesFor } from "./persona";

export type SuggestionMode = "chat" | "agent";

export interface Suggestion {
  id: string;
  /** Short card title, 2–6 words. */
  title: string;
  /** The message that gets sent when the card is picked. */
  prompt: string;
  icon: SuggestionIcon;
  mode: SuggestionMode;
}

export interface SuggestionResult {
  suggestions: Suggestion[];
  personalized: boolean;
  /** True when interests or past chats actually shaped these suggestions. */
  usedHistory: boolean;
  /** "ai" = written by the model just now, "fallback" = curated list (AI unavailable). */
  source: "ai" | "fallback";
  generatedAt: number;
}

const COUNT = 4;
const HISTORY_MAX = 40;
const CACHE_MS = 20 * 60_000;

// Memory keys that are about identity rather than interests. Never used, never echoed.
const PRIVATE_KEY =
  /name|email|phone|address|street|city|town|zip|postal|location|lives?|home|birth|age|password|secret|token|ssn|card|bank|account|health|medical|diagnos|condition|medication|religion|politic|partner|wife|husband|girlfriend|boyfriend|kid|child|son|daughter|school|employer|salary/i;
const PRIVATE_TEXT = /@[\w-]+\.\w|\+?\d[\d\s().-]{7,}\d|\b\d{1,5}\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive)\b/i;

// ---------------------------------------------------------------------------
// Context (interest signals only)
// ---------------------------------------------------------------------------

interface Signals {
  interests: string[];
  recentTopics: string[];
  /** Values that must never appear in suggestion text. */
  privateValues: string[];
}

export async function gatherSignals(ownerId: string): Promise<Signals> {
  const [memories, chats, msgs] = await Promise.all([
    memoriesFor(ownerId),
    q<{ title: string }>("SELECT title FROM chats WHERE owner_id = $1 AND title <> 'New chat' ORDER BY updated_at DESC LIMIT 12", [ownerId]),
    q<{ content: string }>(
      `SELECT m.content FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE c.owner_id = $1 AND m.role = 'user' AND m.content <> ''
       ORDER BY m.seq DESC LIMIT 16`,
      [ownerId]
    ),
  ]);

  const privateValues: string[] = [];
  const interests: string[] = [];
  for (const m of memories) {
    if (PRIVATE_KEY.test(m.key) || PRIVATE_TEXT.test(m.value)) {
      if (m.value.trim().length >= 3) privateValues.push(m.value.trim());
      continue;
    }
    interests.push(`${m.key.replace(/_/g, " ")}: ${m.value}`.slice(0, 140));
  }

  const scrub = (s: string) => s.replace(PRIVATE_TEXT, "…").replace(/\s+/g, " ").trim();
  const recentTopics = [...new Set([...chats.map((c) => scrub(c.title)), ...msgs.map((m) => scrub(m.content).slice(0, 140))])]
    .filter((t) => t.length > 3)
    .slice(0, 20);

  return { interests: interests.slice(0, 25), recentTopics, privateValues };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const ANGLES = [
  "something to learn", "something to make", "something fun", "something practical for today",
  "a deeper follow-up", "a surprising fact", "a quick plan", "a creative twist", "a recommendation",
  "a hands-on project", "a comparison", "a challenge",
];

function season(d: Date) {
  const m = d.getMonth();
  return m < 2 || m === 11 ? "winter" : m < 5 ? "spring" : m < 8 ? "summer" : "autumn";
}

export interface LocalTime {
  hour?: number;
  weekday?: string;
}

function buildPrompt(mode: SuggestionMode, signals: Signals | null, avoid: string[], local: LocalTime = {}): string {
  const now = new Date();
  const hour = local.hour ?? now.getHours();
  const weekday = local.weekday || now.toLocaleDateString("en-US", { weekday: "long" });
  const part = hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
  const angles = [...ANGLES].sort(() => Math.random() - 0.5).slice(0, COUNT);

  const lines = [
    `Write ${COUNT} conversation starters for the welcome screen of Senko, a warm AI assistant that can chat and can also drive a real web browser (Agent mode) to find, open and play things.`,
    `Context: it's ${part} on a ${weekday} in ${season(now)}. The user is in ${mode === "agent" ? "Agent mode, so every starter should be a concrete multi-step web task (find, compare, open, play)" : "Chat mode"}.`,
  ];

  if (signals && (signals.interests.length || signals.recentTopics.length)) {
    lines.push(
      "Personalize using these signals. Use them as THEMES only: build on interests, suggest a natural next step or a related new direction. Don't just repeat a past question.",
      signals.interests.length ? `Interests and preferences:\n- ${signals.interests.join("\n- ")}` : "",
      signals.recentTopics.length ? `Recent conversation topics:\n- ${signals.recentTopics.join("\n- ")}` : "",
      "Make about three of the four personal; let one be a fresh idea outside their usual topics."
    );
  } else {
    lines.push("There's no personal information. Write broadly useful, appealing starters for anyone.");
  }

  lines.push(
    `Give each starter a different flavor, in this order: ${angles.join("; ")}.`,
    mode === "chat" ? "One of the four may be a browsing task suited to Agent mode (set its mode to \"agent\")." : "",
    avoid.length ? `Recently shown (don't reuse these or near-duplicates):\n- ${avoid.slice(0, 24).join("\n- ")}` : "",
    "Privacy rules: never include names, places someone lives, contact details, health details, or anything that reveals private information. Talk about topics, not about the person.",
    "Write the prompt in the user's own voice, as the exact message they'd send to Senko: a request or question (first person, specific, 10–28 words). Never state facts or statistics in it; Senko will supply those in the answer. The title is a short label of 2–5 words, sentence case, no ending punctuation, no emoji.",
    `Pick the icon that best fits each starter, from exactly this list: ${SUGGESTION_ICONS.join(", ")}. Use a different icon for each.`,
    'Reply with JSON only, no prose: {"suggestions":[{"title":"...","prompt":"...","icon":"...","mode":"chat"|"agent"}]}'
  );
  return lines.filter(Boolean).join("\n\n");
}

/** Pull the suggestions array out of a model reply (tolerates code fences and stray text). */
export function parseSuggestions(text: string): unknown[] {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidates = [start !== -1 && end > start ? cleaned.slice(start, end + 1) : "", cleaned.slice(cleaned.indexOf("["), cleaned.lastIndexOf("]") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const v = JSON.parse(c);
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.suggestions)) return v.suggestions;
    } catch {
      /* try the next shape */
    }
  }
  return [];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Validate, tidy and de-duplicate raw model output. */
export function cleanSuggestions(
  raw: unknown[],
  opts: { mode: SuggestionMode; avoid?: string[]; privateValues?: string[] }
): Suggestion[] {
  const avoid = new Set((opts.avoid || []).map(norm));
  const privates = (opts.privateValues || []).map((v) => v.toLowerCase()).filter((v) => v.length >= 3);
  const seenTitles = new Set<string>();
  const usedIcons = new Set<string>();
  const out: Suggestion[] = [];

  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = String(o.title || "").replace(/["“”]/g, "").replace(/[.!]+$/, "").trim().slice(0, 48);
    const prompt = String(o.prompt || "").replace(/^["“]|["”]$/g, "").trim().slice(0, 240);
    if (title.length < 3 || prompt.length < 8) continue;

    const all = `${title} ${prompt}`;
    const lower = all.toLowerCase();
    if (PRIVATE_TEXT.test(all) || privates.some((p) => lower.includes(p))) continue;
    const key = norm(title);
    if (seenTitles.has(key) || avoid.has(key)) continue;

    let icon: SuggestionIcon = isSuggestionIcon(o.icon) && o.icon !== "sparkles" ? o.icon : guessIcon(all);
    if (usedIcons.has(icon)) {
      const alt = guessIcon(all);
      icon = usedIcons.has(alt) ? icon : alt;
    }
    const mode: SuggestionMode = opts.mode === "agent" || o.mode === "agent" ? "agent" : "chat";

    seenTitles.add(key);
    usedIcons.add(icon);
    out.push({ id: `${key.replace(/ /g, "-").slice(0, 32)}-${out.length}`, title, prompt, icon, mode });
    if (out.length === COUNT) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Curated fallback (used only when every AI provider is unavailable)
// ---------------------------------------------------------------------------

const FALLBACK: Record<SuggestionMode, Omit<Suggestion, "id" | "mode">[]> = {
  chat: [
    { title: "Explain it simply", prompt: "Explain how the internet actually gets a web page to my screen, in simple steps", icon: "globe" },
    { title: "Plan a cozy evening", prompt: "Help me plan a relaxing evening at home with a meal, a movie and a small treat", icon: "moon" },
    { title: "Learn a new skill", prompt: "Give me a 7-day plan to learn the basics of drawing, 20 minutes a day", icon: "palette" },
    { title: "Weeknight dinner ideas", prompt: "Suggest three quick weeknight dinners using chicken, rice and whatever vegetables I have", icon: "chef-hat" },
    { title: "Write a short story", prompt: "Write a 200-word story about a clever fox who opens a tiny café in the forest", icon: "feather" },
    { title: "Debug with me", prompt: "I'll paste some code that isn't working. Walk me through finding the bug step by step", icon: "bug" },
    { title: "A surprising fact", prompt: "Tell me one surprising science fact and explain why it's true", icon: "atom" },
    { title: "Anime picks", prompt: "Recommend five anime for someone who loved Spy x Family, with one line on why each fits", icon: "tv" },
    { title: "Budget check-in", prompt: "Help me make a simple monthly budget with categories and a savings goal", icon: "wallet" },
    { title: "Morning routine", prompt: "Design a realistic 30-minute morning routine that helps me feel focused", icon: "sun" },
    { title: "Practice a language", prompt: "Let's practice Japanese. Teach me five useful phrases for ordering food", icon: "languages" },
    { title: "Game night", prompt: "Suggest some fun party games for four friends that need no equipment", icon: "puzzle" },
  ],
  agent: [
    { title: "Find a trailer", prompt: "Find the official trailer for the newest Pixar movie on YouTube and play it", icon: "clapperboard" },
    { title: "Where to watch", prompt: "Find where I can legally watch Spy x Family for free and open episode 1", icon: "tv" },
    { title: "Compare prices", prompt: "Compare the price of a Nintendo Switch OLED on two big retailers and show me the cheaper one", icon: "shopping-bag" },
    { title: "Trending today", prompt: "Open the top trending videos on YouTube right now and tell me what the top three are about", icon: "zap" },
    { title: "Weather check", prompt: "Look up this weekend's weather forecast for Tokyo and summarize it", icon: "cloud-sun" },
    { title: "Recipe hunt", prompt: "Find a highly rated recipe for fluffy pancakes and open it", icon: "utensils" },
    { title: "Music for focus", prompt: "Find a lo-fi study playlist on YouTube and start playing it", icon: "headphones" },
    { title: "Latest space news", prompt: "Find the latest NASA news article and give me a short summary", icon: "rocket" },
  ],
};

export function fallbackSuggestions(mode: SuggestionMode, avoid: string[] = []): Suggestion[] {
  const skip = new Set(avoid.map(norm));
  const pool = FALLBACK[mode].filter((s) => !skip.has(norm(s.title)));
  const src = (pool.length >= COUNT ? pool : FALLBACK[mode]).slice().sort(() => Math.random() - 0.5);
  return src.slice(0, COUNT).map((s, i) => ({ ...s, mode, id: `fb-${norm(s.title).replace(/ /g, "-")}-${i}` }));
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __suggestionCache?: Map<string, SuggestionResult> };
const cache: Map<string, SuggestionResult> = (g.__suggestionCache ??= new Map());

export async function readSuggestionSettings(ownerId: string) {
  const row = await q1<{ data: unknown }>("SELECT data FROM settings WHERE owner_id = $1", [ownerId]);
  const data = json<Record<string, unknown>>(row?.data, {});
  return {
    personalized: data.personalizedSuggestions !== false,
    history: Array.isArray(data.suggestionHistory) ? (data.suggestionHistory as unknown[]).map(String) : [],
  };
}

async function remember(ownerId: string, titles: string[]) {
  const row = await q1<{ data: unknown }>("SELECT data FROM settings WHERE owner_id = $1", [ownerId]);
  const data = json<Record<string, unknown>>(row?.data, {});
  const prev = Array.isArray(data.suggestionHistory) ? (data.suggestionHistory as unknown[]).map(String) : [];
  data.suggestionHistory = [...titles, ...prev.filter((t) => !titles.includes(t))].slice(0, HISTORY_MAX);
  await q(
    "INSERT INTO settings (owner_id, data) VALUES ($1, $2) ON CONFLICT (owner_id) DO UPDATE SET data = EXCLUDED.data",
    [ownerId, JSON.stringify(data)]
  );
}

export function clearSuggestionCache(ownerId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${ownerId}|`)) cache.delete(k);
}

export async function getSuggestions(
  ownerId: string,
  opts: { mode?: SuggestionMode; refresh?: boolean; provider?: string; local?: LocalTime } = {}
): Promise<SuggestionResult> {
  const mode: SuggestionMode = opts.mode === "agent" ? "agent" : "chat";
  const { personalized, history } = await readSuggestionSettings(ownerId);
  const key = `${ownerId}|${mode}|${personalized ? "p" : "g"}`;
  const hit = cache.get(key);
  if (!opts.refresh && hit && Date.now() - hit.generatedAt < CACHE_MS) return hit;

  // When personalization is off, nothing personal is even loaded.
  const signals = personalized ? await gatherSignals(ownerId).catch(() => null) : null;
  const avoid = [...(hit?.suggestions.map((s) => s.title) || []), ...history];

  let suggestions: Suggestion[] = [];
  let source: SuggestionResult["source"] = "ai";
  try {
    const { text } = await complete(
      [
        { role: "system", content: "You write short, specific, genuinely useful conversation starters. You output strict JSON." },
        { role: "user", content: buildPrompt(mode, signals, avoid, opts.local) },
      ],
      { provider: opts.provider, temperature: 0.95, maxTokens: 1500, json: true, signal: AbortSignal.timeout(30_000), priority: "background", hedge: false }
    );
    suggestions = cleanSuggestions(parseSuggestions(text), { mode, avoid, privateValues: signals?.privateValues });
  } catch (e) {
    console.warn("[suggestions]", e instanceof Error ? e.message.split("\n")[0] : e);
  }
  if (suggestions.length < COUNT) {
    // Top up (or fully replace) with curated picks so the screen is never empty.
    const extra = fallbackSuggestions(mode, [...avoid, ...suggestions.map((s) => s.title)]).filter(
      (f) => !suggestions.some((s) => s.icon === f.icon)
    );
    if (!suggestions.length) source = "fallback";
    suggestions = [...suggestions, ...extra].slice(0, COUNT);
  }

  const usedHistory = source === "ai" && !!signals && (signals.interests.length > 0 || signals.recentTopics.length > 0);
  const result: SuggestionResult = { suggestions, personalized, usedHistory, source, generatedAt: Date.now() };
  cache.set(key, result);
  if (source === "ai") await remember(ownerId, suggestions.map((s) => s.title)).catch(() => {});
  return result;
}
