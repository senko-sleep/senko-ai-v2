// The voice director: an LLM decides how Senko performs a transcript (see lib/voice/performance).
import { complete } from "@/lib/llm";
import { DIRECTOR_SYSTEM, directorPrompt, neutralPlan, parseDirectorPlan, type PerformancePlan } from "@/lib/voice/performance";

export interface DirectOptions {
  /** The user's latest message (where requests like "be a bratty tsundere" live, in any wording). */
  request?: string;
  /** A few recent turns, formatted "user: …" / "senko: …". */
  recent?: string[];
  /** Senko's status-tag mood. */
  mood?: string;
  personality?: string;
  provider?: string;
  signal?: AbortSignal;
}

/**
 * Ask the director for a performance. Any failure (timeout, malformed JSON, changed words)
 * falls back to neutral punctuation timing; audio is never blocked on the director.
 */
export async function directPerformance(transcript: string, o: DirectOptions = {}): Promise<PerformancePlan> {
  if (process.env.SENKO_VOICE_DIRECTOR === "0") return neutralPlan(transcript);
  const timeout = AbortSignal.timeout(Number(process.env.SENKO_VOICE_DIRECTOR_TIMEOUT_MS) || 20_000);
  const system = o.personality ? `${DIRECTOR_SYSTEM}\n\nSenko's personality, for reference:\n${o.personality.slice(0, 1500)}` : DIRECTOR_SYSTEM;
  const user = directorPrompt(transcript, { request: o.request, recent: o.recent, mood: o.mood });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = await complete(
        [{ role: "system", content: system }, { role: "user", content: attempt ? `${user}\n\nYour previous answer was unusable. Return valid JSON whose speech segments contain exactly the transcript's words in order.` : user }],
        { provider: o.provider, signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout, json: true, temperature: 0.7, maxTokens: 4000, thinking: "off", hedge: false },
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
