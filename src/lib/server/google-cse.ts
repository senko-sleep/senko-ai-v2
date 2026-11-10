// Google Programmable Search (Custom Search JSON API) with every key we have.
// Each key gets 100 free queries a day. When one runs out (429 / quota error) it is
// skipped until Google resets quotas at midnight Pacific, and the next key is used.
// Keys: GOOGLE_CSE_KEY, GOOGLE_CSE_KEY_2..GOOGLE_CSE_KEY_5, GOOGLE_CSE_KEYS (comma list),
// GOOGLE_SEARCH_API_KEY. Engine: GOOGLE_CSE_ID (or GOOGLE_SEARCH_ENGINE_ID).

export interface CseItem {
  link: string;
  title?: string;
  image?: { contextLink?: string; width?: number; height?: number };
}

const usedUp = new Map<string, number>();

export function cseKeys(): string[] {
  const env = process.env;
  const list = [
    env.GOOGLE_CSE_KEY,
    ...[2, 3, 4, 5].map((n) => env[`GOOGLE_CSE_KEY_${n}`]),
    ...(env.GOOGLE_CSE_KEYS || "").split(","),
    env.GOOGLE_SEARCH_API_KEY,
  ];
  return [...new Set(list.map((k) => (k || "").trim()).filter(Boolean))];
}

export function cseEngineId(): string {
  return (process.env.GOOGLE_CSE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID || "").trim();
}

/** Milliseconds until the next midnight in America/Los_Angeles (when Google resets daily quotas). */
export function msUntilPacificMidnight(now = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const elapsed = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return Math.max(60_000, 86_400_000 - elapsed);
}

function available(): string[] {
  const now = Date.now();
  return cseKeys().filter((k) => (usedUp.get(k) ?? 0) <= now);
}

export function cseConfigured(): boolean {
  return Boolean(cseEngineId() && cseKeys().length);
}

/** True while at least one key still has quota today. */
export function cseAvailable(): boolean {
  return Boolean(cseEngineId() && available().length);
}

function isQuotaError(status: number, body: string): boolean {
  return status === 429 || (status === 403 && /quota|dailyLimit|rateLimit|billing/i.test(body));
}

/** One page (up to 10 results) of image search. Rotates keys on quota errors; [] when all are used up. */
export async function cseImageSearch(query: string, opts: { start?: number; safe?: "off" | "active"; signal?: AbortSignal } = {}): Promise<CseItem[]> {
  const cx = cseEngineId();
  if (!cx) return [];
  for (const key of available()) {
    const url = `https://customsearch.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&searchType=image&num=10&start=${opts.start ?? 1}&safe=${opts.safe ?? "off"}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: opts.signal ?? AbortSignal.timeout(8000) });
    if (res.ok) return ((await res.json()) as { items?: CseItem[] }).items || [];
    const body = await res.text();
    if (isQuotaError(res.status, body)) {
      const wait = msUntilPacificMidnight();
      usedUp.set(key, Date.now() + wait);
      console.warn(`[images] Google search key …${key.slice(-4)} is out of quota for today; ${available().length} key(s) left (resets in ${Math.round(wait / 3_600_000)}h)`);
      continue;
    }
    throw new Error(`Google Programmable Search ${res.status}: ${body.slice(0, 200)}`);
  }
  return [];
}

/** Tests only. */
export function resetCseQuota() {
  usedUp.clear();
}
