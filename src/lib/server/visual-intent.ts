// Questions about a specific, named thing ("do you like Chara from Undertale", "thoughts on
// Breaking Bad", "who is Makima") deserve an immersive answer: Senko's own take, laid out
// with pictures and analysis, without the user having to ask for "a ui".

const ASK = [
  /\b(?:do|did|would)\s+you\s+(?:like|love|hate|enjoy|know|rate|prefer|stan|ship|remember|recommend)\s+(.+)/i,
  /\bwhat\s+do\s+you\s+(?:think|feel|know)\s+(?:of|about)\s+(.+)/i,
  /\bhow\s+do\s+you\s+feel\s+about\s+(.+)/i,
  /\b(?:your|ur)\s+(?:thoughts|opinion|take|views?)\s+(?:on|of|about)\s+(.+)/i,
  /^\s*(?:thoughts|opinion|opinions|take|hot\s+take)\s+(?:on|about)\s+(.+)/i,
  /\b(?:tell\s+me\s+(?:about|everything\s+about)|who\s+(?:is|was|are)|explain(?:\s+the\s+lore\s+of)?|analy[sz]e|break\s+down)\s+(.+)/i,
  /\bis\s+(.+?)\s+(?:good|bad|evil|overrated|underrated|worth\s+(?:it|watching|playing|reading)|strong|the\s+(?:best|villain|strongest))\b/i,
  /\bwhy\s+(?:is|are|do\s+people\s+(?:like|love|hate))\s+(.+?)\s*(?:so\s+\w+|popular|loved|hated|famous)?\s*[?!.]*$/i,
];

// Things that aren't a "subject" worth a visual layout.
const NOT_A_SUBJECT = /^(?:it|this|that|these|those|them|him|her|me|you|us|yourself|myself|everything|anything|something|nothing|life|love|death|people|stuff|things|math|coding|code|programming|homework|school|work|my\b|your\b|the\s+(?:weather|time|news|answer|difference|best\s+way)|how\b|what\b|why\b|when\b|if\b|whether\b)/i;
const ABSTRACT = /^(?:happiness|sadness|anxiety|depression|loneliness|friendship|philosophy|religion|politics|economics|ai|chatgpt|you)$/i;
const CODEY = /```|\b(?:function|component|react|typescript|javascript|python|css|html|regex|sql|api|bug|error|compile|npm)\b/i;

function clean(raw: string): string {
  return raw
    .replace(/\b(?:at\s+all|tho|though|lol|lmao|xd|honestly|tbh|ngl|fr|rn|personally|anymore|too|as\s+a\s+(?:character|person))\b/gi, " ")
    .replace(/[?!.,;:"“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|a|an)\s+(?=\S+\s+\S)/i, "");
}

/** The named subject of a discussion question, or null for chit-chat / generic questions. */
export function discussionSubject(content: string): string | null {
  const text = content.trim();
  if (text.length < 6 || text.length > 300 || CODEY.test(text)) return null;
  for (const re of ASK) {
    const m = re.exec(text);
    if (!m?.[1]) continue;
    const subject = clean(m[1].split(/\s+(?:and\s+(?:why|how|what)|because|since|or\s+not)\b/i)[0]);
    const words = subject.split(" ").filter(Boolean);
    if (!subject || words.length > 7 || subject.length < 2) continue;
    if (NOT_A_SUBJECT.test(subject) || ABSTRACT.test(subject)) continue;
    // Needs to look like a name or title: a capital letter, "X from Y", a digit, or 1-3 words.
    const named = /[A-Z]/.test(subject) || /\bfrom\b/i.test(subject) || /\d/.test(subject) || words.length <= 3;
    if (!named) continue;
    return subject;
  }
  return null;
}

/** "chara from undertale" → "Chara Undertale" for searches; leaves other subjects as they are. */
export function subjectSearchQuery(subject: string): string {
  return subject.replace(/\s+(?:from|in|of)\s+(?:the\s+)?/i, " ").trim();
}

export function visualAnswerNote(subject: string): string {
  return `VISUAL ANSWER — the user is talking about "${subject}". Compose the conversation itself using chat-layout text, image, row, column and grid primitives. Choose a fresh arrangement around what you actually want to say: a figure beside an opinion, images between relevant paragraphs, an asymmetric comparison, or another composition of your own. You decide the number, order, proportions and grouping of images and text without asking the user. There is no required opening, hero, section sequence, UI card or block count. Keep your natural voice and distinguish opinions from researched facts. Use specific imageQuery searches for relevant pictures of ${subject}; never invent facts, quotes or image URLs.`;
}
