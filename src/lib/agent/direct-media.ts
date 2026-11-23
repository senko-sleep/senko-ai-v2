// "Send 5 images of X" needs no model decisions: the results grid already holds the URLs.
// These helpers pick relevant candidates and download them in parallel.
import type { GridImage } from "./grid";

const STOP_WORDS = new Set(["a", "an", "the", "of", "for", "with", "and", "or", "in", "on", "some", "cute", "best", "good", "nice", "cool"]);

const tokens = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);

/** Search terms a candidate must mention. Plural and singular forms count as the same word. */
function queryTerms(query: string): string[] {
  return [...new Set(tokens(query).filter((t) => !STOP_WORDS.has(t)).map((t) => t.replace(/s$/, "")))];
}

/**
 * Candidates whose title, URL or source page mention the query, best match first.
 * An image with no evidence of being on-topic is dropped rather than padded in.
 */
export function rankGridImages(images: GridImage[], query: string): GridImage[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  return images
    .map((image, index) => {
      const haystack = tokens(`${image.alt} ${image.url} ${image.source}`).map((t) => t.replace(/s$/, ""));
      const inTitle = tokens(image.alt).map((t) => t.replace(/s$/, ""));
      const matched = terms.filter((t) => haystack.some((h) => h === t || (t.length >= 5 && h.includes(t)))).length;
      const titled = terms.filter((t) => inTitle.includes(t)).length;
      return { image, index, matched, titled };
    })
    .filter((c) => c.matched === terms.length)
    .sort((a, b) => b.titled - a.titled || a.index - b.index)
    .map((c) => c.image);
}

/**
 * Run `fetchOne` over `items`, at most `concurrency` at a time, until `needed` succeed.
 * Results keep input order, so the best-ranked candidates are the ones delivered.
 */
export async function fetchUntil<T, R>(
  items: T[],
  needed: number,
  fetchOne: (item: T) => Promise<R>,
  opts: { concurrency?: number; signal?: AbortSignal; onError?: (item: T, error: unknown) => void } = {},
): Promise<R[]> {
  const results: ({ value: R } | undefined)[] = new Array(items.length);
  let next = 0;
  let succeeded = 0;
  const worker = async () => {
    while (next < items.length && succeeded < needed && !opts.signal?.aborted) {
      const index = next++;
      try {
        results[index] = { value: await fetchOne(items[index]) };
        succeeded++;
      } catch (error) {
        opts.onError?.(items[index], error);
      }
    }
  };
  const workers = Math.max(1, Math.min(opts.concurrency ?? 6, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results.filter((r): r is { value: R } => !!r).map((r) => r.value).slice(0, needed);
}
