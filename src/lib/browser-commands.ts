// Fast, deterministic parser for simple browser commands like
//   "Open YouTube in a new tab and search MrBeast"
//   "can you put on spy x family on crunchyroll"
//   "search reddit for mechanical keyboards"
// It runs in the browser *inside the send handler*, so window.open() counts as a
// user gesture and isn't blocked as a popup. Anything it doesn't recognise falls
// through to the AI, which can still emit an [[open: url | label]] action.

export interface BrowserCommand {
  url: string;
  label: string;
  site?: string;
  query?: string;
}

interface Site {
  name: string;
  aliases: string[];
  home: string;
  /** Search URL; "{q}" is replaced with the encoded query. */
  search?: string;
}

export const SITES: Site[] = [
  { name: "YouTube", aliases: ["youtube", "yt", "you tube"], home: "https://www.youtube.com", search: "https://www.youtube.com/results?search_query={q}" },
  { name: "Crunchyroll", aliases: ["crunchyroll", "crunchy roll", "crunchy"], home: "https://www.crunchyroll.com", search: "https://www.crunchyroll.com/search?q={q}" },
  { name: "Google", aliases: ["google"], home: "https://www.google.com", search: "https://www.google.com/search?q={q}" },
  { name: "Google Images", aliases: ["google images", "google image"], home: "https://images.google.com", search: "https://www.google.com/search?tbm=isch&q={q}" },
  { name: "Google Maps", aliases: ["google maps", "maps"], home: "https://www.google.com/maps", search: "https://www.google.com/maps/search/{q}" },
  { name: "Netflix", aliases: ["netflix"], home: "https://www.netflix.com", search: "https://www.netflix.com/search?q={q}" },
  { name: "Tubi", aliases: ["tubi", "tubi tv"], home: "https://tubitv.com", search: "https://tubitv.com/search/{q}" },
  { name: "Pluto TV", aliases: ["pluto tv", "pluto", "plutotv"], home: "https://pluto.tv" },
  { name: "Hulu", aliases: ["hulu"], home: "https://www.hulu.com" },
  { name: "Disney+", aliases: ["disney plus", "disney+", "disneyplus"], home: "https://www.disneyplus.com" },
  { name: "Spotify", aliases: ["spotify"], home: "https://open.spotify.com", search: "https://open.spotify.com/search/{q}" },
  { name: "SoundCloud", aliases: ["soundcloud", "sound cloud"], home: "https://soundcloud.com", search: "https://soundcloud.com/search?q={q}" },
  { name: "Twitch", aliases: ["twitch"], home: "https://www.twitch.tv", search: "https://www.twitch.tv/search?term={q}" },
  { name: "Reddit", aliases: ["reddit"], home: "https://www.reddit.com", search: "https://www.reddit.com/search/?q={q}" },
  { name: "Wikipedia", aliases: ["wikipedia", "wiki"], home: "https://en.wikipedia.org", search: "https://en.wikipedia.org/wiki/Special:Search?go=Go&search={q}" },
  { name: "Amazon", aliases: ["amazon"], home: "https://www.amazon.com", search: "https://www.amazon.com/s?k={q}" },
  { name: "eBay", aliases: ["ebay"], home: "https://www.ebay.com", search: "https://www.ebay.com/sch/i.html?_nkw={q}" },
  { name: "GitHub", aliases: ["github", "git hub"], home: "https://github.com", search: "https://github.com/search?q={q}" },
  { name: "X", aliases: ["twitter", "x.com"], home: "https://x.com", search: "https://x.com/search?q={q}" },
  { name: "TikTok", aliases: ["tiktok", "tik tok"], home: "https://www.tiktok.com", search: "https://www.tiktok.com/search?q={q}" },
  { name: "Instagram", aliases: ["instagram", "insta"], home: "https://www.instagram.com" },
  { name: "Facebook", aliases: ["facebook"], home: "https://www.facebook.com" },
  { name: "Pinterest", aliases: ["pinterest"], home: "https://www.pinterest.com", search: "https://www.pinterest.com/search/pins/?q={q}" },
  { name: "IMDb", aliases: ["imdb"], home: "https://www.imdb.com", search: "https://www.imdb.com/find/?q={q}" },
  { name: "Gmail", aliases: ["gmail", "my email", "email"], home: "https://mail.google.com" },
  { name: "Discord", aliases: ["discord"], home: "https://discord.com/app" },
  { name: "Bing", aliases: ["bing"], home: "https://www.bing.com", search: "https://www.bing.com/search?q={q}" },
  { name: "DuckDuckGo", aliases: ["duckduckgo", "duck duck go", "ddg"], home: "https://duckduckgo.com", search: "https://duckduckgo.com/?q={q}" },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest aliases first so "google images" wins over "google".
const ALIAS_LIST = SITES.flatMap((s) => s.aliases.map((a) => ({ alias: a, site: s }))).sort(
  (a, b) => b.alias.length - a.alias.length
);
const SITE_RE = ALIAS_LIST.map((a) => escape(a.alias)).join("|");

const OPEN = "(?:open(?:\\s+up)?|go\\s+to|goto|head\\s+to|launch|pull\\s+up|bring\\s+up|take\\s+me\\s+to|visit|navigate\\s+to|load(?:\\s+up)?|show\\s+me|hop\\s+on|get\\s+on)";
const FIND = "(?:search(?:\\s+(?:it\\s+)?for)?|look\\s+up|look\\s+for|find(?:\\s+me)?|play|watch|put\\s+on|stream|pull\\s+up|show\\s+me|type(?:\\s+in)?)";
const FILLER = "(?:\\s+(?:website|site|app|page|homepage))?";

function findSite(name: string): Site | undefined {
  const n = name.trim().toLowerCase();
  return ALIAS_LIST.find((a) => a.alias === n)?.site;
}

function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/^\s*(?:hey|hi|ok|okay|yo|senko)[,!\s]+/g, "")
    .replace(/\b(?:can|could|would|will)\s+you\s+(?:please\s+)?/g, "")
    .replace(/\b(?:please|pls|plz|for me|real quick|quickly)\b/g, "")
    .replace(/\bi\s+(?:want|wanna|need)\s+(?:you\s+)?to\s+/g, "")
    .replace(/\b(?:in|on)\s+(?:a\s+)?new\s+(?:tab|window)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanQuery(q: string): string {
  return q
    .replace(/^(?:for|up)\s+/, "")
    .replace(/\s+(?:on it|there|on there|for me|now)$/g, "")
    .replace(/\s+(?:on|in)\s+(?:it|there)$/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function build(site: Site, query?: string): BrowserCommand {
  if (query && site.search) {
    return {
      url: site.search.replace("{q}", encodeURIComponent(query)),
      label: `${site.name}: ${query}`,
      site: site.name,
      query,
    };
  }
  return { url: site.home, label: site.name, site: site.name };
}

/** Too many separate actions -> this is a job for Agent mode, not a quick command. */
function looksMultiStep(text: string): boolean {
  const verbs = text.match(/\b(?:open|search|find|play|watch|click|go to|look up|then|after that|episode)\b/g) || [];
  return verbs.length > 3 || /\b(?:then|after that|and then)\b.*\b(?:and|then)\b/.test(text);
}

export function parseBrowserCommand(input: string): BrowserCommand | null {
  const text = clean(input);
  if (!text || text.length > 160 || looksMultiStep(text)) return null;

  let m: RegExpMatchArray | null;

  // 1. "open youtube and search mrbeast" / "go to crunchyroll then play spy x family"
  m = text.match(new RegExp(`^${OPEN}\\s+(?:the\\s+)?(${SITE_RE})${FILLER}\\s*(?:,|and|then|&|to)?\\s*(?:and\\s+)?(?:then\\s+)?${FIND}\\s+(.+)$`));
  if (m) {
    const site = findSite(m[1]);
    const q = cleanQuery(m[2]);
    if (site && q) return build(site, q);
  }

  // 1b. "open wikipedia's page on japan" / "open the youtube channel for mrbeast"
  m = text.match(
    new RegExp(`^${OPEN}\\s+(?:the\\s+)?(${SITE_RE})(?:'s|s)?\\s+(?:page|article|entry|channel|profile|results|wiki)\\s+(?:on|about|for|of)\\s+(.+)$`)
  );
  if (m) {
    const site = findSite(m[1]);
    const q = cleanQuery(m[2]);
    if (site && q) return build(site, q);
  }
  // "open the japan page on wikipedia" / "open the wikipedia article for japan"
  m = text.match(new RegExp(`^${OPEN}\\s+(?:the\\s+)?(.+?)\\s+(?:page|article|entry)\\s+(?:on|from)\\s+(${SITE_RE})$`));
  if (m) {
    const site = findSite(m[2]);
    const q = cleanQuery(m[1]);
    if (site && q) return build(site, q);
  }

  // 2. "play spy x family on crunchyroll" / "search mrbeast on youtube"
  m = text.match(new RegExp(`^(?:${OPEN}\\s+)?${FIND}\\s+(.+?)\\s+(?:on|in|from|at|using)\\s+(?:the\\s+)?(${SITE_RE})${FILLER}$`));
  if (m) {
    const site = findSite(m[2]);
    const q = cleanQuery(m[1]);
    if (site && q) return build(site, q);
  }

  // 3. "search youtube for mrbeast" / "youtube search mrbeast"
  m = text.match(new RegExp(`^(?:search|check)\\s+(?:the\\s+)?(${SITE_RE})\\s+for\\s+(.+)$`)) ||
    text.match(new RegExp(`^(${SITE_RE})\\s+(?:search|search for|look up)\\s+(.+)$`));
  if (m) {
    const site = findSite(m[1]);
    const q = cleanQuery(m[2]);
    if (site && q) return build(site, q);
  }

  // 4. "open youtube" / "take me to netflix"
  m = text.match(new RegExp(`^${OPEN}\\s+(?:the\\s+)?(?:my\\s+)?(${SITE_RE})${FILLER}$`));
  if (m) {
    const site = findSite(m[1]);
    if (site) return build(site);
  }

  // 5. "open example.com" / "go to https://foo.org/bar"
  m = text.match(new RegExp(`^${OPEN}\\s+((?:https?:\\/\\/)?[a-z0-9-]+(?:\\.[a-z0-9-]+)+(?:\\/\\S*)?)$`));
  if (m) {
    const url = /^https?:\/\//.test(m[1]) ? m[1] : `https://${m[1]}`;
    try {
      const u = new URL(url);
      return { url: u.toString(), label: u.hostname.replace(/^www\./, "") };
    } catch {
      return null;
    }
  }

  return null;
}

/** Parse AI-emitted actions: [[open: https://... | Label]] */
export const OPEN_TAG_RE = /\[\[\s*open\s*:\s*(https?:\/\/[^\s|\]]+)\s*(?:\|\s*([^\]]+?))?\s*\]\]/gi;

export function extractOpenTags(text: string): { clean: string; actions: BrowserCommand[] } {
  const actions: BrowserCommand[] = [];
  const clean = text
    .replace(OPEN_TAG_RE, (_, url: string, label?: string) => {
      try {
        const u = new URL(url);
        if (u.protocol === "http:" || u.protocol === "https:") {
          actions.push({ url: u.toString(), label: label?.trim() || u.hostname.replace(/^www\./, "") });
        }
      } catch {
        /* ignore malformed */
      }
      return "";
    })
    .trim();
  return { clean, actions };
}
