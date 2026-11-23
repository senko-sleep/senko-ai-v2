// A voice production: one narration, split into sections that are directed, synthesized and
// retried independently, then joined into one recording.
//
// The server owns the words. The director only returns performance cues for numbered lines,
// so it has no way to add, drop, reorder or rewrite narration.
import { neutralPlan, plainSpeech, type PerformancePlan, type PerformanceSegment, type SpeechSegment } from "./performance";

export type ProductionStage = "writing" | "directing" | "synthesizing" | "assembling" | "completed" | "failed";
export type SectionStatus = "pending" | "directing" | "queued" | "synthesizing" | "ready" | "failed";
export type DirectionSource = "director" | "neutral" | "edited";

/** Controls the speech engine really supports. Anything else a model returns is ignored. */
export interface SectionDirection {
  emotion: string;
  delivery: string;
  /** Speaking rate multiplier. */
  pace: number;
  /** Vocal projection multiplier. */
  energy: number;
  /** Register shift. */
  pitch: number;
  warmth: number;
  brightness: number;
  breathiness: number;
  /** Silence after this section in the joined recording. */
  pauseAfterMs: number;
}

export interface LineCue {
  /** 1-based line of the section. */
  line: number;
  kind?: "narration" | "dialogue";
  speaker?: string;
  emotion?: string;
  pace?: number;
  energy?: number;
  pitch?: number;
  pauseAfterMs?: number;
  emphasis?: string[];
}

/** How a named character sounds, reused by every section so the voice stays consistent. */
export interface CastVoice {
  pace: number;
  pitch: number;
  warmth: number;
  brightness: number;
  breathiness: number;
}

export interface VoiceSection {
  index: number;
  text: string;
  words: number;
  status: SectionStatus;
  direction: SectionDirection;
  directionSource: DirectionSource;
  cues: LineCue[];
  directorModel?: string;
  directorMs?: number;
  directorAttempts: number;
  directorNote?: string;
  audioId?: string;
  seconds?: number;
  /** Where this section starts in the joined recording. */
  startSeconds?: number;
  synthesisMs?: number;
  synthesisAttempts: number;
  linesDone?: number;
  linesTotal?: number;
  error?: string;
}

export interface VoiceProduction {
  version: 1;
  stage: ProductionStage;
  sections: VoiceSection[];
  cast: Record<string, CastVoice>;
  writer?: { provider?: string; model?: string; ms?: number };
  engine?: string;
  voice?: string;
  engineModel?: string;
  audioId?: string;
  seconds?: number;
  directingMs?: number;
  synthesisMs?: number;
  assemblingMs?: number;
  totalMs?: number;
  error?: string;
}

export const DIRECTION_LIMITS = {
  pace: [0.8, 1.2],
  energy: [0.6, 1.2],
  pitch: [-2, 2],
  warmth: [0, 1],
  brightness: [0, 1],
  breathiness: [0, 1],
  pauseAfterMs: [0, 1500],
} as const;

export const NEUTRAL_DIRECTION: SectionDirection = { emotion: "", delivery: "", pace: 1, energy: 1, pitch: 0, warmth: 0.5, brightness: 0.3, breathiness: 0.2, pauseAfterMs: 420 };

const MAX_SECTIONS = 8;
const SINGLE_SECTION_WORDS = 130;
const MAX_CAST = 8;

const clamp = (value: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.min(hi, Math.max(lo, n)) * 1000) / 1000;
};
const label = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
export const countWords = (text: string) => plainSpeech(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
const wordList = (text: string) => text.toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [];

/** True when both texts speak exactly the same words in the same order. */
export function sameWords(a: string, b: string) {
  return wordList(plainSpeech(a)).join(" ") === wordList(plainSpeech(b)).join(" ");
}

/** Split narration at paragraph, then sentence, boundaries. Joining the parts restores every word. */
export function splitNarration(text: string): string[] {
  const clean = text.trim();
  const total = countWords(clean);
  if (total <= SINGLE_SECTION_WORDS) return clean ? [clean] : [];
  const count = Math.min(MAX_SECTIONS, Math.max(2, Math.ceil(total / 200)));
  const target = total / count;
  const units: { text: string; words: number; paragraph: boolean }[] = [];
  for (const paragraph of clean.split(/\n+/).map(p => p.trim()).filter(Boolean)) {
    if (countWords(paragraph) <= target * 1.4) {
      units.push({ text: paragraph, words: countWords(paragraph), paragraph: true });
      continue;
    }
    paragraph.split(/(?<=[.!?…]["'”’)*]*)\s+/).forEach((sentence, i) => {
      if (sentence) units.push({ text: sentence, words: countWords(sentence), paragraph: i === 0 });
    });
  }
  const sections: string[] = [];
  let current = "", words = 0, spoken = 0;
  for (const unit of units) {
    if (current && words + unit.words / 2 >= target && sections.length < count - 1) {
      sections.push(current);
      spoken += words;
      current = "";
      words = 0;
    }
    current = current ? `${current}${unit.paragraph ? "\n" : " "}${unit.text}` : unit.text;
    words += unit.words;
  }
  if (current) sections.push(current);
  return spoken + words === total || sameWords(sections.join("\n"), clean) ? sections : [clean];
}

export function createProduction(text: string, writer?: VoiceProduction["writer"]): VoiceProduction {
  const parts = splitNarration(text);
  return {
    version: 1,
    stage: "directing",
    cast: {},
    writer,
    sections: parts.map((part, index) => ({
      index, text: part, words: countWords(part), status: "pending",
      direction: { ...NEUTRAL_DIRECTION, pauseAfterMs: index === parts.length - 1 ? 0 : NEUTRAL_DIRECTION.pauseAfterMs },
      directionSource: "neutral", cues: [], directorAttempts: 0, synthesisAttempts: 0,
    })),
  };
}

/** The lines the director cues, numbered in speaking order. */
export function directorLines(text: string): string[] {
  return neutralPlan(text).segments.filter((s): s is SpeechSegment => s.kind === "speech").map(s => s.text);
}

export function normalizeDirection(raw: unknown, base: SectionDirection = NEUTRAL_DIRECTION): SectionDirection {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    emotion: typeof d.emotion === "string" ? label(d.emotion, 80) : base.emotion,
    delivery: typeof d.delivery === "string" ? label(d.delivery, 160) : base.delivery,
    pace: clamp(d.pace, DIRECTION_LIMITS.pace, base.pace),
    energy: clamp(d.energy, DIRECTION_LIMITS.energy, base.energy),
    pitch: clamp(d.pitch, DIRECTION_LIMITS.pitch, base.pitch),
    warmth: clamp(d.warmth, DIRECTION_LIMITS.warmth, base.warmth),
    brightness: clamp(d.brightness, DIRECTION_LIMITS.brightness, base.brightness),
    breathiness: clamp(d.breathiness, DIRECTION_LIMITS.breathiness, base.breathiness),
    pauseAfterMs: Math.round(clamp(d.pauseAfterMs, DIRECTION_LIMITS.pauseAfterMs, base.pauseAfterMs)),
  };
}

/** Read JSON from a model answer, tolerating code fences, surrounding prose and trailing commas. */
function parseLooseJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = raw.slice(start, end + 1);
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* try the repaired form */ }
  }
  return null;
}

export interface ParsedDirection {
  direction: SectionDirection;
  cues: LineCue[];
  cast: Record<string, CastVoice>;
}

/** Validate a director answer. Null when it holds no usable direction. */
export function parseSectionDirection(raw: string, lineCount: number, base: SectionDirection = NEUTRAL_DIRECTION): ParsedDirection | null {
  const data = parseLooseJson(raw);
  if (!data || !label(data.emotion, 80) || typeof data.pace !== "number") return null;
  const seen = new Set<number>();
  const cues: LineCue[] = [];
  for (const entry of Array.isArray(data.lines) ? data.lines : []) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    const line = typeof c.line === "number" ? Math.floor(c.line) : 0;
    if (line < 1 || line > lineCount || seen.has(line)) continue;
    seen.add(line);
    const emphasis = Array.isArray(c.emphasis) ? c.emphasis.map(w => label(w, 32)).filter(Boolean).slice(0, 3) : [];
    cues.push({
      line,
      ...(c.kind === "dialogue" || c.kind === "narration" ? { kind: c.kind } : {}),
      ...(label(c.speaker, 40) ? { speaker: label(c.speaker, 40) } : {}),
      ...(label(c.emotion, 60) ? { emotion: label(c.emotion, 60) } : {}),
      ...(typeof c.pace === "number" ? { pace: clamp(c.pace, [0.85, 1.15], 1) } : {}),
      ...(typeof c.energy === "number" ? { energy: clamp(c.energy, [0.8, 1.2], 1) } : {}),
      ...(typeof c.pitch === "number" ? { pitch: clamp(c.pitch, [-1, 1], 0) } : {}),
      ...(typeof c.pauseAfterMs === "number" ? { pauseAfterMs: Math.round(clamp(c.pauseAfterMs, [0, 1200], 200)) } : {}),
      ...(emphasis.length ? { emphasis } : {}),
    });
  }
  const cast: Record<string, CastVoice> = {};
  if (data.cast && typeof data.cast === "object" && !Array.isArray(data.cast)) {
    for (const [name, value] of Object.entries(data.cast).slice(0, MAX_CAST)) {
      const key = label(name, 40), v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      if (key) cast[key] = { pace: clamp(v.pace, [0.9, 1.1], 1), pitch: clamp(v.pitch, [-1.5, 1.5], 0), warmth: clamp(v.warmth, [-0.2, 0.2], 0), brightness: clamp(v.brightness, [-0.2, 0.2], 0), breathiness: clamp(v.breathiness, [-0.2, 0.2], 0) };
    }
  }
  return { direction: normalizeDirection(data, base), cues, cast };
}

/** First definition wins, so a character never changes voice between sections. */
export function mergeCast(existing: Record<string, CastVoice>, next: Record<string, CastVoice>) {
  const merged = { ...existing };
  for (const [name, voice] of Object.entries(next)) {
    if (!merged[name] && Object.keys(merged).length < MAX_CAST) merged[name] = voice;
  }
  return merged;
}

const bound = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n)) * 1000) / 1000;

/** Turn a section's direction into the engine's plan. Spoken text always comes from the section. */
export function sectionPlan(section: VoiceSection, cast: Record<string, CastVoice> = {}): PerformancePlan {
  const base = neutralPlan(section.text);
  const d = section.direction;
  let line = 0;
  const segments = base.segments.map((seg): PerformanceSegment => {
    if (seg.kind !== "speech") return seg;
    line++;
    const cue = section.cues.find(c => c.line === line);
    const voice = cue?.speaker ? cast[cue.speaker] : undefined;
    const lineWords = new Set(wordList(seg.text));
    const emphasis = (cue?.emphasis ?? []).filter(w => wordList(w).every(x => lineWords.has(x)));
    const p = seg.prosody;
    return {
      ...seg,
      emotion: cue?.emotion || d.emotion,
      delivery: d.delivery,
      prosody: {
        pace: bound(p.pace * d.pace * (cue?.pace ?? 1) * (voice?.pace ?? 1), 0.75, 1.3),
        energy: bound(p.energy * d.energy * (cue?.energy ?? 1), 0.55, 1.2),
        pitch: bound(p.pitch + d.pitch + (cue?.pitch ?? 0) + (voice?.pitch ?? 0), -3, 3),
        pauseAfterMs: cue?.pauseAfterMs ?? p.pauseAfterMs,
        timbre: {
          warmth: bound(d.warmth + (p.timbre.warmth - 0.5) + (voice?.warmth ?? 0), 0, 1),
          brightness: bound(d.brightness + (p.timbre.brightness - 0.3) + (voice?.brightness ?? 0), 0, 1),
          breathiness: bound(d.breathiness + (p.timbre.breathiness - 0.2) + (voice?.breathiness ?? 0), 0, 1),
        },
        ...(emphasis.length ? { emphasis } : {}),
      },
    };
  });
  if (segments.length) segments[segments.length - 1] = { ...segments[segments.length - 1], prosody: { ...segments[segments.length - 1].prosody, pauseAfterMs: 0 } } as PerformanceSegment;
  return { ...base, source: section.directionSource === "neutral" ? "neutral" : "director", character: d.emotion ? `Senko, ${d.emotion}` : "Senko", segments };
}

/** What streams to the browser during generation (no narration text, so it can't appear as a reply). */
export function productionSnapshot(p: VoiceProduction): VoiceProduction {
  return { ...p, sections: p.sections.map(s => ({ ...s, text: "", cues: [] })) };
}
