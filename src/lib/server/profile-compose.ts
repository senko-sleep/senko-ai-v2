// Turns "a profile node plus whatever sections the model added" into one intentional
// encyclopedia page: hero + headline stats, grouped infobox, story sections,
// connections, gallery and sources — filled from research, not from guesses.
import type { EntityDossier, DossierFact } from "./entity-dossier";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const sameName = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || (x.split(" ")[0] === y.split(" ")[0] && (x.includes(y) || y.includes(x))));
};

const GROUPS: { group: string; test: RegExp }[] = [
  { group: "Identity", test: /^(?:full ?name|birth ?name|other ?names?|gender|sex|age|birthday|birth ?date|born|birth ?place|place of birth|died|death ?date|death ?place|place of death|resting place|nationality|citizenship|race|species|status|pronouns?)$/i },
  { group: "Appearance", test: /^(?:height|weight|hair(?: colou?r)?|eyes?(?: colou?r)?|blood(?: type)?|skin|build|eye)$/i },
  { group: "Role", test: /^(?:occupation|occupations|profession|job|position|rank|title|affiliation|affiliations|organization|team|class|fields?|field|institutions?|employer|known for|notable works?|awards?|education|alma mater|doctoral advisor|academic advisors|doctoral students|thesis title|thesis year|movement|era|party|office|years active|genre|label|instrument|religion)$/i },
  { group: "In the series", test: /(?:debut|first appearance|appears? in|last appearance|creator|created by|designed by|designer|voice|va$|\bva\b|voiced|portrayed|actor|seiyuu|japvoice|engvoice|mangadebut|animedebut)/i },
];
const SKIP = /^(?:japanese|romaji|kanji|native ?name|alias|aliases|nicknames?|family|relatives?|other|relations?|parents?|children|spouses?|partners?|siblings?|image ?gallery|imagegallery|signature|website|module|embed|name)$/i;
const LABELS: Record<string, string> = { japvoice: "Japanese VA", engvoice: "English VA", mangadebut: "Manga debut", animedebut: "Anime debut", favfood: "Favorite food", favtype: "Ideal type", "hair color": "Hair", "eye color": "Eyes", "blood type": "Blood type", "japanese va": "Japanese VA", "english va": "English VA" };

function label(raw: string): string {
  const key = raw.toLowerCase().replace(/_/g, " ").trim();
  if (LABELS[key] || LABELS[key.replace(/\s+/g, "")]) return LABELS[key] || LABELS[key.replace(/\s+/g, "")];
  const clean = key.replace(/\bva\b/g, "VA");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function groupOf(rawLabel: string): string {
  const key = rawLabel.replace(/_/g, " ").trim();
  return GROUPS.find((g) => g.test.test(key) || g.test.test(key.replace(/\s+/g, "")))?.group || "More";
}

/** A short version of a value for headline tiles: "6 (Forged I.D. papers), 5 (Approximate age)" → "6". */
function short(value: string): string {
  // Prefer the current value: "Test Subject (Formerly), Student" → "Student".
  const parts = value.split(/,\s*(?![^(]*\))|\s*;\s*/).map((s) => s.trim()).filter(Boolean);
  const current = parts.find((s) => !/\((?:formerly|former|previously|deceased|past)[^)]*\)/i.test(s)) || parts[0] || "";
  return current.replace(/\s*\([^)]*\)/g, "").trim().slice(0, 28);
}

const HIGHLIGHT_ORDER = [/^age$/i, /^born$|birth ?date/i, /^died$|death ?date/i, /^height$/i, /^occupation/i, /^fields?$/i, /^nationality|citizenship/i, /^affiliation/i, /^status$/i, /^species|race$/i];

/** Remove wiki citation markers ("[ch. 1–3]", "[12]"), table debris and markdown emphasis. */
function tidyText(text: string): string {
  return text
    .replace(/\s*\[(?:ch|ep|vol|chap|chapter|episode|page|p|citation needed|note)\.?[^\]]{0,40}\]/gi, "")
    .replace(/\s*\[\d{1,3}\]/g, "")
    .replace(/^\s*(?:\{\||\|\}|\|-|!).*$/gm, "")
    .replace(/(\*{1,2}|_{2})([^*_\n]+)\1/g, "$2")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function composeProfile(nodes: Obj[], dossier: EntityDossier | null | undefined): void {
  if (!dossier) return;
  let profile: Obj | null = null;
  const find = (v: unknown): void => {
    if (profile) return;
    if (Array.isArray(v)) { v.forEach(find); return; }
    if (!isObj(v)) return;
    if (v.type === "profile" && sameName(String(v.name || ""), dossier.title)) { profile = v; return; }
    for (const val of Object.values(v)) if (typeof val === "object") find(val);
  };
  find(nodes);
  if (!profile) return;
  const p: Obj = profile;

  // Facts: research first, then model attributes that add something new (they passed the fact guard).
  const facts: DossierFact[] = [...dossier.facts];
  for (const a of (p.attributes as Obj[] | undefined) || []) {
    if (!isObj(a)) continue;
    const l = String(a.label || ""), v = String(a.value ?? "");
    if (!l || !v) continue;
    if (facts.some((f) => norm(label(f.label)) === norm(label(l)) || norm(f.value).includes(norm(v)))) continue;
    // "Atsumi Tanezaki (JP), Megan Shipman (EN)" restates facts already listed under other labels.
    const known = norm(facts.map((f) => f.value).join(" "));
    const words = norm(v).split(" ").filter((w) => w.length > 3);
    if (words.length && words.filter((w) => known.includes(w)).length / words.length >= 0.7) continue;
    facts.push({ label: l, value: v, source: "" });
  }
  const groups = new Map<string, { label: string; value: string }[]>();
  for (const f of facts) {
    if (SKIP.test(f.label.replace(/_/g, " ").trim()) || f.value.length > 220) continue;
    const g = groupOf(f.label);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push({ label: label(f.label), value: f.value });
  }
  const order = ["Identity", "Appearance", "Role", "In the series", "More"];
  p.facts = order.filter((g) => groups.get(g)?.length).map((g) => ({ group: g, items: groups.get(g)!.slice(0, 12) }));
  delete p.attributes;

  const highlights: { label: string; value: string }[] = [];
  for (const re of HIGHLIGHT_ORDER) {
    if (highlights.length >= 4) break;
    const f = facts.find((x) => re.test(x.label.replace(/_/g, " ").trim()));
    if (f && short(f.value)) highlights.push({ label: label(f.label), value: short(f.value) });
  }
  if (highlights.length >= 2) p.highlights = highlights;

  const native = dossier.facts.find((f) => /^(?:japanese|kanji|native ?name)$/i.test(f.label));
  const roman = dossier.facts.find((f) => /^romaji$/i.test(f.label));
  if (native) p.nativeName = [native.value, roman?.value].filter(Boolean).join(" · ");
  const alias = dossier.facts.find((f) => /^(?:alias|aliases|nicknames?)$/i.test(f.label));
  if (alias) p.aliases = alias.value.split(/,\s*(?![^(]*\))/).map((a) => a.replace(/\s*\([^)]*\)/g, "").trim()).filter(Boolean).slice(0, 8);
  if (!p.series && dossier.description) {
    const series = /(?:from|in)\s+(?:the\s+)?(.+?)$/i.exec(dossier.description.replace(/^fictional character\s*/i, ""))?.[1];
    if (series && /^fictional character/i.test(dossier.description)) p.series = series;
  }
  if (!p.subtitle && dossier.description) p.subtitle = dossier.description;
  for (const key of ["subtitle", "bio", "quote", "series"]) if (typeof p[key] === "string") p[key] = tidyText(p[key] as string);
  // Every profile gets a lead paragraph, even when the model skipped it.
  if (!p.bio || String(p.bio).length < 40) {
    // Skip sentences with gaps where the source had a link we couldn't render ("…Party within .").
    const sentences = dossier.summary.split(/(?<=[.!?])\s+/).filter((s) => !/\s[.,;]$|\(\s*\)|\s{2,}\./.test(s.trim()));
    p.bio = tidyText(sentences.slice(0, 3).join(" ").replace(/\s*\((?:Japanese|Hepburn)[^)]*\)/g, ""));
  }

  // Long-form depth comes straight from the articles.
  if (dossier.sections.length) p.sections = dossier.sections.slice(0, 10).map((s) => ({ title: s.title, body: tidyText(s.body) })).filter((s) => s.body.length > 80);
  const trivia = [...dossier.trivia, ...(((p.trivia as string[] | undefined) || []).filter((t) => !dossier.trivia.some((d) => norm(d).includes(norm(t).slice(0, 40)))))]
    .map(tidyText)
    // "According to the fanbook:" introduces a list we don't have; on its own it says nothing.
    .filter((t) => t.length > 20 && !/:\s*$/.test(t));
  if (trivia.length) p.trivia = trivia.slice(0, 8);

  const rels = ((p.relationships as Obj[] | undefined) || []).filter(isObj);
  for (const r of dossier.related) {
    const existing = rels.find((x) => sameName(String(x.name || ""), r.name));
    // The wiki's relation label ("Adoptive Father") is the role; the model's text is the description.
    if (existing) { if (!existing.role || String(existing.role).length > 40) { if (existing.role && !existing.description) existing.description = existing.role; existing.role = r.relation; } }
    else rels.push({ name: r.name, role: r.relation, imageUrl: r.imageUrl });
  }
  if (rels.length) p.relationships = rels.slice(0, 16);

  const gallery = ((p.gallery as Obj[] | undefined) || []).filter(isObj);
  const used = new Set<unknown>([p.imageUrl, ...gallery.map((g) => g.imageUrl)]);
  for (const img of dossier.images) if (!used.has(img.url) && gallery.length < 14) { gallery.push({ title: img.caption, imageUrl: img.url }); used.add(img.url); }
  p.gallery = gallery;
  p.sources = dossier.sources.slice(0, 6);

  // Sibling sections that only repeat what the page now shows are noise.
  const shown = new Set([...facts.map((f) => norm(f.value)), ...facts.map((f) => norm(label(f.label)))]);
  const sectionTitles = new Set(dossier.sections.map((s) => norm(s.title)));
  const redundant = (c: unknown): boolean => {
    if (!isObj(c) || c === p) return false;
    if (c.type === "text" && typeof c.content === "string" && c.content.startsWith("Sources:")) return true;
    // The profile has its own gallery tab and portrait; a second picture block of the same subject repeats it.
    if ((c.type === "gallery" || c.type === "media_card") && (p.gallery as unknown[]).length) {
      const about = norm(`${c.title || ""} ${JSON.stringify(c.items || "").slice(0, 400)}`);
      return !c.title || about.includes(norm(dossier.title).split(" ")[0]);
    }
    if (c.type === "key_value" && Array.isArray(c.items)) {
      const items = c.items.filter(isObj);
      const dup = items.filter((i) => shown.has(norm(String(i.value ?? ""))) || shown.has(norm(String(i.label ?? ""))));
      return items.length > 0 && dup.length / items.length >= 0.6;
    }
    // A birth-and-death timeline only restates the headline facts.
    if (c.type === "timeline" && Array.isArray(c.events) && c.events.length <= 3) {
      const facty = c.events.filter(isObj).every((e) => /\b(?:born|birth|died|death|debut)\b/i.test(`${e.title || ""}`) || shown.has(norm(String(e.date || ""))));
      if (facty) return true;
    }
    if ((c.type === "accordion" || c.type === "tabs") && (Array.isArray(c.items) || Array.isArray(c.tabs))) {
      const list = ((c.items || c.tabs) as Obj[]).filter(isObj);
      return list.length > 0 && list.every((i) => sectionTitles.has(norm(String(i.title || i.label || ""))));
    }
    return false;
  };
  const prune = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(prune); return; }
    if (!isObj(v)) return;
    if (Array.isArray(v.children)) {
      v.children = v.children.filter((c) => !redundant(c));
      // Dividers only make sense between two sections.
      const kids = v.children as unknown[];
      v.children = kids.filter((c, i) => !(isObj(c) && c.type === "divider" && (i === 0 || i === kids.length - 1 || (isObj(kids[i - 1]) && (kids[i - 1] as Obj).type === "divider"))));
    }
    for (const val of Object.values(v)) if (typeof val === "object") prune(val);
  };
  prune(nodes);
  for (let i = nodes.length - 1; i >= 0; i--) if (redundant(nodes[i])) nodes.splice(i, 1);
}
