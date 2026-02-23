/**
 * Shared browsing/navigation helpers — deduplicated from page.tsx
 * Used by processActions, handleSendMessage interceptors, and fetchSearchResults
 */

import type { Message, Conversation } from "@/types/chat";

// ── Ad/tracker URL pattern (used everywhere) ──
export const AD_LINK_PATTERN = /\b(doubleclick|googlesyndication|googleadservices|adsystem|adserver|adclick|clicktrack|tracker|pagead|pubads|syndication|taboola|outbrain|mgid|exoclick|exosrv|juicyads|trafficjunky|trafficstars|popunder|popads|clickadu|adsterra|propellerads|popcash|hilltopads|adcash|clickaine|revcontent|zergnet|disqus\.com|facebook\.com\/tr|analytics|pixel|beacon|imp\?|\/ad\/|\/ads\/|\/adx\/|banner|sponsor|spankurbate|rule34comic|adglare)\b/i;

// ── JS-heavy sites that need Puppeteer browsing ──
export const JS_HEAVY_SITES = /\b(xvideos|pornhub|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|hentaihaven|hanime|iwara|rule34video|dailymotion|vimeo|bitchute|rumble|streamable|twitch|tiktok|instagram|twitter|x\.com|facebook|reddit)\b/i;

// ── Video site URL pattern ──
export const VIDEO_SITE_PATTERN = /\b(rule34video|pornhub|xvideos|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|hentaihaven|hanime|iwara|dailymotion|vimeo|bitchute|rumble)\b/i;

// ── Filter video-specific links from a page's link list ──
export function filterVideoLinks(links: { url: string; text: string }[], skipUrl?: string): { url: string; text: string }[] {
  return links.filter((l) => {
    const u = l.url.toLowerCase();
    try {
      const lu = new URL(l.url);
      if (lu.pathname === "/" || lu.pathname === "") return false;
    } catch { return false; }
    if (skipUrl && u === skipUrl.toLowerCase()) return false;
    if (AD_LINK_PATTERN.test(u)) return false;
    if (u.includes("/login") || u.includes("/register") || u.includes("/signup") || u.includes("/tags") || u.includes("/categories") || u.includes("/members")) return false;
    if (/\/(video|watch|view_video|clip)s?\b/i.test(u)) return true;
    if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
    return false;
  });
}

// ── Filter broader content links (fallback when no video links found) ──
export function filterContentLinks(links: { url: string; text: string }[], skipUrl?: string): { url: string; text: string }[] {
  const videoLinks = filterVideoLinks(links, skipUrl);
  if (videoLinks.length > 0) return videoLinks;

  return links.filter((l) => {
    const u = l.url.toLowerCase();
    const t = l.text.toLowerCase();
    try {
      const lu = new URL(l.url);
      if (lu.pathname === "/" || lu.pathname === "") return false;
    } catch { return false; }
    if (skipUrl && u === skipUrl.toLowerCase()) return false;
    if (/^https?:\/\//i.test(t)) return false;
    if (AD_LINK_PATTERN.test(u)) return false;
    if (/\b(login|sign|register|page|next|prev|tag|categor|sort|filter|lang|privacy|terms|dmca|contact|about|faq|help|home|menu|search|advanced)\b/i.test(t) && t.length < 30) return false;
    if (u.includes("/login") || u.includes("/register") || u.includes("/signup") || u.includes("/tags") || u.includes("/categories") || u.includes("/members")) return false;
    if (u.startsWith("#") || u.startsWith("javascript:")) return false;
    if (/\/(video|watch|view|post|entry|clip|embed)s?\b/i.test(u)) return true;
    if (/view_video|viewkey|watch\?/i.test(u)) return true;
    if (t.length > 5 && !(/^\d+$/.test(t))) return true;
    return false;
  });
}

// ── Find the most recent context URL from conversation history ──
export function getContextUrl(conv: Conversation | undefined, searchResults?: { url: string }[]): string {
  if (!conv) return "";

  // Check tabs first (most recent browsing context)
  const tabs = conv.tabs || [];
  if (tabs.length > 0) {
    const activeTab = tabs.find((t) => t.active) || tabs[tabs.length - 1];
    if (activeTab.url) return activeTab.url;
  }

  // Check message history for sources, webEmbeds, or action tags
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const msg = conv.messages[i];
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

  // Fallback to search results
  if (searchResults && searchResults.length > 0) {
    return searchResults[0].url;
  }

  return "";
}

// ── Normalize video URL for deduplication ──
export function normalizeVideoUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const fileParam = u.searchParams.get("file") || u.searchParams.get("url");
    if (fileParam) {
      const decoded = decodeURIComponent(fileParam).toLowerCase();
      const fname = decoded.match(/([^/]+\.(?:mp4|webm|m3u8|mpd|ogg|mov))$/i)?.[1];
      if (fname) return fname;
      const segments = decoded.split("/").filter(Boolean);
      if (segments.length > 0) return segments[segments.length - 1];
    }
    const pathFilename = path.match(/([^/]+\.(?:mp4|webm|m3u8|mpd|ogg|mov))$/i)?.[1];
    if (pathFilename) return pathFilename;
    return `${u.hostname}${path}`;
  } catch {
    return url.split("?")[0].toLowerCase();
  }
}

// ── Filter playable video sources from a list ──
export function filterPlayableVideos(videos: { url: string; type?: string }[]): { url: string; type?: string }[] {
  return videos.filter((v) => {
    const u = v.url.toLowerCase();
    // Skip get_file URLs (KVS sites — need browser cookies)
    if (/\/get_file\//i.test(u)) return false;
    // Skip known ad domains
    if (/\b(banhq|otcagpqmeoqb|eunow4u)\b/i.test(u)) return false;
    // Skip screenshot/thumbnail URLs that look like videos (e.g., preview.mp4.jpg)
    if (/\.(mp4|webm|m3u8|mpd|ogg|mov)\.(jpg|jpeg|png|gif|webp)\b/i.test(u)) return false;
    if (/videos_screenshots|preview_|thumbnail/i.test(u)) return false;
    // Accept real video URLs
    if (/\.(mp4|webm|m3u8|mpd|ogg|mov)\b/i.test(u)) return true;
    if (/^video\//i.test(v.type || "") || /mpegurl|dash/i.test(v.type || "")) return true;
    // Accept CDN video URLs (boomio, remote_control, etc.)
    if (/boomio-cdn\.com|remote_control\.php/i.test(u)) return true;
    if (/[?&]file=.*%2Fvideos%2F/i.test(u) || /[?&]file=.*\/videos\//i.test(u)) return true;
    return false;
  });
}

// ── Deduplicate videos by normalized URL ──
export function deduplicateVideos<T extends { url: string }>(videos: T[]): T[] {
  const seen = new Set<string>();
  return videos.filter((v) => {
    const key = normalizeVideoUrl(v.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Resolve relative URLs to absolute ──
export function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) {
    try {
      return new URL(baseUrl).origin + url;
    } catch { return url; }
  }
  return url;
}

// ── Extract YouTube video ID from URL ──
export function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      return u.searchParams.get("v");
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1);
    }
  } catch { /* not a valid URL */ }
  return null;
}

// ── Check if a URL is a JS-heavy site needing Puppeteer ──
export function isJsHeavySite(url: string): boolean {
  return JS_HEAVY_SITES.test(url);
}

// ── Check if a URL is a video site ──
export function isVideoSite(url: string): boolean {
  return VIDEO_SITE_PATTERN.test(url);
}
