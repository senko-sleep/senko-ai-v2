// URL normalization, search-query deduplication, and page classification for the browser agent.
// Keeps visited-page tracking, loop detection, and media vs. search-page separation reliable
// even when search engines rotate tracking parameters on every visit.

import { parseResultsUrl, normalizeQuery } from "./google-gate";

/** Query parameters that vary per session/click without changing the underlying page content. */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "dclid", "msclkid", "yclid", "mc_cid", "mc_eid",
  // Bing search / images session & tracking parameters
  "cvid", "form", "qs", "sp", "pq", "sc", "sk", "ghsh", "ghacc", "ghpl",
  "tsc", "thid", "cdnurl", "exph", "expw", "vt", "sim", "simid", "ccid",
  "ck", "selectedindex", "ajaxhist", "ajaxserp", "pc", "refig", "ig",
  // Google search / images session & tracking parameters
  "ei", "ved", "oq", "gs_lcrp", "gs_lp", "sclient", "source", "sourceid",
  "uact", "bih", "biw", "dpr", "rlz", "sca_esv", "sxsrf", "iflsig",
  "sa", "usg", "opi", "vet", "ictx", "fir", "imgrc", "prmd",
  // Common cache-busters / referrals
  "ref", "ref_src", "ref_url", "_ga", "_gl", "trk", "trackingid",
]);

/**
 * Normalize a URL so equivalent visits (different tracking params, param ordering, hash,
 * trailing slash, or www. prefix) map to the same canonical key.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    const proto = u.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return trimmed.toLowerCase();
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const port = u.port && !((proto === "http:" && u.port === "80") || (proto === "https:" && u.port === "443")) ? `:${u.port}` : "";
    const pathname = u.pathname.replace(/\/+$/, "") || "/";

    // For Google/Bing search result pages, canonicalize to engine + kind + normalized query
    // (preserving pagination `start`/`first` and image viewer `view=detailV2` when present).
    const parsedSearch = parseResultsUrl(u.href);
    if (parsedSearch) {
      const qNorm = normalizeQuery(parsedSearch.query);
      const view = u.searchParams.get("view") === "detailV2" ? "&view=detailV2" : "";
      const page = u.searchParams.get("start") || u.searchParams.get("first") || "";
      const pagePart = page && /^\d+$/.test(page) && Number(page) > 1 ? `&page=${page}` : "";
      return `${parsedSearch.engine}:${parsedSearch.kind}?q=${encodeURIComponent(qNorm)}${view}${pagePart}`;
    }

    const kept: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      const kl = k.toLowerCase();
      if (TRACKING_PARAMS.has(kl) || kl.startsWith("utm_")) continue;
      kept.push([kl, v.trim()]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const qs = kept.length ? `?${kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : "";
    return `${proto}//${host}${port}${pathname}${qs}`;
  } catch {
    return trimmed.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

/** Canonical deduplication key for a search action (engine + kind + normalized query). */
export function normalizeSearchKey(engine: string, kind: "web" | "images", query: string): string {
  return `${(engine || "google").toLowerCase()}:${kind}:${normalizeQuery(query)}`;
}

/** True when a URL points directly to an image/GIF/video media file. */
export function isDirectMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (/\.(?:gif|png|jpe?g|webp|bmp|avif|mp4|webm)(?:$)/i.test(u.pathname)) return true;
    // Known direct CDN image formats with query-string format params (e.g. media.giphy.com, media.tenor.com, pbs.twimg.com)
    if (/(^|\.)(media\d*\.giphy\.com|i\.giphy\.com|media\d*\.tenor\.com|c\.tenor\.com|i\.imgur\.com|i\.redd\.it)$/i.test(u.hostname)) {
      return u.pathname.length > 1;
    }
    return false;
  } catch {
    return false;
  }
}

/** True when a URL is a search-engine results or redirect page, NOT a downloadable image file. */
export function isSearchPageUrl(url: string): boolean {
  if (parseResultsUrl(url)) return true;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (/(^|\.)google\.[a-z.]+$/.test(h) && /^\/(search|imgres|url)/.test(u.pathname)) return true;
    if (/(^|\.)bing\.com$/.test(h) && /^\/(search|images\/search|ck\/a)/.test(u.pathname)) return true;
    if (/(^|\.)duckduckgo\.com$/.test(h) && (u.pathname === "/" || u.pathname.startsWith("/html")) && u.searchParams.has("q")) return true;
    return false;
  } catch {
    return false;
  }
}

/** True when a URL is very likely a static thumbnail/proxy preview rather than an original full media file. */
export function isLikelyThumbnailUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    // Search-engine thumbnail proxies (always static JPEGs/WebPs, never original animated GIFs)
    if (/^tse\d*\.mm\.bing\.net$/.test(h) || /^th\.bing\.com$/.test(h)) return true;
    if (/^encrypted-tbn\d*\.gstatic\.com$/.test(h)) return true;
    if (/^external-content\.duckduckgo\.com$/.test(h)) return true;
    if (/\/(?:thumb|thumbs|thumbnail|thumbnails|preview|previews)\//i.test(p)) return true;
    if (/(?:_thumb|-thumb|_small|_preview)\.(?:jpe?g|png|webp)$/i.test(p)) return true;
    return false;
  } catch {
    return false;
  }
}

export type PageKind =
  | "blank"
  | "search_results"
  | "image_search_results"
  | "image_preview"
  | "direct_media"
  | "blocked_or_error"
  | "empty_results"
  | "content_page";

export interface PageClassification {
  kind: PageKind;
  normalizedUrl: string;
  search?: { engine: string; kind: "web" | "images"; query: string };
  note?: string;
}

const EMPTY_RESULTS_RE = /\b(no results found|did not match any|there are no results for|0 results|nothing found|no images found|no matches found)\b/i;
const BLOCKED_OR_ERROR_RE = /\b(403 forbidden|access denied|404 not found|page not found|429 too many requests|rate limit exceeded|service unavailable|502 bad gateway|503 service unavailable|just a moment\.\.\.|verify you are human|unusual traffic)\b/i;

/**
 * Classify the current browser page so the agent clearly distinguishes search-result pages,
 * image previews, direct media files, empty results, and blocked/error pages.
 */
export function classifyPage(input: {
  url: string;
  title?: string;
  text?: string;
  imageCount?: number;
}): PageClassification {
  const url = input.url || "";
  if (!url || url === "about:blank") {
    return { kind: "blank", normalizedUrl: "about:blank" };
  }
  const normalizedUrl = normalizeUrl(url);
  const title = input.title || "";
  const text = input.text || "";
  const sample = `${title}\n${text.slice(0, 800)}`;

  if (BLOCKED_OR_ERROR_RE.test(sample) && text.length < 1500) {
    return {
      kind: "blocked_or_error",
      normalizedUrl,
      note: "This page appears blocked, rate-limited, or returned an error. Switch to an alternate source.",
    };
  }

  if (isDirectMediaUrl(url)) {
    return {
      kind: "direct_media",
      normalizedUrl,
      note: "Direct media URL open in browser.",
    };
  }

  const parsed = parseResultsUrl(url);
  if (parsed) {
    try {
      const u = new URL(url);
      if (u.searchParams.get("view") === "detailV2" || u.pathname.startsWith("/imgres")) {
        return {
          kind: "image_preview",
          normalizedUrl,
          search: parsed,
          note: "Image preview viewer inside search engine — extract the direct media URL or open the source page.",
        };
      }
    } catch {
      /* ignore */
    }
    if (EMPTY_RESULTS_RE.test(sample) || (parsed.kind === "images" && (input.imageCount ?? 0) === 0 && text.length > 20)) {
      return {
        kind: "empty_results",
        normalizedUrl,
        search: parsed,
        note: `Search "${parsed.query}" returned empty/no usable results. Refine the query or switch to a different source.`,
      };
    }
    return {
      kind: parsed.kind === "images" ? "image_search_results" : "search_results",
      normalizedUrl,
      search: parsed,
      note:
        parsed.kind === "images"
          ? "Image search grid (NOT direct downloadable files — use direct media URLs or open source pages, not thumbnail proxy URLs)."
          : "Web search results page (NOT media files — open a promising source site or use image_search / a direct source).",
    };
  }

  if (EMPTY_RESULTS_RE.test(sample) && (input.imageCount ?? 0) === 0) {
    return {
      kind: "empty_results",
      normalizedUrl,
      note: "Page reports no matching results. Try a different query or source.",
    };
  }

  return {
    kind: "content_page",
    normalizedUrl,
  };
}
