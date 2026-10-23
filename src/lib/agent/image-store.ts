/**
 * Per-session temporary image store for the agent.
 *
 * Each browser session (chat) gets its own isolated "stash". The agent calls
 * fetch_image to download an image from the current page into the stash, and
 * make_collage (or other tools) can read it back. Images expire automatically
 * and the stash has a hard cap so it never grows unbounded.
 *
 * Storage is in-memory (process-local), which is fine because:
 *   - images are only needed for the duration of one agent task
 *   - sessions already handle cross-restart persistence for browser state
 */

export interface StashedImage {
  id: string;
  url: string;       // original URL the image was fetched from
  alt: string;       // alt text / description
  mime: string;      // e.g. "image/jpeg"
  data: Buffer;      // raw bytes
  fetchedAt: number; // Date.now()
  expiresAt: number;
}

export interface StashStats {
  count: number;
  totalBytes: number;
  ids: string[];
  images: { id: string; url: string; alt: string; mime: string; bytes: number; expiresAt: number }[];
}

// ---- tunables (all overridable by env vars) ----------------------------------

/** Maximum images kept per session. Oldest are evicted when full. */
const MAX_PER_SESSION = Math.max(1, Number(process.env.AGENT_STASH_MAX ?? 20));
/** How long each image lives (ms). Default 30 minutes. */
const TTL_MS = Math.max(60_000, Number(process.env.AGENT_STASH_TTL_MS ?? 30 * 60_000));
/** Max raw bytes per image (10 MB). */
const MAX_IMAGE_BYTES = Number(process.env.AGENT_STASH_MAX_BYTES ?? 10 * 1024 * 1024);
/** Fetch timeout per image (ms). */
const FETCH_TIMEOUT_MS = 20_000;

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

// ---- public API -------------------------------------------------------------

/**
 * Fetch an image URL into the session stash. Returns the stashed image's id
 * or throws a descriptive error string on failure.
 */
export async function stashImage(
  sessionId: string,
  url: string,
  alt = "",
  referer?: string,
): Promise<StashedImage> {
  const stash = getStash(sessionId);
  evictExpired(stash);

  // Already have this URL? Return the existing record (refreshes nothing — caller can re-fetch).
  const existing = stash.images.find((img) => img.url === url);
  if (existing && existing.expiresAt > Date.now()) return existing;

  // Fetch
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  if (referer) headers["Referer"] = referer;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);

  const ct = res.headers.get("content-type") || "image/jpeg";
  if (!ct.startsWith("image/")) throw new Error(`URL is not an image (content-type: ${ct})`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Image response was empty");
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large (${(buf.length / 1024 / 1024).toFixed(1)} MB; limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
  }

  const img: StashedImage = {
    id: nextId(),
    url,
    alt: alt.slice(0, 200),
    mime: ct.split(";")[0].trim(),
    data: buf,
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
    totalBytes: images.reduce((n, img) => n + img.data.length, 0),
    ids: images.map((img) => img.id),
    images: images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
      mime: img.mime,
      bytes: img.data.length,
      expiresAt: img.expiresAt,
    })),
  };
}
