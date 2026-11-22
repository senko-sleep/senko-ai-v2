/**
 * Per-session temporary image store for the agent.
 *
 * Validates retrieved media bytes (format, dimensions, animation frame count, size limits),
 * deduplicates by normalized URL and SHA-256 content hash, classifies HTTP/network failures
 * (403, 404, 429, timeout, unsupported format, non-animated, duplicate), and ensures every
 * stashed item is genuinely deliverable to chat.
 */
import crypto from "node:crypto";
import sharp from "sharp";
import { isLikelyThumbnailUrl, isSearchPageUrl, normalizeUrl } from "./url-utils";

export interface StashedImage {
  id: string;
  url: string;       // original URL the image was fetched from
  normalizedUrl: string;
  alt: string;       // alt text / description
  mime: string;      // validated MIME: image/gif | image/png | image/jpeg | image/webp
  data: Buffer;      // raw bytes
  hash: string;      // SHA-256 hex digest for content-based deduplication
  animated: boolean; // true only when verified multi-frame (GIF/WebP pages > 1)
  frameCount: number;
  width: number;
  height: number;
  fetchedAt: number; // Date.now()
  expiresAt: number;
}

export interface StashStats {
  count: number;
  animatedCount: number;
  totalBytes: number;
  ids: string[];
  images: {
    id: string;
    url: string;
    alt: string;
    mime: string;
    bytes: number;
    animated: boolean;
    frameCount: number;
    width: number;
    height: number;
    hash: string;
    expiresAt: number;
  }[];
}

export type ImageFetchErrorCode =
  | "http_403"
  | "http_404"
  | "http_429"
  | "timeout"
  | "network_error"
  | "unsupported_format"
  | "too_large"
  | "not_animated"
  | "duplicate"
  | "search_page"
  | "invalid_url";

export class ImageFetchError extends Error {
  readonly code: ImageFetchErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly url: string;
  readonly existingId?: string;

  constructor(
    code: ImageFetchErrorCode,
    message: string,
    opts: { url: string; status?: number; retryAfterMs?: number; existingId?: string } = { url: "" },
  ) {
    super(message);
    this.name = "ImageFetchError";
    this.code = code;
    this.url = opts.url;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.existingId = opts.existingId;
  }
}

export interface StashImageOptions {
  /** When true, reject static images/thumbnails (single-frame GIFs, JPEGs, PNGs). */
  requireAnimated?: boolean;
  /** Optional already-delivered SHA-256 hashes (e.g. restored from checkpoint) to deduplicate against. */
  knownHashes?: ReadonlySet<string>;
  /**
   * Optional permitted browser-session fetch fallback (e.g. Playwright context.request)
   * when server-side fetch lacks session cookies. Must still respect HTTP status codes.
   */
  browserFetch?: (url: string, referer?: string) => Promise<{ ok: boolean; status: number; contentType: string; data: Buffer; retryAfter?: string } | null>;
}

// ---- tunables (aligned with chat delivery limits in src/lib/server/chats.ts) ----

/** Maximum images kept per session. Oldest are evicted when full. */
const MAX_PER_SESSION = Math.max(1, Number(process.env.AGENT_STASH_MAX ?? 20));
/** How long each image lives (ms). Default 30 minutes. */
const TTL_MS = Math.max(60_000, Number(process.env.AGENT_STASH_TTL_MS ?? 30 * 60_000));
/** Max raw bytes per image (8 MB — matches saveImage() chat attachment limit). */
export const MAX_STASH_IMAGE_BYTES = Number(process.env.AGENT_STASH_MAX_BYTES ?? 8 * 1024 * 1024);
/** Fetch timeout per image (ms). */
const FETCH_TIMEOUT_MS = 20_000;

const SUPPORTED_MIMES = new Set(["image/gif", "image/png", "image/jpeg", "image/webp"]);

// ---- global store -----------------------------------------------------------

interface Stash {
  images: StashedImage[];
}

const g = globalThis as unknown as { __agentImageStores?: Map<string, Stash> };
const stores = (g.__agentImageStores ??= new Map<string, Stash>());

function getStash(sessionId: string): Stash {
  let s = stores.get(sessionId);
  if (!s) {
    s = { images: [] };
    stores.set(sessionId, s);
  }
  return s;
}

function evictExpired(stash: Stash): void {
  const now = Date.now();
  stash.images = stash.images.filter((img) => img.expiresAt > now);
}

let _idCounter = 0;
function nextId(): string {
  return `img_${Date.now()}_${++_idCounter}`;
}

function parseRetryAfterMs(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(1000, Number(trimmed) * 1000);
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.max(1000, dateMs - Date.now());
  return undefined;
}

/** Sniff actual image format from magic bytes so lying Content-Type headers are caught. */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    return "image/gif";
  }
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // RIFF....WEBP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/**
 * Inspect raw image bytes using sharp + magic-byte verification to determine real format,
 * dimensions, and whether the media is genuinely animated (multi-frame).
 */
export async function inspectMediaBuffer(buf: Buffer): Promise<{
  mime: string;
  format: string;
  width: number;
  height: number;
  frameCount: number;
  animated: boolean;
}> {
  const sniffed = sniffImageMime(buf);
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf, { animated: true }).metadata();
  } catch {
    throw new ImageFetchError("unsupported_format", "Response bytes are not a valid decodable image.");
  }

  const fmt = (meta.format || "").toLowerCase();
  const mimeFromSharp =
    fmt === "gif" ? "image/gif" :
    fmt === "png" ? "image/png" :
    fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" :
    fmt === "webp" ? "image/webp" :
    null;

  const mime = mimeFromSharp || sniffed;
  if (!mime || !SUPPORTED_MIMES.has(mime)) {
    throw new ImageFetchError(
      "unsupported_format",
      `Unsupported image format "${fmt || "unknown"}". Chat attachments support GIF, PNG, JPEG, and WebP.`,
    );
  }

  const width = meta.width || 0;
  const height = meta.pageHeight || meta.height || 0;
  if (width < 1 || height < 1) {
    throw new ImageFetchError("unsupported_format", "Image has invalid zero dimensions.");
  }

  const frameCount = Math.max(1, meta.pages ?? 1);
  const animated = (mime === "image/gif" || mime === "image/webp") && frameCount > 1;
  return { mime, format: fmt || mime.slice(6), width, height, frameCount, animated };
}

function classifyHttpError(status: number, url: string, retryAfter?: string | null): ImageFetchError {
  if (status === 403 || status === 401) {
    return new ImageFetchError(
      "http_403",
      `HTTP ${status} fetching image (access denied or hotlink-protected). Do not retry this URL; use a permitted alternative source.`,
      { url, status },
    );
  }
  if (status === 404 || status === 410) {
    return new ImageFetchError(
      "http_404",
      `HTTP ${status} fetching image (resource not found). Pick a different candidate.`,
      { url, status },
    );
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(retryAfter);
    return new ImageFetchError(
      "http_429",
      `HTTP 429 fetching image (rate-limited${retryAfterMs ? `, retry after ~${Math.ceil(retryAfterMs / 1000)}s` : ""}). Back off and switch to another source.`,
      { url, status, retryAfterMs },
    );
  }
  return new ImageFetchError("network_error", `HTTP ${status} fetching image`, { url, status });
}

// ---- public API -------------------------------------------------------------

/**
 * Fetch and validate an image URL into the session stash.
 * Throws a typed ImageFetchError on HTTP 403/404/429, timeout, unsupported format,
 * non-animated image when `requireAnimated` is set, or duplicate content hash.
 */
export async function stashImage(
  sessionId: string,
  url: string,
  alt = "",
  referer?: string,
  opts: StashImageOptions = {},
): Promise<StashedImage> {
  const trimmed = (url || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("bad protocol");
    }
  } catch {
    throw new ImageFetchError("invalid_url", `Invalid image URL: ${trimmed.slice(0, 120)}`, { url: trimmed });
  }

  if (isSearchPageUrl(trimmed)) {
    throw new ImageFetchError(
      "search_page",
      "URL is a search-result page, not a direct downloadable media file. Open a source page or pass a direct media URL.",
      { url: trimmed },
    );
  }

  const stash = getStash(sessionId);
  evictExpired(stash);
  const norm = normalizeUrl(trimmed);

  // Already stashed under the exact or normalized URL?
  const existingByUrl = stash.images.find((img) => img.url === trimmed || img.normalizedUrl === norm);
  if (existingByUrl && existingByUrl.expiresAt > Date.now()) {
    if (opts.requireAnimated && !existingByUrl.animated) {
      throw new ImageFetchError(
        "not_animated",
        `Image is static (${existingByUrl.mime}, ${existingByUrl.frameCount} frame), not an animated GIF. Find a direct animated .gif URL.`,
        { url: trimmed },
      );
    }
    return existingByUrl;
  }

  // Fetch via server HTTP first
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "image/gif,image/webp,image/apng,image/png,image/jpeg,image/*,*/*;q=0.8",
  };
  if (referer) headers["Referer"] = referer;

  let status = 0;
  let contentType = "";
  let retryAfter: string | null = null;
  let buf: Buffer | null = null;

  try {
    const res = await fetch(trimmed, { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    status = res.status;
    contentType = res.headers.get("content-type") || "";
    retryAfter = res.headers.get("retry-after");
    if (res.ok) {
      buf = Buffer.from(await res.arrayBuffer());
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(msg)) {
      throw new ImageFetchError("timeout", `Timed out fetching image after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s`, { url: trimmed });
    }
    throw new ImageFetchError("network_error", `Network error fetching image: ${msg.slice(0, 140)}`, { url: trimmed });
  }

  // If server-side fetch got 403 and a permitted browser-session fetcher is available,
  // try retrieving through the active session (same cookies/referer; never bypasses access controls).
  if (!buf && status === 403 && opts.browserFetch) {
    const fallback = await opts.browserFetch(trimmed, referer).catch(() => null);
    if (fallback) {
      status = fallback.status;
      contentType = fallback.contentType;
      retryAfter = fallback.retryAfter ?? null;
      if (fallback.ok) buf = fallback.data;
    }
  }

  if (!buf) {
    throw classifyHttpError(status || 500, trimmed, retryAfter);
  }

  if (buf.length < 20) {
    throw new ImageFetchError("unsupported_format", "Image response was empty or too small.", { url: trimmed });
  }
  if (buf.length > MAX_STASH_IMAGE_BYTES) {
    throw new ImageFetchError(
      "too_large",
      `Image too large (${(buf.length / 1024 / 1024).toFixed(1)} MB; chat limit is ${(MAX_STASH_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB).`,
      { url: trimmed },
    );
  }

  // Reject obvious HTML/JSON pages returned with HTTP 200
  if (contentType && /^(text\/|application\/json|application\/xhtml)/i.test(contentType) && !sniffImageMime(buf)) {
    throw new ImageFetchError(
      "unsupported_format",
      `URL returned ${contentType.split(";")[0]} instead of an image file.`,
      { url: trimmed },
    );
  }

  const info = await inspectMediaBuffer(buf).catch((err) => {
    if (err instanceof ImageFetchError) {
      throw new ImageFetchError(err.code, err.message, { url: trimmed });
    }
    throw new ImageFetchError("unsupported_format", "Could not decode image bytes.", { url: trimmed });
  });

  if (opts.requireAnimated && !info.animated) {
    const thumbNote = isLikelyThumbnailUrl(trimmed) ? " (this is a static search-engine thumbnail proxy URL)" : "";
    throw new ImageFetchError(
      "not_animated",
      `Fetched image is static (${info.mime}, ${info.width}x${info.height}, ${info.frameCount} frame)${thumbNote}, not an animated GIF. Open the source page or pick a direct animated .gif URL.`,
      { url: trimmed },
    );
  }

  // Content-hash deduplication across different URLs pointing to the exact same media bytes
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const dup = stash.images.find((img) => img.hash === hash);
  if (dup) {
    throw new ImageFetchError(
      "duplicate",
      `Duplicate media: this URL returned the exact same image bytes as already-stashed ${dup.id}. Pick a visually distinct candidate.`,
      { url: trimmed, existingId: dup.id },
    );
  }
  if (opts.knownHashes?.has(hash)) {
    throw new ImageFetchError(
      "duplicate",
      "Duplicate media: this URL returned the exact same image bytes as an image already delivered in this task. Pick a different candidate.",
      { url: trimmed },
    );
  }

  const img: StashedImage = {
    id: nextId(),
    url: trimmed,
    normalizedUrl: norm,
    alt: alt.slice(0, 200),
    mime: info.mime,
    data: buf,
    hash,
    animated: info.animated,
    frameCount: info.frameCount,
    width: info.width,
    height: info.height,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };

  // Evict oldest if at capacity
  while (stash.images.length >= MAX_PER_SESSION) {
    stash.images.shift();
  }
  stash.images.push(img);

  return img;
}

/** Get all unexpired images for a session, newest last. */
export function listStash(sessionId: string): StashedImage[] {
  const stash = getStash(sessionId);
  evictExpired(stash);
  return [...stash.images];
}

/** Get a single stashed image by id. */
export function getStashedImage(sessionId: string, id: string): StashedImage | undefined {
  const stash = getStash(sessionId);
  evictExpired(stash);
  return stash.images.find((img) => img.id === id);
}

/** Clear all stashed images for a session. */
export function clearStash(sessionId: string): void {
  stores.delete(sessionId);
}

/** Human-readable stash summary (for the agent). */
export function stashStats(sessionId: string): StashStats {
  const images = listStash(sessionId);
  return {
    count: images.length,
    animatedCount: images.filter((img) => img.animated).length,
    totalBytes: images.reduce((n, img) => n + img.data.length, 0),
    ids: images.map((img) => img.id),
    images: images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
      mime: img.mime,
      bytes: img.data.length,
      animated: img.animated,
      frameCount: img.frameCount,
      width: img.width,
      height: img.height,
      hash: img.hash,
      expiresAt: img.expiresAt,
    })),
  };
}
