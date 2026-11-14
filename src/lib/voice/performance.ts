// Senko's context-aware expressive speech system:
// Speech planning and generation operate on continuous conversational and acoustic dimensions.
//
// There are no discrete emotion tables, keyword rules, or canned personality templates.
// Given the conversation history, user vocal/contextual cues, and the transcript, the planner
// models how delivery evolves phrase by phrase across continuous dimensions:
//   - pace        (0.75–1.30): speaking rate / urgency
//   - energy      (0.55–1.20): vocal projection / intensity
//   - pitch       (−3.0…+3.0): continuous register & intonation tendency
//   - pauseAfterMs(0–1500):    conversational & narrative breathing room
//   - timbre      { warmth, brightness, breathiness } (0–1 each): continuous neural style conditioning
//   - emphasis    string[]:    specific words in the phrase carrying conversational stress
//
// For the local neural engine (Kokoro-82M), these continuous dimensions condition the neural
// style embedding vector (`style`) and speed input *inside* the neural forward pass rather than
// post-processing audio with artificial time-stretching or pitch-shifting DSP.

export interface Timbre {
  /** 0–1 lean toward a warmer, fuller, grounded resonance. */
  warmth: number;
  /** 0–1 lean toward a brighter, livelier, higher-inflection register. */
  brightness: number;
  /** 0–1 lean toward a softer, airy, intimate near-microphone quality. */
  breathiness: number;
}

export interface Prosody {
  /** Speaking-rate multiplier (0.75–1.3). */
  pace: number;
  /** Vocal projection / loudness multiplier (0.55–1.2). */
  energy: number;
  /** Continuous intonation / register shift (−3…+3), conditioned in latent style space on neural engines. */
  pitch: number;
  /** Silence after this segment in milliseconds (0–1500). */
  pauseAfterMs: number;
  timbre: Timbre;
  /** Words in this segment that carry primary conversational emphasis (up to 4). */
  emphasis?: string[];
}

export interface SpeechSegment {
  kind: "speech";
  /** Verbatim words from the transcript. */
  text: string;
  /** Free-form contextual emotional nuance, e.g. "quietly relieved, letting her guard down". */
  emotion: string;
  /** Free-form acting & delivery note, e.g. "soft, unhurried, landing gently on 'home'". */
  delivery: string;
  prosody: Prosody;
}

export interface VocalSegment {
  kind: "vocal";
  /** What the nonverbal sound is, in the director's words: "a quiet amused exhale". */
  description: string;
  /** How a text-only engine would write it ("Hmph!"); may be empty for silent beats. */
  text: string;
  /** IPA the local neural engine voices directly (e.g. "hˈʌmf"). */
  ipa?: string;
  /** A synthesized breath envelope when requested. */
  breath?: { kind: "exhale" | "inhale"; ms: number };
  emotion: string;
  prosody: Prosody;
}

export type PerformanceSegment = SpeechSegment | VocalSegment;

/** Optional vocal cues observed from user audio input (accounted for with ambiguity, never treated as a single-cue rule). */
export interface UserVocalCues {
  /** Observed speaking pace or hesitation notes, e.g. "slow with long pauses". */
  pacing?: string;
  /** Observed vocal energy/tone notes, e.g. "quiet, uncertain inflection". */
  tone?: string;
  /** Explicit reminder that vocal cues can be ambiguous (tired vs. sad, dry humor vs. annoyance). */
  confidence?: number;
}

export interface PerformancePlan {
  version: 2;
  voice: "senko";
  /** "director" when contextually planned by the LLM, "contextual" for continuous linguistic contour fallback, "neutral" for bare punctuation fallback. */
  source: "director" | "contextual" | "neutral";
  /** Free-form description of Senko's conversational stance & register for this turn. */
  character: string;
  /** Brief summary of how the delivery evolves across the response. */
  arc?: string;
  segments: PerformanceSegment[];
}

const clamp = (value: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000));
};
const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export const NEUTRAL_TIMBRE: Timbre = { warmth: 0.5, brightness: 0.3, breathiness: 0.2 };

function parseEmphasis(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .map(w => str(w, 32).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .slice(0, 4);
  return list.length ? list : undefined;
}

function prosody(raw: unknown, fallbackPause = 200): Prosody {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = (p.timbre && typeof p.timbre === "object" ? p.timbre : {}) as Record<string, unknown>;
  const emphasis = parseEmphasis(p.emphasis);
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
    ...(emphasis ? { emphasis } : {}),
  };
}

// ── Action beats ────────────────────────────────────────────────────────────

/**
 * `*pouts*` / `(sighs)` standing between sentences is an action beat to perform; `*really*`
 * inside a sentence is emphasis to speak. Decided by clause structure, not a hardcoded word list.
 */
export function isActionBeat(inner: string, before = "", after = ""): boolean {
  const t = inner.trim();
  if (!t || t.length > 60 || t.split(/\s+/).length > 8 || /[.!?]\s+\S/.test(t)) return false;
  const startsClause = /(?:^|[.!?…,;:—~\n])\s*$/.test(before);
  const endsClause = /^\s*(?:$|[.!?…,;:—~\n]|["'“‘]?[A-Z])/.test(after);
  return startsClause && endsClause;
}

const BEAT = /\*{1,2}([^*\n]{1,60})\*{1,2}|\(([^()\n]{1,60})\)/g;

/** Replace each action beat via `fn`; inline emphasis asterisks are unwrapped to their words. */
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

// ── Context-Aware Speech Director ───────────────────────────────────────────

export const DIRECTOR_SYSTEM = `You are the contextual speech planner for Senko, a conversational AI with a consistent, recognizable voice identity and a continuous expressive range.
You receive the conversation history, the user's latest message (and any vocal cues), and the exact transcript Senko will speak. Your job is to plan how her voice naturally delivers the meaning, subtext, and emotional arc of the response.

Return ONLY a JSON object, no prose:
{"character": string,
 "arc": string,
 "segments": [
   {"kind":"speech","text": string,"emotion": string,"delivery": string,
    "pace": number,"energy": number,"pitch": number,"pauseAfterMs": number,
    "emphasis": [string],
    "timbre":{"warmth": number,"brightness": number,"breathiness": number}},
   {"kind":"vocal","description": string,"text": string,"ipa": string,
    "breath":{"kind":"exhale"|"inhale","ms": number},
    "emotion": string,"pace": number,"energy": number,"pitch": number,"pauseAfterMs": number,
    "timbre":{"warmth": number,"brightness": number,"breathiness": number}}
 ]}

Core Principles:
1. Context drives delivery: Infer the speaker's situation from the whole conversation — celebrate genuine wins with warm enthusiasm and natural emphasis; meet disappointment or vulnerability with a softer, measured, grounded tone without melodrama; handle dry humor, irony, or sarcasm with subtle timing and understated inflection rather than forced laughter; bring engaging conversational rhythm and dynamic transitions to storytelling or podcast-style banter.
2. Evolution within and across sentences: Never assign one flat emotion to an entire response. Split sentences at natural phrase or clause boundaries whenever the thought shifts, hesitation enters, or tone transitions (e.g., starting briskly, pausing to reconsider, then landing softly on a realization).
3. Continuous acoustic conditioning (relative to Senko's recognizable voice):
   - pace (0.75–1.30, 1.0 = natural): faster on urgent, playful, or parenthetical asides; slower on weighty, tender, or reflective phrases.
   - energy (0.55–1.20, 1.0 = normal): vocal projection and presence.
   - pitch (−3.0…+3.0): continuous register & intonation tendency (positive = brighter/lifted inflection, negative = grounded/chest-register calm).
   - pauseAfterMs (0–1500): meaningful conversational breathing room — micro-pauses (90–160ms) inside a thought, reflective beats (300–650ms) at emotional turns or paragraph breaks, 0 on the final segment.
   - timbre (0.0–1.0 each): warmth (fuller, empathetic resonance), brightness (lively, animated clarity), breathiness (intimate, soft air).
   - emphasis: up to 3 specific words in the segment that carry the semantic stress of the phrase.
4. Restraint & naturalness: Avoid repetitive laughter, exaggerated cartoon reactions, forced enthusiasm, or robotic pauses. Vocal segments (brief sighs, quiet exhales, thoughtful hums) should be rare and earned — only when an action beat (*sighs*, *pouts*) or genuine vocal interjection is present in the transcript.
5. Verbatim integrity: Speech segments must contain the transcript's spoken words verbatim and in exact order. Never add, drop, or rewrite words. Standalone action beats in asterisks are replaced with a vocal segment (using Kokoro/espeak IPA such as "hˈʌmf" or "mː" and/or breath) or a silent pause beat.`;

export function directorPrompt(
  transcript: string,
  context: { request?: string; mood?: string; recent?: string[]; vocalCues?: UserVocalCues },
): string {
  const cues = context.vocalCues
    ? `Observed user vocal cues (treat as ambiguous context, not a single-cue rule; confidence ${context.vocalCues.confidence ?? 0.6}): ${[context.vocalCues.pacing, context.vocalCues.tone].filter(Boolean).join("; ")}`
    : "";
  const parts = [
    context.recent?.length ? `Recent conversation (oldest first):\n${context.recent.map(m => `- ${m.slice(0, 400)}`).join("\n")}` : "",
    context.request ? `The user's latest message: ${context.request.slice(0, 600)}` : "",
    cues,
    context.mood ? `Senko's internal mood note: ${context.mood.slice(0, 80)}` : "",
    `Transcript to perform:\n"""\n${transcript}\n"""`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

const words = (text: string) => text.toLowerCase().replace(/[’']/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [];

/** Smooth abrupt jumps across adjacent speech segments while preserving intentional contrasts. */
function smoothContinuity(segments: PerformanceSegment[]): void {
  let prev: SpeechSegment | undefined;
  for (const seg of segments) {
    if (seg.kind !== "speech") continue;
    if (prev) {
      const p = seg.prosody, q = prev.prosody;
      // Limit extreme single-step leaps (>0.35 pace or >3.5 pitch) so voice identity stays coherent.
      if (Math.abs(p.pace - q.pace) > 0.35) p.pace = clamp(q.pace + Math.sign(p.pace - q.pace) * 0.35, 0.75, 1.3, 1);
      if (Math.abs(p.pitch - q.pitch) > 3.5) p.pitch = clamp(q.pitch + Math.sign(p.pitch - q.pitch) * 3.5, -3, 3, 0);
    }
    prev = seg;
  }
}

/**
 * Parse and validate a director answer. Returns null when it isn't usable — malformed JSON or
 * spoken words that don't match the transcript — so the caller can fall back cleanly.
 */
export function parseDirectorPlan(raw: string, transcript: string): PerformancePlan | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  const obj = data as { character?: unknown; arc?: unknown; segments?: unknown };
  if (!Array.isArray(obj.segments) || !obj.segments.length || obj.segments.length > 400) return null;
  const segments: PerformanceSegment[] = [];
  for (const entry of obj.segments) {
    if (!entry || typeof entry !== "object") return null;
    const s = entry as Record<string, unknown>;
    if (s.kind === "speech") {
      const text = str(s.text, 15000);
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
  smoothContinuity(segments);
  segments[segments.length - 1].prosody.pauseAfterMs = 0;
  const arc = str(obj.arc, 240);
  return {
    version: 2,
    voice: "senko",
    source: "director",
    character: str(obj.character, 200) || "Senko",
    ...(arc ? { arc } : {}),
    segments,
  };
}

/**
 * Continuous linguistic-prosody fallback when no LLM director call is available (e.g. offline tests
 * or direct synthesis): derives smooth, evolving phrase-level prosody from sentence structure,
 * clause length, punctuation contour, and discourse position so speech is never flat or monotonous,
 * without any keyword emotion tables.
 */
export function neutralPlan(transcript: string): PerformancePlan {
  const segments: PerformanceSegment[] = [];
  const marked = mapBeats(transcript, () => "\u0001");
  const rawPieces = marked.split(/(\u0001|\n+)/);
  const clauses: { text?: string; beat?: boolean; paraAfter?: boolean }[] = [];

  for (const piece of rawPieces) {
    if (piece === "\u0001") {
      clauses.push({ beat: true });
      continue;
    }
    if (/^\n+$/.test(piece)) {
      if (clauses.length) clauses[clauses.length - 1].paraAfter = true;
      continue;
    }
    // Split on sentence endings, ellipses, em-dashes, and long parenthetical clauses
    for (const part of piece.match(/[^.!?…—;]+(?:\.{3}|…|[.!?]+|—|;)?["'”’)]*/g) ?? []) {
      const text = part.trim();
      if (!words(text).length) continue;
      clauses.push({ text });
    }
  }

  const totalSpoken = Math.max(1, clauses.filter(c => c.text).length);
  let spokenIdx = 0;
  let prevPace = 1.0, prevPitch = 0.0;

  for (const item of clauses) {
    if (item.beat) {
      segments.push({ kind: "vocal", description: "conversational beat", text: "", emotion: "", prosody: prosody({}, item.paraAfter ? 460 : 240) });
      continue;
    }
    const text = item.text!;
    const pos = totalSpoken > 1 ? spokenIdx / (totalSpoken - 1) : 0.5;
    spokenIdx++;

    const wList = words(text);
    const wc = wList.length;
    const isQuestion = /\?["'”’)]*$/.test(text);
    const isExclaim = /!["'”’)]*$/.test(text);
    const isTrailing = /(?:…|\.\.\.)["'”’)]*$/.test(text);
    const isDash = /—["'”’)]*$/.test(text);

    // Continuous discourse contour: natural arch across the utterance + local syntactic dynamics
    const arch = Math.sin(pos * Math.PI); // 0 at edges, 1 in the middle of the turn
    const lengthFactor = Math.max(-0.08, Math.min(0.08, (10 - wc) * 0.007));
    const targetPace = 0.98 + 0.04 * arch + lengthFactor + (isTrailing ? -0.07 : isExclaim ? 0.04 : isDash ? 0.03 : 0) + (pos > 0.85 ? -0.04 : 0);
    const targetPitch = (isQuestion ? 0.65 : isExclaim ? 0.55 : isTrailing ? -0.35 : 0.15 * arch - 0.2 * pos);
    const targetEnergy = 0.96 + 0.06 * arch + (isExclaim ? 0.07 : isTrailing ? -0.10 : 0) + (pos > 0.88 ? -0.04 : 0);

    // Smooth inertia with previous phrase
    const pace = clamp(0.75 * targetPace + 0.25 * prevPace, 0.82, 1.18, 1);
    const pitch = clamp(0.75 * targetPitch + 0.25 * prevPitch, -2, 2, 0);
    const energy = clamp(targetEnergy, 0.78, 1.12, 1);
    prevPace = pace;
    prevPitch = pitch;

    const pause = item.paraAfter ? 480 : isTrailing ? 380 : isQuestion ? 270 : isExclaim ? 220 : isDash ? 170 : /;$/.test(text) ? 190 : 230;
    const timbre: Timbre = {
      warmth: clamp(0.50 + (isTrailing ? 0.08 : 0) + (pos > 0.8 ? 0.06 : 0), 0.3, 0.75, 0.5),
      brightness: clamp(0.30 + (isExclaim || isQuestion ? 0.14 : 0) + 0.05 * arch, 0.15, 0.65, 0.3),
      breathiness: clamp(0.20 + (isTrailing ? 0.15 : 0), 0.1, 0.55, 0.2),
    };

    segments.push({
      kind: "speech",
      text,
      emotion: "",
      delivery: "",
      prosody: { pace, energy, pitch, pauseAfterMs: pause, timbre },
    });
  }
  if (segments.length) segments[segments.length - 1].prosody.pauseAfterMs = 0;
  return { version: 2, voice: "senko", source: "neutral", character: "Senko", segments };
}

// ── Renderings for hosted expressive engines ────────────────────────────────

/** One natural-language instruction for an instruction-following TTS model (Qwen3-TTS style). */
export function performanceInstruction(plan: PerformancePlan): string {
  const notes = plan.segments.flatMap(s => s.kind === "speech" ? [s.delivery || s.emotion] : [s.description]).filter(Boolean);
  const arc = plan.arc ? ` Overall arc: ${plan.arc}.` : "";
  return `Speak as ${plan.character}.${arc}${notes.length ? ` Delivery progression: ${[...new Set(notes)].slice(0, 8).join(" -> ")}.` : ""} Perform nonverbal sounds naturally; never read stage directions aloud.`;
}

/** Per-segment text + instruction, for engines that render one segment at a time. */
export function segmentInstructions(plan: PerformancePlan): { text: string; instruct: string; pauseAfterMs: number; emphasis?: string[] }[] {
  return plan.segments.filter(s => s.text).map(s => ({
    text: s.text,
    instruct: s.kind === "vocal" ? `${s.description || "a short nonverbal sound"}; no words.` : `As ${plan.character}: ${[s.emotion, s.delivery].filter(Boolean).join(" — ") || "natural conversational delivery"}.`,
    pauseAfterMs: s.prosody.pauseAfterMs,
    ...(s.prosody.emphasis?.length ? { emphasis: s.prosody.emphasis } : {}),
  }));
}
