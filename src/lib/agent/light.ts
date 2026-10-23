// Layer 0: the browserless agent. Search, fetch, read, answer, over plain HTTP.
// No Chromium, no Playwright, so it runs on any host (Wasmer, Vercel, a laptop) and
// finishes in a couple of seconds. Anything that needs clicking, logging in or video
// returns "needs-browser" and the router (layers.ts) escalates to a real browser.
import { complete, type LlmMessage } from "@/lib/llm";
import { agentVoice } from "@/lib/server/persona";
import { isPrivateUrl } from "./safety";
import type { RunOptions } from "./runner";

const MAX_TURNS = 5;
const FETCH_TIMEOUT_MS = 7000;
const MAX_BYTES = 1_200_000;
const PAGE_CHARS = 5000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return entities[e.toLowerCase()] ?? m;
  });

/** HTML to readable text: drop scripts/styles/nav chrome, keep block structure as line breaks. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim());
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

async function get(url: string, signal: AbortSignal, init?: RequestInit): Promise<string> {
  if (isPrivateUrl(url)) throw new Error("blocked address");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "text/html,*/*;q=0.8", ...init?.headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (type && !/text|html|xml|json/i.test(type)) throw new Error(`not a text page (${type.split(";")[0]})`);
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function search(q: string, signal: AbortSignal): Promise<Hit[]> {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const add = (title: string, url: string, snippet: string) => {
    if (!/^https?:/.test(url) || seen.has(url)) return;
    seen.add(url);
    hits.push({ title: decode(title.replace(/<[^>]+>/g, "").trim()), url, snippet: decode(snippet.replace(/<[^>]+>/g, "").trim()).slice(0, 220) });
  };
  try {
    const html = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, signal);
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
    for (let m; (m = re.exec(html)) && hits.length < 8; ) {
      let url = decode(m[1]);
      const real = url.match(/[?&]uddg=([^&]+)/);
      if (real) url = decodeURIComponent(real[1]);
      else if (url.startsWith("//")) url = "https:" + url;
      add(m[2], url, m[3] || "");
    }
  } catch {
    /* fall through to Bing */
  }
  if (hits.length < 3) {
    try {
      const html = await get(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, signal);
      const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/g;
      for (let m; (m = re.exec(html)) && hits.length < 8; ) add(m[2], decode(m[1]), m[3] || "");
    } catch {
      /* no results */
    }
  }
  return hits;
}

async function read(url: string, signal: AbortSignal): Promise<string> {
  const raw = await get(url, signal);
  if (/^\s*[[{]/.test(raw)) return raw.slice(0, PAGE_CHARS);
  const { title, text } = htmlToText(raw);
  if (text.length < 200) throw new Error("page is empty without JavaScript");
  return `# ${title}\n${text.slice(0, PAGE_CHARS)}`;
}

type Action =
  | { action: "search"; q: string }
  | { action: "open"; urls: string[] }
  | { action: "answer"; text: string }
  | { action: "browser"; why?: string };

function parse(raw: string): Action | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const a = m && JSON.parse(m[0]);
    return a && typeof a.action === "string" ? (a as Action) : null;
  } catch {
    return null;
  }
}

const SYSTEM = `You are the fast, browserless layer of a web agent. You can only read the web over HTTP: no clicking, no logging in, no JavaScript, no video.
Reply with ONE JSON object, nothing else:
{"action":"search","q":"search query"}            - find pages
{"action":"open","urls":["https://...","..."]}    - read up to 3 pages in parallel (use URLs the user gave or search results)
{"action":"answer","text":"final answer in markdown, cite the page URLs you used"}
{"action":"browser","why":"short reason"}         - ONLY if the goal needs real interaction (click, sign in, fill forms, play or control video, view a page that is blank without JavaScript)
Be efficient: usually search once, open the best 1-3 results, then answer. Answer from what you read; if a fact isn't in the pages, say so rather than guessing.`;

/** Returns "done" when it answered, "needs-browser" when a real browser should take over. */
export async function runLight(opts: RunOptions): Promise<"done" | "needs-browser"> {
  const { goal, ownerId, provider, signal, emit, context } = opts;
  const voice = await agentVoice(ownerId).catch(() => "");
  const notes: string[] = [];
  const sources: string[] = [];
  let stepId = 0;
  let last: { provider?: string; model?: string } = {};

  const step = (label: string) => {
    const id = ++stepId;
    emit({ type: "step", id, label, status: "running" });
    return {
      done: (detail?: string) => emit({ type: "step", id, label, status: "done", detail }),
      fail: (detail: string) => emit({ type: "step", id, label, status: "error", detail }),
    };
  };

  for (let turn = 0; turn < MAX_TURNS && !signal.aborted; turn++) {
    const messages: LlmMessage[] = [
      { role: "system", content: SYSTEM + (voice ? `\n\n${voice}` : "") },
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}. Search for the latest information, not older years.

${context ? `Recent chat:\n${context}\n\n` : ""}Goal: ${goal}\n\n${notes.length ? `What you have so far:\n${notes.join("\n\n")}` : "Nothing yet."}${
          turn === MAX_TURNS - 1 ? "\n\nThis is your last turn: you must answer now (or hand off to the browser)." : ""
        }`,
      },
    ];
    let r;
    try {
      r = await complete(messages, { provider, signal, json: true, temperature: 0.2, maxTokens: 1400, maxWaitMs: 60_000, fast: true });
    } catch (e) {
      if (signal.aborted) return "done";
      emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      return "done";
    }
    last = { provider: r.providerLabel, model: r.model };
    const a = parse(r.text);
    if (!a) {
      notes.push("(your last reply was not valid JSON; reply with one JSON object)");
      continue;
    }

    if (a.action === "answer") {
      emit({ type: "done", answer: String(a.text || "").trim() || "I couldn't find anything.", url: sources[0], imageIds: [], ...last });
      return "done";
    }
    if (a.action === "browser") return "needs-browser";

    if (a.action === "search" && a.q) {
      const s = step(`Searching: ${a.q.slice(0, 80)}`);
      const hits = await search(a.q, signal);
      if (!hits.length) {
        s.fail("no results");
        notes.push(`Search "${a.q}": no results.`);
      } else {
        s.done(`${hits.length} results`);
        notes.push(`Search "${a.q}":\n${hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join("\n")}`);
      }
      continue;
    }

    if (a.action === "open" && Array.isArray(a.urls)) {
      const urls = a.urls.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 3);
      if (!urls.length) {
        notes.push("(open needs full http(s) URLs)");
        continue;
      }
      const pages = await Promise.all(
        urls.map(async (u) => {
          const host = (() => {
            try {
              return new URL(u).hostname;
            } catch {
              return u;
            }
          })();
          const s = step(`Reading ${host}`);
          try {
            const text = await read(u, signal);
            s.done(`${text.length} chars`);
            sources.push(u);
            return `Page ${u}:\n${text}`;
          } catch (e) {
            const why = e instanceof Error ? e.message : String(e);
            s.fail(why);
            return `Page ${u}: could not read (${why}).`;
          }
        })
      );
      notes.push(...pages);
      // Every page was blank or blocked: a real browser may do better.
      if (pages.every((p) => /could not read/.test(p)) && turn >= 1) return "needs-browser";
      continue;
    }
    notes.push("(unknown action; use search, open, answer or browser)");
  }
  if (signal.aborted) {
    emit({ type: "stopped" });
    return "done";
  }
  return "needs-browser";
}
