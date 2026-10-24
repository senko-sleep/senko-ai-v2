// Recognising a model's canned refusal ("Sorry, I can't assist with that."), so the request can
// go to another model instead of ending the task. It looks only at how a reply OPENS and only
// at short replies: a long answer that happens to mention "explicit content" or "I can't" in
// the middle is a normal answer, not a refusal.

const APOLOGY = String.raw`(?:(?:i'?m |i am |so )?(?:sorry|apologi[sz]e|apologies)\b[^.!?\n]{0,40}?[,.;:\-–—]?\s*)?`;
// The verb matters: "I can't tell which one it is" or "I can't find that episode" is an answer.
const REFUSAL_VERB =
  String.raw`(?:assist|help|comply|fulfil+|provide|process|continue|generate|create|write|support|engage|participate|accommodate|go along|do (?:that|this)|complete (?:that|this)|(?:with|on) (?:that|this))\b`;

const OPENERS = [
  // "Sorry, I can't assist." / "I'm sorry, but I cannot help with that" / "Apologies, I won't ..."
  new RegExp(
    String.raw`^${APOLOGY}(?:but\s+)?(?:i|we)\s*(?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|will not|am (?:not able|unable)|(?:'|’)?m (?:not able|unable))\s+(?:be able to\s+|to\s+)?${REFUSAL_VERB}`,
    "i"
  ),
  // "I don't feel comfortable ...", "I don't think I should ..."
  new RegExp(String.raw`^${APOLOGY}i (?:do not|don(?:'|’)?t) (?:feel comfortable|think i (?:should|can))\b`, "i"),
  // "I must decline", "I have to decline", "I'm going to have to pass"
  new RegExp(String.raw`^${APOLOGY}i (?:must|have to|need to|'?m going to have to) (?:decline|refuse|pass)\b`, "i"),
  // "As an AI, I can't ..."
  /^as an ai(?: language model| assistant)?,?\s*i\b/i,
  // "That's not something I can help with", "This request violates ..."
  /^(?:that|this)(?:'s| is| request| content| would)\s+(?:not something i|against (?:my|the)|a violation|violates?|inappropriate)\b/i,
  // "Unable to comply", "Cannot assist with that"
  new RegExp(String.raw`^(?:unable to|not able to|cannot|can(?:'|’)?t) ${REFUSAL_VERB}`, "i"),
];

/** Replies that are only an apology plus a refusal are short; anything longer is an answer. */
const MAX_REFUSAL_CHARS = 420;

const LEAD = /^[\s>*_#"'`​]+/;

export function looksLikeRefusal(text: string): boolean {
  const t = text.replace(LEAD, "");
  if (!t || t.length > MAX_REFUSAL_CHARS) return false;
  // A JSON action or a code block is a work product, never a refusal.
  if (/^[{[]/.test(t) || t.startsWith("```")) return false;
  return OPENERS.some((re) => re.test(t));
}

/** Same check on a stream's first chunk(s), which may be cut mid-sentence (no length limit applies). */
export function startsLikeRefusal(head: string): boolean {
  const t = head.replace(LEAD, "");
  if (!t || /^[{[]/.test(t) || t.startsWith("```")) return false;
  return OPENERS.some((re) => re.test(t));
}
