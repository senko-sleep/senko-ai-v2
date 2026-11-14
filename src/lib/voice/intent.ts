// Reading a chat message as "answer me with a voice message".
//   "send me a voice message saying good morning"  -> { mode: "reply" }   Senko writes it, then says it
//   "can I hear your voice"                         -> { mode: "reply" }
//   "send that as a voice message" / "say that out loud" -> { mode: "repeat" }  says her last reply
// Questions about voice messages ("how do I record a voice note") and code are left alone.

export interface VoiceRequest {
  /** reply: write a new answer and speak it. repeat: speak the previous reply as it was. */
  mode: "reply" | "repeat";
}

export function requestedVoiceSeconds(text: string): number | undefined {
  const match = /\b(\d+(?:\.\d+)?)\s*[- ]?\s*(seconds?|secs?|minutes?|mins?)\b/i.exec(text);
  return match ? Number(match[1]) * (/^m/i.test(match[2]) ? 60 : 1) : undefined;
}

/** Stories need room for a beginning, a scene and a resolution; explicit durations win. */
export function suggestedVoiceSeconds(text: string): number | undefined {
  return detectVoiceRequest(text) && /\b(?:stories|story|storytime|narrat(?:e|ion))\b/i.test(text) ? 120 : undefined;
}

const AUDIO_NOUN = "(?:voice|audio|vocal|spoken|sound)\\s*(?:message|msg|note|memo|clip|reply|response|recording|version)s?|voice\\s*(?:mail|text)|vm|voicemail|audio";
const AUDIO_ASK = new RegExp(`\\b(?:${AUDIO_NOUN})\\b`, "i");
const SEND = /\b(?:send|give|record|make|leave|drop|reply|respond|answer|do|say|tell|read|talk|speak|sing|want|need|wanna|gimme|lemme|let\s+me)\b/i;
// "in your (own) voice", "out loud", "hear you/your voice", "talk to me", "say it": speech without the noun.
const SPOKEN = /\b(?:in\s+(?:your|ur)\s+(?:own\s+|real\s+|actual\s+)?voice|out\s*loud|aloud|hear\s+(?:you|your\s+voice|u|ur\s+voice)|(?:talk|speak)\s+to\s+me|with\s+(?:your|ur)\s+voice|use\s+(?:your|ur)\s+voice)\b/i;
// The previous reply, not a new one: "send that as a voice message", "say that out loud", "read it to me".
const THAT = /\b(?:that|this|it|your\s+(?:last|previous)\s+(?:message|reply|answer|one)|what\s+you\s+(?:just\s+)?(?:said|wrote))\b/i;
const QUESTION = /^(?:what|why|how|who|when|where|is|are|does|did|explain|define|should\s+i)\b/i;
const NOT_ASK = /\b(?:record(?:ing)?\s+(?:my|a)\s+(?:own|voice)|my\s+voice|transcribe|speech\s+to\s+text|html|css|code|api|react|component|in\s+my\s+(?:app|site|project))\b/i;
const LEAD = /^(?:(?:hey|ok|okay|yo)\s+(?:senko\s+)?|senko[,\s]+|(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+|pls\s+)?|please\s+|pls\s+|now\s+|also\s+|and\s+|no[,.]?\s+)/i;

export function detectVoiceRequest(text: string, hasPrevious = false): VoiceRequest | null {
  let t = text.trim().replace(/\s+/g, " ");
  if (!t || t.length > 600) return null;
  for (let i = 0; i < 4; i++) t = t.replace(LEAD, "");
  if (QUESTION.test(t) && !/^(?:how\s+about|is\s+it\s+possible)/i.test(t)) return null;
  if (NOT_ASK.test(t)) return null;
  if (/\b(?:don't|don’t|do not|never|stop)\s+(?:(?:send|give|use|make|record|speak|reply|respond)\s+)?(?:me\s+)?(?:an?\s+|any\s+)?(?:voice|audio|spoken|out loud|aloud)\b/i.test(t)) return null;
  const noun = AUDIO_ASK.test(t);
  const spoken = SPOKEN.test(t);
  if (!noun && !spoken) return null;
  // "audio" on its own needs a verb ("send audio"); "voice message" is enough by itself.
  if (noun && !spoken && !SEND.test(t) && !/^(?:a\s+|an\s+)?(?:voice|audio)\s*(?:message|note|memo|msg)\b/i.test(t)) return null;
  // "send that as a voice message" / "say that out loud" with nothing new asked: repeat the last reply.
  const rest = t
    .replace(new RegExp(`\\b(?:${AUDIO_NOUN})\\b`, "gi"), " ")
    .replace(SPOKEN, " ")
    .replace(/\b(?:send|give|make|say|read|turn|convert|do|record|me|us|as|an?|the|into|in|to|please|pls|again|instead|version|of|for)\b/gi, " ")
    .replace(/[^\w\s]/g, " ")
    .trim();
  if (hasPrevious && THAT.test(t) && rest.replace(THAT, " ").replace(/\s+/g, "").length === 0) return { mode: "repeat" };
  return { mode: "reply" };
}

/** What the reply model is told when its answer will be spoken. */
export const VOICE_REPLY_NOTE = `THIS REPLY IS A VOICE MESSAGE: the server will synthesize your text and attach an actual audio file after you finish writing. You only write the spoken transcript. Never claim you cannot send audio, lack a voice, or that the user must imagine it. Earlier assistant claims about lacking audio are obsolete. Only the server reports actual synthesis failures. The app identifies the actual engine, including any fallback voice; do not claim it is a trained original voice.
Write exactly what you'd say out loud, like a real voice message to a friend: natural spoken sentences, your usual personality and mood, contractions, little verbal reactions are fine.
Keep the requested topic and prior conversation in mind. Follow the requested format: a story needs a compact beginning, event and ending, rather than a discussion of storytelling. For other replies, make one clear point with a concrete example. Start with substance; avoid repeating greetings or filling time with stock reactions. Use punctuation for natural pauses. Do not invent personal experiences or claim the voice is human. A voice director performs your transcript afterwards, so write it to be acted: if the user wants a character, attitude or style, become it in your wording. Hesitations (ellipses), interruptions (dashes), energy (exclamation marks), real interjections and an occasional short action beat in asterisks between sentences (like *sighs* or *crosses arms*) are all performed as sound or silence, never read aloud. No SSML, brackets, or long stage directions.
No markdown, lists, headings, links, URLs, code, tables, emoji, kaomoji or \`\`\`ui blocks (none of them can be heard). Spell out symbols and numbers the way you'd say them.
Follow the requested speaking budget. Don't say "here's a voice message" or describe the audio; just talk.`;
