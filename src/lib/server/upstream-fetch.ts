// Fetch a page or file for the embed proxy, and notice when the site answered with a bot
// check ("Just a moment..." / cf-mitigated) instead of the page. Bot-walled sites aren't
// proxied: the embed flow opens them in the chat's real browser instead.

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export interface UpstreamResult {
  res: Response;
  /** The URL that answered, after redirects. */
  finalUrl: string;
  /** The site answered with a bot check, not the page. */
  challenged: boolean;
}

export interface UpstreamOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const CHALLENGE_STATUS = new Set([403, 429, 503]);
const CHALLENGE_TEXT = /<title>\s*(?:Just a moment|Attention Required|DDoS-Guard|Checking your browser|Please Wait\.\.\. \| Cloudflare)/i;

export function looksChallenged(status: number, headers: Headers, bodyStart: string, url = ""): boolean {
  if (headers.get("cf-mitigated") === "challenge") return true;
  if (/[?&]__cf_chl_/.test(url)) return true;
  if (CHALLENGE_STATUS.has(status) && CHALLENGE_TEXT.test(bodyStart)) return true;
  // Some challenge pages answer 200; they still load Cloudflare's challenge script.
  return CHALLENGE_TEXT.test(bodyStart) && /\/cdn-cgi\/challenge-platform\/|window\._cf_chl_opt/.test(bodyStart);
}

/** GET a URL with browser-like headers; flags bot-check answers. */
export async function fetchUpstream(url: string, o: UpstreamOptions = {}): Promise<UpstreamResult> {
  const headers = { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9", ...(o.headers || {}) };
  const timeout = AbortSignal.timeout(o.timeoutMs ?? 15_000);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  const res = await fetch(url, { headers, signal, redirect: "follow" });
  const finalUrl = res.url || url;
  const type = res.headers.get("content-type") || "";
  // Only a page can be a bot check: anything else streams straight through.
  if (!/text\/html/i.test(type)) {
    return { res, finalUrl, challenged: looksChallenged(res.status, res.headers, "", finalUrl) };
  }
  const text = await res.text();
  return {
    res: new Response(text || null, { status: res.status, headers: res.headers }),
    finalUrl,
    challenged: looksChallenged(res.status, res.headers, text.slice(0, 8000), finalUrl),
  };
}
