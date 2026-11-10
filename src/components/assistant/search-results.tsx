"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Search, ShieldCheck } from "lucide-react";
import { CATEGORY_LABELS, type SearchCard, type SearchCategory } from "@/lib/search/types";

const ENGINE_LABEL: Record<string, string> = {
  "google (live browser)": "Google (live browser)",
  "bing (live browser)": "Bing (live browser)",
  "google (Chromium)": "Google",
  "bing (Chromium)": "Bing",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  proxy: "Proxy",
};
const FIRST = 10;

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path ? ` › ${path.split("/").filter(Boolean).slice(0, 3).join(" › ")}` : ""}`;
  } catch {
    return url;
  }
}

/** Search engine style result list: what the engines returned, with working links. */
export function SearchResults({ card }: { card: SearchCard }) {
  const [filter, setFilter] = useState<SearchCategory | "all">("all");
  const [all, setAll] = useState(false);

  const counts = useMemo(() => {
    const c = new Map<SearchCategory, number>();
    for (const r of card.results) c.set(r.category, (c.get(r.category) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [card.results]);

  const shown = card.results.filter((r) => filter === "all" || r.category === filter);
  const visible = all ? shown : shown.slice(0, FIRST);

  return (
    <section className="w-full max-w-[720px] rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-surface,transparent)] p-3 sm:p-4" aria-label={`Search results for ${card.query}`}>
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--sk-muted)]">
        <Search size={13} className="text-[var(--sk-accent-ink)]" aria-hidden />
        <span className="font-semibold text-[var(--sk-text)]">{card.query}</span>
        <span>
          · {card.results.length} result{card.results.length === 1 ? "" : "s"} via {[...new Set(card.engines.map((e) => ENGINE_LABEL[e] || e))].join(", ")}
        </span>
        <span className="ml-auto inline-flex items-center gap-1" title="SafeSearch setting">
          <ShieldCheck size={12} aria-hidden /> SafeSearch {card.safeSearch}
        </span>
      </header>

      {counts.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by category">
          {([["all", card.results.length], ...counts] as [SearchCategory | "all", number][]).map(([cat, n]) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={filter === cat}
              onClick={() => setFilter(cat)}
              className={`rounded-full border px-2.5 py-0.5 text-[11.5px] transition ${
                filter === cat
                  ? "border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                  : "border-[var(--sk-line)] text-[var(--sk-muted)] hover:border-[var(--sk-accent-line)]"
              }`}
            >
              {cat === "all" ? "All" : CATEGORY_LABELS[cat]} <span className="opacity-70">{n}</span>
            </button>
          ))}
        </div>
      )}

      <ol className="flex flex-col divide-y divide-[var(--sk-line)]">
        {visible.map((r) => (
          <li key={r.url} className="py-2.5 first:pt-1">
            <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-[var(--sk-muted)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://www.google.com/s2/favicons?domain=${r.source}&sz=32`} alt="" className="h-4 w-4 shrink-0 rounded-xs" loading="lazy" />
              <span className="min-w-0 truncate">{displayUrl(r.url)}</span>
              {r.link === "ok" && <CheckCircle2 size={11} className="shrink-0 text-[var(--sk-accent-ink)]" aria-label="Link checked" />}
              {r.category !== "general" && (
                <span className="ml-auto shrink-0 rounded-full border border-[var(--sk-line)] px-1.5 text-[10.5px]">{CATEGORY_LABELS[r.category]}</span>
              )}
            </div>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="group mt-0.5 inline-flex max-w-full items-start gap-1 text-[14.5px] font-medium leading-snug text-[var(--sk-accent-ink)] hover:underline"
            >
              <span className="min-w-0 break-words">{r.title}</span>
              <ExternalLink size={12} className="mt-1 shrink-0 opacity-0 transition group-hover:opacity-100" aria-hidden />
            </a>
            {r.snippet && <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-relaxed text-[var(--sk-muted)]">{r.snippet}</p>}
            {new Set(r.engines.map((e) => ENGINE_LABEL[e] || e)).size > 1 && <p className="mt-0.5 text-[10.5px] text-[var(--sk-faint)]">Found by {[...new Set(r.engines.map((e) => ENGINE_LABEL[e] || e))].join(" + ")}</p>}
          </li>
        ))}
      </ol>

      {shown.length > FIRST && (
        <button type="button" onClick={() => setAll((v) => !v)} className="sk-btn mt-1 h-7 w-full border border-[var(--sk-line)] text-[12px]">
          {all ? "Show fewer" : `Show all ${shown.length}`}
        </button>
      )}
      {card.note && <p className="mt-2 text-[11.5px] text-[var(--sk-faint)]">{card.note}</p>}
    </section>
  );
}
