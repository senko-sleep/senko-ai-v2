// Follow-ups like "images of her as a collage" name their subject with a pronoun.
// Work out who "her" is from the conversation so searches use the real name.
import { extractEntityQuery } from "./grounding";

export interface ConversationSubject { name: string; context?: string }

interface MessageLike { role: string; content: string; meta?: { imageQuery?: string } | null }

const PRONOUN = /^(?:her|him|them|it|she|he|they|this|that|these|those|the same|same|this (?:one|character|person|guy|girl|boy|woman|man)|that (?:one|character|person|guy|girl|boy|woman|man))$/i;
const PRONOUN_WORD = /\b(?:her|him|them|she|he|they|this (?:character|person|guy|girl|boy|woman|man)|that (?:character|person|guy|girl|boy|woman|man))\b/i;
const LAYOUT_WORDS = /\s*\b(?:as|in|into|on)\s+(?:an?\s+|the\s+)?(?:collage|mosaic|grid|gallery|mood ?board|carousel|slideshow)\b.*$|\b(?:collage|mosaic|mood ?board)\b|\s+(?:now|please|pls|again|too|as well)\s*$/gi;

/** The most recent named subject in the conversation (newest first), with its series/context if known. */
export function lastSubject(messages: MessageLike[]): ConversationSubject | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") {
      const profile = /"type":"profile","name":"((?:[^"\\]|\\.)+)"/.exec(m.content);
      if (profile) {
        const series = /"series":"((?:[^"\\]|\\.)+)"/.exec(m.content)?.[1];
        return { name: JSON.parse(`"${profile[1]}"`), context: series ? JSON.parse(`"${series}"`) : undefined };
      }
      const gallery = /"type":"gallery","curated":true,"title":"((?:[^"\\]|\\.)+)"/.exec(m.content);
      if (gallery) return { name: JSON.parse(`"${gallery[1]}"`) };
      if (m.meta?.imageQuery && !PRONOUN_WORD.test(m.meta.imageQuery)) return { name: m.meta.imageQuery };
    } else if (m.role === "user") {
      const entity = extractEntityQuery(m.content);
      if (entity && !PRONOUN.test(entity) && !PRONOUN_WORD.test(entity)) return { name: entity };
    }
  }
  return null;
}

/** Remove layout words ("as a collage now") and replace pronouns with the conversation's subject. */
export function resolveSubject(query: string, subject: ConversationSubject | null): { query: string; label: string } {
  const cleaned = query.replace(LAYOUT_WORDS, "").replace(/\s+/g, " ").trim();
  if (!subject) return { query: cleaned || query, label: cleaned || query };
  const withContext = (name: string) => (subject.context && !name.toLowerCase().includes(subject.context.toLowerCase()) ? `${name} ${subject.context}` : name);
  if (!cleaned || PRONOUN.test(cleaned)) return { query: withContext(subject.name), label: subject.name };
  if (PRONOUN_WORD.test(cleaned)) {
    // "her smiling" → "Anya Forger smiling"
    const replaced = cleaned.replace(PRONOUN_WORD, subject.name);
    return { query: withContext(replaced), label: replaced };
  }
  return { query: cleaned, label: cleaned };
}
