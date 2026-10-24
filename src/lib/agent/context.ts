// Pure helpers that keep each agent step's prompt small. Every step re-sends the page, the
// history and the sources seen so far, so anything that grows here multiplies across the
// whole task (and against the provider's tokens-per-minute limit).

export interface SourceImage {
  url: string;
  alt: string;
  col: number;
  row: number;
}
export interface SourcePage {
  title: string;
  images: SourceImage[];
}

/** Long tracking/redirect links (Bing's are 500+ chars) are cut; the model clicks the element instead. */
export function shortUrl(url: string, max = 160): string {
  return url.length > max ? `${url.slice(0, max)}…` : url;
}

/**
 * The pages seen earlier in this task, for the final answer's links and images: the last
 * `maxPages` pages (not the current one, which is described in full), each with a few image URLs.
 * One line per page instead of a JSON dump of every image on every page.
 */
export function compactSources(visited: Map<string, SourcePage>, currentUrl: string | undefined, maxPages = 8, imagesPerPage = 4): string {
  const lines: string[] = [];
  for (const [url, page] of [...visited.entries()].filter(([u]) => u !== currentUrl).slice(-maxPages)) {
    const imgs = page.images
      .filter((i) => i.url.length <= 400)
      .slice(0, imagesPerPage)
      .map((i) => `${i.alt ? `"${i.alt.slice(0, 60)}" ` : ""}${i.url}`);
    lines.push(`- ${page.title.slice(0, 80) || "(untitled)"} — ${shortUrl(url, 200)}${imgs.length ? `\n    images: ${imgs.join(" | ")}` : ""}`);
  }
  return lines.join("\n");
}

/** One history line, capped so a long typed text or result doesn't ride along on every later step. */
export function historyLine(n: number, decision: Record<string, unknown>, result: string): string {
  const { thought: _t, check: _c, requirements: _r, ...rest } = decision;
  void _t;
  void _c;
  void _r;
  const act = JSON.stringify(rest);
  return `${n}. ${act.length > 260 ? `${act.slice(0, 260)}…` : act} -> ${result.length > 300 ? `${result.slice(0, 300)}…` : result}`;
}

/** Short goals and single actions don't need a separate planning call. */
export function isSimpleGoal(goal: string): boolean {
  const g = goal.trim();
  if (!g || g.length > 90 || /\n/.test(g)) return false;
  const words = g.split(/\s+/).length;
  if (words <= 3) return true;
  return (
    words <= 10 &&
    /^(pause|play|resume|stop|mute|unmute|skip|next|previous|prev|go back|back|scroll|close|switch|fullscreen|exit|open|go to|what('?s| is| are)|which|who|where|is this|read|summari[sz]e (this|the page))\b/i.test(g) &&
    !/\b(and|then|after|collage|compare|download|every|all)\b/i.test(g)
  );
}

export type MediaOp = "play" | "pause" | "mute" | "unmute" | "fullscreen" | "exit_fullscreen";

/**
 * Plain media commands on the current video ("pause", "play it", "mute the video") are done
 * directly, with no AI call at all. Anything with more words goes through the agent.
 */
export function parseMediaCommand(goal: string): MediaOp | null {
  const g = goal
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/^(please|pls|can you|could you)\s+/, "")
    .replace(/\s+(please|pls)$/, "");
  const m = g.match(/^(pause|play|resume|unpause|mute|unmute|fullscreen|full screen|go fullscreen|exit fullscreen|exit full screen|leave fullscreen)(?:\s+(?:it|this|that|the video|video|the show|the episode))?$/);
  if (!m) return null;
  const w = m[1];
  if (w === "pause") return "pause";
  if (w === "play" || w === "resume" || w === "unpause") return "play";
  if (w === "mute") return "mute";
  if (w === "unmute") return "unmute";
  if (/^(exit|leave)/.test(w)) return "exit_fullscreen";
  return "fullscreen";
}
