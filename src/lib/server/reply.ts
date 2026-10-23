// One chat turn: build the history (with images and, if relevant, the live browser
// page), stream the AI reply, save it. Used by the chat API and the test suite.
import { openStream, type LlmMessage } from "@/lib/llm";
import { extractOpenTags } from "@/lib/browser-commands";
import { sessions } from "@/lib/agent/sessions";
import { addMessage, getMessages, maybeTitle, toLlmHistory, type MessageMeta, type StoredMessage } from "./chats";
import { newId } from "./db";
import { absorbMemories, chatSystemPrompt, stripMemoryTags, takeStatusTag } from "./persona";
import { detectImageIntentQuery, extractImagesTag, searchMultiEngineImages, type ScrapedImage } from "./images";

const AGENT_TAG = /\[\[\s*agent\s*\]\]/gi;
const ABOUT_PAGE =
  /\b(this|the|that|current)\s+(page|site|website|video|tab|episode|show|article|screen)\b|\bwhat('?s| is) (on|this)\b|\bon (the )?screen\b/i;

/** How many scraped images are stored on the message (the gallery loads the rest on demand). */
const STORED_IMAGES = 120;

export interface ReplyOptions {
  ownerId: string;
  chatId: string;
  content: string;
  imageIds?: string[];
  provider?: string;
  signal?: AbortSignal;
  /** Tests only: pretend these providers fail. */
  simulateFail?: string[];
  onStart?: (info: { userMessageId: string; assistantMessageId: string; provider: string; providerLabel: string; model: string }) => void;
  onDelta?: (text: string) => void;
  /** Fired as soon as images scraped for an image request are ready. */
  onImages?: (info: { query: string; images: ScrapedImage[] }) => void;
}

async function scrapeForChat(query: string): Promise<ScrapedImage[]> {
  if (process.env.SENKO_DISABLE_IMAGE_SCRAPE === "1") return [];
  try {
    return (await searchMultiEngineImages(query, 1)).images;
  } catch {
    return [];
  }
}

export async function reply(o: ReplyOptions): Promise<StoredMessage> {
  const userMessageId = await addMessage(o.chatId, "user", o.content, o.imageIds || []);
  await maybeTitle(o.chatId, o.content || "Image");
  const assistantMessageId = newId("m_");

  let text = "";
  const meta: MessageMeta = {};

  // Image requests ("show me pics of X") scrape every engine in parallel with the reply.
  const imageQuery = o.imageIds?.length ? undefined : detectImageIntentQuery(o.content);
  let imagesJob: Promise<ScrapedImage[]> | null = null;
  if (imageQuery) {
    imagesJob = scrapeForChat(imageQuery).then((images) => {
      if (images.length) o.onImages?.({ query: imageQuery, images: images.slice(0, STORED_IMAGES) });
      return images;
    });
  }

  try {
    const history = await toLlmHistory(o.ownerId, await getMessages(o.chatId));

    // A live browser for this chat + a question about "this page" -> attach the page.
    let pageNote = "";
    const live = sessions.get(o.chatId);
    if (live?.isActive()) {
      const about = ABOUT_PAGE.test(o.content);
      const ctx = await live.pageContext(about).catch(() => null);
      if (ctx) {
        pageNote = `LIVE BROWSER PAGE (the agent browser for this chat):\nURL: ${ctx.url}\nTitle: ${ctx.title}\nTabs: ${ctx.tabs}\nPage text (excerpt):\n${about ? ctx.text : ctx.text.slice(0, 600)}`;
        if (ctx.screenshot) {
          const last = history[history.length - 1];
          if (last?.role === "user") last.images = [...(last.images || []), { mime: "image/jpeg", data: ctx.screenshot }];
        }
      }
    }
    if (imageQuery) {
      pageNote = [
        pageNote,
        `IMAGE GALLERY: the app is already scraping images for "${imageQuery}" from Google, Bing, DuckDuckGo, Yahoo, Reddit, Wikimedia, image boards and gallery sites, and shows them under your reply as a carousel with a "View all images" gallery. Reply briefly and naturally (1-2 sentences). Don't paste image URLs or markdown images, and don't add an [[images: ...]] tag.`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    const [system, compactSystem] = await Promise.all([
      chatSystemPrompt(o.ownerId, pageNote),
      chatSystemPrompt(o.ownerId, pageNote, { compact: true }),
    ]);
    const messages: LlmMessage[] = [{ role: "system", content: system }, ...history];
    // compactSystem lets the LLM layer shrink long chats to fit each provider instead of failing.
    const opened = await openStream(messages, { provider: o.provider, signal: o.signal, simulateFail: o.simulateFail, compactSystem });
    Object.assign(meta, { provider: opened.provider, providerLabel: opened.providerLabel, model: opened.model });
    o.onStart?.({ userMessageId, assistantMessageId, provider: opened.provider, providerLabel: opened.providerLabel, model: opened.model });

    for await (const chunk of opened.stream) {
      text += chunk;
      o.onDelta?.(chunk);
    }
    if (!text.trim()) throw new Error("The AI returned an empty reply. Try again.");
  } catch (e) {
    if (o.signal?.aborted) {
      meta.interrupted = true;
      if (!text) meta.error = "Stopped.";
    } else {
      meta.error = e instanceof Error ? e.message : String(e);
    }
  }

  // Save whatever we have, even if the browser disconnected mid-reply.
  let clean = await absorbMemories(o.ownerId, text).catch(() => stripMemoryTags(text));
  const status = takeStatusTag(clean);
  clean = status.text;
  if (status.mood) meta.mood = status.mood;
  meta.suggestAgent = AGENT_TAG.test(clean);
  AGENT_TAG.lastIndex = 0;
  const parsed = extractOpenTags(clean.replace(AGENT_TAG, ""));
  clean = parsed.clean;
  if (parsed.actions.length) meta.actions = parsed.actions;

  // The AI can also ask for a gallery itself with [[images: query]].
  const tagged = extractImagesTag(clean);
  clean = tagged.clean;
  let finalQuery = imageQuery;
  if (!imagesJob && tagged.query && !o.signal?.aborted) {
    finalQuery = tagged.query;
    imagesJob = scrapeForChat(tagged.query);
  }
  if (imagesJob && finalQuery) {
    const images = await imagesJob.catch(() => [] as ScrapedImage[]);
    if (images.length) {
      meta.scrapedImages = images.slice(0, STORED_IMAGES);
      meta.imageQuery = finalQuery;
    }
  }

  await addMessage(o.chatId, "assistant", clean, [], meta, assistantMessageId);
  return { id: assistantMessageId, role: "assistant", content: clean, imageIds: [], meta, createdAt: new Date().toISOString() };
}
