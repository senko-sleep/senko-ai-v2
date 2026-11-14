// What kind of site a result is, and whether it matches the query. Uses only the result's own
// host, title and snippet.
import type { SearchCategory } from "./types";

const HOSTS: [SearchCategory, RegExp][] = [
  ["adult", /(?:^|\.)(?:pornhub|xvideos|xnxx|xhamster|redtube|youporn|spankbang|eporner|tube8|rule34\.xxx|rule34\.paheli|rule34video|nhentai|e-hentai|exhentai|hentaihaven|hanime|hentai2read|hentaifox|hitomi|imhentai|9hentai|tsumino|hentai\.tv|gelbooru|sankakucomplex|f95zone|onlyfans|fansly|chaturbate|stripchat|literotica|motherless|thisvid|nutaku|kemono|coomer|e621|fakku|luscious|multporn|8muses|simply-hentai|hentaimama|rule34hentai|r34)\.[a-z.]+$/i],
  ["comics", /(?:^|\.)(?:mangadex|webtoons|tapas|mangaplus\.shueisha|comixology|viz|mangakakalot|manganato|mangasee123|mangapark|bato|comick|kodansha|yenpress|globalcomix|tappytoon|lezhin|mangaupdates|anime-planet|myanimelist|anilist|comicvine\.gamespot|marvel|dccomics|readcomiconline|webcomicname|smackjeeves|comicfury)\.[a-z.]+$/i],
  ["video", /(?:^|\.)(?:youtube|youtu|vimeo|twitch|dailymotion|tiktok|bilibili|nicovideo|kick|rumble|crunchyroll|netflix|hulu|imdb)\.[a-z.]+$/i],
  ["images", /(?:^|\.)(?:pinterest|imgur|deviantart|artstation|flickr|unsplash|pexels|pixiv|danbooru\.donmai|safebooru|zerochan|wallhaven|tumblr|giphy|tenor|500px|gettyimages|shutterstock)\.[a-z.]+$/i],
  ["code", /(?:^|\.)(?:github|gitlab|bitbucket|stackoverflow|stackexchange|npmjs|pypi|crates|codepen|replit|codesandbox|sourceforge)\.[a-z.]+$/i],
  ["docs", /(?:^|\.)(?:developer\.mozilla|readthedocs|docs\.python|learn\.microsoft|developer\.apple|developer\.android|devdocs|w3schools|cppreference|nodejs|typescriptlang|react|nextjs|go\.dev|rust-lang|kotlinlang|php)\.[a-z.]+$|^docs\.|^developers?\./i],
  ["gaming", /(?:^|\.)(?:steampowered|store\.steampowered|steamcommunity|itch|gamebanana|gamejolt|newgrounds|ign|gamespot|polygon|kotaku|pcgamer|nexusmods|curseforge|epicgames|gog|nintendo|playstation|xbox|roblox|speedrun|howlongtobeat|metacritic|fnf\.wiki)\.[a-z.]+$/i],
  ["wiki", /(?:^|\.)(?:wikipedia|wikimedia|wiktionary|fandom|wikia|miraheze|wikihow|britannica|tvtropes|knowyourmeme)\.[a-z.]+$/i],
  ["forum", /(?:^|\.)(?:reddit|quora|discord|discourse|4chan|4channel|resetera|neogaf|gamefaqs|forums?\.[a-z]+|lemmy|kbin)\.[a-z.]+$|^forums?\./i],
  ["news", /(?:^|\.)(?:bbc|cnn|nytimes|theguardian|reuters|apnews|washingtonpost|bloomberg|npr|theverge|techcrunch|arstechnica|wired|engadget|news\.ycombinator|forbes|cnbc|aljazeera)\.[a-z.]+$|^news\./i],
  ["shopping", /(?:^|\.)(?:amazon|ebay|etsy|walmart|bestbuy|target|aliexpress|newegg|shopify|redbubble|teepublic)\.[a-z.]+$/i],
  ["social", /(?:^|\.)(?:twitter|x|facebook|instagram|threads|bsky|mastodon|linkedin|snapchat)\.[a-z.]+$/i],
];

/** Encyclopedias and dictionaries (not community wikis, which can host explicit content). */
const REFERENCE = /(?:^|\.)(?:wikipedia|wikimedia|wiktionary|britannica)\.[a-z.]+$/i;
const ADULT_TEXT = /\b18\+|\b(?:porn\w*|hentai|xxx|nsfw|rule\s?34|r34|nude|naked|sex(?:ual)?|erotic\w*|lewd|explicit|uncensored|adult\s+(?:comics?|games?|videos?|content))\b/i;
const COMIC_TEXT = /\b(?:manga|manhwa|manhua|webtoons?|comics?|doujin(?:shi)?|chapter\s+\d+|read\s+online)\b/i;
const VIDEO_TEXT = /\b(?:watch|video|episode|stream(?:ing)?)\b/i;
const DOCS_TEXT = /\b(?:documentation|docs|api reference|reference|tutorial|guide|getting started)\b/i;
const GAME_TEXT = /\b(?:game|mod|mods|play(?:able)?|download|steam|walkthrough)\b/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** The category the host alone says (a Reddit thread is "forum" whatever its title). */
export function hostCategory(url: string): SearchCategory | null {
  const host = hostOf(url);
  return HOSTS.find(([, re]) => re.test(host))?.[0] ?? null;
}

/** The category from the host first, then from what the title and snippet say. */
export function categorize(url: string, title: string, snippet: string): SearchCategory {
  const host = hostOf(url);
  const text = `${title} ${snippet}`;
  // An adult result on a mixed site (Reddit, Pixiv, Twitter) is still adult.
  for (const [cat, re] of HOSTS) {
    if (!re.test(host)) continue;
    // On a known site only the title counts (a store's genre list says "Erotica"). An
    // encyclopedia's article *about* an adult topic ("Hentai - Wikipedia") is still reference
    // material, not an adult site: it mustn't be offered as one.
    if (cat !== "adult" && ADULT_TEXT.test(title) && cat !== "docs" && cat !== "code" && cat !== "news" && !REFERENCE.test(host)) return "adult";
    return cat;
  }
  if (ADULT_TEXT.test(text) || /(?:porn|hentai|xxx|sex|nsfw|r34)/i.test(host)) return "adult";
  if (COMIC_TEXT.test(text) || /manga|comic|webtoon|manhwa/i.test(host)) return "comics";
  if (DOCS_TEXT.test(title) && /\b(?:api|docs?|reference)\b/i.test(`${host} ${title}`)) return "docs";
  if (/wiki/i.test(host)) return "wiki";
  if (VIDEO_TEXT.test(title) && /\b(?:video|watch|episode)\b/i.test(title)) return "video";
  if (GAME_TEXT.test(title) && /\b(?:game|mod|steam)\b/i.test(text)) return "gaming";
  return "general";
}

const STOP = new Set(["the", "a", "an", "of", "for", "to", "in", "on", "and", "or", "with", "by", "at", "from", "is", "are", "how", "what", "best", "top", "site", "sites", "website", "websites", "online", "free"]);

export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/\bsite:\S+/g, " ")
        .replace(/[^\p{L}\p{N}+#.\s-]/gu, " ")
        .split(/[\s.]+/)
        .map((w) => w.replace(/^-+|-+$/g, ""))
        .filter((w) => w.length > 1 && !STOP.has(w)),
    ),
  ];
}

/**
 * Share of query words found in the result (0..1). Engines often match a word through its
 * stem or a related form ("funkin" for "fnf" sometimes), so a partial match still counts some.
 */
/** Query words that name a kind of result: a result of that kind matches them ("hentai" -> an adult page saying "rule34"). */
const KIND_WORDS: [SearchCategory, RegExp][] = [
  ["adult", /^(?:hentai|porn\w*|xxx|nsfw|r34|rule34|lewds?|smut|nudes?|naked|sex|erotic\w*|18\+|doujin(?:shi)?)$/],
  ["comics", /^(?:manga|manhwa|manhua|webtoons?|comics?|doujin(?:shi)?)$/],
  ["docs", /^(?:docs?|documentation|reference|manual|api)$/],
  ["video", /^(?:videos?|watch|stream)$/],
  ["gaming", /^(?:games?|mods?)$/],
  ["images", /^(?:art|fanart|images?|pics?|pictures?|wallpapers?|drawings?)$/],
];

export function relevance(terms: string[], r: { title: string; url: string; snippet: string }, category?: SearchCategory): number {
  if (!terms.length) return 1;
  const hay = `${r.title} ${r.snippet} ${decodeURIComponentSafe(r.url)}`.toLowerCase();
  let hit = 0;
  let initials: string | null = null;
  for (const t of terms) {
    if (hay.includes(t)) hit += 1;
    else if (category && KIND_WORDS.some(([c, re]) => c === category && re.test(t))) hit += 1;
    // "fnf" matches "Friday Night Funkin'": the term is the initials of consecutive words.
    else if (/^[a-z]{2,5}$/.test(t) && (initials ??= wordInitials(hay)).includes(` ${t} `)) hit += 1;
    else if (t.length > 4 && hay.includes(t.slice(0, Math.max(4, t.length - 2)))) hit += 0.6;
  }
  return hit / terms.length;
}

/** " fnf nf ..." : every run of 2-5 consecutive word initials, space separated, for acronym lookups. */
function wordInitials(hay: string): string {
  const words = hay.split(/[^\p{L}\p{N}']+/u).filter(Boolean).map((w) => w[0]);
  const runs: string[] = [];
  for (let i = 0; i < words.length; i++) for (let n = 2; n <= 5 && i + n <= words.length; n++) runs.push(words.slice(i, i + n).join(""));
  return ` ${runs.join(" ")} `;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s).replace(/[-_/]+/g, " ");
  } catch {
    return s;
  }
}
