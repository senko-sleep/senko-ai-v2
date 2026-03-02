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
const RESULT_NOUNS = ["video", "result", "one", "link", "clip", "item", "option", "entry"];

// ── Ordinal map ──
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1,
};

// ══════════════════════════════════════════════════════════════════
// KNOWN SITES — used for instant resolution, fuzzy matching, and
// search URL pattern construction. NOT a gatekeeper — unknown sites
// get validated via HEAD request by the caller.
// ══════════════════════════════════════════════════════════════════
const KNOWN_SITES: Record<string, string> = {
  "rule34video": "https://rule34video.com",
  "rule34": "https://rule34.xxx",
  "rule34xxx": "https://rule34.xxx",
  "pornhub": "https://www.pornhub.com",
  "xvideos": "https://www.xvideos.com",
  "xhamster": "https://xhamster.com",
  "redtube": "https://www.redtube.com",
  "xnxx": "https://www.xnxx.com",
  "spankbang": "https://spankbang.com",
  "nhentai": "https://nhentai.net",
  "e621": "https://e621.net",
  "gelbooru": "https://gelbooru.com",
  "danbooru": "https://danbooru.donmai.us",
  "youtube": "https://www.youtube.com",
  "reddit": "https://www.reddit.com",
  "twitter": "https://x.com",
  "twitch": "https://www.twitch.tv",
  "tiktok": "https://www.tiktok.com",
  "instagram": "https://www.instagram.com",
  "facebook": "https://www.facebook.com",
  "discord": "https://discord.com",
  "spotify": "https://open.spotify.com",
  "google": "https://www.google.com",
  "amazon": "https://www.amazon.com",
};

// ── Levenshtein distance for fuzzy matching ──
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Fuzzy site resolution: tolerates misspellings like "pornhib", "rul34video", "rule 34 vidoe" ──
function fuzzyMatchSite(input: string): { name: string; url: string } | null {
  const clean = input.toLowerCase().trim().replace(/\s+/g, "");
  // Exact match first
  if (KNOWN_SITES[clean]) return { name: clean, url: KNOWN_SITES[clean] };
  // Fuzzy: find closest known site within edit distance threshold
  // Extra guard: input length must be similar to key length (within 50%) to prevent
  // common words like "the", "did" from matching short keys like "x"
  let bestKey = "";
  let bestDist = Infinity;
  for (const key of Object.keys(KNOWN_SITES)) {
    // Very short keys (≤2 chars like "x") must be exact match only
    if (key.length <= 2) continue;
    // Length similarity check: input must be within 50% of key length
    const lenRatio = clean.length / key.length;
    if (lenRatio < 0.5 || lenRatio > 2.0) continue;
    const dist = levenshtein(clean, key);
    // Threshold: tighter to prevent false positives like "youtell" → "youtube"
    // Max 1 edit for short names (≤5), max 2 for medium (≤10), max 3 for long (>10)
    // AND edit distance must be < 30% of key length
    const maxDist = key.length <= 5 ? 1 : key.length <= 10 ? 2 : 3;
    if (dist > key.length * 0.3) continue; // e.g. 3/7 = 43% for youtube → too high
    if (dist < bestDist && dist <= maxDist) {
      bestDist = dist;
      bestKey = key;
    }
  }
  if (bestKey) return { name: bestKey, url: KNOWN_SITES[bestKey] };
  return null;
}

// ── Check if a site name resolves to a known site (exact or fuzzy) ──
export function isKnownSite(name: string): boolean {
  return fuzzyMatchSite(name) !== null;
}

// ── Validate a candidate URL is real (async HEAD request) ──
export async function validateSiteUrl(candidateUrl: string): Promise<{ valid: boolean; url: string }> {
  try {
    const res = await fetch(`/api/validate-url?url=${encodeURIComponent(candidateUrl)}`);
    if (!res.ok) return { valid: false, url: candidateUrl };
    const data = await res.json();
    return { valid: !!data.valid, url: data.url || candidateUrl };
  } catch {
    return { valid: false, url: candidateUrl };
  }
}

// ── Site URL resolution ──
// Known sites (exact/fuzzy): returns canonical URL (trusted)
// Has domain extension: uses it directly
// Unknown short name: constructs candidate URL (caller MUST validate)
function resolveSiteUrl(name: string): string {
  // 1. Fuzzy match against known sites
  const fuzzy = fuzzyMatchSite(name);
  if (fuzzy) return fuzzy.url;

  const lower = name.toLowerCase().trim();
  const noSpaces = lower.replace(/\s+/g, "");

  // 2. Has a domain extension already (.com, .net, etc)
  if (/\.[a-z]{2,}$/i.test(lower)) {
    let clean = noSpaces;
    if (!clean.startsWith("http")) clean = "https://" + clean;
    return clean;
  }

  // 3. Unknown name — construct candidate if it looks like a valid site name
  //    Must be alphanumeric only, ≤25 chars
  if (noSpaces.length <= 25 && /^[a-z0-9]+$/i.test(noSpaces)) {
    return "https://" + noSpaces + ".com";
  }

  return "";
}

// ── Extract ordinal/number from text ──
function extractOrdinal(text: string): number {
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
  const ordMatch = text.match(/(?:(\d+)(?:st|nd|rd|th)|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last))/i);
  if (ordMatch) {
    if (ordMatch[1]) return parseInt(ordMatch[1]);
    if (ordMatch[2]) return ORDINALS[ordMatch[2].toLowerCase()] || 0;
  }
  const plainNum = text.match(/(?:option|number|#|no\.?)\s*(\d+)/i) || text.match(/(?:play|open|watch|click|pick|select|choose|get|show)\s+(\d+)\b/i) || text.match(/^\s*(\d+)\s*$/);
  if (plainNum) return parseInt(plainNum[1]);
  return 0;
}

// ── Scan text for any mention of a known site (exact or fuzzy) ──
// Used by the complexity gate to intercept site-specific requests even in long messages
// Returns the matched site info + the raw text that matched, or null
function findKnownSiteInText(text: string): { name: string; url: string; rawMatch: string } | null {
  const words = text.split(/\s+/);
  // Try sliding windows of 1-3 consecutive words
  for (let winSize = 3; winSize >= 1; winSize--) {
    for (let i = 0; i <= words.length - winSize; i++) {
      const candidate = words.slice(i, i + winSize).join(" ");
      const candidateNoSpaces = words.slice(i, i + winSize).join("");
      // Try both with and without spaces
      const fuzzy = fuzzyMatchSite(candidate) || fuzzyMatchSite(candidateNoSpaces);
      if (fuzzy) {
        return { name: fuzzy.name, url: fuzzy.url, rawMatch: candidate };
      }
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// MAIN PARSER
//
// Philosophy: only intercept SIMPLE, CLEAR patterns. Complex or
// long multi-step instructions always pass to the AI — it's far
// better at understanding natural language than regex.
//
// The NLP interceptor fires for:
//   1. Explicit URLs
//   2. Pagination ("next page", "page 3")
//   3. Result picks ("play the 3rd video", "option 5")
//   4. Section nav ("go to the yuri section")
//   5. Simple site+query ("look up eevee on rule34video", "rule34video eevee")
//   6. Simple site open ("open pornhub", "go to youtube")
//   7. Long messages that mention a KNOWN site → extract site+query
//
// Everything else → type: "none" → AI handles it
// ══════════════════════════════════════════════════════════════════
export function parseIntent(text: string): ParsedIntent {
  const lower = text.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // ═══ COMPLEXITY GATE ═══
  // Messages >10 words are too complex for simple regex patterns.
  // But if a known site is mentioned WITH a site-search action verb, we intercept
  // to prevent AI from sanitizing NSFW queries. Research questions pass through.
  if (wordCount > 10) {
    // Only intercept if the message has site-search action verbs
    // Research questions ("what's trending", "tell me about", "why is") should pass to AI
    const hasSiteSearchVerb = /\b(look\s*up|search\s*(?:for)?|find|browse|go\s*to|open|visit|show\s*me|list|get\s*me)\b/i.test(lower);
    const isResearchQuestion = /^(what|why|how|who|when|where|tell|explain|describe|summarize)\b/i.test(lower.trim());
    
    // Scan for a known site name anywhere in the text
    const knownSiteMatch = findKnownSiteInText(lower);
    // Only intercept if: has known site + has action verb + NOT a research question
    if (knownSiteMatch && hasSiteSearchVerb && !isResearchQuestion) {
      // Extract the search query: everything that looks like a search term
      // Strip the site name and ALL instruction/filler words to get the real query
      const queryCandidate = lower
        .replace(new RegExp(knownSiteMatch.rawMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
        .replace(/\b(look\s*up|look|search\s*(?:for)?|search|find|on|in|at|from|go\s*to|go|open|visit|browse|and|then|click|first|second|third|fourth|fifth|last|link|listing|all|options|that|this|page|google|bing|the|a|an|for|show|me|play|watch|list|every|each|with|get|give|tell|want|wanna|can|you|please|also|too|now|just|some|any|more|most|best|top|new|latest|see|view|check|out|up|to|of|it|its|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|should|could|may|might)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      // Deduplicate words: "eevee porn eevee" → "eevee porn"
      const words = queryCandidate.split(/\s+/);
      const uniqueWords = [...new Set(words)];
      const dedupedQuery = uniqueWords.join(' ');
      if (dedupedQuery.length >= 2) {
        return {
          type: "site-search",
          confidence: 0.85,
          site: knownSiteMatch.url,
          siteName: knownSiteMatch.name,
          query: dedupedQuery,
        };
      }
      // No query extracted — just open the site
      return {
        type: "open-url",
        confidence: 0.85,
        site: knownSiteMatch.url,
        siteName: knownSiteMatch.name,
        url: knownSiteMatch.url,
      };
    }
    // No known site mentioned — let AI handle the complex message
    return { type: "none", confidence: 0 };
  }

  // ── 1. Explicit URL detection ──
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    const url = urlMatch[1];
    if (/what(?:'s|\s+are|\s+is)?.*(?:videos?|content|on\s+(?:this|that)\s+page)/i.test(lower)) {
      return { type: "page-content", confidence: 0.95, url };
    }
    if (/^\s*(?:open|go\s*to|visit|browse|navigate)/i.test(lower)) {
      return { type: "open-url", confidence: 0.95, url };
    }
    return { type: "open-url", confidence: 0.7, url };
  }

  // ── 2. Pagination ──
  if (/^\s*(?:next\s+page|page\s+\d+|more\s+(?:results|videos?))\s*$/i.test(lower)) {
    const pageMatch = lower.match(/page\s+(\d+)/);
    return { type: "pagination", confidence: 0.9, pageNum: pageMatch ? parseInt(pageMatch[1]) : 0 };
  }

  // ── 3. Result pick: "play the 3rd video", "option 5", bare "5" ──
  const ordinal = extractOrdinal(lower);
  if (ordinal !== 0) {
    const hasResultNoun = RESULT_NOUNS.some(n => lower.includes(n));
    const hasPickVerb = /^(?:play|open|watch|click|pick|select|choose|get|show)\s+/i.test(lower);
    const isOptionRef = /\b(?:option|number|#|no\.?)\s*\d+/i.test(lower);
    const isBareNumber = /^\s*\d+\s*$/.test(lower);
    if ((hasPickVerb && hasResultNoun) || (hasPickVerb && ordinal > 0) || isOptionRef || isBareNumber) {
      const pickConf = (hasPickVerb && hasResultNoun) ? 0.95
        : (hasPickVerb && ordinal > 0) ? 0.85
        : isOptionRef ? 0.9
        : isBareNumber ? 0.4
        : 0.6;
      return { type: "pick-result", confidence: pickConf, autoPick: ordinal };
    }
  }

  // ── 4. Section navigation: "go to the yuri section" ──
  const sectionMatch = lower.match(/(?:go\s+to|show\s+me|open|browse)\s+(?:the\s+)?([a-zA-Z0-9\s]+?)\s+(?:section|category|page|tab)\b/i);
  if (sectionMatch) {
    return { type: "section-nav", confidence: 0.9, section: sectionMatch[1].trim() };
  }

  // ══════════════════════════════════════════════════════════
  // 5. SITE + QUERY DETECTION
  //
  // Only handles simple, clear patterns:
  //   A. "look up QUERY on SITE"  / "search QUERY on SITE"
  //   B. "go to SITE and look up QUERY"
  //   C. "SITE QUERY"  (e.g. "rule34video eevee")
  //   D. "open SITE" / "go to SITE"
  //
  // The site name is resolved via fuzzy matching (handles
  // misspellings) + unknown site validation via HEAD request.
  // ══════════════════════════════════════════════════════════

  // Pattern A: "look up QUERY on/in/at SITE"
  const patternA = lower.match(/^(?:look\s*up|search\s*(?:for)?|find)\s+(.+?)\s+(?:on|in|at|from)\s+(\S+)\s*$/i);
  if (patternA) {
    const query = patternA[1].trim();
    const siteRaw = patternA[2].trim();
    const resolved = resolveSiteUrl(siteRaw);
    if (resolved && query.split(/\s+/).length <= 8) {
      return { type: "site-search", confidence: 0.9, site: resolved, siteName: siteRaw, query };
    }
  }

  // Pattern A2: "look up QUERY on SITE SITE" (multi-word site: "rule 34 video")
  const patternA2 = lower.match(/^(?:look\s*up|search\s*(?:for)?|find)\s+(.+?)\s+(?:on|in|at|from)\s+(.{2,})\s*$/i);
  if (patternA2) {
    const query = patternA2[1].trim();
    const siteRaw = patternA2[2].trim();
    // Only try if the "site" part is short (≤4 words) — anything longer is instructions
    if (siteRaw.split(/\s+/).length <= 4) {
      const fuzzy = fuzzyMatchSite(siteRaw);
      if (fuzzy && query.split(/\s+/).length <= 8) {
        return { type: "site-search", confidence: 0.9, site: fuzzy.url, siteName: fuzzy.name, query };
      }
    }
  }

  // Pattern B: "go to/open SITE and look up/search QUERY"
  const patternB = lower.match(/^(?:go\s*to|open|visit|browse)\s+(\S+)\s+(?:and|then)\s+(?:look\s*up|search\s*(?:for)?|find)\s+(.+)\s*$/i);
  if (patternB) {
    const siteRaw = patternB[1].trim();
    const query = patternB[2].trim();
    const resolved = resolveSiteUrl(siteRaw);
    if (resolved && query.split(/\s+/).length <= 8) {
      return { type: "site-search", confidence: 0.9, site: resolved, siteName: siteRaw, query };
    }
  }

  // Pattern C: "SITE QUERY" — implicit (e.g. "rule34video eevee", "pornhub milf")
  // Only if total ≤8 words and first 1-2 words fuzzy-match a known site
  if (wordCount >= 2 && wordCount <= 8) {
    const words = lower.split(/\s+/);
    // Try first 1-3 words as site name
    for (let i = 1; i <= Math.min(3, words.length - 1); i++) {
      const candidateSite = words.slice(0, i).join("");
      const fuzzy = fuzzyMatchSite(candidateSite);
      if (fuzzy) {
        const query = words.slice(i).join(" ");
        return { type: "site-search", confidence: 0.8, site: fuzzy.url, siteName: fuzzy.name, query };
      }
    }
    // Also try with spaces preserved (e.g. "rule 34 video" as 3 words)
    for (let i = 2; i <= Math.min(3, words.length - 1); i++) {
      const candidateSite = words.slice(0, i).join(" ");
      const fuzzy = fuzzyMatchSite(candidateSite);
      if (fuzzy) {
        const query = words.slice(i).join(" ");
        return { type: "site-search", confidence: 0.8, site: fuzzy.url, siteName: fuzzy.name, query };
      }
    }
  }

  // Pattern D: "open/go to SITE" (no query — just navigate)
  const patternD = lower.match(/^(?:open|go\s*to|visit|browse|navigate\s*to|head\s*to|check\s*out)\s+(\S+)\s*$/i);
  if (patternD) {
    const siteRaw = patternD[1].trim();
    const resolved = resolveSiteUrl(siteRaw);
    if (resolved) {
      return { type: "open-url", confidence: 0.9, site: resolved, siteName: siteRaw, url: resolved };
    }
  }

  // Pattern D2: multi-word site open ("open rule 34 video", "go to porn hub")
  const patternD2 = lower.match(/^(?:open|go\s*to|visit|browse)\s+(.{2,})\s*$/i);
  if (patternD2) {
    const siteRaw = patternD2[1].trim();
    if (siteRaw.split(/\s+/).length <= 4) {
      const fuzzy = fuzzyMatchSite(siteRaw);
      if (fuzzy) {
        return { type: "open-url", confidence: 0.9, site: fuzzy.url, siteName: fuzzy.name, url: fuzzy.url };
      }
      // Unknown site — construct candidate, let caller validate
      const resolved = resolveSiteUrl(siteRaw);
      if (resolved) {
        return { type: "open-url", confidence: 0.6, site: resolved, siteName: siteRaw, url: resolved };
      }
    }
  }

  // Nothing matched clearly — let the AI handle it
  return { type: "none", confidence: 0 };
}
