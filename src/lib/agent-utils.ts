import type { Conversation } from "@/types/chat";

// ── Ad / junk domain patterns (shared across all link filtering) ──
const AD_DOMAINS = /spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i;
const NAV_LINK_TEXT = /\b(login|sign|register|page|next|prev|tag|categor|sort|filter|lang|privacy|terms|dmca|contact|about|faq|help|home|menu|search|advanced)\b/i;
const SKIP_URL_PARTS = /\/(login|register|signup|tags|categories|members)\b/i;

// ── JS-heavy sites that need Puppeteer (BROWSE) instead of simple fetch ──
const JS_HEAVY_PATTERN = /\b(xvideos|pornhub|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|rule34video|twitter|x\.com|reddit|instagram|tiktok)\b/i;

// ── Video URL patterns ──
const VIDEO_URL_PATTERN = /\/(video|watch|view_video|clip)s?\b/i;
const VIDEO_QUERY_PATTERN = /view_video|viewkey|watch\?v=/i;

// ── Video site detection ──
const VIDEO_SITE_PATTERN = /\b(video|watch|view_video|clip|embed|play|rule34video|pornhub|xvideos|xhamster|redtube|tube8|spankbang|xnxx|youporn)\b/i;

export interface PageLink {
  url: string;
  text: string;
}

/**
 * Checks if a URL belongs to a JS-heavy site that needs Puppeteer.
 */
export function isJsHeavySite(url: string): boolean {
  return JS_HEAVY_PATTERN.test(url);
}

/**
 * Checks if a URL looks like a video page.
 */
export function isVideoUrl(url: string): boolean {
  return VIDEO_SITE_PATTERN.test(url);
}

/**
 * Resolves a potentially relative URL against a base URL.
 */
export function resolveRelativeUrl(url: string, baseUrl: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) {
    try {
      return new URL(baseUrl).origin + url;
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * Filters page links to find video-specific links (highest confidence).
 */
export function filterVideoLinks(links: PageLink[], contextUrl?: string): PageLink[] {
  return links.filter((l) => {
    const u = l.url.toLowerCase();
    try {
      const lu = new URL(l.url);
      if (lu.pathname === "/" || lu.pathname === "") return false;
    } catch {
      return false;
    }
    if (contextUrl && u === contextUrl.toLowerCase()) return false;
    if (AD_DOMAINS.test(u)) return false;
    if (SKIP_URL_PARTS.test(u)) return false;
    if (VIDEO_URL_PATTERN.test(u)) return true;
    if (VIDEO_QUERY_PATTERN.test(u)) return true;
    return false;
  });
}

/**
 * Filters page links to find broader content links (titles > 5 chars, not nav/ads).
 */
export function filterContentLinks(links: PageLink[], contextUrl?: string): PageLink[] {
  return links.filter((l) => {
    const u = l.url.toLowerCase();
    const t = l.text.toLowerCase();
    try {
      const lu = new URL(l.url);
      if (lu.pathname === "/" || lu.pathname === "") return false;
    } catch {
      return false;
    }
    if (contextUrl && u === contextUrl.toLowerCase()) return false;
    if (/^https?:\/\//i.test(t)) return false;
    if (AD_DOMAINS.test(u)) return false;
    if (NAV_LINK_TEXT.test(t) && t.length < 30) return false;
    if (SKIP_URL_PARTS.test(u)) return false;
    if (u.startsWith("#") || u.startsWith("javascript:")) return false;
    // Content pages by URL pattern
    if (/\/(video|watch|view|post|entry|clip|embed)s?\b/i.test(u)) return true;
    if (VIDEO_QUERY_PATTERN.test(u)) return true;
    // Links with meaningful text
    if (t.length > 10 && !/^\d+$/.test(t)) return true;
    return false;
  });
}

/**
 * Filters links as a last resort — any link with text > 5 chars that isn't junk.
 */
export function filterFallbackLinks(links: PageLink[], contextUrl?: string): PageLink[] {
  return links.filter((l) => {
    const u = l.url.toLowerCase();
    try {
      const lu = new URL(l.url);
      if (lu.pathname === "/" || lu.pathname === "") return false;
    } catch {
      return false;
    }
    if (contextUrl && u === contextUrl.toLowerCase()) return false;
    if (/^https?:\/\//i.test(l.text)) return false;
    if (AD_DOMAINS.test(u)) return false;
    return l.text.length > 5 && !/\b(login|sign|register|home|menu)\b/i.test(l.text);
  });
}

/**
 * Gets the best content links from a page — tries video links first, then content, then fallback.
 */
export function getBestContentLinks(links: PageLink[], contextUrl?: string): PageLink[] {
  const video = filterVideoLinks(links, contextUrl);
  if (video.length > 0) return video;
  const content = filterContentLinks(links, contextUrl);
  if (content.length > 0) return content;
  return filterFallbackLinks(links, contextUrl);
}

/**
 * Finds the most recent context URL from a conversation (tabs, sources, embeds, action tags).
 */
export function findContextUrl(conversation: Conversation): string {
  // Check tabs first (most recent browsing context)
  const tabs = conversation.tabs || [];
  if (tabs.length > 0) {
    const activeTab = tabs.find((t) => t.active) || tabs[tabs.length - 1];
    return activeTab.url;
  }
  // Check message history
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const msg = conversation.messages[i];
    if (msg.sources && msg.sources.length > 0) {
      return msg.sources[msg.sources.length - 1].url;
    }
    if (msg.webEmbeds && msg.webEmbeds.length > 0) {
      return msg.webEmbeds[msg.webEmbeds.length - 1].url;
    }
    const actionUrlMatch = msg.content.match(/\[ACTION:(?:READ_URL|OPEN_URL):([^\]]+)\]/);
    if (actionUrlMatch) {
      return actionUrlMatch[1].trim();
    }
  }
  return "";
}

/**
 * Parses ordinal text ("first", "2nd", "third") into a 0-based index. Returns -1 if no match.
 */
export function parseOrdinal(text: string): number {
  const numMatch = text.match(/(\d+)(?:st|nd|rd|th)/i);
  if (numMatch) return parseInt(numMatch[1], 10) - 1;

  const bareNum = text.trim().match(/^(\d+)$/);
  if (bareNum) return parseInt(bareNum[1], 10) - 1;

  const numberPick = text.match(/^(?:number|#|no\.?)\s*(\d+)$/i);
  if (numberPick) return parseInt(numberPick[1], 10) - 1;

  if (/\bfirst\b/i.test(text)) return 0;
  if (/\bsecond\b/i.test(text)) return 1;
  if (/\bthird\b/i.test(text)) return 2;
  if (/\bfourth\b/i.test(text)) return 3;
  if (/\bfifth\b/i.test(text)) return 4;
  if (/\bsixth\b/i.test(text)) return 5;
  if (/\bseventh\b/i.test(text)) return 6;
  if (/\beighth\b/i.test(text)) return 7;
  if (/\bninth\b/i.test(text)) return 8;
  if (/\btenth\b/i.test(text)) return 9;

  return -1;
}

/**
 * Returns the appropriate API endpoint for a URL (browse for JS-heavy, url for others).
 */
export function getApiEndpoint(url: string, type: "read" | "browse" = "read"): string {
  if (type === "browse" || isJsHeavySite(url)) {
    return "/api/browse";
  }
  return "/api/url";
}
