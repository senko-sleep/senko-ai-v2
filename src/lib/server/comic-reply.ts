// The in-chat comic reader flow, one step per chat turn:
//   "send me a manga of fnf"  -> which site?          (stage "sources")
//   "Webtoon Canvas" / "1"    -> top 20 there          (stage "results")
//   "#3" / a title            -> reader with all pages (stage "reader")
// Adult requests ("fnf hentai comic") run the same flow with the adult sites listed, when
// SafeSearch is off and the subject passes the fixed limits (no minors, no real people).
import type { MessageMeta, StoredMessage } from "./chats";
import type { SafeSearch } from "@/lib/content-policy";
import type { ComicCard, ComicSourceId } from "@/lib/comics/types";
import { detectComicRequest, OTHER_SITE, parseSeriesChoice, parseSourceChoice } from "@/lib/comics/intent";
import { checkAdultImageRequest } from "./adult-guard";
import { isAdultSite, reachableAdultSources, comicChapters, comicPages, refererFor, searchComics, sourceInfo, sourcesFor } from "./comics";
import { buildEntityDossier } from "./entity-dossier";

type Step = (s: { id: number; label: string; status: "running" | "done" | "error"; detail?: string; url?: string }) => void;

export interface ComicTurn {
  content: string;
  meta: Pick<MessageMeta, "comic">;
}

/** The reader card the last assistant reply showed, if any. */
function lastCard(history: StoredMessage[]): ComicCard | undefined {
  const last = [...history].reverse().find((m) => m.role === "assistant");
  return last?.meta?.comic;
}

/**
 * The latest results grid while the chat is still in the reader flow, so "#17" works after
 * a reader is already open. Stops at the first assistant reply that wasn't a comic card.
 */
function lastResults(history: StoredMessage[]): Extract<ComicCard, { stage: "results" }> | undefined {
  for (const m of [...history].reverse()) {
    if (m.role !== "assistant") continue;
    const c = m.meta?.comic;
    if (!c) return undefined;
    if (c.stage === "results") return c;
  }
  return undefined;
}

/** Fandom short names people type; the full name is what the archives tag. */
const SHORT_NAMES: Record<string, string> = {
  fnf: "Friday Night Funkin",
  fnaf: "Five Nights at Freddys",
  mlp: "My Little Pony",
  jjba: "JoJos Bizarre Adventure",
  botw: "The Legend of Zelda",
  totk: "The Legend of Zelda",
  mha: "My Hero Academia",
  bnha: "My Hero Academia",
  aot: "Attack on Titan",
  snk: "Attack on Titan",
  ddlc: "Doki Doki Literature Club",
  hsr: "Honkai Star Rail",
  zzz: "Zenless Zone Zero",
  sao: "Sword Art Online",
  tlou: "The Last of Us",
  rwby: "RWBY",
};

/** The series most E-Hentai results for "fnf" are tagged with ("parody:friday night funkin"). */
async function parodyTag(query: string, signal?: AbortSignal): Promise<string | null> {
  const found = await searchComics("ehentai", [query], "off", signal, true, { relevance: false }).catch(() => []);
  const counts = new Map<string, number>();
  for (const s of found) {
    for (const t of (s.description || "").split(", ")) {
      const m = /^parody:(.+)$/.exec(t);
      if (m && m[1] !== "original") counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 3 ? best[0] : null;
}

/** "fnf" finds little; its full name ("Friday Night Funkin'") finds the rest. */
async function alsoTry(query: string, signal?: AbortSignal, adult = false): Promise<string[]> {
  const extra: string[] = [];
  const short = SHORT_NAMES[query.toLowerCase().trim()];
  if (short) extra.push(short);
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(7_000)]) : AbortSignal.timeout(7_000);
  const dossier = short ? null : await buildEntityDossier(query, sig).catch(() => null);
  // A disambiguation page ("FNF: Topics referred to by the same term") is no full name.
  const vague = !dossier || /same term|may refer to|disambiguation/i.test(dossier.description || "");
  const full = vague ? null : dossier.title?.replace(/\s*\(.*?\)\s*/g, " ").replace(/['’]/g, "").trim();
  if (full && full.toLowerCase() !== query.toLowerCase()) extra.push(full);
  if (!short && !full && adult) {
    const tag = await parodyTag(query, sig).catch(() => null);
    if (tag && tag.toLowerCase() !== query.toLowerCase()) extra.push(tag);
  }
  extra.push(`${query} comic`);
  return extra;
}

async function otherSites(source: ComicSourceId, adult: boolean, safe: SafeSearch, signal?: AbortSignal) {
  return (await sitesFor(adult, safe, signal)).filter((s) => s.id !== source);
}

/** Adult sites only when SafeSearch is off, and only the ones this server can load. */
async function sitesFor(adult: boolean, safe: SafeSearch, signal?: AbortSignal) {
  return adult && safe === "off" ? reachableAdultSources(signal) : sourcesFor(false);
}

async function results(query: string, source: ComicSourceId, safe: SafeSearch, step: Step, signal: AbortSignal | undefined, adult: boolean): Promise<ComicTurn> {
  const info = sourceInfo(source);
  step({ id: 1, label: `Searching ${info.name} for "${query}"`, status: "running" });
  // Adult archives match loosely: search the full name too ("fnf" -> "Friday Night Funkin").
  let found = isAdultSite(source)
    ? await searchComics(source, [...(await alsoTry(query, signal, true)).filter((q) => !q.endsWith(" comic")), query], safe, signal, adult)
    : await searchComics(source, [query], safe, signal, adult);
  if (found.length < 20 && !signal?.aborted && !isAdultSite(source)) {
    const more = await searchComics(source, await alsoTry(query, signal), safe, signal, adult).catch(() => []);
    const ids = new Set(found.map((s) => s.id));
    found = [...found, ...more.filter((s) => !ids.has(s.id))].slice(0, 20);
  }
  step({ id: 1, label: `Found ${found.length} on ${info.name}`, status: found.length ? "done" : "error" });
  if (!found.length) {
    const card: ComicCard = { stage: "sources", query, sources: await otherSites(source, adult, safe, signal), adult };
    return { content: `Nothing for "${query}" on ${info.name}, sorry! Want me to try another site?`, meta: { comic: card } };
  }
  const card: ComicCard = { stage: "results", query, source, sourceName: info.name, results: found, adult };
  return {
    content: `Here are the top ${found.length} "${query}" picks on ${info.name}! Tap one (or tell me the number) and I'll open it.`,
    meta: { comic: card },
  };
}

async function reader(card: Extract<ComicCard, { stage: "results" }>, pick: Extract<ComicCard, { stage: "results" }>["results"][number], safe: SafeSearch, step: Step, signal?: AbortSignal): Promise<ComicTurn> {
  step({ id: 1, label: `Opening "${pick.title}"`, status: "running", url: pick.url });
  const chapters = await comicChapters(card.source, pick.id, safe, signal);
  step({ id: 1, label: `${chapters.length} chapter(s) in "${pick.title}"`, status: chapters.length ? "done" : "error", url: pick.url });
  if (!chapters.length) {
    const why = card.source === "tapas" ? " (Tapas locks paid and mature episodes behind a login)" : "";
    return { content: `"${pick.title}" has no chapters I can read here${why}. Pick another one?`, meta: { comic: card } };
  }
  const first = chapters[0];
  step({ id: 2, label: `Loading pages of ${first.title}`, status: "running" });
  const pages = await comicPages(card.source, first.id, signal).catch(() => []);
  step({ id: 2, label: `Loaded ${pages.length} page(s)`, status: pages.length ? "done" : "error" });
  const view: ComicCard = {
    stage: "reader",
    source: card.source,
    sourceName: card.sourceName,
    series: pick,
    chapters,
    chapterId: first.id,
    pages,
    referer: refererFor(card.source),
  };
  const parts = chapters.length === 1 ? `${pages.length} pages` : `${chapters.length} chapters`;
  return {
    content: `Opened **${pick.title}**${pick.author ? ` by ${pick.author}` : ""} from ${card.sourceName}: ${parts}. Scroll through every page${chapters.length > 1 ? ", or switch chapters at the top" : ""}.`,
    meta: { comic: view },
  };
}

/**
 * Handles this turn if it is part of the reader flow; otherwise returns null and the
 * normal chat reply runs.
 */
export async function comicTurn(content: string, history: StoredMessage[], safe: SafeSearch, step: Step, signal?: AbortSignal): Promise<ComicTurn | null> {
  // "#17 <title>" is a pick from the grid, even when the title has words like "hentai" in it.
  const fresh = /^\s*#\d{1,2}\b/.test(content) ? null : detectComicRequest(content);
  const prev = lastCard(history);

  if (!fresh && prev?.stage === "sources") {
    const source = parseSourceChoice(content, prev.sources);
    if (source) return results(prev.query, source, safe, step, signal, !!prev.adult);
  }
  if (!fresh && prev?.stage === "results") {
    const adult = !!prev.adult;
    if (OTHER_SITE.test(content)) {
      return {
        content: `Sure! Where should I look for "${prev.query}" instead?`,
        meta: { comic: { stage: "sources", query: prev.query, sources: await otherSites(prev.source, adult, safe, signal), adult } },
      };
    }
    const pick = parseSeriesChoice(content, prev.results);
    if (pick) return reader(prev, pick, safe, step, signal);
    const source = parseSourceChoice(content, await sitesFor(adult, safe, signal));
    if (source && source !== prev.source && content.trim().split(/\s+/).length <= 5) return results(prev.query, source, safe, step, signal, adult);
  }
  // Reading one already: "#17" / a title still picks from the grid shown before it.
  if (!fresh && prev?.stage === "reader") {
    const grid = lastResults(history);
    const pick = grid && content.trim().split(/\s+/).length <= 14 ? parseSeriesChoice(content, grid.results) : null;
    if (grid && pick) return reader(grid, pick, safe, step, signal);
    if (grid && OTHER_SITE.test(content)) {
      return {
        content: `Sure! Where should I look for "${grid.query}" instead?`,
        meta: { comic: { stage: "sources", query: grid.query, sources: await otherSites(grid.source, !!grid.adult, safe, signal), adult: grid.adult } },
      };
    }
  }
  if (!fresh) return null;

  const adult = !!fresh.explicit;
  if (adult) {
    // Same fixed limits as adult images: no minors, no real people.
    const check = await checkAdultImageRequest(`nsfw ${fresh.query}`, (name) => buildEntityDossier(name, signal), "find sexual comics");
    if (!check.allowed) {
      return {
        content: `${check.reason} I can pull up regular ${fresh.query} comics instead. Which site?`,
        meta: { comic: { stage: "sources", query: fresh.query, sources: sourcesFor(false) } },
      };
    }
    if (safe !== "off") {
      return {
        content: `SafeSearch is on (${safe}), so I can't pull up hentai sites. Turn it off in settings and ask again, or pick a regular site for ${fresh.query}.`,
        meta: { comic: { stage: "sources", query: fresh.query, sources: sourcesFor(false) } },
      };
    }
  }
  if (fresh.source) return results(fresh.query, fresh.source, safe, step, signal, adult);
  const sources = await sitesFor(adult, safe, signal);
  return {
    content: adult
      ? `Ooh, ${fresh.query} hentai! Which site should I dig through? Pick one and I'll pull up the top 20 there.`
      : `Ooh, ${fresh.query}! Which site should I dig through? Pick one and I'll pull up the top 20 there.`,
    meta: { comic: { stage: "sources", query: fresh.query, sources, adult } },
  };
}
