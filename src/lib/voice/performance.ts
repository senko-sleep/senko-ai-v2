// Senko's voice performance: an LLM *directs* the delivery, the engine *renders* it.
//
// There are no preset characters or emotion tables here. After the spoken transcript is written,
// a director model reads the conversation and the transcript and decides, freely, who is
// speaking and how: per segment it writes an acting note plus continuous controls (pace, energy,
// pitch, timbre, pauses), and authors nonverbal sounds itself (IPA vocalizations, breaths)
// instead of the words "*pouts*" being read aloud. This module defines that contract, validates
// a director's output against the transcript (it may not change the words), and provides a
// neutral punctuation-only fallback when no director answer is available.

export interface Timbre {
  /** 0–1 lean toward a warmer, fuller tone. */
  warmth: number;
  /** 0–1 lean toward a brighter, more energetic tone. */
  brightness: number;
  /** 0–1 lean toward an airy, breathy, intimate tone. */
  breathiness: number;
}

export interface Prosody {
  /** Speaking-rate multiplier (0.75–1.3). */
  pace: number;
  /** Loudness multiplier (0.55–1.2). */
  energy: number;
  /** Pitch offset in semitones (−3…+3). */
  pitch: number;
  /** Silence after this segment in milliseconds (0–1500). */
  pauseAfterMs: number;
  timbre: Timbre;
}

export interface SpeechSegment {
  kind: "speech";
  /** Verbatim words from the transcript. */
  text: string;
  /** Free-form emotional state, e.g. "defensive, cheeks burning". */
  emotion: string;
  /** Free-form acting note, e.g. "sharp, clipped, then trailing off". */
  delivery: string;
  prosody: Prosody;
}

export interface VocalSegment {
  kind: "vocal";
  /** What the sound is, in the director's words: "a sulky little huff through the nose". */
  description: string;
  /** How a text-only engine would write it ("Hmph!"); may be empty for silent beats. */
  text: string;
  /** IPA the local engine voices directly (e.g. "hˈʌmf"); avoids spelled-out interjections. */
  ipa?: string;
  /** A synthesized breath instead of (or after) the vocalization. */
  breath?: { kind: "exhale" | "inhale"; ms: number };
  emotion: string;
  prosody: Prosody;
}

export type PerformanceSegment = SpeechSegment | VocalSegment;

export interface PerformancePlan {
  version: 2;
  voice: "senko";
  /** "director" when an LLM authored it, "neutral" for the punctuation-only fallback. */
  source: "director" | "neutral";
  /** Free-form description of who is performing, e.g. "Senko playing a bratty tsundere". */
  character: string;
  segments: PerformanceSegment[];
}

const clamp = (value: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000));
};
const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export const NEUTRAL_TIMBRE: Timbre = { warmth: 0.5, brightness: 0.3, breathiness: 0.2 };

function prosody(raw: unknown, fallbackPause = 200): Prosody {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = (p.timbre && typeof p.timbre === "object" ? p.timbre : {}) as Record<string, unknown>;
  return {
    pace: clamp(p.pace, 0.75, 1.3, 1),
    energy: clamp(p.energy, 0.55, 1.2, 1),
    pitch: clamp(p.pitch, -3, 3, 0),
    pauseAfterMs: Math.round(clamp(p.pauseAfterMs, 0, 1500, fallbackPause)),
    timbre: {
      warmth: clamp(t.warmth, 0, 1, NEUTRAL_TIMBRE.warmth),
      brightness: clamp(t.brightness, 0, 1, NEUTRAL_TIMBRE.brightness),
      breathiness: clamp(t.breathiness, 0, 1, NEUTRAL_TIMBRE.breathiness),
    },
  };
}

// ── Action beats ────────────────────────────────────────────────────────────

/**
 * `*pouts*` / `(sighs)` standing between sentences is an action beat to perform; `*really*`
 * inside a sentence is emphasis to speak. Decided by position, not by a word list.
 */
export function isActionBeat(inner: string, before = "", after = ""): boolean {
  const t = inner.trim();
  if (!t || t.length > 60 || t.split(/\s+/).length > 8 || /[.!?]\s+\S/.test(t)) return false;
  const startsClause = /(?:^|[.!?…,;:—~\n])\s*$/.test(before);
  const endsClause = /^\s*(?:$|[.!?…,;:—~\n]|["'“‘]?[A-Z])/.test(after);
  return startsClause && endsClause;
}

const BEAT = /\*{1,2}([^*\n]{1,60})\*{1,2}|\(([^()\n]{1,60})\)/g;

/** Replace each action beat via `fn`; emphasis asterisks are unwrapped to their words. */
export function mapBeats(text: string, fn: (beat: string) => string): string {
  return text.replace(BEAT, (whole, star: string | undefined, paren: string | undefined, offset: number, all: string) => {
    const inner = star ?? paren ?? "";
    if (isActionBeat(inner, all.slice(0, offset), all.slice(offset + whole.length))) return fn(inner.trim());
    return star !== undefined ? star : whole;
  });
}

/** Words only, for engines with no performance support: action beats are dropped, not read. */
export function plainSpeech(transcript: string): string {
  return mapBeats(transcript, () => " ").replace(/[ \t]+/g, " ").replace(/ +([.,!?])/g, "$1").trim();
}

// ── Director ────────────────────────────────────────────────────────────────

export const DIRECTOR_SYSTEM = `You are the voice director for Senko, an AI companion whose replies are spoken by a neural TTS engine. You receive the conversation and the exact transcript she will say. Decide how she performs it, the way a voice actor and director would: who she is being (her own self, or any character or style the user asked for, in any wording), her emotional arc, and the delivery of every phrase.

Return ONLY a JSON object, no prose:
{"character": string,
 "segments": [
   {"kind":"speech","text": string,"emotion": string,"delivery": string,
    "pace": number,"energy": number,"pitch": number,"pauseAfterMs": number,
    "timbre":{"warmth": number,"brightness": number,"breathiness": number}},
   {"kind":"vocal","description": string,"text": string,"ipa": string,
    "breath":{"kind":"exhale"|"inhale","ms": number},
    "emotion": string,"pace": number,"energy": number,"pitch": number,"pauseAfterMs": number,
    "timbre":{...}}
 ]}

Rules:
- Speech segments must contain the transcript's words verbatim and in order, split into phrases wherever the delivery changes (a sentence may become several segments). Never add, drop, reword or reorder spoken words.
- Action beats in the transcript (*pouts*, (sighs), *crosses arms*) are never spoken as words. Replace each with a vocal segment that performs it as a sound, or a silent beat (empty text, no ipa, no breath, just a pause). Spelled interjections that are really sounds (hmph, tch, pfft, hng, mm, hehe) should also be vocal segments.
- For a vocal segment, write "ipa" in Kokoro/espeak-style IPA with stress marks so the engine can voice it (examples of format only: hˈʌmf, hˈɛhɛhɛ, ˈʌɡ, mːː, hˈɑː). Use "breath" for sighs, gasps, exhales, sniffles; a vocal may have ipa, breath, or both.
- Controls are continuous and relative to Senko's natural voice: pace 0.75–1.3 (1 = natural), energy 0.55–1.2 (loudness), pitch −3…+3 semitones, pauseAfterMs 0–1500, timbre values 0–1 (warmth = fuller, brightness = livelier and sharper, breathiness = airy and intimate). Her identity must stay recognisable: use the range expressively but purposefully, and keep emotional continuity between neighbouring segments.
- emotion and delivery are your own free-form acting notes; be specific.
- The last segment's pauseAfterMs should be 0.`;

export function directorPrompt(transcript: string, context: { request?: string; mood?: string; recent?: string[] }): string {
  const parts = [
    context.recent?.length ? `Recent conversation (oldest first):\n${context.recent.map(m => `- ${m.slice(0, 400)}`).join("\n")}` : "",
    context.request ? `The user's latest message: ${context.request.slice(0, 600)}` : "",
    context.mood ? `Senko's current mood tag: ${context.mood.slice(0, 80)}` : "",
    `Transcript to perform:\n"""\n${transcript}\n"""`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

const words = (text: string) => text.toLowerCase().replace(/[’']/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [];

/**
 * Parse and validate a director answer. Returns null when it isn't usable — malformed JSON or
 * spoken words that don't match the transcript — so the caller can fall back.
 */
export function parseDirectorPlan(raw: string, transcript: string): PerformancePlan | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  const obj = data as { character?: unknown; segments?: unknown };
  if (!Array.isArray(obj.segments) || !obj.segments.length || obj.segments.length > 160) return null;
  const segments: PerformanceSegment[] = [];
  for (const entry of obj.segments) {
    if (!entry || typeof entry !== "object") return null;
    const s = entry as Record<string, unknown>;
    if (s.kind === "speech") {
      const text = str(s.text, 1500);
      if (!words(text).length) continue;
      segments.push({ kind: "speech", text, emotion: str(s.emotion, 120), delivery: str(s.delivery, 200), prosody: prosody(s) });
    } else if (s.kind === "vocal") {
      const ipa = str(s.ipa, 40).replace(/[^\p{L}\p{M}ˈˌːˑ.\s!?,…-]/gu, "").trim();
      const b = s.breath as { kind?: unknown; ms?: unknown } | undefined;
      const breath = b && (b.kind === "exhale" || b.kind === "inhale") ? { kind: b.kind, ms: Math.round(clamp(b.ms, 80, 1400, 500)) } as const : undefined;
      segments.push({ kind: "vocal", description: str(s.description, 160), text: str(s.text, 40), ipa: ipa || undefined, breath, emotion: str(s.emotion, 120), prosody: prosody(s, 200) });
    }
  }
  // The director performs the words; it may not change them.
  const expected = words(plainSpeech(transcript)).join(" ");
  const spoken = words(segments.filter((s): s is SpeechSegment => s.kind === "speech").map(s => s.text).join(" ")).join(" ");
  if (!segments.length || spoken !== expected) return null;
  segments[segments.length - 1].prosody.pauseAfterMs = 0;
  return { version: 2, voice: "senko", source: "director", character: str(obj.character, 200) || "Senko", segments };
}

/**
 * No director available: natural punctuation timing only. No character, no emotion guessing;
 * action beats become short silences so they're never read aloud.
 */
export function neutralPlan(transcript: string): PerformancePlan {
  const segments: PerformanceSegment[] = [];
  const pauseFor = (clause: string) => /(?:…|\.\.\.)$/.test(clause) ? 380 : /[?]$/.test(clause) ? 260 : /[.!]$/.test(clause) ? 230 : /—$/.test(clause) ? 180 : 120;
  const marked = mapBeats(transcript, () => "\u0001");
  for (const piece of marked.split(/(\u0001|\n+)/)) {
    if (piece === "\u0001") {
      segments.push({ kind: "vocal", description: "silent beat", text: "", emotion: "", prosody: prosody({}, 260) });
      continue;
    }
    if (/^\n+$/.test(piece)) {
      const last = segments.at(-1);
      if (last) last.prosody.pauseAfterMs = Math.max(last.prosody.pauseAfterMs, 450);
      continue;
    }
    for (const clause of piece.match(/[^.!?…—]+(?:\.{3}|…|[.!?]+|—)?["'”’)]*/g) ?? []) {
      const text = clause.trim();
      if (!words(text).length) continue;
      segments.push({ kind: "speech", text, emotion: "", delivery: "", prosody: prosody({}, pauseFor(text)) });
    }
  }
  if (segments.length) segments[segments.length - 1].prosody.pauseAfterMs = 0;
  return { version: 2, voice: "senko", source: "neutral", character: "Senko", segments };
}

// ── Renderings for hosted expressive engines ────────────────────────────────

/** One natural-language instruction for an instruction-following TTS model (Qwen3-TTS style). */
export function performanceInstruction(plan: PerformancePlan): string {
  const notes = plan.segments.flatMap(s => s.kind === "speech" ? [s.delivery || s.emotion] : [s.description]).filter(Boolean);
  return `Speak as ${plan.character}.${notes.length ? ` Delivery, in order: ${[...new Set(notes)].slice(0, 8).join("; ")}.` : ""} Perform nonverbal sounds as sounds; never read stage directions aloud.`;
}

/** Per-segment text + instruction, for engines that render one segment at a time. */
export function segmentInstructions(plan: PerformancePlan): { text: string; instruct: string; pauseAfterMs: number }[] {
  return plan.segments.filter(s => s.text).map(s => ({
    text: s.text,
    instruct: s.kind === "vocal" ? `${s.description || "a short nonverbal sound"}; no words.` : `As ${plan.character}: ${[s.emotion, s.delivery].filter(Boolean).join(" — ") || "natural"}.`,
    pauseAfterMs: s.prosody.pauseAfterMs,
  }));
}
