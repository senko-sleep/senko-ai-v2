// Shapes for real web search results shown in the chat (shared by server and browser).

export type SearchCategory =
  | "adult"
  | "comics"
  | "video"
  | "images"
  | "docs"
  | "code"
  | "gaming"
  | "wiki"
  | "forum"
  | "news"
  | "shopping"
  | "social"
  | "general";

export const CATEGORY_LABELS: Record<SearchCategory, string> = {
  adult: "Adult",
  comics: "Comics & manga",
  video: "Video",
  images: "Images",
  docs: "Docs",
  code: "Code",
  gaming: "Gaming",
  wiki: "Wiki",
  forum: "Forum",
  news: "News",
  shopping: "Shopping",
  social: "Social",
  general: "Web",
};

/** One result exactly as a search engine returned it (nothing here is made up). */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  /** Host shown under the title ("example.com"). */
  source: string;
  /** Engines that returned it, best first ("google", "bing", ...). */
  engines: string[];
  category: SearchCategory;
  /** Link check: "ok" answered, "unchecked" not checked or the site blocks bots. Broken links are dropped. */
  link: "ok" | "unchecked";
}

export interface SearchCard {
  query: string;
  results: WebResult[];
  /** Engines that answered, in the order they were tried. */
  engines: string[];
  safeSearch: "off" | "moderate" | "strict";
  /** How many the user asked for. */
  wanted: number;
  /** e.g. "SafeSearch hid 4 adult results." */
  note?: string;
}
