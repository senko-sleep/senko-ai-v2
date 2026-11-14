/** Validate generated spoken drafts before publishing or spending inference on TTS. */
export function spokenDraftIssue(text: string, maxWords: number, maxChars: number, minWords = 0): string | null {
  const clean = text.replace(/\[(?:MEMORY|STATUS):[^\]\n]*\]/gi, " ").trim();
  if (!clean) return "The spoken draft is empty.";
  if (/\b(?:can(?:not|'t|’t)|unable\s+to|don['’]t\s+have\s+(?:a|the)\s+(?:voice|ability))[^.!?\n]{0,100}\b(?:audio|voice|record|speak)\b|\b(?:audio|voice)[^.!?\n]{0,60}\b(?:isn't|isn’t|not)\s+(?:available|supported|possible)\b|\bvoice\s+doesn['’]t\s+come\s+out|\b(?:can\s+only|only\s+able\s+to)\s+(?:provide|send|write)\s+text/i.test(clean)) {
    return "The draft incorrectly denies the app's audio capability.";
  }
  const wordCount = clean.split(/\s+/).length;
  if (clean.length > maxChars || wordCount > maxWords) return "The spoken draft exceeds its speaking budget.";
  if (wordCount < minWords) return `The story is too short and rushed (${wordCount} words). Write at least ${minWords} words with developed scenes, believable character motivation, natural dialogue, and an earned ending.`;
  if (/```|^\s*#{1,6}\s|\*\*|https?:\/\//m.test(clean)) return "The draft contains visual formatting instead of spoken prose.";
  return null;
}

const POLISH_STORY_PROMPT = `You are polishing a spoken story draft before it is performed by a neural voice engine.
Read the user's request and the initial draft below, then rewrite and elevate it into an earnest, cohesive, deeply engaging spoken story that genuinely makes sense:
- Fix any rushed leaps, contrived shortcuts, or nonsensical plot devices: every character action and emotional realization must feel earned, grounded, and believable.
- Let scenes breathe with atmospheric sensory detail, natural pacing, inner thoughts, and authentic spoken dialogue that sounds natural out loud.
- Preserve the requested setting, tone, and length requirements.
- Output ONLY the final spoken story (plus a single [STATUS:mood:feeling] tag at the very end). No markdown, headings, bold text, bullet points, or meta-commentary.`;

/** Validate and, when `polish` is provided for a story, run an earnest narrative polish pass before TTS. */
export async function prepareSpokenReply(
  text: string,
  maxWords: number,
  maxChars: number,
  rewrite: (issue: string) => Promise<string>,
  minWords = 0,
  polish?: (draft: string, instructions: string) => Promise<string>,
): Promise<string> {
  let current = text;
  if (polish && !spokenDraftIssue(current, maxWords, maxChars, 0)) {
    const polished = await polish(current, POLISH_STORY_PROMPT).catch(() => "");
    if (polished.trim() && !spokenDraftIssue(polished, maxWords, maxChars, minWords)) {
      return polished;
    }
    if (polished.trim()) current = polished;
  }
  const issue = spokenDraftIssue(current, maxWords, maxChars, minWords);
  if (!issue) return current;
  const revised = await rewrite(issue);
  const remaining = spokenDraftIssue(revised, maxWords, maxChars, minWords);
  if (remaining) throw new Error(`Could not prepare the audio reply: ${remaining}`);
  return revised;
}
