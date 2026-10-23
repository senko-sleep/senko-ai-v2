// Layer 0 "browser": a per-chat web session over plain HTTP. No Chromium, no Playwright,
// so it runs anywhere (Wasmer, Vercel, a laptop). It keeps cookies and history, turns each
// page into text + numbered links + forms, and can follow links and submit forms, which
// covers searching, reading, navigating and simple log-in flows. Pages that need JavaScript
// or video need the real browser layer (layers.ts escalates).
import { isPrivateUrl } from "./safety";

export interface PageLink {
  n: number;
  text: string;
  href: string;
}
export interface PageField {
  name: string;
  type: string;
  value: string;
  label: string;
  options?: string[];
}
export interface PageForm {
  n: number;
  action: string;
  method: "GET" | "POST";
  fields: PageField[];
  submit?: string;
}
export interface PageSnap {
  url: string;
  title: string;
  text: string;
  links: PageLink[];
  forms: PageForm[];
  status: number;
  /** True when the page is mostly empty without JavaScript. */
  needsJs: boolean;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 8;
const MAX_LINKS = 60;
const TEXT_CHARS = 6000;

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return entities[e.toLowerCase()] ?? m;
  });
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : "";
};

/** HTML to readable text, keeping block structure as line breaks. */
export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br|ul|ol|table|form)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePage(html: string, url: string, status: number): PageSnap {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const body = html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const abs = (href: string) => {
    try {
      return new URL(href, url).toString();
    } catch {
      return "";
    }
  };

  const links: PageLink[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = abs(attr(m[0].slice(0, m[0].indexOf(">") + 1), "href").trim());
    if (!/^https?:/.test(href)) continue;
    const text = strip(m[1]) || attr(m[0].slice(0, m[0].indexOf(">") + 1), "aria-label") || attr(m[0].slice(0, m[0].indexOf(">") + 1), "title");
    const key = href + "|" + text;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    links.push({ n: links.length + 1, text: text.slice(0, 90), href });
    if (links.length >= MAX_LINKS) break;
  }

  const forms: PageForm[] = [];
  for (const m of body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const open = `<form ${m[1]}>`;
    const fields: PageField[] = [];
    let submit: string | undefined;
    for (const f of m[2].matchAll(/<(input|textarea|select|button)\b([^>]*)>/gi)) {
      const tag = f[1].toLowerCase();
      const attrs = `<${tag} ${f[2]}>`;
      const name = attr(attrs, "name");
      const type = tag === "input" ? (attr(attrs, "type") || "text").toLowerCase() : tag === "button" ? (attr(attrs, "type") || "submit").toLowerCase() : tag;
      if (type === "submit" || type === "image" || type === "button") {
        if (name && !submit) submit = name + "=" + attr(attrs, "value");
        continue;
      }
      if (!name) continue;
      if ((type === "checkbox" || type === "radio") && !/\schecked\b/i.test(attrs)) {
        fields.push({ name, type, value: attr(attrs, "value") || "on", label: "" });
        continue;
      }
      let options: string[] | undefined;
      if (tag === "select") {
        const block = m[2].slice(f.index!).match(/^<select[\s\S]*?<\/select>/i)?.[0] || "";
        options = [...block.matchAll(/<option\b([^>]*)>/gi)].map((o) => attr(`<option ${o[1]}>`, "value")).filter(Boolean).slice(0, 25);
      }
      const id = attr(attrs, "id");
      const label = (id && strip(m[2].match(new RegExp(`<label[^>]*for=["']${id}["'][^>]*>([\\s\\S]*?)</label>`, "i"))?.[1] || "")) || attr(attrs, "placeholder") || attr(attrs, "aria-label");
      fields.push({ name, type, value: attr(attrs, "value"), label: label.slice(0, 60), options });
    }
    if (!fields.length) continue;
    forms.push({
      n: forms.length + 1,
      action: abs(attr(open, "action") || url),
      method: attr(open, "method").toUpperCase() === "POST" ? "POST" : "GET",
      fields,
      submit,
    });
    if (forms.length >= 8) break;
  }

  const text = htmlToText(body.replace(/<head[\s\S]*?<\/head>/i, " "));
  return { url, title, text: text.slice(0, TEXT_CHARS), links, forms, status, needsJs: text.length < 200 && links.length < 3 };
}

class Jar {
  private cookies = new Map<string, Map<string, string>>(); // host -> name -> value
  header(url: URL): string {
    const out: string[] = [];
    for (const [host, c] of this.cookies) {
      if (url.hostname === host || url.hostname.endsWith("." + host)) for (const [k, v] of c) out.push(`${k}=${v}`);
    }
    return out.join("; ");
  }
  store(url: URL, setCookies: string[]) {
    for (const sc of setCookies) {
      const [pair, ...attrs] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const domain = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a))?.slice(7).replace(/^\./, "").toLowerCase() || url.hostname;
      if (!(url.hostname === domain || url.hostname.endsWith("." + domain))) continue;
      const expired = attrs.some((a) => /^max-age=(0|-)/i.test(a.trim())) || !value;
      const c = this.cookies.get(domain) ?? new Map();
      if (expired) c.delete(name);
      else c.set(name, value);
      this.cookies.set(domain, c);
    }
  }
}

export class HttpSession {
  private jar = new Jar();
  private history: PageSnap[] = [];
  lastUsed = Date.now();

  current(): PageSnap | null {
    return this.history[this.history.length - 1] ?? null;
  }

  private async request(rawUrl: string, signal: AbortSignal, init: { method?: string; body?: string; referer?: string } = {}): Promise<PageSnap> {
    let url = rawUrl;
    let method = init.method || "GET";
    let body = init.body;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (isPrivateUrl(url)) throw new Error("That address is blocked.");
      const u = new URL(url);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const onAbort = () => ctl.abort();
      signal.addEventListener("abort", onAbort);
      try {
        const cookie = this.jar.header(u);
        const res = await fetch(url, {
          method,
          body: method === "POST" ? body : undefined,
          redirect: "manual",
          signal: ctl.signal,
          headers: {
            "user-agent": UA,
            accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
            ...(cookie ? { cookie } : {}),
            ...(init.referer ? { referer: init.referer } : {}),
            ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          },
        });
        this.jar.store(u, res.headers.getSetCookie?.() ?? []);
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
          url = new URL(loc, url).toString();
          if (res.status !== 307 && res.status !== 308) {
            method = "GET";
            body = undefined;
          }
          continue;
        }
        const type = res.headers.get("content-type") || "";
        if (type && !/text|html|xml|json/i.test(type)) throw new Error(`That's a file (${type.split(";")[0]}), not a page.`);
        const reader = res.body?.getReader();
        let text = "";
        if (reader) {
          const chunks: Uint8Array[] = [];
          let total = 0;
          while (total < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.length;
          }
          reader.cancel().catch(() => {});
          text = Buffer.concat(chunks).toString("utf8");
        }
        if (/json/i.test(type) || /^\s*[[{]/.test(text)) {
          return { url, title: u.hostname, text: text.slice(0, TEXT_CHARS), links: [], forms: [], status: res.status, needsJs: false };
        }
        return parsePage(text, url, res.status);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    }
    throw new Error("Too many redirects.");
  }

  private push(p: PageSnap) {
    this.history.push(p);
    if (this.history.length > 30) this.history.shift();
    this.lastUsed = Date.now();
    return p;
  }

  async goto(url: string, signal: AbortSignal): Promise<PageSnap> {
    const u = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    return this.push(await this.request(u, signal, { referer: this.current()?.url }));
  }

  async click(n: number, signal: AbortSignal): Promise<PageSnap> {
    const link = this.current()?.links.find((l) => l.n === n);
    if (!link) throw new Error(`There is no link ${n} on this page.`);
    return this.push(await this.request(link.href, signal, { referer: this.current()?.url }));
  }

  async submit(n: number, values: Record<string, string>, signal: AbortSignal): Promise<PageSnap> {
    const form = this.current()?.forms.find((f) => f.n === n);
    if (!form) throw new Error(`There is no form ${n} on this page.`);
    const data = new URLSearchParams();
    for (const f of form.fields) {
      const v = f.name in values ? values[f.name] : f.value;
      if ((f.type === "checkbox" || f.type === "radio") && !(f.name in values)) continue;
      data.append(f.name, v);
    }
    if (form.submit) {
      const i = form.submit.indexOf("=");
      data.append(form.submit.slice(0, i), form.submit.slice(i + 1));
    }
    const referer = this.current()?.url;
    if (form.method === "GET") {
      const u = new URL(form.action);
      for (const [k, v] of data) u.searchParams.set(k, v);
      return this.push(await this.request(u.toString(), signal, { referer }));
    }
    return this.push(await this.request(form.action, signal, { method: "POST", body: data.toString(), referer }));
  }

  back(): PageSnap | null {
    if (this.history.length > 1) this.history.pop();
    this.lastUsed = Date.now();
    return this.current();
  }
}

// One per chat, kept in memory while the chat is active.
const g = globalThis as unknown as { __httpSessions?: Map<string, HttpSession> };
const store = (g.__httpSessions ??= new Map());

export function httpSession(chatId: string): HttpSession {
  const now = Date.now();
  for (const [id, s] of store) if (now - s.lastUsed > 30 * 60_000) store.delete(id);
  let s = store.get(chatId);
  if (!s) {
    if (store.size >= 50) store.delete(store.keys().next().value as string);
    s = new HttpSession();
    store.set(chatId, s);
  }
  return s;
}

/** Compact text of a page for the model: text, numbered links and forms. */
export function describePage(p: PageSnap, maxText = 3500): string {
  const lines = [`URL: ${p.url}`, `Title: ${p.title}`, `Text:\n${p.text.slice(0, maxText)}`];
  if (p.links.length) lines.push(`Links:\n${p.links.slice(0, 40).map((l) => `[${l.n}] ${l.text}`).join("\n")}`);
  if (p.forms.length) {
    lines.push(
      `Forms:\n${p.forms
        .map(
          (f) =>
            `[form ${f.n}] ${f.method} ${new URL(f.action).pathname} fields: ${f.fields
              .map((x) => `${x.name}${x.label ? ` (${x.label})` : ""}${x.type === "password" ? " [password]" : ""}${x.options?.length ? ` options: ${x.options.slice(0, 8).join("|")}` : ""}`)
              .join(", ")}`
        )
        .join("\n")}`
    );
  }
  if (p.needsJs) lines.push("(This page looks empty without JavaScript.)");
  return lines.join("\n");
}
