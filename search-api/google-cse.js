// Google Programmable Search (Custom Search JSON API) with every key we have — the same
// rotation as src/lib/server/google-cse.ts. Each key gets 100 free queries a day; a key
// that runs out is skipped until Google resets quotas at midnight Pacific.
// Keys: GOOGLE_CSE_KEY, GOOGLE_CSE_KEY_2..5, GOOGLE_CSE_KEYS (comma list), GOOGLE_SEARCH_API_KEY.
// Engine: GOOGLE_CSE_ID (or GOOGLE_SEARCH_ENGINE_ID).

const usedUp = new Map();

function cseKeys() {
  const env = process.env;
  const list = [
    env.GOOGLE_CSE_KEY,
    ...[2, 3, 4, 5].map((n) => env[`GOOGLE_CSE_KEY_${n}`]),
    ...(env.GOOGLE_CSE_KEYS || "").split(","),
    env.GOOGLE_SEARCH_API_KEY,
  ];
  return [...new Set(list.map((k) => (k || "").trim()).filter(Boolean))];
}

function cseEngineId() {
  return (process.env.GOOGLE_CSE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID || "").trim();
}

function msUntilPacificMidnight(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const elapsed = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return Math.max(60_000, 86_400_000 - elapsed);
}

function available() {
  const now = Date.now();
  return cseKeys().filter((k) => (usedUp.get(k) || 0) <= now);
}

function cseConfigured() {
  return Boolean(cseEngineId() && cseKeys().length);
}

function cseAvailable() {
  return Boolean(cseEngineId() && available().length);
}

/** One page (up to 10 results) of image search. Rotates keys on quota errors; [] when all are used up. */
async function cseImageSearch(query, { start = 1, safe = "off", signal } = {}) {
  const cx = cseEngineId();
  if (!cx) return [];
  for (const key of available()) {
    const url = `https://customsearch.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&searchType=image&num=10&start=${start}&safe=${safe}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: signal || AbortSignal.timeout(8000) });
    if (res.ok) return (await res.json()).items || [];
    const body = await res.text();
    if (res.status === 429 || (res.status === 403 && /quota|dailyLimit|rateLimit|billing/i.test(body))) {
      const wait = msUntilPacificMidnight();
      usedUp.set(key, Date.now() + wait);
      console.warn(`[images] Google search key …${key.slice(-4)} is out of quota for today; ${available().length} key(s) left (resets in ${Math.round(wait / 3_600_000)}h)`);
      continue;
    }
    throw new Error(`Google Programmable Search ${res.status}: ${body.slice(0, 200)}`);
  }
  return [];
}

module.exports = { cseKeys, cseEngineId, cseConfigured, cseAvailable, cseImageSearch, msUntilPacificMidnight };
