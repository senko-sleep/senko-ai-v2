import type { ReactNode } from "react";
import { ChevronDown, ExternalLink, Globe2 } from "lucide-react";
import { activitySources, websiteUrl, type TrailEntry } from "./activity";

function SiteIcon({ host }: { host: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`} alt="" referrerPolicy="no-referrer" className="h-3 w-3 shrink-0 rounded-xs opacity-85" />
  );
}

export function AgentTrail({
  trail = [],
  finalUrl,
  running,
  meta,
}: {
  trail?: TrailEntry[];
  finalUrl?: string;
  running?: boolean;
  meta?: ReactNode;
}) {
  const sources = activitySources(trail, finalUrl);
  const hosts = [...new Set(sources.map((s) => s.host))];
  if (!trail.length && !sources.length) return null;
  return (
    <details className="group/trail max-w-full text-[11.5px] text-[var(--sk-muted)]">
      <summary className="inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 py-0.5 text-[11.5px] list-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-[var(--sk-muted)] transition-colors hover:text-[var(--sk-text)]">
          <span className="flex items-center gap-1" aria-hidden>
            {hosts.slice(0, 3).map((host) => (
              <SiteIcon key={host} host={host} />
            ))}
            {!hosts.length && <Globe2 size={12} className="text-[var(--sk-accent-ink)]" />}
          </span>
          <span>{hosts.length ? `${running ? "Browsing" : "Visited"} ${hosts.length} ${hosts.length === 1 ? "website" : "websites"}` : `${trail.length} steps`}</span>
          <ChevronDown size={11.5} className="text-[var(--sk-faint)] transition-transform group-open/trail:rotate-180" aria-hidden />
        </span>
        {meta && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-normal text-[var(--sk-faint)]"
            onClick={(e) => e.stopPropagation()}
          >
            {meta}
          </span>
        )}
      </summary>
      <div className="mt-1.5 space-y-2.5 border-l border-[var(--sk-line)] pl-3">
        {sources.length > 0 && (
          <div>
            <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-[var(--sk-faint)]">Websites visited</p>
            <ul className="space-y-1">
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 py-0.5 hover:text-[var(--sk-text)]">
                    <SiteIcon host={source.host} />
                    <span className="shrink-0 underline decoration-[var(--sk-line)] underline-offset-2">{source.host}</span>
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--sk-faint)]">{source.url}</span>
                    <ExternalLink size={10.5} className="shrink-0 opacity-50" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {trail.length > 0 && (
          <div>
            <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-[var(--sk-faint)]">Steps taken</p>
            <ol className="space-y-1">
              {trail.map((entry, index) => {
                const item = typeof entry === "string" ? { label: entry } : entry;
                const url = websiteUrl(item.url);
                return (
                  <li key={index} className="break-words text-[var(--sk-muted)]">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--sk-text)] hover:underline">
                        {item.label}
                      </a>
                    ) : (
                      item.label
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </details>
  );
}
