/**
 * Shared browsing/navigation helpers — deduplicated from page.tsx
 * Used by processActions, handleSendMessage interceptors, and fetchSearchResults
 */

import type { Conversation } from "@/types/chat";

// ── Ad/tracker URL pattern (used everywhere) ──
export const AD_LINK_PATTERN = /\b(doubleclick|googlesyndication|googleadservices|adsystem|adserver|adclick|clicktrack|tracker|pagead|pubads|syndication|taboola|outbrain|mgid|exoclick|exosrv|juicyads|trafficjunky|trafficstars|popunder|popads|clickadu|adsterra|propellerads|popcash|hilltopads|adcash|clickaine|revcontent|zergnet|disqus\.com|facebook\.com\/tr|analytics|pixel|beacon|imp\?|\/ad\/|\/ads\/|\/adx\/|banner|sponsor|spankurbate|rule34comic|adglare|adtng|afcpatrk|aftrk|nutaku\.net|adxpansion|admaven|tubecorporate|twinrdsrv|plugrush|trafficforce)\b/i;

// ── JS-heavy site detection (generic — any site with dynamic/video content) ──
export function isJsHeavySite(url: string): boolean {
  // Any URL with video/watch/embed/player/stream path keywords likely needs Puppeteer
  if (/\/(video|watch|embed|player|play|stream|clip|episode|movie|hentai|anime)s?[\d\/?#]/i.test(url)) return true;
  // Known SPA/dynamic platforms (social media, streaming)
  if (/\b(twitch|tiktok|instagram|twitter|x\.com|facebook|reddit|discord)\b/i.test(url)) return true;
  // Sites that render search results via JavaScript (static HTML only has tag clouds/sidebars)
  if (/\b(rule34video)\b/i.test(url)) return true;
  return false;
}

// ── Video page URL detection (generic — any URL that looks like a video page) ──
export function isVideoPageUrl(url: string): boolean {
  // URL path contains video-related keywords
  if (/\/(video|watch|embed|player|play|stream|clip|episode|movie|hentai|anime|view_video)s?[\d\/?#]/i.test(url)) return true;
  // Query params that indicate video pages
  if (/[?&](v|video|viewkey|watch|clip|id)=/i.test(url)) return true;
  return false;
}

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
    if (/\b(banhq|otcagpqmeoqb|eunow4u|adtng|afcpatrk|aftrk|nutaku|adxpansion|admaven|tubecorporate|twinrdsrv|plugrush|trafficforce)\b/i.test(u)) return false;
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

// ── Build site-specific search URL (different sites need different formats) ──
export function buildSiteSearchUrl(site: string, query: string): string {
  const host = site.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  if (host.includes("rule34video"))   return `${site}/search/?q=${encodeURIComponent(query)}`;
  if (host.includes("pornhub"))       return `${site}/video/search?search=${encodeURIComponent(query)}`;
  if (host.includes("xvideos"))       return `${site}/?k=${encodeURIComponent(query)}`;
  if (host.includes("xhamster"))      return `${site}/search/${encodeURIComponent(query)}`;
  if (host.includes("spankbang"))     return `${site}/s/${encodeURIComponent(query)}/`;
  if (host.includes("xnxx"))          return `${site}/search/${encodeURIComponent(query)}`;
  if (host.includes("redtube"))       return `${site}/?search=${encodeURIComponent(query)}`;
  if (host.includes("youtube"))       return `${site}/results?search_query=${encodeURIComponent(query)}`;
  if (host.includes("reddit"))        return `${site}/search/?q=${encodeURIComponent(query)}`;
  if (host.includes("x.com") || host.includes("twitter")) return `${site}/search?q=${encodeURIComponent(query)}`;
  if (host.includes("amazon"))        return `${site}/s?k=${encodeURIComponent(query)}`;
  if (host.includes("nhentai"))       return `${site}/search/?q=${encodeURIComponent(query)}`;
  if (host.includes("rule34.xxx"))    return `${site}/index.php?page=post&s=list&tags=${encodeURIComponent(query)}`;
  if (host.includes("e621"))          return `${site}/posts?tags=${encodeURIComponent(query)}`;
  if (host.includes("gelbooru"))      return `${site}/index.php?page=post&s=list&tags=${encodeURIComponent(query)}`;
  if (host.includes("danbooru"))      return `${site}/posts?tags=${encodeURIComponent(query)}`;
  return `${site}/search?q=${encodeURIComponent(query)}`;
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


