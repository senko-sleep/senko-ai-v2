// After the model composes a UI tree, make it trustworthy before anyone sees it:
//  1. images: every picture is a real, downloaded, decoded image stored by the app
//     (model-invented URLs are dropped; imageQuery slots are resolved on the server)
//  2. facts: names, numbers and dates that don't appear in the research dossier are removed
//  3. sources: the dossier's sources are cited under the UI
import type { EntityDossier } from "./entity-dossier";
import { dossierCorpus, wikipediaPortraits } from "./entity-dossier";
import { searchMultiEngineImages } from "./images";
import { sameImage, verifyGalleryImages, verifyImageUrl, type VerifiedImage } from "./gallery-images";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export interface EnrichOptions {
  dossier?: EntityDossier | null;
  /** Persist verified image bytes (webp) and return the URL the browser should load. */
  store: (data: Buffer) => Promise<string>;
  signal?: AbortSignal;
  /** Total time allowed for image work. */
  budgetMs?: number;
}

export interface EnrichStats { images: number; droppedImages: number; droppedFacts: string[]; inventedUrls: number }

// ─── Image references ────────────────────────────────────────────────────────

/** Replace `imageRef: n` with the dossier's real image n and drop image URLs the model made up. */
export function applyImageRefs(root: unknown, dossier: EntityDossier | null | undefined, stats?: EnrichStats): unknown {
  const allowed = new Set<string>([...(dossier?.images || []).map((i) => i.url), ...(dossier?.related || []).map((r) => r.imageUrl).filter(Boolean) as string[]]);
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit);
    if (!isObj(v)) return v;
    const out: Obj = {};
    for (const [k, val] of Object.entries(v)) out[k] = visit(val);
    const ref = Number(out.imageRef ?? out.imageIndex);
    if (Number.isInteger(ref) && dossier?.images[ref - 1]) {
      out.imageUrl = dossier.images[ref - 1].url;
      // Untitled pictures get their caption so galleries don't read "#2, #3…".
      if (!out.title && !out.name && !out.caption) out.title = dossier.images[ref - 1].caption;
    }
    delete out.imageRef;
    delete out.imageIndex;
    for (const key of ["imageUrl", "image", "thumbnail", "portrait", "avatar", "src"]) {
      const url = out[key];
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
      if (key === "src" && out.type !== "image") continue;
      if (allowed.has(url) || /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\//.test(url)) continue;
      delete out[key];
      if (stats) stats.inventedUrls++;
    }
    return out;
  };
  return visit(root);
}

interface Slot { obj: Obj; label: string; kind: "hero" | "person" | "gallery" | "item" }

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function sameName(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.split(" ")[0] === y.split(" ")[0] && (x.includes(y) || y.includes(x)));
}

/** Collect every place an image can go, filling gaps from the dossier first. */
/** Put the dossier's real pictures where they belong: hero portrait, family portraits, gallery. */
export function fillFromDossier(nodes: Obj[], dossier: EntityDossier | null | undefined): void {
  if (!dossier) return;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isObj(node)) return;
    if (node.type === "profile") {
      const name = String(node.name || "");
      const isSubject = sameName(name, dossier.title);
      if (isSubject && !node.imageUrl && dossier.images[0]) node.imageUrl = dossier.images[0].url;
      for (const r of (node.relationships as Obj[] | undefined) || []) {
        if (!isObj(r)) continue;
        const known = dossier.related.find((d) => sameName(d.name, String(r.name || "")));
        if (known?.imageUrl && !r.imageUrl) r.imageUrl = known.imageUrl;
      }
      if (isSubject) {
        const gallery = ((node.gallery as Obj[] | undefined) || []).filter(isObj);
        const used = new Set(gallery.map((g) => g.imageUrl).concat(node.imageUrl));
        for (const img of dossier.images.slice(1)) {
          if (gallery.length >= 6) break;
          if (!used.has(img.url)) gallery.push({ title: img.caption, imageUrl: img.url });
        }
        node.gallery = gallery;
      }
    }
    for (const v of Object.values(node)) if (typeof v === "object") visit(v);
  };
  visit(nodes);
}

function collectSlots(nodes: Obj[], dossier: EntityDossier | null | undefined): Slot[] {
  void dossier;
  const slots: Slot[] = [];
  const visit = (node: unknown, parentType?: string) => {
    if (Array.isArray(node)) { node.forEach((n) => visit(n, parentType)); return; }
    if (!isObj(node)) return;
    const type = String(node.type || parentType || "");
    if (type === "profile") {
      const name = String(node.name || "");
      slots.push({ obj: node, label: name, kind: "hero" });
      for (const r of (node.relationships as Obj[] | undefined) || []) if (isObj(r)) slots.push({ obj: r, label: String(r.name || ""), kind: "person" });
      for (const g of (node.gallery as Obj[] | undefined) || []) if (isObj(g)) slots.push({ obj: g, label: String(g.title || name), kind: "gallery" });
    } else if (type === "gallery") {
      for (const g of (node.items as Obj[] | undefined) || []) if (isObj(g)) slots.push({ obj: g, label: String(g.title || node.title || ""), kind: "gallery" });
    } else if (type === "media_card" || type === "figure") {
      slots.push({ obj: node, label: String(node.title || node.heading || ""), kind: "hero" });
    } else if (type === "map") {
      for (const m of (node.markers as Obj[] | undefined) || []) if (isObj(m) && (m.imageQuery || m.imageUrl)) slots.push({ obj: m, label: String(m.label || ""), kind: "item" });
    } else if (type === "ranking") {
      for (const it of (node.items as Obj[] | undefined) || []) if (isObj(it) && (it.imageQuery || it.imageUrl)) slots.push({ obj: it, label: String(it.title || ""), kind: "item" });
    } else if (type === "vs_card") {
      for (const side of ["left", "right", "a", "b"]) if (isObj(node[side])) slots.push({ obj: node[side] as Obj, label: String((node[side] as Obj).name || ""), kind: "person" });
      // The schema stores both sides in "combatants".
      for (const c of (node.combatants as Obj[] | undefined) || []) if (isObj(c)) slots.push({ obj: c, label: String(c.name || ""), kind: "item" });
    } else if (node.imageQuery || (typeof node.imageUrl === "string" && /^https?:/.test(node.imageUrl))) {
      // Any other card with a picture: verify it too, so the browser never gets an unchecked URL.
      slots.push({ obj: node, label: String(node.title || node.name || node.label || ""), kind: "item" });
    }
    for (const [k, v] of Object.entries(node)) if (k !== "relationships" && k !== "gallery" && k !== "items" && typeof v === "object") visit(v, k === "children" ? undefined : undefined);
    if (type === "tabs" || type === "accordion") for (const it of (node.items as Obj[] | undefined) || []) if (isObj(it)) visit(it.children);
  };
  visit(nodes);
  // Profile gallery/relationships were visited by the generic walk too; dedupe by object identity.
  return slots.filter((s, i) => slots.findIndex((x) => x.obj === s.obj) === i);
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Resolve every image slot to a verified, stored image. */
export async function resolveImages(nodes: Obj[], opts: EnrichOptions, stats: EnrichStats): Promise<void> {
  const deadline = AbortSignal.timeout(opts.budgetMs ?? 22_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
  const slots = collectSlots(nodes, opts.dossier);
  const accepted: VerifiedImage[] = [];
  const byUrl = new Map<string, Promise<string | undefined>>();
  const storeVerified = async (img: VerifiedImage) => {
    // The same picture in two places (e.g. hero and gallery) is fine; near-duplicates in a gallery are not.
    accepted.push(img);
    return opts.store(img.data);
  };
  const galleryShots: VerifiedImage[] = [];
  const fromUrl = async (url: string, gallery: boolean): Promise<string | undefined> => {
    if (!gallery) {
      if (!byUrl.has(url)) byUrl.set(url, verifyImageUrl(url, signal).then((img) => (img ? storeVerified(img) : undefined)).catch(() => undefined));
      return byUrl.get(url)!;
    }
    // Gallery pictures must be distinct from each other.
    const img = await verifyImageUrl(url, signal).catch(() => undefined);
    if (!img || galleryShots.some((g) => sameImage(g, img))) return undefined;
    galleryShots.push(img);
    return storeVerified(img);
  };
  // Watermarked stock photos and "no image" placeholders are not pictures of the subject.
  const unusable = /alamy|shutterstock|gettyimages|istockphoto|dreamstime|depositphotos|123rf|stock\.adobe|agefotostock|bigstock|no[-_ ]?image|noimage|placeholder|image[-_]?not[-_]?(?:found|available)|default[-_]?(?:avatar|image)/i;
  const searchCache = new Map<string, Promise<import("./images").ScrapedImage[]>>();
  const fromQuery = async (query: string, avoidDupes: boolean): Promise<string | undefined> => {
    if (!searchCache.has(query)) searchCache.set(query, searchMultiEngineImages(query, 1, 40, signal).then((r) => r.images).catch(() => []));
    const candidates = (await searchCache.get(query)!).filter((c) => !unusable.test(`${c.url} ${c.source} ${c.alt}`));
    for await (const batch of verifyGalleryImages(query, candidates, 3, signal)) {
      for (const img of batch) {
        if (avoidDupes && accepted.some((a) => sameImage(a, img))) continue;
        return storeVerified(img);
      }
    }
    return undefined;
  };

  // Real people without a wiki portrait: try their own Wikipedia article before a web image search.
  const people = slots.filter((s) => s.kind === "person" && !s.obj.imageUrl && s.label);
  if (people.length) {
    const found = await wikipediaPortraits(people.map((p) => p.label), signal).catch(() => new Map<string, string>());
    for (const p of people) {
      const hit = found.get(p.label.replace(/\s*\(.*\)$/, "").trim());
      if (hit) p.obj.imageUrl = hit;
    }
  }

  // Known URLs first (fast, exact), then searches.
  const ordered = [...slots].sort((a, b) => Number(!a.obj.imageUrl) - Number(!b.obj.imageUrl));
  await pool(ordered, 6, async (slot) => {
    if (signal.aborted) return;
    const url = typeof slot.obj.imageUrl === "string" ? slot.obj.imageUrl : undefined;
    if (url?.startsWith("/api/uploads/")) return;
    let stored: string | undefined;
    if (url && /^https?:/.test(url)) stored = await fromUrl(url, slot.kind === "gallery");
    const query = typeof slot.obj.imageQuery === "string" && slot.obj.imageQuery.trim()
      ? slot.obj.imageQuery.trim()
      : slot.label && slot.kind !== "gallery" ? `${slot.label} ${opts.dossier?.description?.replace(/^fictional character from /i, "") || ""}`.trim() : "";
    if (!stored && query) stored = await fromQuery(query, slot.kind === "gallery").catch(() => undefined);
    if (stored) {
      slot.obj.imageUrl = stored;
      delete slot.obj.imageQuery;
      stats.images++;
    } else if (signal.aborted && !opts.signal?.aborted) {
      // Out of time, not out of luck: leave the search to the browser rather than show nothing.
      if (query && !slot.obj.imageUrl) slot.obj.imageQuery = query;
    } else {
      delete slot.obj.imageUrl;
      // No verified picture: say so instead of letting the browser guess.
      slot.obj.imageQuery = undefined;
      slot.obj.noImage = true;
      stats.droppedImages++;
    }
  });

  // Gallery items without a real picture are just empty boxes; remove them.
  const prune = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(prune); return; }
    if (!isObj(v)) return;
    if (v.type === "gallery" && Array.isArray(v.items)) v.items = v.items.filter((g) => !isObj(g) || !g.noImage);
    if (v.type === "profile" && Array.isArray(v.gallery)) v.gallery = v.gallery.filter((g) => !isObj(g) || !g.noImage);
    for (const val of Object.values(v)) if (typeof val === "object") prune(val);
  };
  prune(nodes);
}

// Accordion sections live in "items"; validated tabs live in "tabs".
const sectionsOf = (v: Obj): unknown[] => (Array.isArray(v.tabs) ? v.tabs : Array.isArray(v.items) ? v.items : []);
const setSections = (v: Obj, list: unknown[]) => { if (Array.isArray(v.tabs)) v.tabs = list; else v.items = list; };
const hasBody = (it: unknown) => !isObj(it) || (typeof it.content === "string" && !!it.content.trim()) || (Array.isArray(it.children) && it.children.length > 0);

// ─── Fact guard ──────────────────────────────────────────────────────────────

const COMMON = new Set("the a an and or of in on at to for with from by as is was are be his her their its this that these those he she they it i you we not no yes also very more most first last new one two three four five many some all who what when where why how known best".split(" "));

function corpusIndex(corpus: string) {
  const text = norm(corpus);
  const words = new Set(text.split(" "));
  const digits = corpus.replace(/[,\s](?=\d{3}\b)/g, "");
  return { text, words, digits };
}

/** Claim tokens: numbers and proper nouns. Generic words carry no checkable claim. */
function claims(value: string, prose = false): { numbers: string[]; names: string[] } {
  // In prose, a capital at the start of a sentence is grammar, not a name.
  if (prose) value = value.replace(/(^|[.!?:;]\s+|\n)[A-Z][\p{L}'’-]*/gu, "$1");
  const numbers = (value.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/,/g, "")).filter((n) => n.length >= 2 || /\b(?:cm|kg|m|ft|years?|episode|chapter|season)\b/i.test(value));
  const names = (value.match(/(?:^|[\s(“"'-])([A-Z][\p{L}'’.-]{2,})/gu) || [])
    .map((w) => w.trim().replace(/^[(“"'-]/, "").replace(/[.’']+$/, ""))
    .filter((w) => !COMMON.has(w.toLowerCase()));
  return { numbers, names };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A full date (2022-04-09) is only supported when the corpus states that day. */
function dateSupported(value: string, idx: ReturnType<typeof corpusIndex>): boolean | null {
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return false;
  const day = String(Number(d));
  return idx.text.includes(`${day} ${month} ${y}`) || idx.text.includes(`${month} ${day} ${y}`) || idx.text.includes(`${y} ${mo} ${d}`);
}

export function supported(value: string, idx: ReturnType<typeof corpusIndex>, prose = false): boolean {
  value = value.replace(/[‐‑–—]/g, "-");
  const dated = dateSupported(value, idx);
  if (dated === false) return false;
  if (dated) value = value.replace(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/, "");
  const { numbers, names } = claims(value, prose);
  if (!numbers.length && !names.length) return true;
  for (const n of numbers) if (!idx.digits.includes(n) && !idx.text.includes(n)) return false;
  if (!names.length) return true;
  const hit = names.filter((w) => {
    const k = norm(w);
    if (!k) return true;
    if (idx.words.has(k)) return true;
    // Allow inflections ("Telepathic" vs "telepath", "Ostanian" vs "Ostania").
    const stem = k.slice(0, Math.max(4, Math.ceil(k.length * 0.7)));
    return k.length >= 4 && idx.text.includes(stem);
  });
  return hit.length / names.length >= 0.6;
}

/** Remove claims the dossier doesn't support. Only runs with a substantial dossier. */
export function guardFacts(nodes: Obj[], dossier: EntityDossier | null | undefined, stats: EnrichStats, opts: { prose?: boolean } = {}): void {
  // Opinion/analysis replies keep their prose (it is Senko's take); only hard facts are checked.
  const checkProse = opts.prose !== false;
  if (!dossier) return;
  const corpus = dossierCorpus(dossier);
  if (corpus.length < 300) return;
  const idx = corpusIndex(corpus);
  const check = (text: string, where: string, prose = false) => {
    const ok = supported(text, idx, prose);
    if (!ok) stats.droppedFacts.push(`${where}: ${text.slice(0, 80)}`);
    return ok;
  };
  /** Keep only the sentences of a paragraph that the sources support. */
  const proseFilter = (text: string, where: string) =>
    text.split(/(?<=[.!?])\s+/).filter((s) => check(s, where, true)).join(" ");
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!isObj(v)) return;
    switch (v.type) {
      case "profile": {
        if (Array.isArray(v.attributes)) v.attributes = v.attributes.filter((a) => !isObj(a) || check(`${a.value}`, String(a.label)));
        if (Array.isArray(v.trivia)) v.trivia = v.trivia.filter((t) => typeof t !== "string" || check(t, "trivia", true));
        if (typeof v.quote === "string") {
          const words = norm(v.quote).split(" ").filter((w) => w.length > 3);
          const found = words.filter((w) => idx.words.has(w)).length;
          if (words.length && found / words.length < 0.8) { stats.droppedFacts.push(`quote: ${v.quote}`); delete v.quote; }
        }
        if (typeof v.subtitle === "string" && !check(v.subtitle, "subtitle")) delete v.subtitle;
        if (typeof v.bio === "string") v.bio = v.bio.split(/(?<=[.!?])\s+/).filter((s) => check(s, "bio", true)).join(" ") || dossier.summary.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
        if (Array.isArray(v.appearances)) v.appearances = v.appearances.filter((a) => !isObj(a) || check(`${a.title} ${a.subtitle || ""}`, "appearance"));
        break;
      }
      case "key_value":
        if (Array.isArray(v.items)) v.items = v.items.filter((a) => !isObj(a) || check(`${a.value}`, String(a.label)));
        break;
      case "stat_grid":
        if (Array.isArray(v.stats)) v.stats = v.stats.filter((a) => !isObj(a) || check(`${a.value}`, String(a.label)));
        break;
      case "timeline":
        if (Array.isArray(v.events)) v.events = v.events.filter((e) => !isObj(e) || check(`${e.date || ""} ${e.title || ""}`, "timeline") && (!e.description || check(String(e.description), "timeline", true)));
        break;
      case "text":
        if (checkProse && typeof v.content === "string" && !v.content.includes("[[cite:")) v.content = proseFilter(v.content, "text");
        break;
      case "accordion":
      case "tabs":
        if (checkProse) for (const item of sectionsOf(v)) if (isObj(item) && typeof item.content === "string") item.content = proseFilter(item.content, String(item.title || item.label || v.type));
        break;
    }
    for (const val of Object.values(v)) if (typeof val === "object") visit(val);
  };
  visit(nodes);
  // Sections the guard emptied are noise.
  const strip = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(strip); return; }
    if (!isObj(v)) return;
    if (v.type === "accordion" || v.type === "tabs") setSections(v, sectionsOf(v).filter(hasBody));
    for (const val of Object.values(v)) if (typeof val === "object") strip(val);
  };
  strip(nodes);
  const empty = (v: unknown): boolean => isObj(v) && (
    (v.type === "key_value" && Array.isArray(v.items) && !v.items.length) ||
    // A one-event timeline isn't a timeline.
    (v.type === "timeline" && Array.isArray(v.events) && v.events.length < 2) ||
    ((v.type === "accordion" || v.type === "tabs") && !sectionsOf(v).length) ||
    (v.type === "text" && typeof v.content === "string" && !v.content.trim()) ||
    (v.type === "stat_grid" && Array.isArray(v.stats) && !v.stats.length));
  const prune = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(prune); return; }
    if (!isObj(v)) return;
    if (Array.isArray(v.children)) v.children = v.children.filter((c) => !empty(c));
    for (const val of Object.values(v)) if (typeof val === "object") prune(val);
  };
  prune(nodes);
  // Tabs/accordion items whose sections were all removed are empty now; remove them too.
  const pruneItems = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(pruneItems); return; }
    if (!isObj(v)) return;
    if (v.type === "accordion" || v.type === "tabs") {
      for (const it of sectionsOf(v)) if (isObj(it) && Array.isArray(it.children)) it.children = it.children.filter((c) => !empty(c));
      setSections(v, sectionsOf(v).filter(hasBody));
    }
    for (const val of Object.values(v)) if (typeof val === "object") pruneItems(val);
  };
  pruneItems(nodes);
  prune(nodes);
}

// ─── Sources footer ──────────────────────────────────────────────────────────

export function sourcesNode(dossier: EntityDossier): Obj | null {
  const sources = dossier.sources.filter((s) => /^https?:\/\//.test(s.url)).slice(0, 5);
  if (!sources.length) return null;
  return { type: "text", variant: "caption", content: `Sources: ${sources.map((s) => `[[cite: ${s.label.replace(/[|\]]/g, " ").trim()} | ${s.url}]]`).join(" ")}` };
}

// ─── Deterministic layout from research (used when every model fails) ────────

const PERSONAL = /^(?:japanese|romaji|kanji|alias|gender|sex|age|height|weight|birthday|birth ?date|born|birth ?place|death ?date|died|death ?place|hair(?: colou?r)?|eyes?(?: colou?r)?|blood(?: type)?|race|species|nationality|status|occupation|affiliation|citizenship|fields|education|alma mater|spouse|children)$/i;
const MEDIA = /(?:debut|va|voice|voiced|portrayed|actor|creator|created by|designed by|first appearance|appears in)/i;

export function dossierUI(dossier: EntityDossier): Obj {
  const facts = dossier.facts.filter((f) => f.value.length <= 140);
  const personal = facts.filter((f) => PERSONAL.test(f.label) && !/alias/i.test(f.label)).slice(0, 12);
  const media = facts.filter((f) => MEDIA.test(f.label)).slice(0, 8);
  const alias = facts.find((f) => /alias|nickname/i.test(f.label));
  const sentences = dossier.summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  const profile: Obj = {
    type: "profile",
    name: dossier.title,
    subtitle: dossier.description,
    bio: sentences.slice(0, 4).join(" "),
    quote: dossier.quote,
    imageUrl: dossier.images[0]?.url,
    badges: alias ? alias.value.split(/,\s*/).slice(0, 4).map((a) => a.replace(/\s*\(.*\)$/, "")) : undefined,
    attributes: personal.map((f) => ({ label: titleLabel(f.label), value: f.value })),
    relationships: dossier.related.slice(0, 8).map((r) => ({ name: r.name, role: r.relation, imageUrl: r.imageUrl })),
    gallery: dossier.images.slice(1, 7).map((i) => ({ title: i.caption, imageUrl: i.url })),
  };
  const children: Obj[] = [profile];
  if (media.length) children.push({ type: "key_value", title: "In the series", cols: 2, items: media.map((f) => ({ label: titleLabel(f.label), value: f.value })) });
  const sections = dossier.text.split(/\n\n(?=[A-Z][^\n:]{2,40}:\n)/).map((s) => {
    const m = /^([^\n:]{2,40}):\n([\s\S]+)$/.exec(s.trim());
    return m ? { title: m[1], body: m[2].trim().slice(0, 1400) } : null;
  }).filter((s): s is { title: string; body: string } => !!s && s.body.length > 160).slice(0, 5);
  if (sections.length) children.push({ type: "accordion", title: "Background", items: sections.map((s) => ({ title: s.title, children: [{ type: "text", variant: "body", content: s.body }] })) });
  const src = sourcesNode(dossier);
  if (src) children.push(src);
  return { type: "stack", children };
}

function titleLabel(label: string): string {
  const map: Record<string, string> = { va: "VA", japvoice: "Japanese VA", engvoice: "English VA", mangadebut: "Manga debut", animedebut: "Anime debut", favfood: "Favorite food" };
  const key = label.toLowerCase().replace(/\s+/g, "");
  if (map[key]) return map[key];
  return label.replace(/\b(va)\b/gi, "VA").replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Presentation cleanup ────────────────────────────────────────────────────

const SUPERSCRIPT: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

/** Profile/key-value fields render as plain text, so "$E=mc^2$" becomes "E=mc²". */
function plainMath(text: string): string {
  return text.replace(/\$([^$\n]{1,60})\$/g, (_, expr: string) =>
    expr.replace(/\^\{?(-?\d+)\}?/g, (__, p: string) => [...p].map((c) => SUPERSCRIPT[c] || c).join("")).replace(/\\(?:cdot|times)/g, "×").replace(/[{}\\]/g, ""));
}

function factKey(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[\s,.  ]/g, "").replace(/[()]/g, "");
}

/** Show each fact once: later key_value/stat_grid entries that repeat an earlier value or label are dropped. */
export function tidyUI(nodes: Obj[]): void {
  const seenValues = new Set<string>();
  const seenLabels = new Set<string>();
  const remember = (label: unknown, value: unknown) => { seenValues.add(factKey(value)); seenLabels.add(factKey(label)); };
  const repeats = (label: unknown, value: unknown) => {
    const v = factKey(value);
    return (v.length >= 2 && seenValues.has(v)) || seenLabels.has(factKey(label)) && [...seenValues].some((s) => s && v && (s.includes(v) || v.includes(s)));
  };
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!isObj(v)) return;
    for (const key of ["bio", "quote", "subtitle", "content"]) if (typeof v[key] === "string" && v.type !== "text" && v.type !== "math") v[key] = plainMath(v[key] as string);
    // Grouped profile facts and headline stats count as already shown.
    if (v.type === "profile") {
      for (const g of (v.facts as Obj[] | undefined) || []) for (const it of ((isObj(g) && g.items) as Obj[] | undefined) || []) if (isObj(it)) remember(it.label, it.value);
      for (const h of (v.highlights as Obj[] | undefined) || []) if (isObj(h)) remember(h.label, h.value);
    }
    const list = v.type === "profile" ? "attributes" : v.type === "key_value" ? "items" : v.type === "stat_grid" ? "stats" : "";
    if (list && Array.isArray(v[list])) {
      v[list] = (v[list] as unknown[]).filter((a) => {
        if (!isObj(a)) return true;
        if (typeof a.value === "string") a.value = plainMath(a.value);
        if (v.type !== "profile" && repeats(a.label, a.value)) return false;
        remember(a.label, a.value);
        return true;
      });
    }
    for (const val of Object.values(v)) if (typeof val === "object") visit(val);
  };
  visit(nodes);
  // Sections emptied by de-duplication go away.
  const prune = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(prune); return; }
    if (!isObj(v)) return;
    if (Array.isArray(v.children)) v.children = v.children.filter((c) => !(isObj(c) && ((c.type === "key_value" && Array.isArray(c.items) && !c.items.length) || (c.type === "stat_grid" && Array.isArray(c.stats) && !c.stats.length))));
    for (const val of Object.values(v)) if (typeof val === "object") prune(val);
  };
  prune(nodes);
}
