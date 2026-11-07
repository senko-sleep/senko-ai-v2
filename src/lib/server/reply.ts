// One chat turn: build the history (with images and, if relevant, the live browser
// page), stream the AI reply, save it. Used by the chat API and the test suite.
import { openStream, type LlmMessage } from "@/lib/llm";
import { extractOpenTags } from "@/lib/browser-commands";
import { sessions } from "@/lib/agent/sessions";
import { addMessage, getMessages, maybeTitle, saveImage, toLlmHistory, type MessageMeta, type StoredMessage } from "./chats";
import { newId } from "./db";
import { absorbMemories, chatSystemPrompt, stripMemoryTags, takeStatusTag } from "./persona";
import { detectCollageRequest, detectImageIntentQuery, extractImagesTag, searchMultiEngineImages, type ScrapedImage } from "./images";
import { gatherLiveGroundingNote } from "./grounding";
import { sanitizeYouTubeInReply, verifyYouTubeVideo } from "./youtube";
import { verifyGalleryImages } from "./gallery-images";
import { extractCodeArtifacts } from "@/components/assistant/workspace-artifacts";
import { stripCodeBlocks, wantsCodeJob } from "@/lib/code-intent";
import { CodingWorkspaceRuntime, verifyAndSanitizeCodingClaims } from "@/lib/agent/coding-runtime";
import { isExecutableCodingRequest, materializeReplyFilesToWorkspace, runAutonomousCodingWorkflow } from "@/lib/agent/coding-agent";

const AGENT_TAG = /\[\[\s*agent\s*\]\]/gi;
const CODE_TAG = /\[\[\s*code\s*:\s*([^\]\n]{3,2000})\]\]/i;
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
  /** The user's IANA time zone (e.g. "America/New_York"), so "what time is it" is right. */
  timeZone?: string;
  signal?: AbortSignal;
  /** Tests only: pretend these providers fail. */
  simulateFail?: string[];
  onStart?: (info: { userMessageId: string; assistantMessageId: string; provider?: string; providerLabel?: string; model?: string }) => void;
  onDelta?: (text: string) => void;
  onPreview?: (content: string) => void;
  /** Fired as soon as images scraped for an image request are ready. */
  onImages?: (info: { query: string; images: ScrapedImage[] }) => void;
  /** Fired for each live mini-agent task step during grounding (YouTube search, verification, etc.). */
  onMiniAgentStep?: (step: { id: number; label: string; status: "running" | "done" | "error"; detail?: string; url?: string }) => void;
}

async function scrapeForChat(query: string, signal?: AbortSignal): Promise<ScrapedImage[]> {
  if (process.env.SENKO_DISABLE_IMAGE_SCRAPE === "1") return [];
  try {
    const deadline = AbortSignal.timeout(12_000);
    return (await searchMultiEngineImages(query, 1, STORED_IMAGES, signal ? AbortSignal.any([signal, deadline]) : deadline)).images;
  } catch {
    return [];
  }
}

export async function reply(o: ReplyOptions): Promise<StoredMessage> {
  const userMessageId = await addMessage(o.chatId, "user", o.content, o.imageIds || []);
  await maybeTitle(o.chatId, o.content || "Image", o.provider);
  const assistantMessageId = newId("m_");

  const collage = o.imageIds?.length ? undefined : detectCollageRequest(o.content);
  if (collage) {
    o.onStart?.({ userMessageId, assistantMessageId });
    o.onMiniAgentStep?.({ id: 1, label: `Finding images of ${collage.query}`, status: "running" });
    const images = await scrapeForChat(collage.query, o.signal);
    const items: { title: string; imageUrl: string; sourceUrl?: string; width: number; height: number }[] = [];
    const verifyDeadline = AbortSignal.timeout(16_000);
    const signal = o.signal ? AbortSignal.any([o.signal, verifyDeadline]) : verifyDeadline;
    const label = "Checking and preparing images";
    o.onMiniAgentStep?.({ id: 1, label: `Finding images of ${collage.query}`, status: images.length ? "done" : "error" });
    if (images.length) o.onMiniAgentStep?.({ id: 2, label, status: "running" });
    let layout = collage.layout;
    const galleryContent = () => {
      const gallery = { type: "gallery", curated: true, title: collage.query, cols: collage.cols, layout, items };
      return "```ui\n" + JSON.stringify(gallery) + "\n```";
    };
    for await (const batch of verifyGalleryImages(collage.query, images, Math.min(collage.count, 30), signal)) {
      if (o.signal?.aborted) break;
      const saved = await Promise.allSettled(batch.map(async ({ candidate, data, width, height }) => ({
        title: candidate.alt.slice(0, 180) || collage.query,
        imageUrl: `/api/uploads/${await saveImage(o.ownerId, "image/webp", data)}`,
        sourceUrl: candidate.source || candidate.url,
        width,
        height,
      })));
      for (const result of saved) if (result.status === "fulfilled") items.push(result.value);
      if (items.length && !o.signal?.aborted) {
        if (layout === "auto") {
          const ratios = items.map(({ width, height }) => width / height);
          layout = Math.max(...ratios) - Math.min(...ratios) > 0.45 ? "masonry" : "grid";
        }
        o.onPreview?.(galleryContent());
      }
    }
    const stopped = o.signal?.aborted;
    if (images.length) o.onMiniAgentStep?.({ id: 2, label, status: !stopped && items.length ? "done" : "error" });
    const summary = items.length < collage.count ? `\n\n${items.length} of ${collage.count} requested images were usable.` : "";
    const content = items.length ? galleryContent() + summary
      : stopped ? "Stopped the image search." : "I couldn’t verify any usable images for this gallery. Try a more specific search.";
    const meta: MessageMeta = stopped ? { interrupted: true } : {};
    await addMessage(o.chatId, "assistant", content, [], meta, assistantMessageId, userMessageId);
    return { id: assistantMessageId, role: "assistant", content, imageIds: [], meta, createdAt: new Date().toISOString() };
  }

  let text = "";
  const meta: MessageMeta = {};

  // Build requests go to a coding job in the chat's workspace (decided here, not by the model).
  const storedHistory = await getMessages(o.chatId);
  const chatHasProject = storedHistory.some((m) => m.meta?.codeTask);
  const codeJob = !o.imageIds?.length && wantsCodeJob(o.content, chatHasProject);

  // Image requests ("show me pics of X") scrape every engine in parallel with the reply.
  const composedUI = /\b(?:make|build|design|create|compose)\b[\s\S]*\b(?:dashboard|workspace|interface|layout|catalog|profile|page)\b/i.test(o.content);
  const imageQuery = o.imageIds?.length || composedUI || codeJob ? undefined : detectImageIntentQuery(o.content);
  let imagesJob: Promise<ScrapedImage[]> | null = null;
  if (imageQuery) {
    imagesJob = scrapeForChat(imageQuery, o.signal).then((images) => {
      if (images.length) o.onImages?.({ query: imageQuery, images: images.slice(0, STORED_IMAGES) });
      return images;
    });
  }

  try {
    const history = await toLlmHistory(o.ownerId, storedHistory);

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
        `IMAGE GALLERY: the app is already scraping images for "${imageQuery}" from Bing, DuckDuckGo, Wallhaven, Reddit, Wikimedia, image boards and gallery sites, and shows them under your reply as a carousel with a "View all images" gallery. Reply briefly and naturally (1-2 sentences). Don't paste image URLs or markdown images, and don't add an [[images: ...]] tag.`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    if (codeJob) {
      pageNote = [
        pageNote,
        `CODING JOB: a coding agent is starting right now to build this in the workspace${chatHasProject ? " (it continues the existing project)" : ""}. Reply in 1-2 friendly sentences saying what you'll build and the stack. Do NOT write any code or code blocks, don't claim anything is done or tested, and end with [[code: <the full, detailed build request>]] on its own line.`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    const groundingNote = codeJob ? "" : await gatherLiveGroundingNote(o.content, o.signal, o.onMiniAgentStep).catch(() => "");
    if (groundingNote) {
      pageNote = [pageNote, groundingNote].filter(Boolean).join("\n\n");
    }

    const [system, compactSystem] = await Promise.all([
      chatSystemPrompt(o.ownerId, pageNote, { timeZone: o.timeZone }),
      chatSystemPrompt(o.ownerId, pageNote, { compact: true, timeZone: o.timeZone }),
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

  // Sanitize YouTube links: verify IDs via oEmbed, strip dead links, correct wrong titles.
  if (!o.signal?.aborted && clean) {
    const { text: sanitized } = await sanitizeYouTubeInReply(clean, {
      verify: verifyYouTubeVideo,
      signal: o.signal,
    }).catch(() => ({ text: clean }));
    clean = sanitized;
  }
  if (status.mood) meta.mood = status.mood;
  // Big coding work runs as a job in the chat's workspace; the reply only says it started.
  const codeTag = CODE_TAG.exec(clean);
  if (codeTag) {
    meta.codeTask = codeTag[1].trim();
    clean = clean.replace(CODE_TAG, "").trim();
  }
  if (codeJob) {
    meta.codeTask ||= chatHasProject ? `${o.content}\n\n(Continue the existing project in this workspace: read the files first and change them as needed.)` : o.content;
    clean = stripCodeBlocks(clean) || "On it! Building it in the workspace now.";
  }

  // Materialize generated code files into the chat's real Node.js workspace and run
  // autonomous execution/testing when requested.
  if (!o.signal?.aborted && clean && !o.simulateFail?.length) {
    const replyArtifacts = extractCodeArtifacts([{ id: assistantMessageId, role: "assistant", content: clean }]);
    if (replyArtifacts.length > 0 && !meta.codeTask) {
      try {
        if (isExecutableCodingRequest(o.content)) {
          const wf = await runAutonomousCodingWorkflow({
            chatId: o.chatId,
            goal: o.content,
            assistantDraft: replyArtifacts.length > 0 ? clean : undefined,
            provider: o.provider,
            inspectBrowser: false,
            signal: o.signal,
            onStep: (step) =>
              o.onMiniAgentStep?.({
                id: 100 + step.id,
                label: step.label,
                status: step.status,
                detail: step.detail,
                url: step.url,
              }),
          });
          clean = `${wf.sanitizedReply || clean}\n\n${wf.verificationReportMarkdown}`.trim();
          o.onPreview?.(clean);
        } else {
          const ws = new CodingWorkspaceRuntime(o.chatId);
          await materializeReplyFilesToWorkspace(ws, assistantMessageId, clean);
          const check = verifyAndSanitizeCodingClaims(clean, ws.ledger);
          clean = check.sanitizedText;
        }
      } catch {
        /* workspace execution fallback: preserve reply text */
      }
    }
  }
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
    imagesJob = scrapeForChat(tagged.query, o.signal);
  }
  if (imagesJob && finalQuery) {
    const images = await imagesJob.catch(() => [] as ScrapedImage[]);
    if (images.length) {
      meta.scrapedImages = images.slice(0, STORED_IMAGES);
      meta.imageQuery = finalQuery;
    }
  }

  await addMessage(o.chatId, "assistant", clean, [], meta, assistantMessageId, userMessageId);
  return { id: assistantMessageId, role: "assistant", content: clean, imageIds: [], meta, createdAt: new Date().toISOString() };
}
