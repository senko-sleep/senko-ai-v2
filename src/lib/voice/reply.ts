/** Validate generated spoken drafts before publishing or spending inference on TTS. */
export function spokenDraftIssue(text: string, maxWords: number, maxChars: number, minWords = 0): string | null {
  if (!text.trim()) return "The spoken draft is empty.";
  if (/\b(?:can(?:not|'t|’t)|unable\s+to|don['’]t\s+have\s+(?:a|the)\s+(?:voice|ability))[^.!?\n]{0,100}\b(?:audio|voice|record|speak)\b|\b(?:audio|voice)[^.!?\n]{0,60}\b(?:isn't|isn’t|not)\s+(?:available|supported|possible)\b|\bvoice\s+doesn['’]t\s+come\s+out|\b(?:can\s+only|only\s+able\s+to)\s+(?:provide|send|write)\s+text/i.test(text)) {
    return "The draft incorrectly denies the app's audio capability.";
  }
  if (text.length > maxChars || text.trim().split(/\s+/).length > maxWords) return "The spoken draft exceeds its speaking budget.";
  if (text.trim().split(/\s+/).length < minWords) return `The story is too short. Write at least ${minWords} words with a developed scene and ending.`;
  if (/```|^\s*#{1,6}\s|\*\*|https?:\/\//m.test(text)) return "The draft contains visual formatting instead of spoken prose.";
  return null;
}

/** One bounded rewrite; never clip a story or synthesize a known-invalid draft. */
export async function prepareSpokenReply(text: string, maxWords: number, maxChars: number, rewrite: (issue: string) => Promise<string>, minWords = 0): Promise<string> {
  const issue = spokenDraftIssue(text, maxWords, maxChars, minWords);
  if (!issue) return text;
  const revised = await rewrite(issue);
  const remaining = spokenDraftIssue(revised, maxWords, maxChars, minWords);
  if (remaining) throw new Error(`Could not prepare the audio reply: ${remaining}`);
  return revised;
}
