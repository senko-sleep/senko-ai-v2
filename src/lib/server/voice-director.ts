// The voice director: an LLM decides how Senko performs a transcript (see lib/voice/performance).
import { complete, type LlmMessage } from "@/lib/llm";
import { directorLines, parseSectionDirection, type CastVoice, type ParsedDirection, type SectionDirection } from "@/lib/voice/production";
import { DIRECTOR_SYSTEM, directorPrompt, neutralPlan, parseDirectorPlan, type PerformancePlan, type UserVocalCues } from "@/lib/voice/performance";

export interface DirectOptions {
  /** The user's latest message (where conversational context and tone live). */
  request?: string;
  /** A few recent turns, formatted "user: …" / "senko: …". */
  recent?: string[];
  /** Optional vocal cues observed from user voice input (accounted for with ambiguity). */
  vocalCues?: UserVocalCues;
  /** Senko's internal mood note. */
  mood?: string;
  personality?: string;
  provider?: string;
  signal?: AbortSignal;
}

const SECTION_DIRECTOR_SYSTEM = `You direct one section of a spoken story for a single neural voice. You decide how it is performed. You never write or repeat the narration: refer to lines only by number.

Return ONLY this JSON object:
{"emotion": "short emotional state for the section",
 "delivery": "one short acting note",
 "pace": 0.8-1.2, "energy": 0.6-1.2, "pitch": -2 to 2,
 "warmth": 0-1, "brightness": 0-1, "breathiness": 0-1,
 "pauseAfterMs": 0-1500,
 "cast": {"Character name": {"pace": 0.9-1.1, "pitch": -1.5 to 1.5, "warmth": -0.2 to 0.2, "brightness": -0.2 to 0.2, "breathiness": -0.2 to 0.2}},
 "lines": [{"line": 1, "kind": "narration" or "dialogue", "speaker": "Character name", "emotion": "short", "pace": 0.85-1.15, "energy": 0.8-1.2, "pitch": -1 to 1, "pauseAfterMs": 0-1200, "emphasis": ["word"]}]}

Rules:
- Cue only lines that need something special: dialogue, turns, reveals. Leave ordinary narration out.
- Emphasis words must appear in that line.
- Reuse the established cast exactly; add a character to "cast" only the first time they speak.
- Let the emotion progress naturally from the previous section. Stay restrained: small numbers sound human.
- pauseAfterMs at the top level is the transition into the next section. Use 0 for the final section.`;

export interface SectionDirectOptions {
  previous?: SectionDirection;
  cast: Record<string, CastVoice>;
  position: { index: number; count: number };
  request?: string;
  mood?: string;
  provider?: string;
  signal?: AbortSignal;
  /** Replaces the LLM call in tests. */
  ask?: (messages: LlmMessage[], signal: AbortSignal) => Promise<{ text: string; model?: string }>;
}

export interface SectionDirectResult {
  parsed: ParsedDirection | null;
  model?: string;
  attempts: number;
  ms: number;
  note?: string;
}

/**
 * Direct one section: one attempt plus one repair for a malformed answer, each time-boxed.
 * A null result means the section is performed with the neutral profile. It's never lost.
 */
export async function directSection(text: string, base: SectionDirection, o: SectionDirectOptions): Promise<SectionDirectResult> {
  const started = Date.now();
  if (process.env.SENKO_VOICE_DIRECTOR === "0") return { parsed: null, attempts: 0, ms: 0, note: "Director turned off" };
  const lines = directorLines(text);
  const castNames = Object.entries(o.cast);
  const user = [
    o.request ? `The listener asked for: ${o.request.slice(0, 400)}` : "",
    o.mood ? `Senko's mood: ${o.mood.slice(0, 80)}` : "",
    `This is section ${o.position.index + 1} of ${o.position.count}.`,
    o.previous?.emotion ? `Previous section's delivery: ${o.previous.emotion}; ${o.previous.delivery} (pace ${o.previous.pace}, energy ${o.previous.energy}).` : "",
    castNames.length ? `Established cast: ${JSON.stringify(o.cast)}` : "",
    `Lines:\n${lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
  const timeoutMs = Number(process.env.SENKO_VOICE_DIRECTOR_TIMEOUT_MS) || 25_000;
  const ask = o.ask ?? (async (messages: LlmMessage[], signal: AbortSignal) => {
    const answer = await complete(messages, { provider: o.provider, signal, json: true, temperature: 0.5, maxTokens: 1800, thinking: "off", hedge: false, fast: true, eager: true, maxWaitMs: 4000 });
    return { text: answer.text, model: `${answer.providerLabel} · ${answer.model}` };
  });
  let previousAnswer = "", note = "", model: string | undefined, attempts = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    attempts = attempt + 1;
    const limit = AbortSignal.timeout(timeoutMs);
    try {
      const messages: LlmMessage[] = [{ role: "system", content: SECTION_DIRECTOR_SYSTEM }, { role: "user", content: user }];
      if (attempt) messages.push({ role: "assistant", content: previousAnswer.slice(0, 1500) }, { role: "user", content: "That wasn't valid. Return only the JSON object in the required format, with numeric pace." });
      const answer = await ask(messages, o.signal ? AbortSignal.any([o.signal, limit]) : limit);
      model = answer.model;
      const parsed = parseSectionDirection(answer.text, lines.length, base);
      if (parsed) return { parsed, model, attempts, ms: Date.now() - started };
      previousAnswer = answer.text;
      note = "Director answers were malformed";
      console.warn(`[voice] Section ${o.position.index + 1} director answer was malformed (attempt ${attempts})`);
    } catch (error) {
      if (o.signal?.aborted) throw error;
      // A timeout or outage won't be fixed by asking again right away.
      note = limit.aborted ? "Director timed out" : "No director model was available";
      console.warn(`[voice] Section ${o.position.index + 1} director unavailable:`, error instanceof Error ? error.message.split("\n")[0] : "unknown");
      break;
    }
  }
  return { parsed: null, model, attempts, ms: Date.now() - started, note };
}

/**
 * Ask the contextual speech planner for a performance. Any failure (timeout, malformed JSON, changed words)
 * falls back to continuous linguistic prosody (`neutralPlan`); audio is never blocked on the director.
 */
export async function directPerformance(transcript: string, o: DirectOptions = {}): Promise<PerformancePlan> {
  if (process.env.SENKO_VOICE_DIRECTOR === "0") return neutralPlan(transcript);
  const timeout = AbortSignal.timeout(Number(process.env.SENKO_VOICE_DIRECTOR_TIMEOUT_MS) || 45_000);
  const system = o.personality ? `${DIRECTOR_SYSTEM}\n\nSenko's personality, for reference:\n${o.personality.slice(0, 1500)}` : DIRECTOR_SYSTEM;
  const user = directorPrompt(transcript, { request: o.request, recent: o.recent, mood: o.mood, vocalCues: o.vocalCues });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = await complete(
        [{ role: "system", content: system }, { role: "user", content: attempt ? `${user}\n\nYour previous answer was unusable. Return valid JSON whose speech segments contain exactly the transcript's words in order.` : user }],
        { provider: o.provider, signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout, json: true, temperature: 0.7, maxTokens: 12000, thinking: "off", hedge: false },
      );
      const plan = parseDirectorPlan(answer.text, transcript);
      if (plan) return plan;
      console.warn("[voice] Director answer rejected (malformed or changed the words)");
    } catch (error) {
      if (o.signal?.aborted) throw error;
      console.warn("[voice] Director unavailable", error instanceof Error ? error.message : "unknown");
      break;
    }
  }
  return neutralPlan(transcript);
}
