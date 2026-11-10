// Real research for "who is X ... make the ui" requests.
// Pulls the full Wikipedia article and, for fictional subjects, the Fandom wiki page
// (infobox facts, page images, related characters). The UI model writes from this
// dossier, and the server checks facts and images against it afterwards.
import { fetchEntityWebSnippets, type WebSnippet } from "./grounding";

const UA = "SenkoAI/1.0 (entity research; https://github.com/)";
const TEXT_LIMIT = 4500;

export interface DossierImage { url: string; caption: string; source: string; width?: number; height?: number }
export interface DossierFact { label: string; value: string; source: string }
export interface DossierSource { label: string; url: string }
export interface DossierSection { title: string; body: string; source: string }
export interface DossierRelated { name: string; relation?: string; url?: string; imageUrl?: string }

export interface EntityDossier {
  query: string;
  title: string;
  description?: string;
  summary: string;
  text: string;
  /** Article sections (Background, Personality, Creation, Reception…), oldest-first. */
  sections: DossierSection[];
  trivia: string[];
  quote?: string;
  facts: DossierFact[];
  images: DossierImage[];
  related: DossierRelated[];
  sources: DossierSource[];
  snippets: WebSnippet[];
  fandom?: { host: string; title: string };
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Wikitext → plain text ───────────────────────────────────────────────────

/** Split a template/infobox body on top-level pipes (ignores pipes inside {{ }} and [[ ]]). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") { depth++; i++; continue; }
    if (two === "}}" || two === "]]") { depth = Math.max(0, depth - 1); i++; continue; }
    if (body[i] === "|" && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts;
}

/** Find the end of a {{template}} starting at `from` (index of the opening braces). */
function templateEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") { depth++; i++; }
    else if (text[i] === "}" && text[i + 1] === "}") { depth--; i++; if (depth === 0) return i + 1; }
  }
  return -1;
}

const KEEP_FIRST_ARG = /^(?:nihongo\d?|nihongo2|tooltip|abbr|nowrap|small|transl|ruby|j|anchor|color|colour|w|wp|font|nobold|sic)$/i;
const JOIN_ARGS = /^(?:scroll ?box|plainlist|flatlist|ubl|unbulleted list|hlist|collapsible list|tabber)$/i;

export function wikitextToPlain(input: string): string {
  let s = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<gallery[^>]*>[\s\S]*?<\/gallery>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n");
  // Resolve templates innermost-first.
  for (let pass = 0; pass < 12 && /\{\{/.test(s); pass++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      const args = splitTopLevel(body);
      const name = args[0].trim();
      const positional = args.slice(1).filter((a) => !/^\s*[\w ]+\s*=/.test(a)).map((a) => a.trim());
      if (KEEP_FIRST_ARG.test(name)) return positional[0] || "";
      if (/^(?:lang|lang-\w+|langx)$/i.test(name)) return positional[positional.length - 1] || "";
      if (/^marriage$/i.test(name)) return `${positional[0] || ""}${positional[1] ? ` (m. ${positional[1]}${positional[2] ? `–${positional[2]}` : ""})` : ""}`;
      if (/^(?:birth|death|start|end)[ _]date(?: and age)?$|^b-?da$|^dob$/i.test(name)) {
        const [y, mo, d] = positional.filter((a) => /^\d+$/.test(a));
        if (!y) return "";
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        return [d, mo ? months[Number(mo) - 1] : "", y].filter(Boolean).join(" ");
      }
      if (JOIN_ARGS.test(name)) return positional.join("\n");
      return "";
    });
  }
  s = s
    .replace(/\[\[(?:File|Image|Category|Media):[^\]]*\]\]/gi, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/\S+\]/g, "")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/__[A-Z]+__/g, "")
    .replace(/^=+\s*(.*?)\s*=+$/gm, "\n$1:")
    .replace(/^[*#:;]+\s*/gm, "• ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Turn an infobox value into a compact one-line string. */
function cleanValue(raw: string): string {
  return wikitextToPlain(raw)
    .split("\n")
    .map((line) => line.replace(/^•\s*/, "").trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s*,\s*\(/g, " (")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function linkTargets(raw: string): { target: string; label: string; note?: string }[] {
  const out: { target: string; label: string; note?: string }[] = [];
  const lines = raw.replace(/<br\s*\/?>/gi, "\n").split("\n");
  for (const line of lines) {
    const m = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(line);
    if (!m) continue;
    const target = m[1].trim();
    if (/^(?:file|image|category):/i.test(target)) continue;
    const note = /<small>\s*\(?([^<)]*)\)?\s*<\/small>/i.exec(line)?.[1]?.trim();
    out.push({ target, label: (m[2] || m[1]).trim(), note });
  }
  return out;
}

interface Infobox { fields: { key: string; raw: string }[]; start: number; end: number }

export function parseInfobox(wikitext: string): Infobox | null {
  const re = /\{\{\s*([^|}\n]*(?:infobox|character|person|biography)[^|}\n]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext))) {
    const start = m.index;
    const end = templateEnd(wikitext, start);
    if (end < 0) continue;
    const body = wikitext.slice(start + 2, end - 2);
    const fields = splitTopLevel(body).slice(1).map((part) => {
      const eq = part.indexOf("=");
      return eq < 0 ? null : { key: part.slice(0, eq).trim(), raw: part.slice(eq + 1).trim() };
    }).filter((f): f is { key: string; raw: string } => !!f && !!f.key && !!f.raw);
    if (fields.length >= 3) return { fields, start, end };
  }
  return null;
}

const SKIP_FIELD = /^(?:image\d*|caption|name|title|imagecaption|image_?size|alt|signature|color|colour|tab\d*|embed|module|footnotes|header|bg|text ?color)$/i;
const RELATION_FIELD = /^(?:other(?: ?relations?)?|relations?|associates?|family|relatives?|parents?|children|spouse|partners?|siblings?|pets?|mother|father|brother|sister|friends?|allies|master|apprentice|students?|teachers?|mentor)$/i;

// ─── Wikipedia ───────────────────────────────────────────────────────────────

interface WikiPage {
  title: string; extract?: string; description?: string; fullurl?: string;
  original?: { source: string; width: number; height: number };
  thumbnail?: { source: string; width: number; height: number };
  missing?: boolean;
}

async function wikipedia(query: string, signal: AbortSignal) {
  const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
    "&generator=search&gsrlimit=3&gsrsearch=" + encodeURIComponent(query) +
    "&prop=extracts|pageimages|description|info&explaintext=1&exlimit=1&piprop=original|thumbnail&pithumbsize=1000&inprop=url";
  const data = await getJson<{ query?: { pages?: (WikiPage & { index?: number })[] } }>(url, signal);
  const pages = (data?.query?.pages || []).sort((a, b) => (a.index ?? 9) - (b.index ?? 9));
  if (!pages.length) return null;
  // Prefer an exact or near title match over a loosely related top hit.
  const want = normal(query);
  const page = pages.find((p) => normal(p.title) === want) || pages.find((p) => normal(p.title).includes(want) || want.includes(normal(p.title))) || pages[0];
  if (!page.extract && pages[0] !== page) return null;
  // The extract is only returned for the first page in a generator; fetch the chosen page directly if needed.
  if (!page.extract) {
    const direct = await getJson<{ query?: { pages?: WikiPage[] } }>(
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=extracts|pageimages|description|info&explaintext=1&piprop=original|thumbnail&pithumbsize=1000&inprop=url&titles=" + encodeURIComponent(page.title), signal);
    const p = direct?.query?.pages?.[0];
    if (!p || p.missing) return null;
    return p;
  }
  return page;
}

function normal(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/×/g, "x").replace(/[^a-z0-9]+/g, " ").trim();
}

const SKIP_SECTION = /^(?:references?|external links|see also|notes|footnotes|navigation|site navigation|gallery|image gallery|sources|bibliography|further reading|merchandise|quotes?|videos?|links|citations?)$/i;

/** Clip at a sentence boundary so sections read cleanly. */
function clip(text: string, max = 1100): string {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

function wikipediaSections(extract: string, source: string): DossierSection[] {
  const out: DossierSection[] = [];
  const parts = extract.split(/\n+(={2,4})\s*(.+?)\s*\1\n+/);
  for (let i = 1; i + 2 < parts.length + 1; i += 3) {
    const title = parts[i + 1]?.trim();
    // A sub-heading right after its parent heading is part of the body text; drop the marker.
    const body = (parts[i + 2] || "").replace(/^\s*={2,4}\s*(.+?)\s*={2,4}\s*/, "").replace(/\n={2,4}\s*(.+?)\s*={2,4}\n/g, "\n\n$1:\n").trim();
    if (!title || SKIP_SECTION.test(title) || body.length < 160) continue;
    out.push({ title, body: clip(body), source });
  }
  return out;
}

/** Fandom page sections; the Trivia section becomes a bullet list. */
function wikiSections(wikitext: string, source: string): { sections: DossierSection[]; trivia: string[] } {
  const sections: DossierSection[] = [];
  const trivia: string[] = [];
  const parts = wikitext.split(/^(={2,4})\s*(.+?)\s*\1\s*$/m);
  for (let i = 1; i + 1 < parts.length; i += 3) {
    const title = wikitextToPlain(parts[i + 1] || "").trim();
    const raw = parts[i + 2] || "";
    if (!title) continue;
    if (/^trivia$/i.test(title)) {
      for (const line of raw.split("\n")) if (/^\*/.test(line)) {
        const t = wikitextToPlain(line.replace(/^\*+\s*/, "")).replace(/^•\s*/, "").trim();
        if (t.length > 20 && t.length < 400) trivia.push(t);
      }
      continue;
    }
    if (SKIP_SECTION.test(title)) continue;
    const body = wikitextToPlain(raw).replace(/^•\s*/gm, "• ").trim();
    if (body.length < 160) continue;
    sections.push({ title, body: clip(body), source });
  }
  return { sections, trivia };
}

/** Keep the article sections that describe the subject; drop references and reception walls. */
function articleText(extract: string): { summary: string; text: string } {
  const [intro, ...rest] = extract.split(/\n\n\n== /);
  const sections = rest
    .map((s) => s.replace(/^([^=]+) ==\n/, "$1:\n").replace(/\n==+ ([^=]+) ==+\n/g, "\n$1:\n"))
    .filter((s) => !/^(?:References|External links|See also|Notes|Further reading|Bibliography|Sources)\b/i.test(s));
  return { summary: intro.trim(), text: sections.join("\n\n").trim() };
}

// ─── Fandom ──────────────────────────────────────────────────────────────────

/** Bing wraps result links as /ck/a?...&u=a1<base64url>. */
export function decodeSearchUrl(raw: string): string {
  const url = raw.replace(/&amp;/g, "&");
  try {
    const u = new URL(url);
    if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith("/ck/")) {
      const enc = u.searchParams.get("u");
      if (enc?.startsWith("a1")) return Buffer.from(enc.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    }
    if (/duckduckgo\.com$/.test(u.hostname)) return u.searchParams.get("uddg") || url;
  } catch { /* keep raw */ }
  return url;
}

function fandomFromUrl(url: string): { host: string; title: string } | null {
  try {
    const u = new URL(url);
    if (!/\.fandom\.com$/.test(u.hostname)) return null;
    const m = /^\/(?:[a-z-]{2,5}\/)?wiki\/([^?#]+)/.exec(u.pathname);
    if (!m) return null;
    const title = decodeURIComponent(m[1]).replace(/_/g, " ");
    if (/^(?:Category|File|Special|Template|User|Talk):/i.test(title)) return null;
    return { host: u.hostname + (u.pathname.match(/^\/([a-z-]{2,5})\/wiki\//)?.[0].replace(/wiki\/$/, "") || "/").replace(/\/$/, ""), title };
  } catch {
    return null;
  }
}

async function findFandomPage(query: string, hint: string | undefined, snippets: WebSnippet[], signal: AbortSignal) {
  for (const s of snippets) {
    const hit = fandomFromUrl(decodeSearchUrl(s.url));
    if (hit && normal(hit.title).split(" ").some((w) => normal(query).includes(w))) return hit;
  }
  // Guess the wiki from the series name (e.g. "Spy × Family" → spy-x-family.fandom.com).
  if (hint) {
    const slug = normal(hint).replace(/ /g, "-");
    for (const host of [`${slug}.fandom.com`, `${slug.replace(/-/g, "")}.fandom.com`]) {
      const ok = await getJson<{ query?: { pages?: { missing?: boolean; title: string }[] } }>(
        `https://${host}/api.php?action=query&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(query)}`, signal);
      const page = ok?.query?.pages?.[0];
      if (page && !page.missing) return { host, title: page.title };
    }
  }
  return null;
}

interface FandomPage { title: string; missing?: boolean; revisions?: { slots: { main: { content: string } } }[]; original?: { source: string; width: number; height: number } }
interface FandomFile { title: string; imageinfo?: { url: string; width: number; height: number; mime: string }[] }

async function fandom(host: string, title: string, signal: AbortSignal) {
  const api = `https://${host}/api.php?format=json&formatversion=2&redirects=1`;
  const [page, files] = await Promise.all([
    getJson<{ query?: { pages?: FandomPage[] } }>(`${api}&action=query&prop=revisions|pageimages&rvprop=content&rvslots=main&piprop=original&titles=${encodeURIComponent(title)}`, signal),
    // The article plus its gallery subpages, where wikis keep most official art.
    getJson<{ query?: { pages?: FandomFile[] } }>(`${api}&action=query&generator=images&gimlimit=200&prop=imageinfo&iiprop=url|size|mime&titles=${encodeURIComponent([title, `${title}/Gallery`, `${title}/Image Gallery`].join("|"))}`, signal),
  ]);
  const p = page?.query?.pages?.[0];
  const wikitext = p?.revisions?.[0]?.slots?.main?.content;
  if (!p || p.missing || !wikitext) return null;
  return { page: p, wikitext, files: files?.query?.pages || [] };
}

async function fandomPageImages(host: string, titles: string[], signal: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!titles.length) return out;
  const data = await getJson<{ query?: { pages?: FandomPage[]; redirects?: { from: string; to: string }[] } }>(
    `https://${host}/api.php?format=json&formatversion=2&redirects=1&action=query&prop=pageimages&piprop=original&titles=${encodeURIComponent(titles.slice(0, 40).join("|"))}`, signal);
  const back = new Map((data?.query?.redirects || []).map((r) => [r.to, r.from]));
  for (const page of data?.query?.pages || []) {
    if (page.original?.source) {
      out.set(page.title, page.original.source);
      const from = back.get(page.title);
      if (from) out.set(from, page.original.source);
    }
  }
  return out;
}

/** "File:Anya Forger Manga Infobox.png" → "Manga". */
function fileCaption(title: string, subject: string): string {
  let c = title.replace(/^File:/, "").replace(/\.(png|jpe?g|webp|gif)$/i, "").replace(/[_-]+/g, " ");
  for (const word of subject.split(/\s+/)) {
    const w = word.replace(/[^\p{L}\p{N}]/gu, "");
    if (w) c = c.replace(new RegExp(`(^|\\s)${w}(?=\\s|$)`, "iu"), " ");
  }
  c = c
    .replace(/\((?:[^)]*\d{5,}[^)]*)?\)/g, " ")
    .replace(/\b[\w]*\d{5,}[\w]*\b|\b[a-z]*\d+[a-z]+\d*\b/gi, " ")
    .replace(/\b(?:infobox|profile|render|image|img|pic|cropped|crop|cr|edit|full|hd|LOC|retouched|restored)\b/gi, "")
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/\s{2,}/g, " ").trim();
  c = c.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
  return c ? c.replace(/^\w/, (x) => x.toUpperCase()) : "Portrait";
}

// ─── Assemble ────────────────────────────────────────────────────────────────

export async function buildEntityDossier(query: string, signal?: AbortSignal): Promise<EntityDossier | null> {
  const deadline = AbortSignal.timeout(14_000);
  const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const [wiki, snippets] = await Promise.all([
    wikipedia(query, sig),
    fetchEntityWebSnippets(`${query} fandom wiki`, sig, 8).catch(() => [] as WebSnippet[]),
  ]);

  const dossier: EntityDossier = {
    query, title: wiki?.title || titleCase(query), description: wiki?.description, summary: "", text: "", sections: [], trivia: [],
    facts: [], images: [], related: [], sources: [],
    snippets: snippets.map((s) => ({ ...s, url: decodeSearchUrl(s.url) })),
  };

  if (wiki?.extract) {
    const { summary, text } = articleText(wiki.extract);
    dossier.sections.push(...wikipediaSections(wiki.extract, wiki.fullurl || "https://en.wikipedia.org"));
    dossier.summary = summary;
    dossier.text = text;
    if (wiki.fullurl) dossier.sources.push({ label: "Wikipedia", url: wiki.fullurl });
    // The sized thumbnail is a normal JPEG/PNG even when the original is a huge TIFF or SVG.
    const lead = wiki.thumbnail || wiki.original;
    if (lead?.source) dossier.images.push({ url: lead.source, caption: `${wiki.title} (Wikipedia)`, source: wiki.fullurl || "https://en.wikipedia.org", width: lead.width, height: lead.height });
  }

  // Fiction usually has a far richer Fandom page. Series hint comes from the Wikipedia description.
  const seriesHint = /(?:from|in)\s+(?:the\s+)?(?:[\w' ]+?(?:manga|anime|series|franchise|game|novel|film)\s+)?(?:series\s+)?([A-Z][^,.;()]+?)(?:\s+(?:series|franchise|manga|anime))?$/
    .exec(wiki?.description || "")?.[1]
    || /character (?:from|in) [^.]*?(?:'s )?(?:manga|anime|series|game|novel) ([A-Z][^.,]+)/.exec(wiki?.extract?.slice(0, 400) || "")?.[1];
  const fan = await findFandomPage(wiki?.title || query, seriesHint, dossier.snippets, sig);
  const fanData = fan ? await fandom(fan.host, fan.title, sig) : null;
  if (fan && fanData) {
    dossier.fandom = { host: fan.host, title: fanData.page.title };
    const pageUrl = `https://${fan.host}/wiki/${encodeURIComponent(fanData.page.title.replace(/ /g, "_"))}`;
    dossier.sources.push({ label: `${fan.host.split(".")[0].replace(/-/g, " ")} Fandom wiki`, url: pageUrl });
    const box = parseInfobox(fanData.wikitext);
    const relatedTargets: { target: string; label: string; relation: string; note?: string }[] = [];
    if (box) {
      for (const f of box.fields) {
        if (SKIP_FIELD.test(f.key)) continue;
        const value = cleanValue(f.raw);
        if (!value || value.length > 400) continue;
        dossier.facts.push({ label: f.key.replace(/_/g, " "), value, source: pageUrl });
        if (RELATION_FIELD.test(f.key)) for (const t of linkTargets(f.raw)) relatedTargets.push({ ...t, relation: t.note || f.key });
      }
    }
    const quoteAt = fanData.wikitext.search(/\{\{\s*Quote\s*\|/i);
    const quoteEnd = quoteAt >= 0 ? templateEnd(fanData.wikitext, quoteAt) : -1;
    if (quoteEnd > 0) {
      const [, said, speaker] = splitTopLevel(fanData.wikitext.slice(quoteAt + 2, quoteEnd - 2));
      const text = said ? wikitextToPlain(said).replace(/\s+/g, " ").trim() : "";
      if (text.length > 8 && text.length < 300) dossier.quote = text + (speaker ? ` — ${wikitextToPlain(speaker).replace(/\s+/g, " ").trim()}` : "");
    }
    const bodyText = box ? fanData.wikitext.slice(0, box.start) + fanData.wikitext.slice(box.end) : fanData.wikitext;
    const body = wikitextToPlain(bodyText);
    const wikiParts = wikiSections(bodyText, pageUrl);
    dossier.trivia.push(...wikiParts.trivia);
    // Wiki sections describe the subject in-universe; put them before real-world ones.
    dossier.sections.unshift(...wikiParts.sections);
    if (!dossier.summary) dossier.summary = body.split("\n\n").find((p) => p.length > 120) || body.slice(0, 600);
    dossier.text = [dossier.text.slice(0, TEXT_LIMIT / 2), body.slice(0, TEXT_LIMIT)].filter(Boolean).join("\n\n");

    // Images: lead image first, then other large page images.
    if (fanData.page.original?.source) dossier.images.unshift({ url: fanData.page.original.source, caption: `${fanData.page.title} (official)`, source: pageUrl, width: fanData.page.original.width, height: fanData.page.original.height });
    for (const file of fanData.files) {
      const info = file.imageinfo?.[0];
      if (!info || !/^image\/(?:png|jpe?g|webp)$/.test(info.mime) || info.width < 300 || info.height < 200) continue;
      if (/logo|icon|flag|symbol|signature|sprite|banner|button/i.test(file.title)) continue;
      // Only pictures of the subject (wiki file names say who is in them).
      const first = normal(fanData.page.title).split(" ")[0];
      if (first && !normal(file.title).split(" ").includes(first)) continue;
      if (dossier.images.some((i) => i.url.split("/revision")[0] === info.url.split("/revision")[0])) continue;
      dossier.images.push({ url: info.url, caption: fileCaption(file.title, fanData.page.title), source: pageUrl, width: info.width, height: info.height });
    }

    // Related characters, with their own wiki portraits.
    const unique = relatedTargets.filter((t, i, all) => all.findIndex((x) => x.target === t.target) === i && !/\b(?:unnamed|unknown)\b/i.test(t.label)).slice(0, 10);
    const portraits = await fandomPageImages(fan.host, unique.map((t) => t.target), sig);
    dossier.related = unique.map((t) => ({
      name: t.label.replace(/\s*\(.*\)$/, ""),
      relation: t.relation.replace(/_/g, " "),
      url: `https://${fan.host}/wiki/${encodeURIComponent(t.target.replace(/ /g, "_"))}`,
      imageUrl: portraits.get(t.target),
    }));
  }

  // Article images (Commons), sized for the web. Real people and places rely on these.
  // Fictional subjects use their wiki art instead (article photos there are of cast and staff).
  if (wiki?.title && !dossier.fandom) {
    const files = await getJson<{ query?: { pages?: (FandomFile & { imageinfo?: { thumburl?: string; thumbwidth?: number; thumbheight?: number; url: string; width: number; height: number; mime: string }[] })[] } }>(
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=images&gimlimit=60&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1000&titles=" + encodeURIComponent(wiki.title), sig);
    for (const file of files?.query?.pages || []) {
      const info = file.imageinfo?.[0];
      if (!info || !/^image\/(?:jpeg|png|webp)$/.test(info.mime) || info.width < 400 || info.height < 300) continue;
      if (/logo|icon|flag|symbol|signature|seal|map|coat of arms|disambig|commons-|wiki|question_book|edit-clear|crystal|nuvola|padlock|portal|ambox/i.test(file.title)) continue;
      const url = info.thumburl || info.url;
      if (dossier.images.some((i) => i.url.split("/").pop() === url.split("/").pop())) continue;
      dossier.images.push({ url, caption: fileCaption(file.title, ""), source: wiki.fullurl || "https://en.wikipedia.org", width: info.thumbwidth || info.width, height: info.thumbheight || info.height });
    }
  }

  // Real people, places and things: use the Wikipedia infobox for hard facts.
  if (!dossier.facts.length && wiki?.title) {
    const raw = await getJson<{ query?: { pages?: FandomPage[] } }>(
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=content&rvslots=main&rvsection=0&titles=" + encodeURIComponent(wiki.title), sig);
    const box = parseInfobox(raw?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || "");
    for (const f of box?.fields || []) {
      if (SKIP_FIELD.test(f.key) || /^(?:module\d*|child|embed|landscape|upright|website|logo)$/i.test(f.key)) continue;
      const value = cleanValue(f.raw).slice(0, 320);
      if (/url$/i.test(f.key)) continue;
      if (value) dossier.facts.push({ label: f.key.replace(/_/g, " "), value, source: wiki.fullurl || "https://en.wikipedia.org" });
      // Spouses, partners, relatives and named children become connections (portraits come from Wikipedia).
      const relation = /^spouses?$/i.test(f.key) ? "Spouse" : /^partners?$/i.test(f.key) ? "Partner" : /^(?:children|child)$/i.test(f.key) ? "Child"
        : /^(?:relatives?|family|parents?|mother|father|siblings?)$/i.test(f.key) ? "Family" : "";
      if (relation) {
        for (const t of linkTargets(f.raw)) {
          if (/family$|^list of/i.test(t.target) || dossier.related.some((r) => r.name === t.label)) continue;
          dossier.related.push({ name: t.label.replace(/\s*\(.*\)$/, ""), relation, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(t.target.replace(/ /g, "_"))}` });
        }
        // {{marriage|Mileva Marić|1903|1919}} has no link brackets; take the plain name.
        for (const m of f.raw.matchAll(/\{\{\s*marriage\s*\|\s*(?:\[\[)?([^|\]}]+)/gi)) {
          const name = m[1].trim();
          if (name && !dossier.related.some((r) => r.name === name)) dossier.related.push({ name, relation });
        }
      }
    }
  }

  dossier.text = dossier.text.slice(0, TEXT_LIMIT * 1.5);
  if (!dossier.summary) dossier.summary = dossier.snippets.map((s) => s.snippet).join(" ").slice(0, 800);
  if (!dossier.summary && !dossier.facts.length) return null;
  const key = (u: string) => {
    try { const x = new URL(u); return x.hostname.replace(/^(?:www|m)\./, "").replace(/^en\.m\./, "en.") + decodeURIComponent(x.pathname).toLowerCase(); } catch { return u; }
  };
  const subjectWords = normal(dossier.title).split(" ").filter((w) => w.length > 2);
  for (const s of dossier.snippets.slice(0, 6)) {
    if (dossier.sources.length >= 5) break;
    const about = normal(`${s.title} ${decodeURIComponent(s.url)}`);
    if (!subjectWords.every((w) => about.includes(w))) continue;
    if (dossier.sources.some((x) => key(x.url) === key(s.url))) continue;
    try { dossier.sources.push({ label: new URL(s.url).hostname.replace(/^www\./, ""), url: s.url }); } catch { /* bad url */ }
  }
  dossier.images = dossier.images.slice(0, 16);
  const seen = new Set<string>();
  dossier.sections = dossier.sections.filter((x) => { const k = normal(x.title); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  dossier.trivia = dossier.trivia.slice(0, 10);
  return dossier;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** All text the UI is allowed to state facts from (for the fact guard). */
export function dossierCorpus(d: EntityDossier): string {
  return [d.title, d.description, d.summary, d.text, d.quote, ...d.facts.map((f) => `${f.label} ${f.value}`),
    ...d.related.map((r) => `${r.name} ${r.relation || ""}`), ...d.snippets.map((s) => `${s.title} ${s.snippet}`)].filter(Boolean).join("\n");
}

/** The prompt section the UI model writes from. Images are numbered so the model can reference real ones. */
export function dossierPrompt(d: EntityDossier): string {
  const lines = [
    `[RESEARCH DOSSIER — ${d.title}] (retrieved live; this is your ONLY source of facts)`,
    d.description ? `Short description: ${d.description}` : "",
    `Summary: ${d.summary.slice(0, 1400)}`,
    d.quote ? `Signature quote (verbatim from source): "${d.quote}"` : "",
    d.facts.length ? `Infobox facts:\n${d.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")}` : "",
    d.related.length ? `Related (name — relation):\n${d.related.map((r) => `- ${r.name} — ${r.relation}`).join("\n")}` : "",
    d.text ? `Article excerpt:\n${d.text.slice(0, 5000)}` : "",
    d.images.length ? `Verified images (use "imageRef": <number> to place one; never write image URLs):\n${d.images.map((img, i) => `${i + 1}. ${img.caption}${img.width ? ` (${img.width}×${img.height})` : ""}`).join("\n")}` : "",
    `Sources:\n${d.sources.map((s, i) => `[${i + 1}] ${s.label} — ${s.url}`).join("\n")}`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** Lead-image thumbnails for people/things by exact Wikipedia title (used for related people). */
export async function wikipediaPortraits(names: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(names.map((n) => n.replace(/\s*\(.*\)$/, "").trim()).filter(Boolean))].slice(0, 20);
  if (!list.length) return out;
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000);
  const data = await getJson<{ query?: { pages?: (WikiPage & { pageprops?: Record<string, string> })[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } }>(
    "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages|pageprops&piprop=thumbnail&pithumbsize=400&titles=" + encodeURIComponent(list.join("|")), sig);
  const back = new Map<string, string>();
  for (const r of [...(data?.query?.normalized || []), ...(data?.query?.redirects || [])]) back.set(r.to, back.get(r.from) || r.from);
  for (const page of data?.query?.pages || []) {
    // Disambiguation pages don't identify one person.
    if (!page.thumbnail?.source || page.pageprops?.disambiguation !== undefined) continue;
    out.set(page.title, page.thumbnail.source);
    const from = back.get(page.title);
    if (from) out.set(from, page.thumbnail.source);
  }
  return out;
}
