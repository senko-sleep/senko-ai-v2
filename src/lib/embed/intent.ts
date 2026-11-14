// Reading a chat message as "put this website / video in the chat as a live embed".
//   "send me a embed of imhentai.com"        -> { url: "https://imhentai.com" }
//   "embed the new sml video"                -> { name: "sml", video: "latest" }
//   "embed the newest video on example.com"  -> { url: "https://example.com", video: "latest" }
//   "embed an anime website"                 -> { topic: "anime" }                  (any good site of that kind)
//   "a random hentai website" (after an embed) -> { topic: "hentai", pick: "random" } (the follow-up keeps the embed action)
//   "a manga website embedded so I can read" -> { topic: "manga", purpose: "read" }
//   "embed the second one" (after a search)  -> { url: <the 2nd result> }
//
// The message alone often isn't enough: "now a random hentai website" right after an embed means
// "embed one", while the same words in a fresh chat with nothing to go on are just a request
// for one site. EmbedFollowContext carries what the chat already did, so a follow-up that
// changes only *what* to show keeps *how* to show it.

export interface EmbedRequest {
  /** The words the user used for the target ("imhentai.com", "the new sml video", "a manga site"). */
  asked: string;
  /** A URL or bare domain they named (or picked from earlier results), normalized to https://. */
  url?: string;
  /** No URL: the site / channel / creator name to look up ("sml", "imhentai"). */
  name?: string;
  /** No URL or name: the kind of site they want ("anime", "hentai", "manga"). We choose one. */
  topic?: string;
  /** What they want to do there ("read" manga, "watch" anime); shapes which sites fit. */
  purpose?: string;
  /** They left the choice to us: "random" picks among the good ones, "best" takes the top one. */
  pick?: "random" | "best";
  /** Hosts already shown in this chat ("another one" shouldn't repeat them). */
  exclude?: string[];
  /** They want a video from it: the newest one, or any matching one. */
  video?: "latest" | "any";
  /** They mentioned YouTube (or a creator, which we look up there). */
  youtube?: boolean;
  /** Read as a follow-up of the chat's last tool turn, not from this message alone. */
  followUp?: boolean;
}

/** What the chat did recently, as far as embeds care. Built from stored messages (turn-context.ts). */
export interface EmbedFollowContext {
  /** The kind of tool card the last assistant reply showed. */
  lastTool?: "embed" | "search" | "comic" | null;
  /** The most recent embed (within the last few turns). */
  lastEmbed?: { asked: string; topic?: string; purpose?: string; host: string; url: string };
  /** Search results shown recently, newest search first. */
  results?: { title: string; url: string; snippet?: string; category?: string }[];
  /** Hosts embedded recently. */
  shownHosts?: string[];
}

const EMBED_WORD = /\b(?:embed(?:ded|ding|s)?|iframe)\b/i;
// "how do I embed a video in html" asks about embedding, it doesn't ask for one.
const QUESTION = /^(?:what|why|how|who|when|where|is|are|does|do|did|explain|define|should\s+i|can\s+i)\b/i;
const CODE = /\b(?:html|css|jsx|tsx|react|vue|svelte|component|code|snippet|script|markdown|embeddings?|vector|in\s+my\s+(?:site|page|app|website|project))\b/i;
// "a manga of fnf as an embed ui" is the comic reader; "embed ui" is generated UI. Only when no
// website is asked for: "a manga *website* so I can read" is a site.
const NOT_SITE = /\b(?:manga|manhwa|manhua|comics?|doujin(?:shi)?|webtoons?|read(?:er|ing)?|ui|widget|chart|map)\b/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/i;
// A bare domain: labels plus a letters-only TLD ("imhentai.com", "youtube.com/@SMLMovies").
const DOMAIN_RE = /(?:^|[\s(])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s<>"'`)\]]*)?(?=$|[\s),.!?])/i;
const FILE_TLD = /\.(?:mp4|webm|mov|png|jpe?g|gif|webp|txt|pdf|zip|js|ts|json|html?|css|exe)$/i;
const VIDEO_WORD = /\b(?:videos?|vids?|uploads?|episodes?|clips?|shorts?)\b/i;
const LATEST_WORD = /\b(?:new(?:est)?|latest|recent|most\s+recent|last|today'?s|just\s+(?:posted|uploaded))\b/i;

const SITE_NOUN = "(?:web\\s?sites?|sites?|web\\s?pages?|homepages?)";
const SITE_RE = new RegExp(`\\b${SITE_NOUN}\\b`, "i");
// More than one site, a ranking, or a list: that's a search card, not one embed.
const MANY = new RegExp(`\\b(?:web\\s?sites|sites|web\\s?pages|homepages)\\b|\\btop\\s+\\d|\\b\\d{1,2}\\s+${SITE_NOUN}|\\b(?:list|search|look\\s+up|google|results?|links?|recommend\\w*|suggest\\w*|options|alternatives)\\b`, "i");

// Leading politeness and conversational glue ("now", "ok so", "no I meant") isn't part of the ask.
const LEAD = new RegExp(
  "^(?:" +
    [
      "(?:hey|ok|okay|yo)\\s+(?:senko\\s+)?",
      "senko[,\\s]+",
      "(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?",
      "please\\s+",
      "pls\\s+",
      "i\\s+(?:want|need|wanna|would\\s+like|'d\\s+like)\\s+(?:you\\s+to\\s+)?",
      "(?:no|nah|nope)(?:\\s+no)*[,.!]*\\s+",
      "i\\s+(?:mean|meant|said)[,:]?\\s+",
      "(?:now|also|and|then|next|alright|ok\\s+so|so|actually|instead|just|lol|lmao)[,.!]*\\s+",
    ].join("|") +
    ")",
  "i",
);
const VERB = /^(?:send|give|show|get|make|create|pull\s+up|bring\s+up|open|do|put|drop|post|find|load|try|embed|go\s+(?:to|with))\b(?:\s+(?:me|us|it))?\s*/i;

// "random", "pick one", "you choose", "surprise me", "whatever": they left the choice to us.
const RANDOM = /\b(?:random(?:ly)?|any(?:\s+one)?|whatever|whichever|surprise\s+me)\b/i;
const DELEGATE = /\b(?:(?:you|u)\s+(?:pick|choose|decide)|(?:pick|pic|choose|select)\s+(?:one|a\s+good\s+one|something|any|for\s+me|it|the\s+best)|your\s+(?:choice|pick)|up\s+to\s+you|dealer'?s\s+choice|idc|i\s+don'?t\s+care\s+which)\b/i;
// "another one", "a different one", "something else": same kind as last time, a new site.
const ANOTHER = /\b(?:another|different|other|new|else|next)\b/i;
// Modifiers about the pick, not about the kind of site.
const MODIFIER = /\b(?:random(?:ly)?|any|another|different|other|new|good|great|best|cool|nice|popular|decent|legit|real|working|actual|free|safe|some|one|a|an|the|me|for|please|pls|plz|embedded|embeddable|embed|iframe|live|interactive|in\s+(?:the\s+)?chat|here|instead|else|then|now|kind\s+of|type\s+of|sort\s+of)\b/gi;
const PURPOSE = /\b(?:so|where|that|which|to|for)\s+(?:(?:i|we|u|you)\s+(?:can|could|may)\s+)?(?:be\s+able\s+to\s+)?(read(?:ing)?|watch(?:ing)?|stream(?:ing)?|play(?:ing)?|listen(?:ing)?(?:\s+to)?|download(?:ing)?|browse|browsing)\b(?:\s+(?:it|them|some|on\s+it|there))*(?:\s+((?:[\w'+-]+\s*){1,4}))?/i;

const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, last: -1 };

function normalizeUrl(raw: string): string | undefined {
  const s = raw.replace(/[.,!?;:]+$/, "");
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/\./.test(u.hostname)) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function subjectName(text: string): string {
  return text
    .replace(EMBED_WORD, " ")
    .replace(/\b(?:send|give|show|get|make|create|pull\s+up|bring\s+up|open|do|put|drop|post|find)\b(?:\s+(?:me|us|it))?/gi, " ")
    .replace(/\b(?:in|into|to)\s+(?:the\s+)?chat\b/gi, " ")
    .replace(LATEST_WORD, " ")
    .replace(VIDEO_WORD, " ")
    .replace(/\b(?:youtube|yt)\b(?:\s+channel)?/gi, " ")
    .replace(/\b(?:of|for|from|with|on|by|at|about|an?|the|some|one|their|his|her|its|channel|site|website|page|homepage|please|pls|here|for\s+me)\b/gi, " ")
    .replace(/(\w)'s\b/gi, "$1")
    .replace(/[“”"`?!.,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLead(text: string): string {
  let t = text.trim().replace(/\s+/g, " ");
  for (let i = 0; i < 6; i++) {
    const next = t.replace(LEAD, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

function words(s: string): string {
  return s.replace(/[“”"`?!.,:;()]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The kind-of-site words: "a random hentai website" -> "hentai". */
function topicWords(s: string): string {
  return words(s.replace(VERB, " ").replace(MODIFIER, " ").replace(/\b(?:so|to|i|can|that|which|where|it|on|of|with|and|or|but|is|was)\b/gi, " "));
}

/** "the second one", "#3", "the last result", "that one" -> 1-based index (or -1 for last, 0 for "that"). */
function resultRef(t: string): number | null {
  const m = /(?:^|\s)(?:#|no\.?\s*|number\s+|result\s+|option\s+)(\d{1,2})\b/i.exec(t) || /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:one|result|link|site|option)\b/i.exec(t);
  if (m) return Number(m[1]) || null;
  // "the second one" / "the 3rd result", or the ordinal on its own ("the second", "2nd pls").
  const o = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|last)\s+(?:one|result|link|site|website|option)\b/i.exec(t)
    || /^(?:(?:embed|open|show|load|try|use)\s+)?(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|last)(?:\s+(?:pls|please|plz))?[.!]*$/i.exec(t);
  if (o) return ORDINAL[o[1].toLowerCase()] ?? null;
  if (/\b(?:that|this)\s+(?:one|site|website|result|link)\b/i.test(t)) return 0;
  return null;
}

function urlRequest(t: string): { asked: string; url: string } | null {
  const rawUrl = URL_RE.exec(t)?.[0];
  const dom = rawUrl ? undefined : DOMAIN_RE.exec(t);
  const named = rawUrl ?? (dom && !FILE_TLD.test(dom[1]) ? dom[1] + (dom[2] || "") : undefined);
  const url = named ? normalizeUrl(named) : undefined;
  return url ? { asked: named!.replace(/[.,!?;:]+$/, ""), url } : null;
}

/**
 * The message as an embed request, or null. `ctx` is what the chat already did: a follow-up
 * like "now a random hentai website" after an embed keeps the embed action, and "embed the
 * second one" after a search points at that result.
 */
export function detectEmbedRequest(text: string, ctx: EmbedFollowContext = {}): EmbedRequest | null {
  const raw = text.trim().replace(/\s+/g, " ");
  if (!raw || raw.length > 400) return null;
  const t = stripLead(raw);
  if (!t || QUESTION.test(t) || CODE.test(t)) return null;

  const explicit = EMBED_WORD.test(t) || /\b(?:in|into)\s+(?:the\s+)?chat\b|\bin\s+here\b/i.test(t);
  const afterEmbed = ctx.lastTool === "embed" && !!ctx.lastEmbed;
  const results = ctx.results ?? [];
  const exclude = ctx.shownHosts?.length ? [...new Set(ctx.shownHosts)] : undefined;

  const video = VIDEO_WORD.test(t) ? (LATEST_WORD.test(t) ? "latest" : "any") : undefined;
  const youtube = /\b(?:youtube|yt|youtu\.be)\b/i.test(t) || undefined;
  const site = SITE_RE.exec(t);
  const many = MANY.test(t);
  const delegated = RANDOM.test(t) || DELEGATE.test(t);
  const purposeM = PURPOSE.exec(t);
  const purpose = purposeM ? purposeM[1].toLowerCase().replace(/ing$/, "").replace(/\s+to$/, "").replace(/^brows$/, "browse") : undefined;

  // 1. A URL or domain they typed.
  const typed = urlRequest(t);
  if (typed && (explicit || (afterEmbed && t.split(" ").length <= 8))) {
    const host = new URL(typed.url).hostname;
    const yt = /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(host);
    return { asked: typed.asked, url: typed.url, video, youtube: youtube || yt || undefined, followUp: !explicit || undefined };
  }
  if (typed) return null;

  // 2. One of the results already on screen: "embed the second one", "pick one for me".
  if (results.length && !many) {
    const ref = resultRef(t);
    const pointsAtResults = ref !== null && (explicit || /\b(?:open|show|load|go\s+with|try|use)\b/i.test(t) || ctx.lastTool === "search");
    if (pointsAtResults && ref !== null) {
      const r = ref === -1 ? results[results.length - 1] : results[Math.max(0, ref - 1)];
      if (r) return { asked: r.title || hostOf(r.url), url: r.url, followUp: true };
    }
    // "pick one for me" / "you choose" / "a random one" with nothing else named.
    const bare = topicWords(t.replace(DELEGATE, " ").replace(RANDOM, " ").replace(PURPOSE, " ").replace(SITE_RE, " ").replace(EMBED_WORD, " "));
    if (ctx.lastTool === "search" && delegated && !bare) {
      return { asked: "one of those results", topic: "", purpose, pick: "random", exclude, followUp: true };
    }
  }

  // 3. A kind of site: "an anime website", "a random hentai site", "a site to read manga".
  if (site && !many) {
    const before = t.slice(0, site.index);
    const after = t.slice(site.index + site[0].length);
    const purposeObj = purposeM?.[2] ? topicWords(purposeM[2]) : "";
    let topic = topicWords(before);
    if (!topic) topic = purposeObj || topicWords(after.replace(PURPOSE, " ").replace(/^\s*(?:for|about|with|of|on)\s+/i, " "));
    // "the crunchyroll website" / "sml's site" names one site; "a/random/any anime site" asks for a kind.
    const named = /\b(?:the|their|his|her|its)\s+(?:(?:official|main|real)\s+)?[\w'+.-]+(?:\s+[\w'+.-]+){0,2}\s*$/i.test(before) && !delegated && !/\b(?:a|an|some|any|another|one)\b/i.test(before) || /\w's\s*$/i.test(before);
    // "send me / show me / open a X website" asks to be given one site: showing it is the answer.
    const handOver = /^(?:send|give|show|pull\s+up|bring\s+up|open|load|drop)\b/i.test(t);
    const wants = explicit || afterEmbed || delegated || handOver;
    if (!wants) return null;
    if (!topic && ANOTHER.test(t) && ctx.lastEmbed) {
      // "another site" / "a different website": same kind as last time.
      return {
        asked: ctx.lastEmbed.topic ? `another ${ctx.lastEmbed.topic} site` : "another site",
        topic: ctx.lastEmbed.topic || "",
        purpose: purpose ?? ctx.lastEmbed.purpose,
        pick: "random",
        exclude,
        followUp: true,
      };
    }
    if (!topic) return null;
    if (named) return { asked: words(`${before.replace(VERB, "")} ${site[0]}`).replace(/^(?:the|a|an)\s+/i, ""), name: topic.replace(/'s$/i, ""), video, followUp: !explicit || undefined };
    const asked = words(`${topic} ${site[0]}`);
    return {
      asked,
      topic,
      purpose,
      pick: delegated ? "random" : "best",
      exclude: delegated || afterEmbed ? exclude : undefined,
      video,
      followUp: !explicit || undefined,
    };
  }

  // 4. "another one" / "a different one" / "something else" right after an embed.
  if (afterEmbed && !many && /^(?:(?:send|give|show|get|do|try|find|embed)\s+(?:me\s+)?)?(?:an?\s+)?(?:another|different|new|other)(?:\s+one)?\b|\bsomething\s+else\b|^(?:one\s+more|next(?:\s+one)?)\b/i.test(t) && topicWords(t.replace(ANOTHER, " ")).split(" ").filter(Boolean).length <= 1) {
    const extra = topicWords(t.replace(ANOTHER, " ").replace(/\b(?:one|something|more|next)\b/gi, " "));
    const topic = extra || ctx.lastEmbed!.topic || "";
    return {
      asked: topic ? `another ${topic} site` : "another site",
      topic,
      purpose: purpose ?? ctx.lastEmbed!.purpose,
      pick: "random",
      exclude,
      followUp: true,
    };
  }

  // 5. The original shape: "embed <name>" / "embed the new sml video".
  if (!explicit) return null;
  if (NOT_SITE.test(t)) return null;
  const name = subjectName(t);
  if (!name || name.length < 2 || name.split(" ").length > 8) return null;
  if (/^(?:it|this|that|me|you|something|anything)$/i.test(name)) return null;
  const asked = video ? `${video === "latest" ? "the newest " : ""}${name} video` : name;
  return { asked, name: name.slice(0, 80), video, youtube };
}
