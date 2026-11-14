// Reading a chat message as a web search. The query is kept as the user wrote it: filler like
// "can you search for" is removed, but no word of the subject is dropped or swapped.

export interface SearchRequest {
  query: string;
  /** How many results were asked for (default 10, at most 30). */
  count: number;
}

const DEFAULT_COUNT = 10;
const MAX_COUNT = 30;

/** Adult wording. Searches for it are normal searches (SafeSearch decides what shows). */
export const ADULT_SEARCH = /\b(?:h[\s-]?manga|hentai|porn\w*|xxx|nsfw|r34|rule\s?34|lewds?|smut|ecchi|nudes?|naked|sex|18\+|erotic\w*|doujin(?:shi)?)\b/i;

const LEAD = new RegExp(
  "^(?:" +
    [
      "(?:hey|ok|okay|yo)\\s+(?:senko\\s+)?",
      "senko[,\\s]+",
      "(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?",
      "please\\s+",
      "pls\\s+",
      "i\\s+(?:want|need|wanna)\\s+(?:you\\s+to\\s+)?",
      // Conversational glue a follow-up starts with ("now ...", "ok so ...", "no I meant ...").
      "(?:no|nah|nope)[,.!]*\\s+",
      "i\\s+(?:mean|meant)[,:]?\\s+",
      "(?:now|also|and|then|next|alright|ok\\s+so|so|actually|instead|just)[,.!]*\\s+",
    ].join("|") +
    ")",
  "i",
);

const SEARCH_VERB =
  /^(?:(?:do\s+a\s+)?(?:web\s+|google\s+|bing\s+|internet\s+)?search(?:\s+(?:the\s+)?(?:web|internet|google|online))?(?:\s+(?:for|up|about))?|google|bing|look\s+up|lookup|search\s+up)\s+(.+)$/i;
const RESULTS_FOR =
  /^(?:(?:show|give|get|send|find|list)\s+(?:me\s+)?)?(?:the\s+)?(?:top\s+(\d{1,2})\s+)?(?:(?:search\s+)?results?|links?|sites?|websites?|webpages?|pages?)\s+(?:for|about|on|with|of|that\s+have|where\s+i\s+can\s+(?:find|read|watch))\s+(.+)$/i;
const TOP_N = /^(?:(?:show|give|get|send|find|list)\s+(?:me\s+)?)?(?:the\s+)?top\s+(\d{1,2})\s+(.+?)(?:\s+(?:search\s+)?(?:results?|links?|sites?|websites?))?$/i;
const WHERE = /^where\s+(?:can|do|could|should)\s+i\s+((?:read|watch|find|download|buy|play|stream)\s+.+)$/i;
const BARE_ADULT = /^(?:(?:send|show|give|get|find|pull\s+up|bring)\s+(?:me\s+)?)?(?:some\s+)?(.+)$/i;
// Leave these to the chat (they ask about something, they don't ask to search for it).
const QUESTION = /^(?:what|why|how|who|when|is|are|does|do|did|explain|define|tell\s+me\s+(?:about|what))\b/i;
// Picture requests have their own gallery.
const IMAGE_ASK = /\b(?:pics?|pictures?|images?|photos?|wallpapers?|gifs?|collage|gallery|fan\s?art|art)\b/i;

function tidy(s: string): string {
  return s
    .replace(/[“”"`]/g, "")
    // Search engines can't pick at random: "a random hentai site" searches "hentai site".
    .replace(/^(?:(?:a|an|some|one)\s+)?(?:random|any|good|cool|nice)\s+/i, "")
    .replace(/^(?:a|an|some|one)\s+(?=.*\b(?:web\s?)?sites?$)/i, "")
    .replace(/\s+(?:for\s+me|please|pls|plz|thanks|thank\s+you|rn|now)\s*$/gi, "")
    .replace(/\s+(?:on|in|using|with)\s+(?:google|bing|duckduckgo|ddg|the\s+(?:web|internet))\s*$/i, "")
    .replace(/\s*\b(?:results?|links?)\s*$/i, "")
    .replace(/[?!.,:;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countIn(text: string): number | null {
  const m = /\btop\s+(\d{1,2})\b|\b(\d{1,2})\s+(?:results?|links?|sites?|websites?)\b/i.exec(text);
  const n = m ? Number(m[1] || m[2]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : null;
}

/**
 * "search fnf hentai", "top 20 sites for fnf hentai", "fnf hentai", "google rust borrow checker"
 * -> { query, count }. Returns null for anything that isn't a search.
 */
export function detectSearchRequest(text: string): SearchRequest | null {
  let t = text.trim().replace(/\s+/g, " ");
  if (!t || t.length > 300 || t.includes("\n")) return null;
  // Multi-step browser jobs ("search flights and book one") belong to the agent.
  if (/\b(?:and\s+then|then\s+(?:open|click|book|buy)|book\s+(?:a|the|it)|buy\s+(?:a|the|it)|log\s*in|sign\s*up|fill\s+(?:out|in)|add\s+to\s+cart|checkout)\b/i.test(t)) return null;
  for (let i = 0; i < 3; i++) t = t.replace(LEAD, "");
  const count = countIn(t) ?? DEFAULT_COUNT;
  const done = (q: string | undefined): SearchRequest | null => {
    const query = tidy(q || "").replace(/^top\s+\d{1,2}\s+/i, "");
    return query.length >= 2 ? { query: query.slice(0, 200), count } : null;
  };

  let m = SEARCH_VERB.exec(t);
  if (m) return done(m[1]);
  m = RESULTS_FOR.exec(t);
  if (m) return done(m[2]);
  m = TOP_N.exec(t);
  if (m && !IMAGE_ASK.test(m[2])) return done(m[2]);
  m = WHERE.exec(t);
  if (m) return done(m[1]);

  // A short adult query on its own ("fnf hentai", "send me fnf r34") is a search, like typing it into a browser.
  if (ADULT_SEARCH.test(t) && !QUESTION.test(t) && !IMAGE_ASK.test(t) && t.split(" ").length <= 10) {
    m = BARE_ADULT.exec(t);
    return done(m?.[1]);
  }
  return null;
}
