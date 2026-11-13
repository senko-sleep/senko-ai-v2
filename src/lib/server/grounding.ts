/**
 * Live Grounding Helper for Universal AI-Generated UI
 *
 * Retrieves real-time or verified grounding context for:
 * 1. YouTube queries (distinguishing currently trending, all-time most viewed,
 *    recent popular, most liked, and category-specific queries).
 * 2. Current news / breaking headlines via Google News RSS.
 * 3. Entity / character / person lookups — web-searched snippets so the AI can
 *    produce a rich, accurate profile UI without hallucinating facts.
 *
 * Never fabricates live statistics; if live retrieval is blocked or offline,
 * returns an explicit limitation note so the AI communicates it transparently.
 */

import { searchYouTube, verifyYouTubeVideo } from "./youtube";

export type YouTubeQueryIntent =
  | "trending_now"
  | "all_time_most_viewed"
  | "recent_popular"
  | "most_liked"
  | "category_specific";

export interface GroundedYouTubeVideo {
  videoId: string;
  title: string;
  channel: string;
  views?: string;
  likes?: string;
  publishedAt?: string;
  duration?: string;
  category?: string;
  url: string;
  thumbnailUrl: string;
}

const VERIFIED_ALL_TIME_YOUTUBE: GroundedYouTubeVideo[] = [
  {
    videoId: "XqZsoesa55w",
    title: "Baby Shark Dance",
    channel: "Pinkfong Baby Shark - Kids' Songs & Stories",
    views: "15.4B+",
    likes: "45M+",
    publishedAt: "Jun 17, 2016",
    duration: "2:17",
    category: "Kids & Music",
    url: "https://www.youtube.com/watch?v=XqZsoesa55w",
    thumbnailUrl: "https://i.ytimg.com/vi/XqZsoesa55w/hqdefault.jpg",
  },
  {
    videoId: "kJQP7kiw5Fk",
    title: "Despacito",
    channel: "Luis Fonsi ft. Daddy Yankee",
    views: "8.6B+",
    likes: "54M+",
    publishedAt: "Jan 12, 2017",
    duration: "4:42",
    category: "Music",
    url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
    thumbnailUrl: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
  },
  {
    videoId: "F4tHL8reNCs",
    title: "Johny Johny Yes Papa",
    channel: "LooLoo Kids",
    views: "7.0B+",
    likes: "21M+",
    publishedAt: "Oct 8, 2016",
    duration: "1:40",
    category: "Kids",
    url: "https://www.youtube.com/watch?v=F4tHL8reNCs",
    thumbnailUrl: "https://i.ytimg.com/vi/F4tHL8reNCs/hqdefault.jpg",
  },
  {
    videoId: "WRVsOCh907o",
    title: "Bath Song",
    channel: "Cocomelon - Nursery Rhymes",
    views: "6.9B+",
    likes: "18M+",
    publishedAt: "May 2, 2018",
    duration: "1:52",
    category: "Kids",
    url: "https://www.youtube.com/watch?v=WRVsOCh907o",
    thumbnailUrl: "https://i.ytimg.com/vi/WRVsOCh907o/hqdefault.jpg",
  },
  {
    videoId: "RgKAFK5djSk",
    title: "See You Again",
    channel: "Wiz Khalifa ft. Charlie Puth",
    views: "6.5B+",
    likes: "44M+",
    publishedAt: "Apr 6, 2015",
    duration: "3:58",
    category: "Music",
    url: "https://www.youtube.com/watch?v=RgKAFK5djSk",
    thumbnailUrl: "https://i.ytimg.com/vi/RgKAFK5djSk/hqdefault.jpg",
  },
  {
    videoId: "JGwWNGJdvx8",
    title: "Shape of You",
    channel: "Ed Sheeran",
    views: "6.4B+",
    likes: "34M+",
    publishedAt: "Jan 30, 2017",
    duration: "4:24",
    category: "Music",
    url: "https://www.youtube.com/watch?v=JGwWNGJdvx8",
    thumbnailUrl: "https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg",
  },
];

export function classifyYouTubeIntent(userText: string): {
  isYouTubeQuery: boolean;
  intent: YouTubeQueryIntent;
  label: string;
  searchQuery?: string;
} {
  const lower = userText.toLowerCase();
  if (!/\b(youtube|yt\s+video|trending\s+video|most\s+viewed\s+video|popular\s+video)\b/i.test(lower)) {
    return { isYouTubeQuery: false, intent: "trending_now", label: "" };
  }

  if (/\b(all[- ]time|ever|in\s+history|most[- ]viewed\s+of\s+all)\b/i.test(lower)) {
    return {
      isYouTubeQuery: true,
      intent: "all_time_most_viewed",
      label: "Most-Viewed YouTube Videos of All Time",
    };
  }
  if (/\b(most[- ]liked)\b/i.test(lower)) {
    return {
      isYouTubeQuery: true,
      intent: "most_liked",
      label: "Most-Liked YouTube Videos",
    };
  }
  const catMatch = /\b(gaming|music|tech|technology|science|anime|coding|programming|sports|movies|news)\b/i.exec(lower);
  if (catMatch) {
    const cat = catMatch[1];
    return {
      isYouTubeQuery: true,
      intent: "category_specific",
      label: `Popular YouTube Videos — ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
      searchQuery: `${cat} trending popular videos`,
    };
  }
  if (/\b(this\s+week|this\s+month|this\s+year|recently|recent)\b/i.test(lower)) {
    return {
      isYouTubeQuery: true,
      intent: "recent_popular",
      label: "Most-Viewed Recent YouTube Videos",
      searchQuery: "trending videos this week",
    };
  }
  return {
    isYouTubeQuery: true,
    intent: "trending_now",
    label: "Currently Trending / Popular YouTube Videos",
    searchQuery: "trending videos right now",
  };
}

export interface GroundedNewsItem {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  category?: string;
}

async function fetchGoogleNewsRss(topicQuery: string, signal?: AbortSignal): Promise<GroundedNewsItem[]> {
  const rssUrl = topicQuery
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(topicQuery)}&hl=en-US&gl=US&ceid=US:en`
    : "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(rssUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SenkoBot/1.0)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: GroundedNewsItem[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) !== null && items.length < 8) {
      const block = m[1];
      const rawTitle = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block)?.[1]?.trim() || "";
      const link = /<link>([\s\S]*?)<\/link>/i.exec(block)?.[1]?.trim() || "";
      const pubDate = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1]?.trim() || "";
      const source = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(block)?.[1]?.trim() || "";
      if (!rawTitle) continue;
      const cleanTitle = rawTitle
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/ - [^-]+$/, "")
        .trim();
      items.push({
        title: cleanTitle || rawTitle,
        source: source || "News Wire",
        publishedAt: pubDate ? pubDate.replace(/\s+\d{2}:\d{2}:\d{2}\s+GMT$/, "") : "Recent",
        url: link,
      });
    }
    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function gatherLiveGroundingNote(
  userText: string,
  signal?: AbortSignal,
  onStep?: (step: { id: number; label: string; status: "running" | "done" | "error"; detail?: string }) => void,
  opts?: { composedUI?: boolean }
): Promise<string> {
  if (!userText || process.env.SENKO_DISABLE_WEB_GROUNDING === "1") return "";

  let stepId = 0;
  const step = (label: string, status: "running" | "done" | "error", detail?: string) => {
    onStep?.({ id: stepId++, label, status, detail });
  };

  // 1. Check YouTube intent
  const yt = classifyYouTubeIntent(userText);
  if (yt.isYouTubeQuery) {
    if (yt.intent === "all_time_most_viewed" || yt.intent === "most_liked") {
      step("Loading verified all-time YouTube records", "done");
      return (
        `\n\n[GROUNDED YOUTUBE DATA — ${yt.label}]\n` +
        `Interpretation detected: "${yt.label}". Use \`video_grid\` with \`dataStatus: "historical"\` and \`interpretation: "${yt.label}"\`.\n` +
        `Verified all-time records (DO NOT invent fake live view counts):\n` +
        JSON.stringify(VERIFIED_ALL_TIME_YOUTUBE, null, 2)
      );
    }

    // Use searchYouTube() — results verified via oEmbed before presenting.
    step(`Searching YouTube for "${yt.searchQuery ?? "trending videos"}"`, "running");
    const outcome = await searchYouTube(
      {
        query: yt.searchQuery ?? "trending videos right now",
        sort: "relevance",
        limit: 8,
      },
      { signal, verify: verifyYouTubeVideo }
    ).catch(() => null);

    if (outcome?.ok && outcome.results.length >= 3) {
      step(`Found ${outcome.results.length} verified videos`, "done", outcome.source);
      return (
        `\n\n[LIVE YOUTUBE DATA RETRIEVED — ${yt.label}]\n` +
        `Interpretation detected: "${yt.label}". Source: ${outcome.source}. Render a \`video_grid\` component with \`dataStatus: "live"\` and \`interpretation: "${yt.label}"\` using these real retrieved videos (preserve their exact videoId, title, channel, and url; never invent statistics):\n` +
        JSON.stringify(outcome.results, null, 2)
      );
    }

    return (
      `\n\n[YOUTUBE DATA LIMITATION NOTICE — ${yt.label}]\n` +
      `Live YouTube trending telemetry could not be retrieved in this environment. ` +
      `CRITICAL RULE: NEVER invent live view counts, current #1 trending rankings, or fake popularity statistics. ` +
      `Instead, render a \`video_grid\` with \`dataStatus: "historical"\`, \`interpretation: "${yt.label} (Verified All-Time Reference — Live Feed Unavailable)"\`, and \`statusNote: "Live YouTube trending feed could not be reached right now; showing verified all-time most-viewed YouTube videos for reference."\` using these real verified videos:\n` +
      JSON.stringify(VERIFIED_ALL_TIME_YOUTUBE, null, 2)
    );
  }

  // 2. Check News / Current Events intent
  const isNewsQuery = /\b(latest\s+.*news|news\s+today|breaking\s+news|current\s+events|what\s+happened\s+in\s+the\s+news|headlines\s+today|tech(?:nology)?\s+news|science\s+news|world\s+news)\b/i.test(
    userText
  );
  if (isNewsQuery) {
    const topicMatch = /\b(technology|tech|science|ai|business|gaming|world|sports|entertainment|space)\b/i.exec(userText);
    const topic = topicMatch ? `${topicMatch[1]} news` : "";
    const articles = await fetchGoogleNewsRss(topic, signal);
    if (articles.length >= 2) {
      return (
        `\n\n[LIVE NEWS HEADLINES RETRIEVED]\n` +
        `Use a \`news_feed\` component with \`dataStatus: "live"\` and populate it ONLY with these real retrieved headlines, sources, timestamps, and URLs (never fabricate headlines or URLs):\n` +
        JSON.stringify(articles, null, 2)
      );
    }
    return (
      `\n\n[LIVE NEWS LIMITATION NOTICE]\n` +
      `Live news RSS feed could not be reached right now. CRITICAL RULE: Do NOT fabricate breaking headlines, timestamps, or fake news URLs. Clearly state that live news retrieval is currently unavailable and offer to discuss major recent themes or analyze a specific article/link provided by the user.`
    );
  }

  return "";
}

// ─── Entity / character / person web-search grounding ────────────────────────

export interface WebSnippet {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Extracts the entity/character name the user wants to look up from a combined
 * "who is X ... and make the ui" message.  Returns null when no recognisable
 * entity lookup pattern is found.
 */
export function extractEntityQuery(userText: string): string | null {
  const lower = userText.toLowerCase();

  // Everyday questions ("what time is it", "weather today") are not a subject to research.
  if (/\b(?:what\s+time|time\s+is\s+it|what\s+day|what(?:'s|\s+is)\s+(?:the\s+)?date|today|tonight|tomorrow|right\s+now|weather|forecast|temperature)\b/i.test(userText)) return null;
  // Reject common non-entity "what is X" queries early
  if (/\bwhat\s+is\s+(?:the\s+)?(?:weather|time|date|temperature|capital|currency|population|distance|difference|definition|meaning|synonym)\b/i.test(userText)) return null;
  if (/\bwrite\s+(?:me\s+)?(?:a|an)\s+\w+\b/i.test(userText)) return null;

  // "who is X", "what is X" (entity-specific, not generic facts)
  const whoIs = /\b(?:who|what)\s+is\s+([A-Za-z0-9 '\-]{2,60}?)(?:\s*[,?.!]|\s+and\b|\s+look|\s+make|\s+show|\s+create|\s+build|\s+generate|\s+(?:us|use|using|with|in|as|via)?\s*(?:an?\s+|the\s+)?(?:ui|interface)\b|\s*$)/i.exec(userText);
  if (whoIs) {
    const candidate = whoIs[1].trim();
    // Reject generic/common noun phrases (single common words, weather, etc.)
    if (/^(?:the|a|an|this|that|it|he|she|they|we|you|i|me)\b/i.test(candidate)) return null;
    if (candidate.split(" ").length === 1 && /^(?:weather|time|date|love|life|death|war|peace|art|music|math|science|history|politics|religion|philosophy)\b/i.test(candidate)) return null;
    return candidate;
  }

  const lookUp = /\b(?:look\s+(?:it\s+)?up|search(?:\s+for)?|find|tell\s+me\s+about|info(?:rmation)?\s+(?:on|about))\s+([A-Za-z0-9 '\-]{2,60}?)(?:\s*[,?.!]|\s+and\b|\s+look|\s+make|\s+show|\s+create|\s+build|\s+generate|\s*$)/i.exec(userText);
  if (lookUp) return lookUp[1].trim();

  // "X profile", "X wiki", "X character" — often the subject comes before the UI ask
  if (/\b(profile|wiki|character|info|card|page)\b/i.test(lower)) {
    const beforeUI = userText.replace(/\b(create|make|show|generate|build|design|render)\s+(the\s+)?(ui|interface|card|profile|page)\b.*/i, "").trim();
    if (beforeUI && beforeUI.length < 80 && beforeUI !== userText) return beforeUI.trim();
  }

  // "make a ui for X", "build a ui showing goku", "X ui please": remove the request words and keep the subject.
  if (/\b(?:ui|interface|infographic|profile|infobox)\b/i.test(userText)) {
    const subject = userText
      .replace(/\b(?:please|pls|can you|could you|i want|i need|give me|for me|now|thanks?)\b/gi, " ")
      .replace(/\b(?:create|make|build|generate|design|render|show(?:ing)?|do|draw|code)\b/gi, " ")
      .replace(/\b(?:me|an?|the|some|nice|cool|beautiful|clean|good|rich|interactive|themed|custom|full|detailed|dynamic)\b/gi, " ")
      .replace(/\b(?:ui|interface|infographic|profile|infobox|page|card|wiki|layout|design)\b/gi, " ")
      .replace(/\b(?:for|of|about|on|with|that shows|showing)\b/gi, " ")
      .replace(/[^\p{L}\p{N}'\- ]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = subject.split(" ").filter(Boolean);
    // A real subject is a short name-like phrase, not leftover sentence.
    // A leftover question ("what time is it in") is not a name either.
    if (/^(?:what|how|when|where|why|which|is|are|can|could|do|does|will|should)\b/i.test(subject)) return null;
    if (words.length >= 1 && words.length <= 5 && subject.length >= 3 && !/^(?:it|this|that|something|anything|everything|data|stats|dashboard|app|website|game|pokedex|encyclopedia|wiki|tracker|calculator|quiz|timer|todo|calendar|weather)$/i.test(subject)) return subject;
  }

  return null;
}

/**
 * Fetches real web-search snippets for an entity name from the configured
 * search proxy or by directly hitting DuckDuckGo / Bing HTML.
 * Returns up to `limit` snippets or an empty array on failure.
 */
export async function fetchEntityWebSnippets(
  entityQuery: string,
  signal?: AbortSignal,
  limit = 6
): Promise<WebSnippet[]> {
  const searchApiUrl = process.env.SEARCH_API_URL;
  const deadline = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;

  // Try the app's own search proxy first (Render/Railway sidecar avoids scraping blocks)
  if (searchApiUrl) {
    try {
      const res = await fetch(
        `${searchApiUrl}/search?q=${encodeURIComponent(entityQuery + " wiki")}&safe=off`,
        { signal: combined }
      );
      if (res.ok) {
        const data = (await res.json()) as { results?: WebSnippet[] };
        if (Array.isArray(data.results) && data.results.length > 0) {
          return data.results.slice(0, limit);
        }
      }
    } catch { /* fall through */ }
  }

  // Direct DuckDuckGo HTML scraping (works from Node, often blocked on serverless)
  for (const url of [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(entityQuery + " wiki character")}&kp=-2`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(entityQuery + " wiki character")}&kp=-2`,
  ]) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SenkoBot/1.0)", Accept: "text/html" },
        signal: combined,
      });
      if (!res.ok) continue;
      const html = await res.text();
      const snippets = parseDDGSnippets(html, limit);
      if (snippets.length > 0) return snippets;
    } catch { /* next engine */ }
  }

  // Direct Bing HTML scraping fallback
  try {
    const res = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(entityQuery + " wiki character")}&safeSearch=Off`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; SenkoBot/1.0)", Accept: "text/html", Referer: "https://www.bing.com/" }, signal: combined }
    );
    if (res.ok) {
      const html = await res.text();
      const snippets = parseBingSnippets(html, limit);
      if (snippets.length > 0) return snippets;
    }
  } catch { /* give up */ }

  return [];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function decodeDDGUrl(raw: string): string {
  try {
    const clean = raw.replace(/&amp;/g, "&");
    const decoded = decodeURIComponent(clean);
    if (decoded.startsWith("/") || decoded.startsWith("//")) {
      const uddg = new URL(`https://duckduckgo.com${decoded}`);
      return uddg.searchParams.get("uddg") || raw;
    }
    if (decoded.startsWith("http")) return decoded;
  } catch { /* ignore */ }
  return raw;
}

function parseDDGSnippets(html: string, limit: number): WebSnippet[] {
  const results: WebSnippet[] = [];
  const combined = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(html)) !== null && results.length < limit) {
    const url = decodeDDGUrl(m[1]);
    const title = stripHtml(m[2]);
    const snippet = stripHtml(m[3]);
    if (title && url.startsWith("http")) results.push({ title, url, snippet });
  }
  return results;
}

function parseBingSnippets(html: string, limit: number): WebSnippet[] {
  const results: WebSnippet[] = [];
  const algo = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<p[^>]*>(.*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = algo.exec(html)) !== null && results.length < limit) {
    const url = m[1];
    const title = stripHtml(m[2]);
    const snippet = stripHtml(m[3]);
    if (title && url) results.push({ title, url, snippet });
  }
  return results;
}

/**
 * Returns a grounding note for entity/character/person UI requests.
 * Searches the web for real facts and injects them so the LLM can generate
 * a fully populated profile/UI without inventing data.
 */
export async function gatherEntityGroundingNote(
  entityQuery: string,
  signal?: AbortSignal,
  onStep?: (step: { id: number; label: string; status: "running" | "done" | "error"; detail?: string }) => void
): Promise<string> {
  if (!entityQuery) return "";
  onStep?.({ id: 0, label: `Looking up "${entityQuery}"`, status: "running" });
  const snippets = await fetchEntityWebSnippets(entityQuery, signal);
  if (snippets.length === 0) {
    onStep?.({ id: 0, label: `Looking up "${entityQuery}"`, status: "error", detail: "No search results" });
    return (
      `\n\n[ENTITY LOOKUP — "${entityQuery}" — SEARCH UNAVAILABLE]\n` +
      `Web search could not be reached. Use your parametric knowledge about "${entityQuery}" to generate the richest possible UI. ` +
      `Fill the profile with real attributes, bio, traits, abilities, relationships, and appearances from your training data. ` +
      `Use imageQuery with the character name + series/context (e.g. "${entityQuery} official artwork") to fetch real images. ` +
      `Never invent URLs, statistics, or facts you are not confident about.`
    );
  }
  onStep?.({ id: 0, label: `Found ${snippets.length} results for "${entityQuery}"`, status: "done" });
  return (
    `\n\n[WEB SEARCH RESULTS — "${entityQuery}"]\n` +
    `Use these real web snippets as your factual source. Extract all available information (description, role, attributes, relationships, ` +
    `media appearances, trivia) from them and populate a rich, comprehensive UI node (use "profile" for characters/people, plus supporting ` +
    `sections like "timeline", "key_value", "stat_grid", "gallery" etc. inside a "stack"). ` +
    `Use imageQuery with specific keywords (e.g. "${entityQuery} official artwork") — NEVER invent imageUrl values.\n` +
    `Web results:\n` +
    snippets.map((s, i) => `${i + 1}. [${s.title}](${s.url})\n   ${s.snippet}`).join("\n\n")
  );
}
