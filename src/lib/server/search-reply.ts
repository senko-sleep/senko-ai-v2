// "search fnf hentai" / "top 20 sites for X": a real search, answered with the results card.
// The reply text is written from the results themselves, so it can't claim anything the
// engines didn't return.
import type { MessageMeta } from "./chats";
import type { SafeSearch } from "@/lib/content-policy";
import { ADULT_SEARCH, detectSearchRequest, type SearchRequest } from "@/lib/search/intent";
import type { SearchCard } from "@/lib/search/types";
import { CATEGORY_LABELS } from "@/lib/search/types";
import { checkAdultImageRequest } from "./adult-guard";
import { buildEntityDossier } from "./entity-dossier";
import { searchWeb, type SearchOptions } from "./web-search";

type Step = (s: { id: number; label: string; status: "running" | "done" | "error"; detail?: string; url?: string }) => void;

export interface SearchTurn {
  content: string;
  meta: Pick<MessageMeta, "search">;
}

const ENGINE_NAMES: Record<string, string> = {
  "google (live browser)": "Google (in your live browser)",
  "bing (live browser)": "Bing (in your live browser)",
  "google (Chromium)": "Google",
  "bing (Chromium)": "Bing",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  proxy: "the search proxy",
};

function list(names: string[]): string {
  const n = [...new Set(names.map((e) => ENGINE_NAMES[e] || e))];
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** The fixed legal limits: nothing sexual involving minors or sexualizing a real person. */
export async function searchAllowed(query: string, signal?: AbortSignal): Promise<{ allowed: boolean; reason?: string }> {
  if (!ADULT_SEARCH.test(query)) return { allowed: true };
  const subject = query.replace(new RegExp(ADULT_SEARCH.source, "gi"), " ").replace(/\s+/g, " ").trim();
  return checkAdultImageRequest(`nsfw ${subject} ${query}`, (name) => buildEntityDossier(name, signal), "search for sexual content");
}

export async function runSearchTurn(
  req: SearchRequest,
  safe: SafeSearch,
  step: Step,
  opts: Pick<SearchOptions, "chatId" | "providers" | "checkLinks"> & { signal?: AbortSignal } = {},
): Promise<SearchTurn> {
  const check = await searchAllowed(req.query, opts.signal).catch(() => ({ allowed: true }));
  if (!check.allowed) return { content: (check as { reason?: string }).reason || "I can't search for that.", meta: {} };

  step({ id: 1, label: `Searching the web for "${req.query}"`, status: "running" });
  const run = await searchWeb(req.query, {
    safe,
    count: req.count,
    signal: opts.signal,
    chatId: opts.chatId,
    providers: opts.providers,
    checkLinks: opts.checkLinks,
    onProgress: (text) => step({ id: 2, label: text, status: "running" }),
  });
  const tried = run.attempts.map((a) => `${ENGINE_NAMES[a.engine] || a.engine}: ${a.error ? "failed" : `${a.count} results`}`).join(", ");
  step({ id: 1, label: `Found ${run.results.length} results for "${req.query}"`, status: run.results.length ? "done" : "error", detail: tried });
  if (opts.checkLinks !== false) step({ id: 2, label: "Checked the links", status: "done", detail: `${run.results.filter((r) => r.link === "ok").length} answered` });

  const note = run.hiddenAdult ? `SafeSearch (${safe}) hid ${run.hiddenAdult} adult result${run.hiddenAdult === 1 ? "" : "s"}. You can change it in Settings.` : undefined;
  if (!run.results.length && run.hiddenAdult) {
    return { content: `SafeSearch is set to ${safe}, so it hid all ${run.hiddenAdult} results for "${req.query}" (they're adult sites). You can change SafeSearch in Settings.`, meta: {} };
  }
  if (!run.results.length) {
    const why = run.attempts.every((a) => a.error || !a.count) ? "None of the search engines answered" : "The search engines didn't return anything that matches";
    return { content: `${why} for "${req.query}"${note ? `. ${note}` : "."} Try different words?`, meta: {} };
  }

  const card: SearchCard = { query: req.query, results: run.results, engines: run.engines, safeSearch: safe, wanted: req.count, note };
  const cats = [...new Set(run.results.map((r) => r.category))].filter((c) => c !== "general").slice(0, 3).map((c) => CATEGORY_LABELS[c].toLowerCase());
  const n = run.results.length;
  const short = n < req.count ? ` (only ${n} matched out of the ${req.count} you asked for)` : "";
  const content =
    `Here ${n === 1 ? "is" : "are"} ${n} result${n === 1 ? "" : "s"} for **${req.query}** from ${list(run.engines)}${short}` +
    `${cats.length ? `, mostly ${cats.join(", ")}` : ""}.${note ? ` ${note}` : ""}`;
  return { content, meta: { search: card } };
}

/** The search part of a chat turn, or null when the message isn't a search. */
export async function searchTurn(text: string, safe: SafeSearch, step: Step, opts: { chatId?: string; signal?: AbortSignal } = {}): Promise<SearchTurn | null> {
  const req = detectSearchRequest(text);
  return req ? runSearchTurn(req, safe, step, opts) : null;
}
