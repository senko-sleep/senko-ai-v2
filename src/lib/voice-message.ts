/** Explicit requests for a spoken reply in this chat. */
export function wantsVoiceMessage(text: string): boolean {
  if (/\b(?:don['’]?t|do not|never|no)\s+(?:(?:send|use|give|make|reply|respond)(?:\s+me)?\s+)?(?:an?\s+|any\s+)?(?:audio|voice|spoken)\b/i.test(text)) return false;
  return /\b(?:send|give|make|record)\b[^.!?\n]{0,60}\b(?:audio|voice)\s+(?:message|reply|response|note)\b|\b(?:reply|respond|answer)\s+(?:to me\s+)?(?:with|in|using|as)\s+(?:an?\s+|your\s+)?(?:audio|voice|spoken)\b|\b(?:say|read)\s+(?:this|that|it)\s+(?:out loud|aloud|in your voice)\b/i.test(text);
}

export function spokenText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[(?:[^\]]|\](?!\]))*\]\]/g, " ")
    .replace(/\[(?:STATUS|MEMORY):[^\]]*\]/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_~#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const VOICE_REPLY_GUIDANCE = "The user requested a voice message. Write the words to speak naturally in your own personality. Keep it conversational and concise. The app will create the audio card from your finished reply. Avoid tables, code and visual layouts for this response. Do not claim audio was generated before the app reports success.";
