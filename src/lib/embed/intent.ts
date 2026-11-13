// Reading a chat message as "put this website / video in the chat as a live embed".
//   "send me a embed of imhentai.com"        -> { url: "https://imhentai.com" }
//   "embed the new sml video"                -> { name: "sml", video: "latest" }
//   "embed the newest video on example.com"  -> { url: "https://example.com", video: "latest" }

export interface EmbedRequest {
  /** The words the user used for the target ("imhentai.com", "the new sml video"). */
  asked: string;
  /** A URL or bare domain they named, normalized to https://. */
  url?: string;
  /** No URL: the site / channel / creator name to look up ("sml", "imhentai"). */
  name?: string;
  /** They want a video from it: the newest one, or any matching one. */
  video?: "latest" | "any";
  /** They mentioned YouTube (or a creator, which we look up there). */
  youtube?: boolean;
}

const EMBED_WORD = /\b(?:embed(?:ded|ding|s)?|iframe)\b/i;
// "how do I embed a video in html" asks about embedding, it doesn't ask for one.
const QUESTION = /^(?:what|why|how|who|when|where|is|are|does|do|did|explain|define|should\s+i|can\s+i)\b/i;
const CODE = /\b(?:html|css|jsx|tsx|react|vue|svelte|component|code|snippet|script|markdown|embeddings?|vector|in\s+my\s+(?:site|page|app|website|project))\b/i;
// "a manga of fnf as an embed ui" is the comic reader; "embed ui" is generated UI.
const NOT_SITE = /\b(?:manga|manhwa|manhua|comics?|doujin(?:shi)?|webtoons?|read(?:er|ing)?|ui|widget|chart|map)\b/i;
const URL_RE =/\bhttps?:\/\/[^\s<>"'`)\]]+/i;
// A bare domain: labels plus a letters-only TLD ("imhentai.com", "youtube.com/@SMLMovies").
const DOMAIN_RE = /(?:^|[\s(])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s<>"'`)\]]*)?(?=$|[\s),.!?])/i;
const FILE_TLD = /\.(?:mp4|webm|mov|png|jpe?g|gif|webp|txt|pdf|zip|js|ts|json|html?|css|exe)$/i;
const VIDEO_WORD = /\b(?:videos?|vids?|uploads?|episodes?|clips?|shorts?)\b/i;
const LATEST_WORD = /\b(?:new(?:est)?|latest|recent|most\s+recent|last|today'?s|just\s+(?:posted|uploaded))\b/i;

const LEAD = /^(?:(?:hey|ok|okay|yo)\s+(?:senko\s+)?|senko[,\s]+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|pls\s+|i\s+(?:want|need|wanna)\s+(?:you\s+to\s+)?)/i;

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

export function detectEmbedRequest(text: string): EmbedRequest | null {
  let t = text.trim().replace(/\s+/g, " ");
  if (!t || t.length > 400 || !EMBED_WORD.test(t)) return null;
  for (let i = 0; i < 3; i++) t = t.replace(LEAD, "");
  if (QUESTION.test(t) || CODE.test(t)) return null;
  const hasUrl = URL_RE.test(t) || DOMAIN_RE.test(t);
  if (!hasUrl && NOT_SITE.test(t)) return null;
  if (hasUrl && /\b(?:manga|manhwa|comics?|doujin(?:shi)?)\s+(?:of|about|for)\b/i.test(t)) return null;

  const video = VIDEO_WORD.test(t) ? (LATEST_WORD.test(t) ? "latest" : "any") : undefined;
  const youtube = /\b(?:youtube|yt|youtu\.be)\b/i.test(t) || undefined;

  const rawUrl = URL_RE.exec(t)?.[0];
  const dom = rawUrl ? undefined : DOMAIN_RE.exec(t);
  const named = rawUrl ?? (dom && !FILE_TLD.test(dom[1]) ? dom[1] + (dom[2] || "") : undefined);
  const url = named ? normalizeUrl(named) : undefined;
  if (url) {
    const host = new URL(url).hostname;
    const yt = /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(host);
    return { asked: named!.replace(/[.,!?;:]+$/, ""), url, video, youtube: youtube || yt || undefined };
  }

  const name = subjectName(t);
  if (!name || name.length < 2 || name.split(" ").length > 8) return null;
  if (/^(?:it|this|that|me|you|something|anything)$/i.test(name)) return null;
  const asked = video ? `${video === "latest" ? "the newest " : ""}${name} video` : name;
  return { asked, name: name.slice(0, 80), video, youtube };
}
