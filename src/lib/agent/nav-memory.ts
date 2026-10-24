// Navigation memory: what worked (and what didn't) on each site, per user, kept in the
// database so later tasks start from known-good moves instead of rediscovering them.
//
// Three kinds of rows, keyed by (owner, host, kind, key):
//   element     a control the agent clicked/typed into: its fingerprint, the page path, how
//               often it worked (the page visibly reacted) or failed, and why it failed.
//   search_url  a site's search results URL with the query replaced by {query}, learned when
//               typing into a search box led to a URL containing the query.
//   route       the page a finished task ended on, by a short goal key (a direct shortcut).
//
// Memory is only ever a hint. Remembered elements are shown to the model only when an
// element with the same fingerprint is on the current page (validated against the live
// DOM), mapped to its current id. Writes are fire-and-forget and never slow an action.
import { q } from "@/lib/server/db";

export interface ElementFingerprint {
  tag: string;
  text: string;
  href: string;
  role: string;
  /** Text of the element's surrounding item/heading, for controls whose label repeats ("Like"). */
  ctx: string;
  /** Index among elements with the same tag, text and ctx on the page. */
  nth: number;
}

export interface MemoryRow {
  kind: "element" | "search_url" | "route";
  key: string;
  data: Record<string, unknown>;
  successes: number;
  failures: number;
  lastError: string | null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    // Ids in paths vary between visits (/watch/123); keep the shape, not the values.
    return new URL(url).pathname.replace(/\/\d+(?=\/|$)/g, "/:n").replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, "/:id").slice(0, 120) || "/";
  } catch {
    return "/";
  }
}

/** A stable key for an element across visits: no ids, no query strings, no counts. */
export function fingerprintKey(fp: Pick<ElementFingerprint, "tag" | "text" | "href" | "ctx">): string {
  const href = fp.href ? pathOf(fp.href) : "";
  const text = fp.text.toLowerCase().replace(/\d+(?:[.,]\d+)*/g, "#").slice(0, 80);
  return [fp.tag, text, href, fp.ctx.toLowerCase().slice(0, 40)].join("|");
}

/** Domain-looking words in a goal ("search fixture.test for ...", "open youtube.com"). */
export function hostsInGoal(goal: string): string[] {
  const out = new Set<string>();
  for (const m of goal.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/gi)) {
    const h = m[1].toLowerCase().replace(/^www\./, "");
    if (!/\.(png|jpe?g|gif|webp|txt|pdf|mp4)$/.test(h)) out.add(h);
  }
  return [...out].slice(0, 3);
}

const READ_TTL_MS = 30_000;
const cache = new Map<string, { at: number; rows: Promise<MemoryRow[]> }>();

/** Everything remembered for a site, most useful first. Cached briefly; never throws. */
export function loadHostMemory(ownerId: string, host: string): Promise<MemoryRow[]> {
  if (!host) return Promise.resolve([]);
  const k = `${ownerId}|${host}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.rows;
  const rows = Promise.resolve()
    .then(() => q(
    `SELECT kind, key, data, successes, failures, last_error FROM nav_memory
     WHERE owner_id = $1 AND host = $2 ORDER BY (successes + failures) DESC, updated_at DESC LIMIT 80`,
    [ownerId, host]
  ))
    .then((rs) =>
      rs.map((r) => ({
        kind: r.kind as MemoryRow["kind"],
        key: String(r.key),
        data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, unknown>,
        successes: Number(r.successes) || 0,
        failures: Number(r.failures) || 0,
        lastError: (r.last_error as string | null) ?? null,
      }))
    )
    .catch(() => [] as MemoryRow[]);
  cache.set(k, { at: Date.now(), rows });
  return rows;
}

function upsert(ownerId: string, host: string, kind: MemoryRow["kind"], key: string, data: Record<string, unknown>, ok: boolean | null, error?: string) {
  if (!ownerId || !host || !key) return;
  cache.delete(`${ownerId}|${host}`);
  void Promise.resolve()
    .then(() => q(
    `INSERT INTO nav_memory (owner_id, host, kind, key, data, successes, failures, last_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (owner_id, host, kind, key) DO UPDATE SET
       data = nav_memory.data || EXCLUDED.data,
       successes = nav_memory.successes + EXCLUDED.successes,
       failures = nav_memory.failures + EXCLUDED.failures,
       last_error = CASE WHEN EXCLUDED.failures > 0 THEN EXCLUDED.last_error WHEN EXCLUDED.successes > 0 THEN NULL ELSE nav_memory.last_error END,
       updated_at = now()`,
    [ownerId, host, kind, key.slice(0, 400), JSON.stringify(data), ok === true ? 1 : 0, ok === false ? 1 : 0, error ? error.slice(0, 200) : null]
  ))
    .catch(() => {});
}

/**
 * Record how a click/type on an element went. On success, `method` (how it was finally done)
 * and its time become the remembered way to do it, replacing an older, slower or broken one.
 */
export function recordElement(ownerId: string, pageUrl: string, fp: ElementFingerprint, ok: boolean, info: { method?: string; error?: string; goal?: string; ms?: number } = {}) {
  const host = hostOf(pageUrl);
  upsert(ownerId, host, "element", fingerprintKey(fp), {
    tag: fp.tag, text: fp.text.slice(0, 90), ctx: fp.ctx.slice(0, 60), path: pathOf(pageUrl),
    ...(ok && info.method ? { method: info.method } : {}),
    ...(ok && info.ms ? { ms: Math.round(info.ms) } : {}),
    ...(ok && info.goal ? { goal: info.goal.slice(0, 80) } : {}),
  }, ok, info.error);
}

/** The interaction method that last worked for this control, if memory trusts it. */
export function preferredMethod(rows: MemoryRow[], fp: ElementFingerprint | null | undefined): "keyboard" | null {
  if (!fp) return null;
  const key = fingerprintKey(fp);
  const r = rows.find((x) => x.kind === "element" && x.key === key);
  return r && r.successes > 0 && r.successes >= r.failures && /^keyboard/.test(String(r.data.method || "")) ? "keyboard" : null;
}

/** Is this remembered entry still trustworthy? Recent failures outweighing successes mean the site changed. */
const outdated = (r: MemoryRow) => r.failures > 0 && r.failures >= r.successes;

/**
 * After visiting a URL, credit or blame the remembered search URL / route it came from, so a
 * shortcut that stopped working (site redesign, moved page) is dropped instead of reused.
 */
export function recordUrlOutcome(ownerId: string, rows: MemoryRow[], url: string, ok: boolean, error?: string) {
  const host = hostOf(url);
  for (const r of rows) {
    if (r.kind === "search_url") {
      const [pre] = r.key.split("{query}");
      if (pre && url.startsWith(pre)) upsert(ownerId, host, "search_url", r.key, {}, ok, error);
    } else if (r.kind === "route" && r.data.url === url) {
      upsert(ownerId, host, "route", r.key, {}, ok, error);
    }
  }
}

/** After typing `query` and submitting, learn the site's search URL if the result URL contains it. */
export function learnSearchUrl(ownerId: string, beforeUrl: string, afterUrl: string, query: string): string | null {
  const template = searchTemplate(afterUrl, query);
  if (!template || hostOf(beforeUrl) !== hostOf(afterUrl)) return null;
  upsert(ownerId, hostOf(afterUrl), "search_url", template, { template }, true);
  return template;
}

export function searchTemplate(url: string, query: string): string | null {
  const q = query.trim();
  if (q.length < 2 || q.length > 120) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  for (const [name, value] of u.searchParams) {
    if (value.trim().toLowerCase() === q.toLowerCase()) {
      const keep = new URLSearchParams();
      // Keep only the query parameter: tracking/session params don't belong in a template.
      keep.set(name, "__Q__");
      return `${u.origin}${u.pathname}?${keep.toString().replace("__Q__", "{query}")}`;
    }
  }
  const enc = encodeURIComponent(q);
  if (u.pathname.includes(enc) || u.pathname.includes(q.replace(/\s+/g, "-"))) {
    const p = u.pathname.includes(enc) ? u.pathname.replace(enc, "{query}") : u.pathname.replace(q.replace(/\s+/g, "-"), "{query}");
    return `${u.origin}${p}`;
  }
  return null;
}

/**
 * Remember the page a finished task ended on, so the same request can go straight there.
 * The fastest known way (fewest actions) wins; a slower run only adds a success.
 */
export function recordRoute(ownerId: string, goal: string, url: string, run: { actions: number; ms: number }, known: MemoryRow[] = []) {
  const host = hostOf(url);
  const key = goalKey(goal);
  if (!host || !key || /^about:|^data:/.test(url)) return;
  const old = known.find((r) => r.kind === "route" && r.key === key);
  const best = Number(old?.data.actions) || Infinity;
  const better = !old || outdated(old) || run.actions <= best;
  upsert(ownerId, host, "route", key, better ? { url: url.slice(0, 600), goal: goal.slice(0, 120), actions: run.actions, ms: Math.round(run.ms) } : {}, true);
}

const STOP = new Set("the a an to of in on for and or then please can you me my it this that is are be with from at by go open find show".split(" "));
export function goalKey(goal: string): string {
  return [...new Set(goal.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)))].sort().slice(0, 10).join(" ");
}

interface LiveElement { id: number; fp?: ElementFingerprint }

/**
 * Hints for the model, validated against the current page: remembered elements are listed
 * only when the same control is on screen now (with its current id).
 */
export function memoryHints(rows: MemoryRow[], opts: { host: string; elements: LiveElement[]; goal: string }): string {
  const lines: string[] = [];
  const byKey = new Map<string, number>();
  for (const e of opts.elements) if (e.fp) byKey.set(fingerprintKey(e.fp), e.id);
  for (const r of rows) {
    if (r.kind !== "element") continue;
    const id = byKey.get(r.key);
    if (id === undefined) continue;
    const label = `[${id}] "${String(r.data.text || "").slice(0, 50)}"`;
    if (r.failures >= 2 && r.successes === 0) lines.push(`- AVOID ${label}: failed ${r.failures}x before${r.lastError ? ` (${r.lastError})` : ""}.`);
    else if (r.successes > 0 && r.successes >= r.failures) lines.push(`- ${label} worked ${r.successes}x before${r.data.method && r.data.method !== "pointer" ? ` (via ${r.data.method})` : ""}${r.data.goal ? ` for "${r.data.goal}"` : ""}.`);
    else if (r.failures > 0 && r.lastError) lines.push(`- ${label} sometimes fails: ${r.lastError}.`);
    if (lines.length >= 8) break;
  }
  // Shortcuts that stopped working are reported as outdated, never offered as the way to go.
  const score = (r: MemoryRow) => r.successes - r.failures * 2;
  const searches = rows.filter((r) => r.kind === "search_url").sort((a, b) => score(b) - score(a));
  const search = searches.find((r) => !outdated(r));
  const stale = searches.filter(outdated);
  if (stale.length) lines.unshift(`- OUTDATED (stopped working${stale[0].lastError ? `: ${stale[0].lastError}` : ""}): ${stale.map((r) => r.key).slice(0, 2).join(", ")}. Don't use it; find the site's search again.`);
  if (search) lines.unshift(`- Search URL on ${opts.host}: ${search.key} (goto it with your query instead of typing into the search box)`);
  const gk = goalKey(opts.goal);
  const route = rows.find((r) => r.kind === "route" && r.key === gk);
  if (route?.data.url && !outdated(route)) lines.unshift(`- This exact request finished before at ${String(route.data.url)}${route.data.actions ? ` (${route.data.actions} actions)` : ""}: goto it directly, then verify.`);
  else if (route?.data.url) lines.unshift(`- OUTDATED route ${String(route.data.url)} (it failed last time); find the way again.`);
  return lines.length ? `Site memory for ${opts.host} (from earlier tasks; verify on the page before relying on it):\n${lines.join("\n")}` : "";
}
