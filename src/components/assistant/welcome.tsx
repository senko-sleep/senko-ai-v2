import type { ReactNode } from "react";
import { Bot, RefreshCw, UserRound, Globe2 } from "lucide-react";
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
    <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center px-4 py-10 sm:px-6 sm:py-14">
      <div className="sk-pop flex flex-col items-center text-center">
        <div className="mb-4 flex h-13 w-13 items-center justify-center rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-solid)] shadow-xs">
          <FoxMark size={32} />
        </div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--sk-faint)]" suppressHydrationWarning>
          {greeting()}
        </p>
        <h1 className="sk-display mt-1.5 text-[26px] font-semibold leading-tight tracking-tight text-[var(--sk-text)] sm:text-[32px]">
          {mode === "agent" ? "What should I do in the browser?" : "How can I help you today?"}
        </h1>
        <p className="mt-2 max-w-md text-[14.5px] text-[var(--sk-muted)]">
          {mode === "agent"
            ? "Describe a task and watch Senko navigate, click, and research live."
            : "Ask a question, drop in an image, or tell me to open a site."}
        </p>
      </div>

      <div className="sk-in mt-7" style={{ animationDelay: "50ms" }}>
        {composer}
      </div>

      <section aria-labelledby="sk-suggest-h" className="sk-in mt-8" style={{ animationDelay: "100ms" }}>
        <div className="mb-3 flex items-center gap-2 px-0.5">
          <h2 id="sk-suggest-h" className="text-[12.5px] font-medium text-[var(--sk-muted)]">
            {personalized && usedHistory ? "Picked for you" : "Suggestions"}
          </h2>
          <button
            type="button"
            onClick={onOpenSettings}
            className="sk-chip transition-colors hover:border-[var(--sk-accent-line)] hover:text-[var(--sk-text)]"
            title="Change in Settings"
          >
            {personalized ? <UserRound size={11} aria-hidden /> : <Globe2 size={11} aria-hidden />}
            {personalized ? "Personalized" : "General"}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="sk-btn ml-auto h-7.5 rounded-lg px-2 text-xs text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
            aria-label="New suggestions"
            title="New suggestions"
          >
            <RefreshCw size={13} className={loading ? "sk-spin" : ""} aria-hidden />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" aria-busy={loading}>
          {showSkeleton
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-solid)] p-3.5" aria-hidden>
                  <div className="sk-skel h-9 w-9 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="sk-skel h-3 w-1/2 rounded-full" />
                    <div className="sk-skel h-2.5 w-5/6 rounded-full" />
                  </div>
                </div>
              ))
            : suggestions.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPick(s)}
                  className={`sk-in group flex items-start gap-3 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-solid)] p-3.5 text-left transition-all hover:border-[var(--sk-accent-line)] hover:bg-[var(--sk-raised)]/50 ${
                    loading ? "opacity-60" : ""
                  }`}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--sk-line)] bg-[var(--sk-raised)] text-[var(--sk-accent-ink)] transition-transform group-hover:scale-105">
                    <SuggestionIcon name={s.icon} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13.5px] font-medium leading-snug text-[var(--sk-text)]">
                      <span className="truncate">{s.title}</span>
                      {s.mode === "agent" && mode !== "agent" && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-[var(--sk-accent-soft)] px-1.5 py-px text-[10px] font-medium text-[var(--sk-accent-ink)]">
                          <Bot size={10} aria-hidden /> Agent
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-[var(--sk-muted)]">{s.prompt}</span>
                  </span>
                </button>
              ))}
        </div>
        {error && !suggestions.length && <p className="mt-3 px-1 text-[12.5px] text-[var(--sk-faint)]">{error}</p>}
      </section>
    </div>
  );
}
