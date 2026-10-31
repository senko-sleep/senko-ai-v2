// Outbound-request guard for tools the AI can trigger (reading pages it was pointed at).
// Only public http(s) hosts are reachable: no localhost, private/link-local ranges, or
// credentials in URLs. Redirects are followed manually so every hop is re-checked.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedUrlError extends Error {}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::" || l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    return mapped ? isPrivateIPv4(mapped[1]) : false;
  }
  return true;
}

/** Throws BlockedUrlError unless the URL is a public http(s) address. Returns the parsed URL. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("Not a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("Only http(s) pages can be read.");
  if (u.username || u.password) throw new BlockedUrlError("URLs with credentials are not allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new BlockedUrlError("Local addresses are not allowed.");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError("Private network addresses are not allowed.");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError("That host could not be found.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedUrlError("That host resolves to a private network address.");
  }
  return u;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  text: string;
  truncated: boolean;
}

/** GET a public page as text: bounded time, bounded size, redirects re-validated. */
export async function safeFetchText(
  raw: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 600_000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let url = (await assertPublicHttpUrl(raw)).toString();
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SenkoAgent/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          ...(opts.headers || {}),
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = (await assertPublicHttpUrl(new URL(res.headers.get("location")!, url).toString())).toString();
        continue;
      }
      const contentType = res.headers.get("content-type") || "";
      if (!/text\/|html|xml|json/i.test(contentType) && contentType) {
        return { ok: false, status: res.status, finalUrl: url, contentType, text: "", truncated: false };
      }
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      let truncated = false;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          chunks.push(value);
          if (received >= maxBytes) {
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
      return { ok: res.ok, status: res.status, finalUrl: url, contentType, text, truncated };
    }
    throw new BlockedUrlError("Too many redirects.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Visible text of an HTML page (scripts/styles/tags removed), plus its <title>. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() || "";
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title: decodeEntities(title), text };
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Remove query values that look like secrets before a URL is shown or stored. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (/key|token|secret|sig|auth|pass|session|code/i.test(k)) u.searchParams.set(k, "…");
    }
    return u.toString();
  } catch {
    return raw;
  }
}
