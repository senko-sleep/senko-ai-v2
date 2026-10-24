import type { ReactNode } from "react";
import { ArrowUpRight, Bot, Globe2, RefreshCw, UserRound } from "lucide-react";
import { FoxMark } from "./fox-mark";
import { SuggestionIcon } from "./suggestion-icon";
import type { Mode, Suggestion } from "./lib";

function greeting(d = new Date()) {
  const h = d.getHours();
  const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
  return `${part} · ${d.toLocaleDateString(undefined, { weekday: "long" })}`;
}

export function Welcome({
  mode,
  suggestions,
  loading,
  personalized,
  usedHistory,
  error,
  onPick,
  onRefresh,
  onOpenSettings,
  composer,
}: {
  mode: Mode;
  suggestions: Suggestion[];
  loading: boolean;
  personalized: boolean;
  usedHistory: boolean;
  error: string | null;
  onPick: (s: Suggestion) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  composer: ReactNode;
}) {
  const showSkeleton = loading && suggestions.length === 0;
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[580px] flex-col justify-center px-3.5 py-6 sm:px-6 sm:py-10">
      <div className="sk-pop flex flex-col items-center text-center">
        <FoxMark size={25} className="mb-2.5 drop-shadow-[0_0_18px_rgba(255,122,26,0.5)]" />
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--sk-accent-ink)]/80" suppressHydrationWarning>
          {greeting()}
        </p>
        <h1 className="sk-display mt-1 text-[19px] font-semibold leading-snug tracking-tight text-[var(--sk-text)] sm:text-[23px]">
          {mode === "agent" ? "What should I do in the browser?" : "How can I help you today?"}
        </h1>
        <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-[var(--sk-muted)]">
          {mode === "agent"
            ? "Describe a task and watch Senko navigate, click, and research live."
            : "Ask a question, drop in an image, or tell me to open a site."}
        </p>
      </div>

      <div className="sk-in mt-5" style={{ animationDelay: "40ms" }}>
        {composer}
      </div>

      <section aria-labelledby="sk-suggest-h" className="sk-in mt-5" style={{ animationDelay: "80ms" }}>
        <div className="mb-1.5 flex items-center gap-2 px-1">
          <h2 id="sk-suggest-h" className="text-[11px] font-medium tracking-wide text-[var(--sk-faint)]">
            {personalized && usedHistory ? "Picked for you" : "Suggestions"}
          </h2>
          <button
            type="button"
            onClick={onOpenSettings}
            className="sk-chip transition-colors hover:text-[var(--sk-text)]"
            title="Change in Settings"
          >
            {personalized ? <UserRound size={10.5} aria-hidden /> : <Globe2 size={10.5} aria-hidden />}
            {personalized ? "Personalized" : "General"}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="sk-btn ml-auto h-6 rounded-md px-1.5 text-[11px] text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
            aria-label="New suggestions"
            title="New suggestions"
          >
            <RefreshCw size={11.5} className={loading ? "sk-spin" : ""} aria-hidden />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="divide-y divide-[var(--sk-line)]" aria-busy={loading}>
          {showSkeleton
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2.5 px-1.5 py-2.5" aria-hidden>
                  <div className="sk-skel h-3.5 w-3.5 shrink-0 rounded-full" />
                  <div className="sk-skel h-3 w-1/3 rounded-full" />
                  <div className="sk-skel ml-auto h-2.5 w-2/5 rounded-full" />
                </div>
              ))
            : suggestions.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPick(s)}
                  className={`sk-in sk-suggest group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left ${
                    loading ? "opacity-60" : ""
                  }`}
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  <span className="shrink-0 text-[var(--sk-accent-ink)] opacity-80 transition-opacity group-hover:opacity-100">
                    <SuggestionIcon name={s.icon} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="shrink-0 text-[12.5px] font-medium text-[var(--sk-text)] transition-colors group-hover:text-white">
                        {s.title}
                      </span>
                      {s.mode === "agent" && mode !== "agent" && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-[var(--sk-accent-ink)]">
                          <Bot size={9.5} aria-hidden /> Agent
                        </span>
                      )}
                      <span className="hidden min-w-0 flex-1 truncate text-[11.5px] text-[var(--sk-faint)] transition-colors group-hover:text-[var(--sk-muted)] sm:inline">
                        {s.prompt}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-[var(--sk-faint)] sm:hidden">
                      {s.prompt}
                    </span>
                  </span>
                  <ArrowUpRight
                    size={13}
                    className="shrink-0 text-[var(--sk-faint)] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--sk-accent-ink)] group-hover:opacity-100"
                    aria-hidden
                  />
                </button>
              ))}
        </div>
        {error && !suggestions.length && <p className="mt-2 px-1 text-[11.5px] text-[var(--sk-faint)]">{error}</p>}
      </section>
    </div>
  );
}
