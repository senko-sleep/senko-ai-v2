/**
 * URL Resolution — Fabricated URL Detection & Resolution
 * 
 * Extracted from processActions in page.tsx.
 * Pure logic for detecting AI-fabricated URLs and resolving them
 * to real content links on the target page.
 */

/**
 * Detect if a URL was fabricated by the AI (made-up path with English words).
 * Real video/content URLs have numeric IDs or short hashes, not descriptive English words.
 */
export function isFabricatedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathAndQuery = parsed.pathname + parsed.search;
    // Skip well-known search patterns — these are constructed, not fabricated
    if (/[?&](?:q|query|search_query|search|s|k)=/i.test(parsed.search)) return false;
    // Skip homepage/root paths
    if (parsed.pathname === "/" || parsed.pathname === "") return false;
    // Check for descriptive English words in path segments or query values
    // Real IDs: /video/12345, /view_video.php?viewkey=ph5f3a2b1c, /watch?v=dQw4w9WgXcQ
    // Fake IDs: /video/eevee-first-video, /view_video.php?viewkey=eevee-pokemon-animation
    const suspiciousSegments = pathAndQuery.match(/(?:viewkey|id|v|video|watch|view)=([^&]+)/i) ||
      pathAndQuery.match(/\/(?:video|watch|view|post|entry)\/([^/?]+)/i);
    if (suspiciousSegments) {
      const idPart = decodeURIComponent(suspiciousSegments[1]);
      // Real IDs are typically: numeric (12345), hex (5f3a2b1c), alphanumeric (dQw4w9WgXcQ)
      // Fake IDs contain multiple English words separated by hyphens/underscores
      const words = idPart.split(/[-_+]/).filter(w => w.length > 2);
      const englishWords = words.filter(w => /^[a-z]+$/i.test(w) && w.length > 3);
      // If more than 1 English word in the ID, it's likely fabricated
      if (englishWords.length >= 2) {
        console.log(`%c[FABRICATION] 🚨 Detected fabricated URL ID: "${idPart}" (${englishWords.length} English words)`, "color: #ff4444; font-weight: bold");
        return true;
      }
    }
    return false;
  } catch { return false; }
}

/** Check if a link is an ad/signup/nav junk link */
export function isJunkLink(url: string, text: string, fetchUrl?: string, baseUrl?: string): boolean {
  const u = url.toLowerCase();
  const t = text.toLowerCase();
  // Skip account/signup/login URLs
  if (/\/account|\/create|\/signup|\/login|\/register|\/join|\/subscribe|\/premium|\/upgrade/i.test(u)) return true;
  // Skip ad/tracker URLs
  if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare|popads|adsterra/i.test(u)) return true;
  // Skip nav/utility links by text
  if (/\b(join|sign\s*up|sign\s*in|log\s*in|register|create\s*account|free\s*account|subscribe|premium|upgrade)\b/i.test(t)) return true;
  // Skip self-links
  try { const lu = new URL(url); if (lu.pathname === "/" || lu.pathname === "") return true; } catch { /* skip */ }
  if (fetchUrl && u === fetchUrl.toLowerCase()) return true;
  if (baseUrl && u === baseUrl.toLowerCase()) return true;
  // Skip same-page anchors and javascript
  if (u.startsWith("#") || u.startsWith("javascript:")) return true;
  return false;
}

/** Extract the target index from a user message ("3rd video" → 2, "first" → 0, etc.) */
export function extractTargetIndex(userMessage: string): number {
  const numMatch = userMessage.match(/(\d+)(?:st|nd|rd|th)/i);
  if (numMatch) return parseInt(numMatch[1], 10) - 1;
  if (/\bfirst\b/i.test(userMessage)) return 0;
  if (/\bsecond\b/i.test(userMessage)) return 1;
  if (/\bthird\b/i.test(userMessage)) return 2;
  if (/\bfourth\b/i.test(userMessage)) return 3;
  if (/\bfifth\b/i.test(userMessage)) return 4;
  return 0;
}

interface LinkItem {
  url: string;
  text: string;
}

/** Filter links into video-specific, content, and general categories */
export function categorizeLinks(
  links: LinkItem[],
  fetchUrl: string,
  baseUrl: string
): { videoLinks: LinkItem[]; contentLinks: LinkItem[]; fallbackLinks: LinkItem[] } {
  // First pass: video-specific URL patterns (highest confidence)
  const videoLinks = links.filter((l) => {
    if (isJunkLink(l.url, l.text, fetchUrl, baseUrl)) return false;
    const u = l.url.toLowerCase();
    if (/\/(video|watch|view_video|clip)s?\b/i.test(u)) return true;
    if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
    return false;
  });

  // Second pass: broader content links
  const contentLinks = videoLinks.length > 0 ? videoLinks : links.filter((l) => {
    if (isJunkLink(l.url, l.text, fetchUrl, baseUrl)) return false;
    const u = l.url.toLowerCase();
    const t = l.text.toLowerCase();
    if (/^https?:\/\//i.test(t)) return false;
    if (/\b(page|next|prev|tag|categor|sort|filter|lang|privacy|terms|dmca|contact|about|faq|help|home|menu|search)\b/i.test(t) && t.length < 30) return false;
    if (u.includes("/tags") || u.includes("/categories") || u.includes("/members")) return false;
    if (/\/(video|watch|view|post|entry|clip|embed)s?\b/i.test(u)) return true;
    if (/view_video|viewkey|watch\?/i.test(u)) return true;
    if (t.length > 10 && !(/^\d+$/.test(t))) return true;
    return false;
  });

  // Third pass: anything with meaningful text
  const fallbackLinks = contentLinks.length > 0 ? contentLinks : links.filter((l) => {
    if (isJunkLink(l.url, l.text, fetchUrl, baseUrl)) return false;
    if (/^https?:\/\//i.test(l.text)) return false;
    return l.text.length > 5;
  });

  return { videoLinks, contentLinks, fallbackLinks };
}

/** Score a link against hint words (title matching). Returns 0-1. */
function scoreMatch(hintWords: string[], linkText: string): number {
  if (hintWords.length === 0) return 0;
  const normalized = linkText.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const matchedWords = hintWords.filter(w => normalized.includes(w));
  return matchedWords.length / hintWords.length;
}

/** Find the best matching link from candidates using title hint, URL path, and message context */
export function findBestMatch(
  targetLinks: LinkItem[],
  options: {
    titleHint?: string;
    fabricatedUrl?: string;
    recentBoldTexts?: string[];
  }
): LinkItem | null {
  if (targetLinks.length === 0) return null;

  const MIN_SCORE = 0.4;

  // Strategy 1: Match by title hint
  if (options.titleHint) {
    const hint = options.titleHint.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const hintWords = hint.split(/\s+/).filter(w => w.length > 2);
    if (hintWords.length > 0) {
      let bestScore = 0;
      let bestLink: LinkItem | null = null;
      for (const link of targetLinks) {
        const score = scoreMatch(hintWords, link.text);
        if (score > bestScore) {
          bestScore = score;
          bestLink = link;
        }
      }
      if (bestScore >= MIN_SCORE && bestLink) {
        console.log(`%c[FABRICATION] 🎯 Title-matched: "${options.titleHint}" -> "${bestLink.text}" (score: ${bestScore})`, "color: #00ff88; font-weight: bold");
        return bestLink;
      }
    }
  }

  // Strategy 2: Match by URL path keywords
  if (options.fabricatedUrl) {
    try {
      const parsed = new URL(options.fabricatedUrl);
      const pathSegments = parsed.pathname.split("/").filter(s => s.length > 0);
      const lastSegment = pathSegments[pathSegments.length - 1] || "";
      const urlWords = decodeURIComponent(lastSegment)
        .replace(/[-_+]/g, " ").toLowerCase()
        .split(/\s+/).filter(w => w.length > 2 && /^[a-z]+$/.test(w));
      if (urlWords.length >= 2) {
        let bestScore = 0;
        let bestLink: LinkItem | null = null;
        for (const link of targetLinks) {
          const score = scoreMatch(urlWords, link.text);
          if (score > bestScore) {
            bestScore = score;
            bestLink = link;
          }
        }
        if (bestScore >= MIN_SCORE && bestLink) {
          console.log(`%c[FABRICATION] 🎯 URL-path-matched: "${lastSegment}" -> "${bestLink.text}" (score: ${bestScore})`, "color: #00ff88; font-weight: bold");
          return bestLink;
        }
      }
    } catch { /* skip */ }
  }

  // Strategy 3: Match from recent bold/bracketed text in AI messages
  if (options.recentBoldTexts) {
    for (const candidate of options.recentBoldTexts) {
      if (candidate.length < 5) continue;
      const candidateWords = candidate.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim()
        .split(/\s+/).filter(w => w.length > 2);
      if (candidateWords.length === 0) continue;
      let bestScore = 0;
      let bestLink: LinkItem | null = null;
      for (const link of targetLinks) {
        const score = scoreMatch(candidateWords, link.text);
        if (score > bestScore) {
          bestScore = score;
          bestLink = link;
        }
      }
      if (bestScore >= MIN_SCORE && bestLink) {
        console.log(`%c[FABRICATION] 🎯 Message-title-matched: "${candidate}" -> "${bestLink.text}" (score: ${bestScore})`, "color: #00ff88; font-weight: bold");
        return bestLink;
      }
    }
  }

  return null;
}

/** Extract bold (**text**) and bracketed ([text]) strings from AI message content */
export function extractTitleCandidates(content: string): string[] {
  const boldMatches = [...content.matchAll(/\*\*(.+?)\*\*/g)].map(m => m[1]);
  const bracketMatches = [...content.matchAll(/\[([^\]]{5,})\]/g)]
    .map(m => m[1])
    .filter(t => !t.startsWith("ACTION:"));
  return [...boldMatches, ...bracketMatches];
}
