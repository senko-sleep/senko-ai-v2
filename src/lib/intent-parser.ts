import nlp from "compromise";

// ── Intent types ──
export interface ParsedIntent {
  type: "site-search" | "open-url" | "page-content" | "pick-result" | "pagination" | "section-nav" | "none";
  confidence: number;  // 0–1 confidence score; only auto-execute if >= 0.8
  site?: string;       // resolved URL (e.g., "https://rule34video.com")
  siteName?: string;   // raw site name from user (e.g., "rule 34 video")
  query?: string;      // search query (e.g., "eevee")
  autoPick?: number;   // 0 = no pick, N = pick Nth result, -1 = last
  action?: string;     // user's desired action: list, play, open, watch, etc.
  url?: string;        // explicit URL if provided
  pageNum?: number;    // for pagination intents
  section?: string;    // for section navigation
}

// ── Verb categories ──
const SEARCH_WORDS = ["look", "search", "find", "lookup"];
const RESULT_NOUNS = ["video", "result", "one", "link", "clip", "item", "option", "entry"];

// ── Ordinal map ──
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1,
};

// ── Site URL resolution ──
function resolveSiteUrl(name: string): string {
  let clean = name.replace(/\s+/g, "").toLowerCase();
  if (!clean.includes(".")) clean += ".com";
  if (!clean.startsWith("http")) clean = "https://" + clean;
  return clean;
}

// ── Clause parser: split text on "and" / "then" / commas into semantic chunks ──
// Always use deterministic manual split — compromise clause splitting is unreliable
// for multi-action sentences like "go to X and look up Y and list Z"
function splitClauses(text: string): string[] {
  return text.split(/\s+(?:and|then|,)\s+/).map(s => s.trim()).filter(Boolean);
}

// ── Extract ordinal/number from text ──
function extractOrdinal(text: string): number {
  // compromise ordinal detection
  try {
    const doc = nlp(text);
    const ordinals = doc.match("#Ordinal").out("array") as string[];
    if (ordinals.length > 0) {
      const word = ordinals[0].toLowerCase().trim();
      if (ORDINALS[word] !== undefined) return ORDINALS[word];
      const numMatch = word.match(/^(\d+)/);
      if (numMatch) return parseInt(numMatch[1]);
    }
  } catch { /* fall back */ }
  // Regex: ordinals with suffix (1st, 2nd, 3rd, 5th)
  const ordMatch = text.match(/(?:(\d+)(?:st|nd|rd|th)|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last))/i);
  if (ordMatch) {
    if (ordMatch[1]) return parseInt(ordMatch[1]);
    if (ordMatch[2]) return ORDINALS[ordMatch[2].toLowerCase()] || 0;
  }
  // Plain number in pick context: "option 5", "number 3", "#7", "play 5", or bare number
  const plainNum = text.match(/(?:option|number|#|no\.?)\s*(\d+)/i) || text.match(/(?:play|open|watch|click|pick|select|choose|get|show)\s+(\d+)\b/i) || text.match(/^\s*(\d+)\s*$/);
  if (plainNum) return parseInt(plainNum[1]);
  return 0;
}

// ── Detect if a word/phrase is a site reference ──
function isSiteReference(phrase: string): boolean {
  const lower = phrase.toLowerCase();
  // Has a domain extension
  if (/\.[a-z]{2,}$/i.test(lower)) return true;
  // Contains known site-like suffixes
  if (/(?:video|hub|tube|porn|xxx|rule34|hentai|reddit|twitter|twitch|tiktok|youtube|instagram|facebook|discord|spotify)\b/i.test(lower)) return true;
  // Is a known short name
  if (/^(?:xvideos|pornhub|xhamster|redtube|xnxx|reddit|youtube|twitch|google)\b/i.test(lower)) return true;
  return false;
}

// ── Detect explicit URL in text ──
function extractUrl(text: string): string | null {
  const match = text.match(/(https?:\/\/[^\s]+)/i);
  return match ? match[1] : null;
}

// ── Main parser ──
export function parseIntent(text: string): ParsedIntent {
  const lower = text.toLowerCase().trim();

  // ── 1. Explicit URL detection ──
  const explicitUrl = extractUrl(text);
  if (explicitUrl) {
    // "what videos are on https://..." → page-content
    if (/what(?:'s|\s+are|\s+is)?.*(?:videos?|content|on\s+(?:this|that)\s+page)/i.test(lower)) {
      return { type: "page-content", confidence: 0.95, url: explicitUrl };
    }
    // "open/go to https://..." → open-url
    if (/^\s*(?:open|go\s*to|visit|browse|navigate)/i.test(lower)) {
      return { type: "open-url", confidence: 0.95, url: explicitUrl };
    }
    // URL with other intent — treat as open-url but lower confidence (no explicit verb)
    return { type: "open-url", confidence: 0.7, url: explicitUrl };
  }

  // ── 2. Pagination detection ──
  if (/^\s*(?:next\s+page|page\s+\d+|more\s+(?:results|videos?))\s*$/i.test(lower)) {
    const pageMatch = lower.match(/page\s+(\d+)/);
    return { type: "pagination", confidence: 0.9, pageNum: pageMatch ? parseInt(pageMatch[1]) : 0 };
  }

  // ── 3. Result pick detection: "play the 3rd video", "play option 5", "option 5", "5" ──
  const ordinal = extractOrdinal(lower);
  if (ordinal !== 0) {
    const hasResultNoun = RESULT_NOUNS.some(n => lower.includes(n));
    const hasPickVerb = /^(?:play|open|watch|click|pick|select|choose|get|show)\s+/i.test(lower);
    const isOptionRef = /\b(?:option|number|#|no\.?)\s*\d+/i.test(lower);
    const isBareNumber = /^\s*\d+\s*$/.test(lower);
    // Pick if: (verb + noun), (verb + number), (option/number ref), or bare number
    if ((hasPickVerb && hasResultNoun) || (hasPickVerb && ordinal > 0) || isOptionRef || isBareNumber) {
      // Confidence: verb+noun = high, bare number = low (could be game answer)
      const pickConfidence = (hasPickVerb && hasResultNoun) ? 0.95
        : (hasPickVerb && ordinal > 0) ? 0.85
        : isOptionRef ? 0.9
        : isBareNumber ? 0.4  // bare numbers are ambiguous — might be game answers
        : 0.6;
      return { type: "pick-result", confidence: pickConfidence, autoPick: ordinal };
    }
  }

  // ── 4. Section navigation: "go to the yuri section" ──
  const sectionMatch = lower.match(/(?:go\s+to|show\s+me|open|browse)\s+(?:the\s+)?([a-zA-Z0-9\s]+?)\s+(?:section|category|page|tab)\b/i);
  if (sectionMatch) {
    return { type: "section-nav", confidence: 0.9, section: sectionMatch[1].trim() };
  }

  // ── 5. Site-search detection (the main adaptive parser) ──
  const clauses = splitClauses(lower);

  let detectedSite = "";
  let detectedSiteName = "";
  let detectedQuery = "";
  let detectedAction = "";
  let detectedAutoPick = 0;

  for (const clause of clauses) {
    const words = clause.split(/\s+/);
    // ── Navigation clause: "go to X", "visit X", "open X", "browse X" ──
    const navMatch = clause.match(/^(?:go\s*to|visit|browse|open|navigate\s*to|head\s*to|check\s*out)\s+(.+)/i);
    if (navMatch) {
      const target = navMatch[1].trim();
      // If the target looks like a site (not a section/action), extract it
      if (isSiteReference(target) || (!SEARCH_WORDS.some(w => target.startsWith(w)) && target.length > 1)) {
        // Only set as site if it's not clearly a search phrase
        const potentialSite = target.replace(/\s*(?:and|then)\s+.*$/i, "").trim();
        if (potentialSite && isSiteReference(potentialSite)) {
          detectedSiteName = potentialSite;
          detectedSite = resolveSiteUrl(potentialSite);
        }
      }
    }

    // ── Search clause: "look up X", "search for X", "find X" ──
    const searchMatch = clause.match(/^(?:look\s*up|search\s*(?:for)?|find)\s+(.+)/i);
    if (searchMatch) {
      detectedQuery = searchMatch[1].trim();
    }

    // ── "X on/in SITE" pattern: "look up eevee on rule34video", "look up eevee in rule34video" ──
    const onSiteMatch = clause.match(/^(?:look\s*up|search\s*(?:for)?|find)\s+(.+?)\s+(?:on|in|at|from)\s+(.+)/i);
    if (onSiteMatch) {
      let rawQuery = onSiteMatch[1].trim();
      const siteRef = onSiteMatch[2].trim();
      
      // Strip count modifiers like "10 videos", "some clips", "a few" — these aren't real search terms
      // If the entire query is just a count + generic noun, treat as empty (browse homepage)
      const countModifierPattern = /^(?:(?:the\s+)?(?:top|first|latest|newest|recent|best|popular|random|some|a\s+few|several|\d+)\s+)?(?:videos?|clips?|results?|items?|things?|content|posts?|entries?)$/i;
      if (countModifierPattern.test(rawQuery)) {
        rawQuery = ""; // Generic browse — no specific search term
      } else {
        // Strip leading count modifiers from actual queries: "10 eevee videos" → "eevee videos"
        rawQuery = rawQuery.replace(/^(?:(?:the\s+)?(?:top|first|latest|newest|recent|best|popular|random|some|a\s+few|several|\d+)\s+)/i, "").trim();
      }
      
      detectedQuery = rawQuery;
      if (isSiteReference(siteRef) || siteRef.length > 2) {
        detectedSiteName = siteRef;
        detectedSite = resolveSiteUrl(siteRef);
      }
    }

    // ── Action clause: "list top 10", "play the first video", "click the 3rd one" ──
    const actionMatch = clause.match(/^(play|click|watch|list|show|give|tell|display|get|send|pick|select|choose)\b\s*(.*)/i);
    if (actionMatch) {
      detectedAction = actionMatch[1].toLowerCase();
      const rest = actionMatch[2];
      const ord = extractOrdinal(rest);
      if (ord !== 0) detectedAutoPick = ord;
    }

    // ── Implicit site + query: "rule34video eevee" (site name followed by query) ──
    if (!detectedSite && !detectedQuery && words.length >= 2) {
      // Check if first word(s) look like a site
      for (let i = 1; i <= Math.min(words.length - 1, 4); i++) {
        const potentialSite = words.slice(0, i).join(" ");
        if (isSiteReference(potentialSite)) {
          detectedSiteName = potentialSite;
          detectedSite = resolveSiteUrl(potentialSite);
          detectedQuery = words.slice(i).join(" ");
          break;
        }
      }
    }

    // ── Check for ordinals in any clause ──
    if (!detectedAutoPick) {
      const ord = extractOrdinal(clause);
      if (ord !== 0 && RESULT_NOUNS.some(n => clause.includes(n))) {
        detectedAutoPick = ord;
      }
    }
  }

  // ── Safety net: full-text scan for combined nav+search patterns the clause loop missed ──
  // Catches cases where clause splitting didn't separate "go to SITE and look up QUERY" properly
  if (detectedSite && !detectedQuery) {
    const embeddedSearch = lower.match(/(?:look\s*up|search\s*(?:for)?|find)\s+(.+?)(?:\s+and\s+(?:click|play|open|watch|pick|select|choose|list|show|give|tell|display|get|send|put).*)?$/i);
    if (embeddedSearch) {
      detectedQuery = embeddedSearch[1].trim();
    }
  }
  if (!detectedSite && detectedQuery) {
    // Check for "on SITE" / "on that site" at end
    const endSiteMatch = lower.match(/(?:on|at|from)\s+(?:that\s+)?(?:site|website|page)\s*$/i);
    if (endSiteMatch) {
      return { type: "site-search", confidence: 0.5, query: detectedQuery, action: detectedAction || undefined, autoPick: detectedAutoPick || undefined };
    }
    // Check for site reference anywhere in the text
    const siteInText = lower.match(/(?:on|in|at|from)\s+([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+)/i)
      || lower.match(/(?:on|in|at|from)\s+(\w+(?:video|hub|tube|porn|xxx|rule34|hentai)\w*)/i);
    if (siteInText) {
      detectedSiteName = siteInText[1].trim();
      detectedSite = resolveSiteUrl(detectedSiteName);
    }
  }

  // ── Determine final intent type + confidence ──
  if (detectedSite && detectedQuery) {
    // Confidence factors: explicit search verb, recognized site, query present
    let conf = 0.5;
    const hasSearchVerb = SEARCH_WORDS.some(w => lower.includes(w));
    const hasOnSitePattern = /\b(?:on|in|at|from)\s+/i.test(lower);
    if (hasSearchVerb) conf += 0.2;        // explicit "look up" / "search"
    if (hasOnSitePattern) conf += 0.15;    // "on rule34video"
    if (isSiteReference(detectedSiteName)) conf += 0.15; // recognized site name
    if (detectedQuery.length > 2) conf += 0.05;          // non-trivial query
    conf = Math.min(conf, 1.0);
    return {
      type: "site-search",
      confidence: conf,
      site: detectedSite,
      siteName: detectedSiteName,
      query: detectedQuery,
      action: detectedAction || undefined,
      autoPick: detectedAutoPick || undefined,
    };
  }

  if (detectedSite && !detectedQuery) {
    // Just "open rule34video" — open the site
    const hasNavVerb = /^\s*(?:open|go\s*to|visit|browse|navigate)/i.test(lower);
    return { type: "open-url", confidence: hasNavVerb ? 0.9 : 0.6, site: detectedSite, siteName: detectedSiteName, url: detectedSite };
  }

  // No site-specific intent detected — let the AI handle it
  return { type: "none", confidence: 0 };
}
