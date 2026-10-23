import { ChevronDown, ExternalLink, Globe2 } from "lucide-react";
import { activitySources, websiteUrl, type TrailEntry } from "./activity";

function SiteIcon({ host }: { host: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`} alt="" referrerPolicy="no-referrer" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
  );
}

export function AgentTrail({ trail = [], finalUrl, running }: { trail?: TrailEntry[]; finalUrl?: string; running?: boolean }) {
  const sources = activitySources(trail, finalUrl);
  const hosts = [...new Set(sources.map((s) => s.host))];
  if (!trail.length && !sources.length) return null;
  return (
    <details className="group/trail max-w-full text-xs text-[var(--sk-muted)]">
      <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-solid)] px-2.5 py-1 text-[12px] font-medium text-[var(--sk-muted)] transition-colors hover:border-[var(--sk-accent-line)] hover:text-[var(--sk-text)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1" aria-hidden>
          {hosts.slice(0, 3).map((host) => (
            <SiteIcon key={host} host={host} />
          ))}
          {!hosts.length && <Globe2 size={13} />}
        </span>
        <span>{hosts.length ? `${running ? "Browsing" : "Visited"} ${hosts.length} ${hosts.length === 1 ? "website" : "websites"}` : `${trail.length} steps`}</span>
        <ChevronDown size={12} className="transition-transform group-open/trail:rotate-180" aria-hidden />
      </summary>
      <div className="mt-2 space-y-3 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-solid)]/60 p-3">
        {sources.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-[var(--sk-text)]">Websites visited</p>
            <ul className="space-y-1.5">
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-start gap-2 hover:text-[var(--sk-text)]">
                    <SiteIcon host={source.host} />
                    <span className="min-w-0 flex-1">
                      <span className="underline decoration-[var(--sk-line)] underline-offset-2">{source.host}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--sk-faint)]">{source.url}</span>
                    </span>
                    <ExternalLink size={11} className="mt-0.5 shrink-0 opacity-60" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {trail.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-[var(--sk-text)]">Steps taken</p>
            <ol className="ml-1 space-y-1.5 border-l border-[var(--sk-line)] pl-3">
              {trail.map((entry, index) => {
                const item = typeof entry === "string" ? { label: entry } : entry;
                const url = websiteUrl(item.url);
                return (
                  <li key={index} className="break-words">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
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
