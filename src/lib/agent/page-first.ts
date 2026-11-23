// Use what the current page already offers before spending a step on leaving it.
import type { BrowserDecision } from "./action-protocol";

export interface PageMediaCandidate {
  url: string;
  animated?: boolean;
  thumbnail?: boolean;
}

const MAX_BATCH = 12;
/** A few spares, because some direct URLs fail validation. */
const SPARE_CANDIDATES = 3;
/** Actions that abandon or drill out of a page that may already hold the answer. */
const LEAVING_ACTIONS = new Set(["goto", "search", "image_search", "new_tab", "open_fastest", "click"]);

/** Direct, untried media URLs on the page, limited to what the task still needs. */
export function pickPageMedia(
  candidates: PageMediaCandidate[],
  opts: { needed: number; requireAnimated?: boolean; isUnusable?: (url: string) => boolean },
): string[] {
  if (opts.needed <= 0) return [];
  const limit = Math.min(MAX_BATCH, opts.needed + SPARE_CANDIDATES);
  const out = new Set<string>();
  for (const c of candidates) {
    if (out.size >= limit) break;
    if (c.thumbnail || !/^https?:\/\//i.test(c.url)) continue;
    if (opts.requireAnimated && !c.animated && !/\.gif(?:[?#]|$)/i.test(c.url)) continue;
    if (opts.isUnusable?.(c.url)) continue;
    out.add(c.url);
  }
  return [...out];
}

/** Replaces a leaving action with a batch fetch when the page already has usable media. */
export function preferPageMedia(decision: BrowserDecision, urls: string[]): BrowserDecision {
  if (!urls.length || !LEAVING_ACTIONS.has(decision.action)) return decision;
  return { action: "fetch_images", urls, send: true } as BrowserDecision;
}
