// What the chat's recent tool turns did (embeds, search cards, the comic reader), read back
// from the stored messages. Two uses:
//   - followContext(): the state a follow-up is interpreted against ("now a random hentai
//     website" right after an embed is another embed; "embed the 2nd one" points at a result).
//   - toolNote(): a compact, factual line appended to an assistant message in the LLM history,
//     so the model sees which results it showed and what is embedded, instead of only the
//     one-line summary text ("Here are 10 results for ...").
import type { MessageMeta, StoredMessage } from "./chats";
import type { EmbedFollowContext } from "@/lib/embed/intent";

/** How many assistant turns back a follow-up can still lean on. */
const LOOKBACK = 4;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function toolKind(meta: MessageMeta | undefined): EmbedFollowContext["lastTool"] {
  if (!meta) return null;
  if (meta.embed) return "embed";
  if (meta.search) return "search";
  if (meta.comic) return "comic";
  return null;
}

export function followContext(history: StoredMessage[]): EmbedFollowContext {
  const assistant = history.filter((m) => m.role === "assistant" && !m.meta?.error).slice(-LOOKBACK).reverse();
  const ctx: EmbedFollowContext = { lastTool: toolKind(assistant[0]?.meta) };
  const results: NonNullable<EmbedFollowContext["results"]> = [];
  const seen = new Set<string>();
  const shown = new Set<string>();
  for (const m of assistant) {
    const e = m.meta?.embed;
    if (e) {
      shown.add(e.host || hostOf(e.url));
      ctx.lastEmbed ??= { asked: e.asked, topic: e.topic, purpose: e.purpose, host: e.host || hostOf(e.url), url: e.url };
    }
    for (const r of m.meta?.search?.results ?? []) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push({ title: r.title, url: r.url, snippet: r.snippet, category: r.category });
    }
  }
  // Older embeds still count as "already shown" for "another one".
  for (const m of history.slice(-30)) if (m.role === "assistant" && m.meta?.embed) shown.add(m.meta.embed.host || hostOf(m.meta.embed.url));
  if (results.length) ctx.results = results;
  if (shown.size) ctx.shownHosts = [...shown];
  return ctx;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The tool output of an assistant message, as the model should know it. Empty for plain replies. */
export function toolNote(meta: MessageMeta | undefined): string {
  if (!meta) return "";
  const out: string[] = [];
  if (meta.embed) {
    const e = meta.embed;
    const how = e.mode === "live" ? "opened in the chat's live browser (the site blocks embedding)" : e.mode === "proxy" ? "embedded through the proxy" : "embedded directly";
    out.push(`[Tool result: ${e.url} (${e.title ? clip(e.title, 70) : e.host}) is ${how} in this reply${e.topic ? `, picked for "${e.topic}"` : ""}.]`);
  }
  if (meta.search?.results.length) {
    const s = meta.search;
    const lines = s.results.slice(0, 8).map((r, i) => `${i + 1}. ${clip(r.title, 70)} — ${r.url}`);
    out.push(`[Tool result: search card for "${s.query}" showing ${s.results.length} results:\n${lines.join("\n")}]`);
  }
  if (meta.comic) {
    const c = meta.comic;
    if (c.stage === "sources") out.push(`[Tool result: comic reader asked which site to search for "${c.query}" (${c.sources.map((x) => x.name).join(", ")}).]`);
    else if (c.stage === "results") out.push(`[Tool result: comic reader showing ${c.results.length} "${c.query}" results on ${c.sourceName}.]`);
    else out.push(`[Tool result: comic reader open on "${c.series.title}" from ${c.sourceName}.]`);
  }
  return out.join("\n");
}
