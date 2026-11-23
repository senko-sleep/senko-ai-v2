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

export type ImageSearchIntent = { query: string; engine: "google" | "bing"; simple: boolean };

const VERBS = String.raw`(?:search(?:\s+up)?|look\s+up|look\s+for|find|show(?:\s+me)?|get(?:\s+me)?|pull\s+up|bring\s+up|give\s+me|send(?:\s+me)?)`;
const IMG = String.raw`(?:images?|pictures?|pics?|photos?|wallpapers?|gifs?)`;
const COUNT = String.raw`(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)`;

/**
 * "google images eevee", "search for eevee pics", "find me pictures of red foxes on bing":
 * the user wants IMAGE results, not ordinary web results. Returns the query and engine
 * (Google unless they name Bing), and whether the search is the whole request.
 */
export function imageSearchIntent(goal: string): ImageSearchIntent | null {
  let g = goal.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").replace(/^(?:please|pls|can you|could you|would you|hey senko,?)\s+/i, "");
  // "send" means this chat. Sending to someone else, or sending an email, is a different task.
  if (/^send\b/i.test(g) && (/\b(?:e-?mails?|messages?|texts?|dms?|invoices?|fax)\b/i.test(g) || /\bto\s+(?!me\b|chat\b|this chat\b|here\b)\S+/i.test(g))) return null;
  const engine: "google" | "bing" = /\bbing\b/i.test(g) && !/\bgoogle\b/i.test(g) ? "bing" : "google";
  // "and click the second one", "then download it": more than a search.
  const tail = /\s+(?:and|then)\s+(.+)$/i.exec(g);
  if (tail) g = g.slice(0, tail.index);
  g = g.replace(/\s+(?:on|using|in|with|via)\s+(?:google|bing)(?:\s+images?)?$/i, "").replace(/\s+for me$/i, "");
  let query: string | undefined;
  const m1 = new RegExp(String.raw`^(?:${VERBS}\s+)?(?:on\s+)?(?:google|bing)\s+images?\s+(?:for\s+|of\s+)?(.+)$`, "i").exec(g);
  const m2 = new RegExp(String.raw`^(?:${VERBS}|image\s+search)\s+(?:me\s+)?(?:for\s+)?(?:some\s+|a\s+few\s+|an?\s+|${COUNT}\s+)?${IMG}\s+(?:of|for|about|with)\s+(.+)$`, "i").exec(g);
  const m3 = new RegExp(String.raw`^${VERBS}\s+(?:me\s+)?(?:for\s+)?(?:some\s+|${COUNT}\s+)?(.+?)\s+(${IMG})$`, "i").exec(g);
  const m4 = /^image\s+search\s+(?:for\s+)?(.+)$/i.exec(g);
  if (m1) query = m1[1];
  else if (m2) query = m2[1];
  else if (m3) query = /^(wallpapers?|gifs?)$/i.test(m3[2]) ? `${m3[1]} ${m3[2]}` : m3[1];
  else if (m4) query = m4[1];
  query = query?.replace(/^(?:for|of)\s+/i, "").replace(/^(?:an?)\s+/i, "").replace(/^["'“]|["'”]$/g, "").trim();
  if (!query || query.length > 120) return null;
  return { query, engine, simple: !tail };
}

export interface MediaDeliverableSpec {
  /** Requested number of distinct media items (null if unspecified). */
  count: number | null;
  /** True when the user specifically asked for animated GIFs. */
  requireAnimated: boolean;
  /** True when the user asked to send/deliver the images/GIFs directly into chat (not just browse). */
  deliverToChat: boolean;
  /** True when the user asked for a collage rather than separate chat images. */
  isCollage: boolean;
}

const WORD_NUMS: Record<string, number> = {
  one: 1, a: 1, an: 1, two: 2, both: 2, couple: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Parse media deliverable requirements from a natural-language goal so the runner can
 * validate animated GIFs, track partial progress (e.g. 3/5 delivered), and verify chat delivery.
 */
export function parseMediaDeliverable(goal: string): MediaDeliverableSpec {
  const g = (goal || "").trim();
  const isCollage = /\bcollage\b/i.test(g);
  const requireAnimated = /\bgifs?\b|\banimated\b/i.test(g);
  const mentionsMedia = /\b(gifs?|images?|pictures?|pics?|photos?|wallpapers?|memes?)\b/i.test(g);
  const deliverToChat =
    mentionsMedia &&
    !isCollage &&
    /\b(send|attach|post|drop|deliver|share|put)\b[^.?!\n]{0,60}\b(chat|here|directly|me|them|gifs?|images?|pictures?|pics?|photos?)\b/i.test(g);

  let count: number | null = null;
  const numMatch = g.match(
    /\b(\d{1,2}|one|two|both|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z0-9-]+,?\s+){0,4}(?:gifs?|images?|pictures?|pics?|photos?|wallpapers?|memes?)\b/i,
  );
  if (numMatch) {
    const raw = numMatch[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMS[raw];
    if (Number.isInteger(n) && n >= 1 && n <= 20) count = n;
  }

  return { count, requireAnimated, deliverToChat, isCollage };
}
