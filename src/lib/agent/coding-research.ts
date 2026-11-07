import dns from "node:dns/promises";
import { isIP } from "node:net";
import { searchYouTube, verifyYouTubeVideo } from "@/lib/server/youtube";
import { isPrivateUrl } from "./safety";

export interface ResearchResult { ok: boolean; result: string; sources: { url: string; title?: string; checkedAt: number }[] }
const MAX_BYTES = 512 * 1024;

export function publicResearchUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || host === "localhost" || host.endsWith(".localhost") ||
    host === "0.0.0.0" || host === "::" || host === "::1" || host.startsWith("::ffff:") ||
    /^(127\.|169\.254\.|10\.|192\.168\.)/.test(host) || isPrivateUrl(url.href)) throw new Error("Research tools accept public HTTP(S) URLs only.");
  return url;
}

/** Check redirects separately; never follow a public URL into a private network. */
export async function fetchResearchPage(raw: string, signal?: AbortSignal): Promise<{ url: string; status: number; type: string; text: string; truncated: boolean }> {
  let url = publicResearchUrl(raw);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (!addresses.length) throw new Error("Host did not resolve.");
    for (const address of addresses) publicResearchUrl(`http://${address.address.includes(":") ? `[${address.address}]` : address.address}/`);
    const response = await fetch(url, { signal, redirect: "manual", headers: { "User-Agent": "SenkoResearch/1.0", Accept: "application/json,text/html,text/plain;q=0.9" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect did not include a location.");
      url = publicResearchUrl(new URL(location, url).href); continue;
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "", bytes = 0, truncated = false;
    try {
      while (reader) {
        const item = await reader.read(); if (item.done) break;
        const remaining = MAX_BYTES - bytes;
        text += decoder.decode(item.value.subarray(0, remaining), { stream: true }); bytes += item.value.length;
        if (bytes >= MAX_BYTES) { truncated = true; break; }
      }
      text += decoder.decode();
    } finally { await reader?.cancel().catch(() => {}); }
    return { url: url.href, status: response.status, type: response.headers.get("content-type") || "", text, truncated };
  }
  throw new Error("Too many research redirects.");
}

export function researchText(html: string): string {
  return html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** The same real lookups serve browser jobs and the server coding loop. */
export async function runCodingResearch(op: { op: "fetch"; url: string } | { op: "search" | "youtube"; query: string }, signal?: AbortSignal): Promise<ResearchResult> {
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
  if (op.op === "youtube") {
    const outcome = await searchYouTube({ query: op.query, limit: 5 }, { signal: bounded, verify: verifyYouTubeVideo });
    return { ok: outcome.ok, sources: outcome.results.map((v) => ({ url: `https://www.youtube.com/watch?v=${v.videoId}`, title: v.title, checkedAt: Date.now() })),
      result: outcome.results.length ? JSON.stringify({ source: outcome.source, playbackVerified: false, note: "oEmbed checks public metadata only. Browser playback, embedding permission and region restrictions still need testing.", videos: outcome.results }) : outcome.error || "No readable YouTube results." };
  }
  const page = await fetchResearchPage(op.op === "fetch" ? op.url : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(op.query)}`, bounded);
  if (op.op === "fetch") {
    const title = page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const text = /html/i.test(page.type) ? researchText(page.text) : page.text;
    // Preserve discovered URLs: text-only extraction otherwise hides every useful link.
    const links = [...page.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 40).flatMap((m) => {
      try { return [{ title: researchText(m[2]).slice(0, 100), url: publicResearchUrl(new URL(m[1], page.url).href).href }]; } catch { return []; }
    });
    const assets = [...page.text.matchAll(/<(iframe|audio|video|source|img)\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].slice(0, 30).flatMap((m) => {
      try { return [{ kind: m[1].toLowerCase(), url: publicResearchUrl(new URL(m[2], page.url).href).href, alt: m[0].match(/\balt=["']([^"']*)["']/i)?.[1] || "", sourcePage: page.url }]; } catch { return []; }
    });
    return { ok: page.status >= 200 && page.status < 300, sources: [{ url: page.url, title: title && researchText(title), checkedAt: Date.now() }], result: JSON.stringify({ status: page.status, url: page.url, type: page.type, text: text.slice(0, 12000), links, assets, truncated: page.truncated || text.length > 12000 }) };
  }
  const links = [...page.text.matchAll(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap((m) => {
    try { const url = new URL(m[1].replace(/&amp;/g, "&"), "https://duckduckgo.com"); return [{ url: publicResearchUrl(url.searchParams.get("uddg") || url.href).href, title: researchText(m[2]), checkedAt: Date.now() }]; } catch { return []; }
  }).slice(0, 8);
  return { ok: page.status === 200 && links.length > 0, sources: links, result: links.length ? JSON.stringify({ searchUrl: page.url, results: links }) : `Search returned no readable results (HTTP ${page.status}); a challenge or format change may be blocking retrieval.` };
}
