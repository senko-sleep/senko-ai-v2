export type TrailEntry = string | { label: string; url?: string };

export function websiteUrl(value?: string): string | undefined {
  try {
    const url = new URL(value || "");
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function activitySources(trail: TrailEntry[] = [], finalUrl?: string) {
  const sources = new Map<string, { url: string; host: string; label: string }>();
  for (const entry of [...trail, ...(finalUrl ? [{ label: 'Final page', url: finalUrl }] : [])]) {
    if (typeof entry === 'string') continue;
    const url = websiteUrl(entry.url);
    if (!url || sources.has(url)) continue;
    sources.set(url, { url, host: new URL(url).hostname.replace(/^www\./, ''), label: entry.label });
  }
  return [...sources.values()];
}
