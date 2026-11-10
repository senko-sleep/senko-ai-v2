"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { filterActivity, formatActivityText, summarizeActivity, type ActivityCategory, type ActivityEntry } from "@/lib/agent/activity-log";

const CATEGORIES: { id: ActivityCategory; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "research", label: "Research" },
  { id: "terminal", label: "Terminal" },
  { id: "files", label: "Files" },
  { id: "testing", label: "Testing" },
];

const STATUS_TEXT: Record<ActivityEntry["status"], string> = { running: "running", done: "ok", error: "failed" };
const STATUS_CLASS: Record<ActivityEntry["status"], string> = { running: "text-[var(--sk-accent-ink)]", done: "text-emerald-300", error: "text-rose-300" };

/** Chronological, searchable view over step events streamed by the server. */
export function WorkspaceActivityLog({ entries }: { entries: ActivityEntry[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<ReadonlySet<ActivityCategory>>(new Set());
  const [errorsOnly, setErrorsOnly] = useState(false);
  const counts = useMemo(() => summarizeActivity(entries), [entries]);
  const visible = useMemo(() => filterActivity(entries, { query, categories: active, errorsOnly }), [entries, query, active, errorsOnly]);

  const toggle = (id: ActivityCategory) => setActive((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <section aria-label="Activity log" className="flex min-h-0 flex-col gap-2">
    <div className="flex flex-wrap items-center gap-1.5">
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity" aria-label="Search activity" className="h-6 min-w-0 flex-1 rounded border border-[var(--sk-line)] bg-transparent px-2 text-[11px] text-[var(--sk-text)] outline-none focus:border-[var(--sk-line-strong)]" />
      <button type="button" disabled={visible.length === 0} onClick={() => void navigator.clipboard?.writeText(formatActivityText(visible))} aria-label="Copy visible activity" title="Copy visible activity" className="sk-btn flex h-6 w-6 items-center justify-center rounded border border-[var(--sk-line)] text-[var(--sk-muted)] disabled:opacity-40"><Copy className="h-3 w-3" /></button>
    </div>
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by category">
      {CATEGORIES.map((category) => <button key={category.id} type="button" aria-pressed={active.has(category.id)} onClick={() => toggle(category.id)} className={`h-5 rounded border px-1.5 text-[10.5px] ${active.has(category.id) ? "border-[var(--sk-line-strong)] text-[var(--sk-text)]" : "border-[var(--sk-line)] text-[var(--sk-muted)]"}`}>{category.label} {counts[category.id]}</button>)}
      <button type="button" aria-pressed={errorsOnly} onClick={() => setErrorsOnly((value) => !value)} className={`h-5 rounded border px-1.5 text-[10.5px] ${errorsOnly ? "border-rose-400/50 text-rose-300" : "border-[var(--sk-line)] text-[var(--sk-muted)]"}`}>Failed {counts.errors}</button>
    </div>
    {entries.length === 0 ? <p className="text-[11px] text-[var(--sk-muted)]">No agent activity yet.</p>
      : visible.length === 0 ? <p className="text-[11px] text-[var(--sk-muted)]">No entries match the current filter.</p>
      : <ol className="min-h-0 space-y-1.5 overflow-y-auto font-mono text-[11px]">
        {visible.map((entry) => <li key={entry.key} className="border-l border-[var(--sk-line)] pl-2">
          <div className="flex items-baseline gap-2">
            <time className="shrink-0 text-[10px] text-[var(--sk-faint)]" dateTime={new Date(entry.startedAt).toISOString()}>{new Date(entry.startedAt).toLocaleTimeString([], { hour12: false })}</time>
            <span className="shrink-0 text-[10px] uppercase text-[var(--sk-muted)]">{entry.category}</span>
            <span className="min-w-0 flex-1 break-words text-[var(--sk-text)]">{entry.label}</span>
            <span className={`shrink-0 text-[10px] ${STATUS_CLASS[entry.status]}`}>{STATUS_TEXT[entry.status]}</span>
          </div>
          {entry.detail && <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[10.5px] text-[var(--sk-muted)]">{entry.detail}</pre>}
          {entry.url && <p className="break-all text-[10.5px] text-[var(--sk-muted)]">{entry.url}</p>}
          {entry.fileOps?.map((op, index) => <p key={`${op.path}:${index}`} className="text-[10.5px] text-[var(--sk-muted)]">{op.action} {op.path}{op.added || op.removed ? ` (+${op.added || 0} -${op.removed || 0})` : ""}</p>)}
        </li>)}
      </ol>}
  </section>;
}
