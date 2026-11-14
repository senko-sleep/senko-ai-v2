// Reading a chat message as a comic-reader request, a site pick, or a series pick.
import type { ComicSeries, ComicSourceId, ComicSourceInfo } from "./types";
import { detectVoiceRequest } from "@/lib/voice/intent";

const KIND = "(?:manga|mangas|manhwa|manhua|webtoons?|comics?|comic\\s+books?|doujin(?:shi)?s?|graphic\\s+novels?)";
const KIND_RE = new RegExp(`\\b${KIND}\\b`, "i");
const WANT = /\b(send|show|give|get|find|open|read|reading|pull\s+up|bring|load|embed|reader|pages?|chapters?|episodes?|look\s+up|search|want|need|recommend|me)\b/i;
// "what is a manga" / "how do I draw a comic" are questions about comics, not requests to read one.
const NOT_READ = /^\s*(what|why|how|who|when|is|are|does|do|explain|define|tell me about|history of)\b(?!.*\b(send|show|give|read|find|open|embed)\b)/i;
const FILLER = new RegExp(
  [
    "\\b(?:can|could|would|will)\\s+you\\b",
    "\\bplease\\b|\\bpls\\b|\\bplz\\b",
    "\\b(?:send|show|give|get|find|open|bring|pull\\s+up|load|read)\\b(?:\\s+(?:me|us))?",
    "\\bi\\s+(?:want|need|wanna)\\b(?:\\s+to\\s+read)?",
    "\\bas\\s+(?:an?\\s+)?(?:embed(?:ded)?|ui|reader|viewer)(?:\\s+(?:ui|reader|viewer))*",
    "\\b(?:in|with)\\s+(?:an?\\s+)?(?:embed(?:ded)?|ui|reader|viewer)(?:\\s+(?:ui|reader|viewer))*",
    "\\b(?:with\\s+)?all\\s+(?:the\\s+)?(?:pages?|chapters?|episodes?)\\b",
    "\\b(?:embed(?:ded)?|reader|viewer)\\b",
    "\\bui\\b",
  ].join("|"),
  "gi"
);

const SITE_WORDS: { id: ComicSourceId; re: RegExp }[] = [
  { id: "mangadex", re: /\b(?:on|from|at|via|using)\s+(?:the\s+)?(?:manga\s?dex|md)\b|\bmanga\s?dex\b/i },
  { id: "webtoon-originals", re: /\b(?:on|from|at)\s+(?:the\s+)?webtoons?\s+originals?\b|\bwebtoons?\s+originals?\b/i },
  { id: "webtoon-canvas", re: /\b(?:on|from|at|via)\s+(?:the\s+)?(?:webtoons?(?:\s+canvas)?|canvas)\b|\bwebtoons?\s+canvas\b/i },
  { id: "tapas", re: /\b(?:on|from|at|via|using)\s+(?:the\s+)?tapas(?:\.io)?\b|\btapas\.io\b/i },
  { id: "ehentai", re: /\b(?:(?:on|from|at|via|using)\s+(?:the\s+)?)?(?:e[\s-]?hentai|ex[\s-]?hentai)(?:\.org)?\b/i },
  { id: "imhentai", re: /\b(?:(?:on|from|at|via|using)\s+(?:the\s+)?)?im[\s-]?hentai(?:\.xxx)?\b/i },
  { id: "hentaiera", re: /\b(?:(?:on|from|at|via|using)\s+(?:the\s+)?)?hentai[\s-]?era(?:\.com)?\b/i },
  { id: "hentaifox", re: /\b(?:(?:on|from|at|via|using)\s+(?:the\s+)?)?hentai[\s-]?fox(?:\.com)?\b/i },
];
const SITE_ASK = new RegExp(`\\b${KIND}\\s+(?:web\\s?)?(?:sites?|pages?)\\b|\\b(?:web\\s?)?sites?\\s+(?:to|for|where)\\b.*\\b${KIND}\\b`, "i");
const ADULT_SITES = new Set<ComicSourceId>(["ehentai", "imhentai", "hentaiera", "hentaifox"]);

/** Porn wording: adult comics (SafeSearch off, subject checked for minors / real people). */
// Match sexual-content wording, not identity/education words such as sexuality
// or unrelated prefixes such as sextant. Identity alone never implies pornography.
const EXPLICIT = /\b(?:h[\s-]?manga|hentai|porn\w*|xxx|nsfw|r34|rule\s?34|lewds?|smut|ecchi|nudes?|naked|sex|sexual(?:ly)?|18\+|explicit|erotic\w*)\b/gi;

const MEDIA = /\b(?:pics?|pictures?|images?|imgs?|photos?|videos?|vids?|clips?|gifs?|collages?|gallery|galleries|wallpapers?|art|fan\s?art|drawings?)\b/i;

export interface ComicRequest {
  query: string;
  /** Asked for adult comics. */
  explicit?: boolean;
  /** The site, when the message already named one ("... from mangadex"). */
  source?: ComicSourceId;
}

function tidy(s: string): string {
  return s
    .replace(/[“”"'`]/g, "")
    .replace(/[?!.,:;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|a|an|some|any)\s+/i, "")
    .replace(/\s+(?:for|to|on|in|with|from|of|and)$/i, "")
    .trim();
}

/** "send me a manga of fnf as a embed ui all pages" -> { query: "fnf" }. */
export function detectComicRequest(text: string): ComicRequest | null {
  const full = text.trim();
  // Spoken answers belong to the voice path even when discussing a comic.
  if (detectVoiceRequest(full)) return null;
  // Site names first: "e-hentai" is a site, not just porn wording.
  const source = SITE_WORDS.find((s) => s.re.test(full))?.id;
  let raw = full;
  for (const s of SITE_WORDS) raw = raw.replace(s.re, " ");
  const explicit = (!!source && ADULT_SITES.has(source)) || new RegExp(EXPLICIT.source, "i").test(raw);
  // "fnf hentai" is a comic request even without the word "manga" (but "fnf hentai pics" is images).
  if (!KIND_RE.test(raw) && MEDIA.test(raw)) return null;
  const t = explicit && !KIND_RE.test(raw) ? `${raw.replace(EXPLICIT, " ")} manga` : raw.replace(EXPLICIT, " ");
  if (!t || t.length > 300 || !KIND_RE.test(t) || NOT_READ.test(t)) return null;
  // "a manga website so I can read" asks for a site (the embed flow), not for a title to look up.
  if (SITE_ASK.test(t)) return null;
  if (!WANT.test(t.replace(KIND_RE, ""))) return null;
  const rest = t.replace(FILLER, " ");

  // "manga of/about/for X" or "X manga".
  const after = new RegExp(`\\b${KIND}\\b\\s+(?:of|about|for|on|from|based\\s+on|called|named|titled)\\s+(.+)$`, "i").exec(rest);
  const before = new RegExp(`^(.*?)\\b(?:fan\\s*)?${KIND}\\b`, "i").exec(rest);
  let query = after?.[1] ?? before?.[1] ?? "";
  query = tidy(query.replace(new RegExp(`\\b(?:fan\\s*)?${KIND}\\b`, "gi"), " ").replace(/\b(?:an?|the|some|any|fan)\b\s*$/i, ""));
  // A delegated choice is a follow-up, not a title. Leave it to the normal
  // conversation path, which has the preceding search results and messages.
  // Include the common "pic one" typo without stripping words from real titles.
  const namedTitle = new RegExp(`\\b${KIND}\\b\\s+(?:called|named|titled)\\s+`, "i").test(rest);
  if (!namedTitle && /^(?:pick|pic|choose|select)\s+(?:one|it|something|anything)(?:\s+(?:for\s+me|please|pls|and|make\s+it|it|as|to\s+read))*$/i.test(query)) return null;
  // "a hentai website" leaves just the site noun: that's a site request, not a title.
  query = tidy(query.replace(/\b(?:random|any|good|new)\b|\b(?:web\s?)?sites?\b|\bwebpages?\b/gi, " "));
  if (!query || query.length < 2 || /^(?:me|a|an|it|one|good|some|new|this|that)$/i.test(query)) return null;
  return explicit ? { query: query.slice(0, 80), source, explicit } : { query: query.slice(0, 80), source };
}

/** "MangaDex", "2", "the second one", "canvas" -> that site. */
export function parseSourceChoice(text: string, sources: ComicSourceInfo[]): ComicSourceId | null {
  const t = text.toLowerCase().trim();
  const n = pickNumber(t);
  if (n && n <= sources.length) return sources[n - 1].id;
  // Longer aliases first, so "webtoon originals" doesn't match "webtoon".
  const named = sources
    .flatMap((s) => [s.name.toLowerCase(), ...s.aliases].map((a) => ({ id: s.id, a })))
    .sort((x, y) => y.a.length - x.a.length)
    .find(({ a }) => new RegExp(`(^|\\b)${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|$)`, "i").test(t));
  return named?.id ?? null;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];

function pickNumber(t: string): number | null {
  const m = /^(?:#|no\.?\s*|number\s+|option\s+|pick\s+|read\s+)?(\d{1,2})\b/.exec(t) || /(?:^|\s)#(\d{1,2})\b/.exec(t);
  if (m) return Number(m[1]) || null;
  const o = ORDINALS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  return o >= 0 ? o + 1 : null;
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);
}

/** "#3", "3", "the third one" or (part of) a title -> that series. */
export function parseSeriesChoice(text: string, results: ComicSeries[]): ComicSeries | null {
  const t = text.toLowerCase().trim();
  const n = pickNumber(t);
  if (n && n <= results.length) return results[n - 1];
  const asked = new Set(words(t));
  if (!asked.size) return null;
  let best: { s: ComicSeries; score: number } | null = null;
  for (const s of results) {
    const title = s.title.toLowerCase();
    if (t.length >= 4 && (title === t || title.includes(t) || t.includes(title))) return s;
    const tw = words(s.title);
    const score = tw.filter((w) => asked.has(w)).length / Math.max(tw.length, 1);
    if (score > (best?.score ?? 0)) best = { s, score };
  }
  return best && best.score >= 0.6 ? best.s : null;
}

/** "another site", "different website", "go back" while looking at results. */
export const OTHER_SITE = /\b(other|another|different|change|switch)\s+(site|website|source|place)\b|\bgo\s+back\b|\bsites?\s+list\b/i;
