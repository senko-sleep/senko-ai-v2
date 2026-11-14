/** How a site embed is shown in the chat. */
export type EmbedMode =
  /** The real site in an iframe (it allows framing and isn't behind a bot wall). */
  | "direct"
  /** Through /api/proxy, which re-serves the page so it can be framed. */
  | "proxy"
  /** Neither works: the chat's real Chromium opened it (shown in the live browser). */
  | "live";

/** A website embedded in a chat reply. */
export interface SiteEmbedCard {
  /** The page as the site serves it (after redirects). */
  url: string;
  /** What the user asked for, e.g. "imhentai.com" or "the new SML video". */
  asked: string;
  host: string;
  title?: string;
  mode: EmbedMode;
  /** Why this mode was picked (shown small under the frame). */
  note?: string;
  /** Pages visited before embedding (homepage -> newest video page). */
  path?: string[];
  /** The kind of site asked for ("anime", "manga"), when we picked the site ourselves. */
  topic?: string;
  /** What they wanted to do there ("read", "watch"). */
  purpose?: string;
  /** Live mode only: the chat's live browser couldn't open it, so nothing is showing it yet. */
  liveUnavailable?: boolean;
  /** Sites tried first that couldn't be shown, and why ("x.com: HTTP 503"). */
  skipped?: string[];
}
