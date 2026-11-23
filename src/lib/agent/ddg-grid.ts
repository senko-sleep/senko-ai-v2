// Reads full-size image URLs for a DuckDuckGo Images grid, so the agent can batch-fetch them
// instead of clicking tiles one at a time (DDG tiles only expose proxied thumbnails in the DOM).
// Always uses DDG's strict filter, and does nothing for explicit requests.
import { isExplicitMediaText } from "@/lib/policy-classifier";

export interface DdgGridImage {
  url: string;
  alt: string;
  source: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const MAX_GRID_URLS = 12;

export async function fetchDdgGrid(query: string, signal: AbortSignal, limit = MAX_GRID_URLS): Promise<DdgGridImage[]> {
  const q = encodeURIComponent(query);
  const timed = () => AbortSignal.any([signal, AbortSignal.timeout(6000)]);
  const tokenRes = await fetch(`https://duckduckgo.com/?q=${q}&kp=1&iax=images&ia=images`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: timed(),
  });
  const html = await tokenRes.text();
  const vqd = (html.match(/vqd=["']([^"']+)["']/i) || html.match(/vqd=([\d-]+)/i))?.[1];
  if (!vqd) return [];

  const res = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=1`, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://duckduckgo.com/" },
    signal: timed(),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: { image?: unknown; title?: unknown; url?: unknown }[] };

  const seen = new Set<string>();
  const out: DdgGridImage[] = [];
  for (const r of data.results || []) {
    if (typeof r.image !== "string" || !/^https?:\/\//i.test(r.image) || seen.has(r.image)) continue;
    seen.add(r.image);
    out.push({
      url: r.image,
      alt: typeof r.title === "string" ? r.title.slice(0, 80) : "",
      source: typeof r.url === "string" ? r.url : "",
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** A note for the agent's history listing the grid's direct URLs, or "" when not applicable. */
export async function ddgGridNote(opts: { engine: string; goal: string; query: string; signal: AbortSignal; onImages?: (images: DdgGridImage[]) => void }): Promise<string> {
  const { engine, goal, query, signal } = opts;
  if (engine !== "ddg" || isExplicitMediaText(goal) || isExplicitMediaText(query)) return "";
  const images = await fetchDdgGrid(query, signal).catch(() => []);
  if (!images.length) return "";
  opts.onImages?.(images);
  const lines = images.map((img, i) => `  ${i + 1}. ${img.url}${img.alt ? ` "${img.alt}"` : ""}`).join("\n");
  return `\nDirect image URLs from this grid. Use fetch_images with these (send:true when the user wants them in chat) instead of clicking tiles:\n${lines}`;
}
