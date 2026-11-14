// One chat turn: build the history (with images and, if relevant, the live browser
// page), stream the AI reply, save it. Used by the chat API and the test suite.
import { openStream, type LlmMessage } from "@/lib/llm";
import { wantsGeneratedUI } from "@/lib/ui-generation";
import { enrichInlineUI, generateComposedUI } from "./ui-response";
import { buildEntityDossier, dossierPrompt, type EntityDossier } from "./entity-dossier";
import { DYNAMIC_UI_SYSTEM } from "@/lib/ui-prompt";
import { extractOpenTags } from "@/lib/browser-commands";
import { sessions } from "@/lib/agent/sessions";
import { addMessage, getMessages, maybeTitle, saveImage, toLlmHistory, type MessageMeta, type StoredMessage } from "./chats";
import { newId } from "./db";
import { absorbMemories, chatSystemPrompt, stripMemoryTags, takeStatusTag } from "./persona";
import { ADULT_IMAGE_QUERY, detectCollageRequest, detectImageIntentQuery, extractImagesTag, searchMultiEngineImages, type ScrapedImage } from "./images";
import { gatherLiveGroundingNote, gatherEntityGroundingNote, extractEntityQuery } from "./grounding";
import { sanitizeYouTubeInReply, verifyYouTubeVideo } from "./youtube";
import { onlyReachableImages, verifyGalleryImages } from "./gallery-images";
import { lastSubject, resolveSubject } from "./subject-context";
import { checkAdultImageRequest } from "./adult-guard";
import { personalityFor, safeSearchFor } from "./persona";
import { geocode, PLACES_NOTE, singlePlaceQuery, wantsPlaces } from "./geocode";
import { discussionSubject, subjectSearchQuery, visualAnswerNote } from "./visual-intent";
import { wantsDeepThinking } from "./reply-depth";
import { comicTurn } from "./comic-reply";
import { searchTurn } from "./search-reply";
import { embedTurn, runEmbedTurn } from "./embed-reply";
import { followContext } from "./turn-context";
import { detectVoiceRequest, VOICE_REPLY_NOTE } from "@/lib/voice/intent";
import { saveAudio, speechText, synthesizeVoice, type VoiceMeta } from "./voice";
import { validateVoiceInput, voiceLimits, VoiceError } from "./voice-policy";
import { extractCodeArtifacts } from "@/components/assistant/workspace-artifacts";
import { stripCodeBlocks, wantsCodeJob } from "@/lib/code-intent";
import { CodingWorkspaceRuntime, verifyAndSanitizeCodingClaims } from "@/lib/agent/coding-runtime";
import { isExecutableCodingRequest, materializeReplyFilesToWorkspace, runAutonomousCodingWorkflow } from "@/lib/agent/coding-agent";

const AGENT_TAG = /\[\[\s*agent\s*\]\]/gi;
const CODE_TAG = /\[\[\s*code\s*:\s*([^\]\n]{3,2000})\]\]/i;
/** The model chose the embed tool: [[embed: https://site]] (a URL it has, e.g. from results above). */
const EMBED_TAG = /\[\[\s*embed\s*:\s*(https?:\/\/[^\s|\]]+)[^\]\n]*\]\]/gi;
const ABOUT_PAGE =
  /\b(this|the|that|current)\s+(page|site|website|video|tab|episode|show|article|screen)\b|\bwhat('?s| is) (on|this)\b|\bon (the )?screen\b/i;

/** How many scraped images are stored on the message (the gallery loads the rest on demand). */
const STORED_IMAGES = 120;

export interface ReplyOptions {
  ownerId: string;
  chatId: string;
  content: string;
  voiceDurationSeconds?: number;
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
  /** The model's reasoning / thought summaries as they stream (shown in the "Thinking" dropdown). */
  onThought?: (text: string) => void;
}

type TraceStep = NonNullable<MessageMeta["thinking"]>["steps"][number];
const THINK_STEP = 51;
const WRITE_STEP = 52;
const MAX_THOUGHTS = 16_000;

/** Records every step and thought of a reply so the dropdown can be shown again after a reload. */
function traceReply(o: ReplyOptions) {
  const startedAt = Date.now();
  const steps: TraceStep[] = [];
  let thoughts = "";
  let answeredAt = 0;
  const step: NonNullable<ReplyOptions["onMiniAgentStep"]> = (st) => {
    const i = steps.findIndex((x) => x.id === st.id);
    if (i >= 0) steps[i] = { ...steps[i], ...st };
    else steps.push({ ...st });
    o.onMiniAgentStep?.(st);
  };
  const thought = (t: string) => {
    if (thoughts.length < MAX_THOUGHTS) thoughts += t;
    o.onThought?.(t);
  };
  return {
    step,
    thought,
    /** First words of the answer: thinking is over. */
    answered() {
      if (answeredAt) return;
      answeredAt = Date.now();
      if (steps.some((x) => x.id === THINK_STEP)) step({ id: THINK_STEP, label: "Thought it through", status: "done", detail: `${((answeredAt - startedAt) / 1000).toFixed(1)}s` });
    },
    meta(): MessageMeta["thinking"] {
      // Anything still marked running when the reply ends is finished (or stopped).
      const done = steps.map((x) => (x.status === "running" ? { ...x, status: "done" as const } : x));
      if (!done.length && !thoughts.trim()) return undefined;
      return { steps: done, thoughts: thoughts.trim() || undefined, ms: (answeredAt || Date.now()) - startedAt };
    },
  };
}

async function scrapeForChat(query: string, signal?: AbortSignal, safe: Awaited<ReturnType<typeof safeSearchFor>> = "off"): Promise<ScrapedImage[]> {
  if (process.env.SENKO_DISABLE_IMAGE_SCRAPE === "1") return [];
  try {
    const deadline = AbortSignal.timeout(12_000);
    const found = (await searchMultiEngineImages(query, 1, STORED_IMAGES, signal ? AbortSignal.any([signal, deadline]) : deadline, safe)).images;
    // Only links that really serve a picture (HTTP 200 + image) reach the chat.
    return await onlyReachableImages(found, signal, { budgetMs: 6_000 });
  } catch {
    return [];
  }
}

export async function reply(opts: ReplyOptions): Promise<StoredMessage> {
  const trace = traceReply(opts);
  // Steps and thoughts go to the browser and into the saved message.
  const o: ReplyOptions = { ...opts, onMiniAgentStep: trace.step, onThought: trace.thought };
  const userMessageId = await addMessage(o.chatId, "user", o.content, o.imageIds || []);
  await maybeTitle(o.chatId, o.content || "Image", o.provider);
  const assistantMessageId = newId("m_");

  // Earlier turns tell us who "her" / "him" / "them" refers to in follow-ups.
  const storedHistory = await getMessages(o.chatId);
  const subject = lastSubject(storedHistory.slice(0, -1));

  // "send me a voice message" / "say that out loud": the reply is spoken in Senko's voice.
  const lastReply = [...storedHistory.slice(0, -1)].reverse().find((m) => m.role === "assistant" && m.content.trim() && !m.meta?.error);
  const voiceAsk = o.imageIds?.length || o.simulateFail?.length ? null : detectVoiceRequest(o.content, !!lastReply);
  if (voiceAsk?.mode === "repeat" && lastReply) {
    // Her last reply, as it was, now spoken: no new text to write.
    o.onStart?.({ userMessageId, assistantMessageId });
    trace.answered();
    const meta: MessageMeta = {};
    const spoken = speechText(lastReply.content);
    const voice = await recordVoice(o, spoken, lastReply.meta?.mood);
    const content = spoken;
    if (voice.meta) meta.voice = voice.meta;
    if (voice.failure) meta.voiceError = voice.failure;
    if (lastReply.meta?.mood) meta.mood = lastReply.meta.mood;
    meta.thinking = trace.meta();
    await addMessage(o.chatId, "assistant", content, [], meta, assistantMessageId, userMessageId);
    return { id: assistantMessageId, role: "assistant", content, imageIds: [], meta, createdAt: new Date().toISOString() };
  }

  // "search X" / "top 20 sites for X" / "fnf hentai": a real web search, shown as a results card.
  // "send me a manga of X": the in-chat reader (pick a site, pick from its top 20, read every page).
  if (!o.imageIds?.length && !o.simulateFail?.length && !voiceAsk) {
    const safe = await safeSearchFor(o.ownerId).catch(() => "off" as const);
    const fail = (what: string) => (e: unknown) => ({
      content: `I couldn't ${what} (${e instanceof Error ? e.message : String(e)}). Try again?`,
      meta: {} as MessageMeta,
    });
    // "send me an embed of example.com" / "embed the new sml video": find the page, embed it live.
    // Follow-ups are read against what the chat just did: "now a random hentai website" after an
    // embed is another embed, "embed the 2nd one" points at a result already on screen.
    let turn: { content: string; meta: MessageMeta } | null = await embedTurn(o.content, {
      safe,
      step: o.onMiniAgentStep!,
      signal: o.signal,
      chatId: o.chatId,
      ownerId: o.ownerId,
      follow: followContext(storedHistory.slice(0, -1)),
    }).catch(fail("embed that"));
    if (!turn) turn = await comicTurn(o.content, storedHistory.slice(0, -1), safe, o.onMiniAgentStep!, o.signal).catch(fail("load that from the site"));
    if (!turn) turn = await searchTurn(o.content, safe, o.onMiniAgentStep!, { chatId: o.chatId, signal: o.signal }).catch(fail("finish the search"));
    if (turn) {
      o.onStart?.({ userMessageId, assistantMessageId });
      trace.answered();
      const meta: MessageMeta = { ...turn.meta, thinking: trace.meta() };
      if (o.signal?.aborted) meta.interrupted = true;
      await addMessage(o.chatId, "assistant", turn.content, [], meta, assistantMessageId, userMessageId);
      return { id: assistantMessageId, role: "assistant", content: turn.content, imageIds: [], meta, createdAt: new Date().toISOString() };
    }
  }
  const detected = o.imageIds?.length ? undefined : detectCollageRequest(o.content);
  const resolved = detected ? resolveSubject(detected.query, subject) : undefined;
  const collage = detected && resolved
    ? { ...detected, query: resolved.label, searchQuery: detected.adultWord ? `${resolved.query} ${detected.adultWord}` : resolved.query }
    : undefined;
  if (collage) {
    o.onStart?.({ userMessageId, assistantMessageId });
    const safe = await safeSearchFor(o.ownerId).catch(() => "off" as const);
    // Adult collages are allowed, except of minors or real people (content-policy.ts).
    if (collage.adultWord) {
      if (safe !== "off") {
        const content = `SafeSearch is set to ${safe}, so I can't make adult collages. You can turn it off in Settings.`;
        await addMessage(o.chatId, "assistant", content, [], {}, assistantMessageId, userMessageId);
        return { id: assistantMessageId, role: "assistant", content, imageIds: [], meta: {}, createdAt: new Date().toISOString() };
      }
      o.onMiniAgentStep?.({ id: 0, label: `Checking who "${collage.query}" is`, status: "running" });
      const check = await checkAdultImageRequest(`${collage.adultWord} ${collage.query}`, (name) => buildEntityDossier(name, o.signal));
      o.onMiniAgentStep?.({ id: 0, label: check.allowed ? `Checked ${check.subject || collage.query}` : "Not allowed", status: check.allowed ? "done" : "error" });
      if (!check.allowed) {
        const content = check.reason || "I can't make that collage.";
        await addMessage(o.chatId, "assistant", content, [], {}, assistantMessageId, userMessageId);
        return { id: assistantMessageId, role: "assistant", content, imageIds: [], meta: {}, createdAt: new Date().toISOString() };
      }
    }
    o.onMiniAgentStep?.({ id: 1, label: `Finding images of ${collage.query}`, status: "running" });
    const images = await scrapeForChat(collage.searchQuery, o.signal, safe);
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
    trace.answered();
    meta.thinking = trace.meta();
    await addMessage(o.chatId, "assistant", content, [], meta, assistantMessageId, userMessageId);
    return { id: assistantMessageId, role: "assistant", content, imageIds: [], meta, createdAt: new Date().toISOString() };
  }

  let text = "";
  const meta: MessageMeta = {};
  let discussSubject: string | null = null;
  let discussDossier: EntityDossier | null = null;

  // Build requests go to a coding job in the chat's workspace (decided here, not by the model).
  const chatHasProject = storedHistory.some((m) => m.meta?.codeTask);
  // A voice message is spoken words: no generated UI cards or coding jobs.
  const composedUI = !voiceAsk && wantsGeneratedUI(o.content);
  const codeJob = !voiceAsk && !composedUI && !o.imageIds?.length && wantsCodeJob(o.content, chatHasProject);
  // Location questions get a map card without the user having to ask for "a ui".
  const placesAsk = !codeJob && !voiceAsk && wantsPlaces(o.content);

  // Image requests ("show me pics of X") scrape every engine in parallel with the reply.
  const askedImages = o.imageIds?.length || composedUI || codeJob || voiceAsk ? undefined : detectImageIntentQuery(o.content);
  // Same rules as collages: adult images follow SafeSearch and never show minors or real people.
  const imageSafe = askedImages ? await safeSearchFor(o.ownerId).catch(() => "off" as const) : "off";
  let imageQuery = askedImages ? resolveSubject(askedImages, subject).query : undefined;
  let imageBlocked = "";
  if (imageQuery && ADULT_IMAGE_QUERY.test(o.content)) {
    const adultWord = ADULT_IMAGE_QUERY.exec(o.content)![1];
    if (imageSafe !== "off") imageBlocked = `SafeSearch is set to ${imageSafe}; adult images are filtered. It can be turned off in Settings.`;
    else {
      const check = await checkAdultImageRequest(`${adultWord} ${imageQuery}`, (name) => buildEntityDossier(name, o.signal));
      if (!check.allowed) { imageBlocked = check.reason || "That image request isn't allowed."; imageQuery = undefined; }
      else if (!ADULT_IMAGE_QUERY.test(imageQuery)) imageQuery = `${imageQuery} ${adultWord}`;
    }
  }
  let imagesJob: Promise<ScrapedImage[]> | null = null;
  if (imageQuery) {
    imagesJob = scrapeForChat(imageQuery, o.signal, imageSafe).then((images) => {
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
    if (imageBlocked) {
      pageNote = [pageNote, `IMAGE REQUEST NOT FULFILLED: ${imageBlocked} Tell the user this in one short sentence, without lecturing, and offer something close that is fine.`].filter(Boolean).join("\n\n");
    }
    if (imageQuery) {
      pageNote = [
        pageNote,
        `IMAGE RESULTS: the app is fetching pictures for "${imageQuery}" and keeps a full gallery available. Compose the visible images and text yourself using chat-layout, with image indexes 0 through 3 and imageQuery "${imageQuery}" as fallback on each image. Choose placement, sizes, grouping and amount of prose to fit this request; you are not limited to a strip below the text. Don't invent image URLs or add an [[images: ...]] tag.`,
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

    if (placesAsk) pageNote = [pageNote, PLACES_NOTE].filter(Boolean).join("\n\n");

    // "do you like Chara from Undertale": research the subject, then answer with a visual layout.
    discussSubject = !codeJob && !composedUI && !placesAsk && !imageQuery && !o.imageIds?.length ? discussionSubject(o.content) : null;

    // The plan for this reply, as decided above (first line of the "Thinking" dropdown).
    const plan = codeJob ? "A build request: handing it to the coding agent in the workspace"
      : composedUI ? "An interactive UI request: researching the subject and designing the layout"
      : placesAsk ? "About real places: I'll find exact locations and show them on a map"
      : imageQuery ? `An image request: searching for "${imageQuery}"`
      : discussSubject ? `About ${discussSubject}: researching it, then answering with pictures and analysis`
      : o.imageIds?.length ? "Looking at the image(s) you attached"
      : "A conversational reply";
    o.onMiniAgentStep?.({ id: 50, label: "Understood your message", status: "done", detail: plan });

    if (discussSubject) {
      const query = subjectSearchQuery(discussSubject);
      o.onMiniAgentStep?.({ id: 0, label: `Researching "${query}"`, status: "running" });
      const sig = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000);
      discussDossier = await buildEntityDossier(query, sig).catch(() => null);
      o.onMiniAgentStep?.({ id: 0, label: discussDossier ? `Researched ${discussDossier.title}` : `No sources found for "${query}"`, status: "done",
        detail: discussDossier ? `${discussDossier.facts.length} facts, ${discussDossier.images.length} images` : undefined, url: discussDossier?.sources[0]?.url });
      pageNote = [pageNote, visualAnswerNote(discussSubject), discussDossier ? dossierPrompt(discussDossier) : ""].filter(Boolean).join("\n\n");
    }

    const groundingNote = codeJob ? "" : await gatherLiveGroundingNote(o.content, o.signal, o.onMiniAgentStep).catch(() => "");
    if (groundingNote) {
      pageNote = [pageNote, groundingNote].filter(Boolean).join("\n\n");
    }

    // "who is X ... make the ui": research the subject for real (Wikipedia + Fandom wiki)
    // so the UI is written from sources, with real images, instead of from memory.
    let dossier: EntityDossier | null = null;
    if (composedUI && !codeJob) {
      const entityQuery = extractEntityQuery(o.content);
      if (entityQuery) {
        o.onMiniAgentStep?.({ id: 0, label: `Researching "${entityQuery}"`, status: "running" });
        dossier = await buildEntityDossier(entityQuery, o.signal).catch(() => null);
        if (dossier) {
          o.onMiniAgentStep?.({ id: 0, label: `Researched ${dossier.title}`, status: "done",
            detail: `${dossier.facts.length} facts, ${dossier.images.length} images, ${dossier.sources.length} sources`, url: dossier.sources[0]?.url });
          pageNote = [pageNote, dossierPrompt(dossier)].filter(Boolean).join("\n\n");
        } else {
          const entityNote = await gatherEntityGroundingNote(entityQuery, o.signal, o.onMiniAgentStep).catch(() => "");
          if (entityNote) pageNote = [pageNote, entityNote].filter(Boolean).join("\n\n");
        }
      }
    }

    // Told up front, so the words are written to be heard (no markdown, links or cards).
    const requestedSeconds = o.voiceDurationSeconds ?? voiceLimits().defaultSeconds;
    const extra = [pageNote, voiceAsk ? `${VOICE_REPLY_NOTE}\nAim for about ${Math.max(5, Math.floor(requestedSeconds * 2))} words, fitting a ${requestedSeconds}-second maximum. Keep the topic coherent; avoid filler. Never exceed ${voiceLimits().maxChars} characters.` : ""].filter(Boolean).join("\n\n");
    const [system, compactSystem] = await Promise.all([
      chatSystemPrompt(o.ownerId, extra, { timeZone: o.timeZone }),
      chatSystemPrompt(o.ownerId, extra, { compact: true, timeZone: o.timeZone }),
    ]);
    const messages: LlmMessage[] = [{ role: "system", content: system }, ...history];
    // Think only where it helps, and briefly: a chat answer should start in a second or two.
    const thinking = wantsDeepThinking(o.content, { visual: !!discussSubject, places: placesAsk, composedUI, attachments: !!o.imageIds?.length }) ? "low" as const : "off" as const;
    o.onMiniAgentStep?.({ id: THINK_STEP, label: "Thinking", status: "running" });
    // compactSystem lets the LLM layer shrink long chats to fit each provider instead of failing.
    if (composedUI) {
      o.onStart?.({ userMessageId, assistantMessageId });
      // A focused designer prompt (not the whole chat persona) keeps small models on task.
      const uiSystem = [DYNAMIC_UI_SYSTEM, `Current date: ${new Date().toISOString().slice(0, 10)}.`, pageNote].filter(Boolean).join("\n\n");
      const uiMessages: LlmMessage[] = [{ role: "system", content: uiSystem }, ...history.slice(-6)];
      const generated = await generateComposedUI(uiMessages, { provider: o.provider, signal: o.signal, simulateFail: o.simulateFail, dossier, onThought: o.onThought, thinking,
        storeImage: o.simulateFail?.length ? undefined : (data) => saveImage(o.ownerId, "image/webp", data).then((id) => `/api/uploads/${id}`),
        onEnrich: (phase, stats) => o.onMiniAgentStep?.({ id: 2, label: phase === "images" ? "Verifying images" : `Verified ${stats.images} images`, status: phase === "images" ? "running" : "done",
          detail: stats.droppedFacts.length ? `Removed ${stats.droppedFacts.length} unsupported claim(s)` : undefined }),
        onPhase: (repair, issues) => o.onMiniAgentStep?.({ id: 1, label: repair ? "Repairing UI component format" : "Composing interactive UI", status: "running", detail: issues?.join(" ") }) });
      Object.assign(meta, { provider: generated.provider, providerLabel: generated.providerLabel, model: generated.model });
      trace.answered();
      text = generated.text;
      o.onPreview?.(text);
      o.onMiniAgentStep?.({ id: 1, label: "UI component schema validated", status: "done", detail: `${generated.nodeCount} component tree(s), ${generated.inferenceRequests} inference requests. Browser rendering is checked separately.` });
    } else {
      const opened = await openStream(messages, { provider: o.provider, signal: o.signal, simulateFail: o.simulateFail, compactSystem, onThought: o.onThought, thinking });
      Object.assign(meta, { provider: opened.provider, providerLabel: opened.providerLabel, model: opened.model });
      o.onStart?.({ userMessageId, assistantMessageId, provider: opened.provider, providerLabel: opened.providerLabel, model: opened.model });
      for await (const chunk of opened.stream) {
        if (!text) {
          trace.answered();
          o.onMiniAgentStep?.({ id: WRITE_STEP, label: "Writing the reply", status: "running", detail: opened.providerLabel ? `${opened.providerLabel} · ${opened.model}` : undefined });
        }
        text += chunk;
        o.onDelta?.(chunk);
      }
      if (text) o.onMiniAgentStep?.({ id: WRITE_STEP, label: "Wrote the reply", status: "done", detail: opened.providerLabel ? `${opened.providerLabel} · ${opened.model}` : undefined });
    }
    if (!text.trim()) throw new Error("The AI returned an empty reply. Try again.");
  } catch (e) {
    if (composedUI) o.onMiniAgentStep?.({ id: 1, label: "UI generation did not pass validation", status: "error", detail: e instanceof Error ? e.message : String(e) });
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

  // The chat model sometimes draws a card on its own ("who is X"). Research it and swap its
  // guessed image searches for verified, stored pictures before it is saved.
  if (!composedUI && !codeJob && !o.signal?.aborted && !o.simulateFail?.length && /```(?:ui|senko-ui|json-ui)\s*\n/.test(clean)) {
    o.onMiniAgentStep?.({ id: 2, label: "Checking facts and images", status: "running" });
    const enriched = await enrichInlineUI(clean, {
      signal: o.signal,
      research: (name) => buildEntityDossier(name, o.signal),
      dossier: discussDossier,
      // An opinion/analysis reply keeps Senko's take; only hard facts are checked.
      guard: discussSubject ? "facts" : undefined,
      // The answer is already on screen; don't keep it "working" for long on picture checks.
      // Pictures not verified in time are left for the browser to find.
      imageBudgetMs: 12_000,
      storeImage: (data) => saveImage(o.ownerId, "image/webp", data).then((id) => `/api/uploads/${id}`),
    }).catch(() => null);
    if (enriched) {
      clean = enriched.text;
      o.onPreview?.(clean);
      o.onMiniAgentStep?.({ id: 2, label: `Verified ${enriched.stats.images} images`, status: "done",
        detail: enriched.dossier ? `Researched ${enriched.dossier.title}` : undefined });
    }
  }

  // "where is X" should always come with a map, even when the model forgot to draw one.
  if (placesAsk && !o.signal?.aborted && !o.simulateFail?.length && clean && !/"type"\s*:\s*"map"/.test(clean)) {
    const place = singlePlaceQuery(o.content);
    const hit = place ? await geocode(place, { signal: o.signal }).catch(() => null) : null;
    if (hit) {
      const label = hit.name || place!;
      const category = hit.kind ? hit.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : undefined;
      const card = { type: "map", title: label, zoom: 13, markers: [{ label, address: hit.address, category, lat: hit.lat, lng: hit.lng }] };
      clean = `${clean.trimEnd()}\n\n` + "```ui\n" + JSON.stringify(card) + "\n```";
      o.onPreview?.(clean);
    }
  }

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

  // The AI can choose the embed tool itself. The site is really opened and checked; the reply
  // only says it's embedded if the card exists, otherwise it says why not.
  const embedAsk = [...clean.matchAll(EMBED_TAG)][0]?.[1];
  clean = clean.replace(EMBED_TAG, "").replace(/\n{3,}/g, "\n\n").trim();
  if (embedAsk && !o.signal?.aborted && !o.simulateFail?.length) {
    const safe = await safeSearchFor(o.ownerId).catch(() => "off" as const);
    let host = embedAsk;
    try { host = new URL(embedAsk).hostname.replace(/^www\./, ""); } catch { /* keep as typed */ }
    const shown = await runEmbedTurn({ asked: host, url: embedAsk }, {
      safe, step: o.onMiniAgentStep!, signal: o.signal, chatId: o.chatId, ownerId: o.ownerId,
    }).catch((e: unknown) => ({ content: `I couldn't embed ${host} (${e instanceof Error ? e.message : String(e)}).`, meta: {} as MessageMeta }));
    if (shown.meta.embed) {
      meta.embed = shown.meta.embed;
      if (shown.meta.videos) meta.videos = shown.meta.videos;
      if (shown.meta.embed.note) clean = `${clean}\n\n_${shown.meta.embed.note}._`.trim();
    } else {
      clean = `${clean}\n\n${shown.content}`.trim();
    }
    o.onPreview?.(clean);
  }

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

  // Voice message: asked for in the message, or chosen by the model with [[voice]] when the
  // wording was unusual ("lemme hear you"). The text stays as the transcript under the player.
  const voiceTag = VOICE_TAG.test(clean);
  if (voiceTag) clean = clean.replace(VOICE_TAG_ALL, "").replace(/\n{3,}/g, "\n\n").trim();
  if ((voiceAsk || voiceTag) && clean && !meta.error && !o.signal?.aborted && !o.simulateFail?.length) {
    const voice = await recordVoice(o, speechText(clean), meta.mood);
    if (voice.meta) meta.voice = voice.meta;
    if (voice.failure) meta.voiceError = voice.failure;
  }

  meta.thinking = trace.meta();
  await addMessage(o.chatId, "assistant", clean, [], meta, assistantMessageId, userMessageId);
  return { id: assistantMessageId, role: "assistant", content: clean, imageIds: [], meta, createdAt: new Date().toISOString() };
}

const VOICE_TAG = /\[\[\s*voice\s*\]\]/i;
const VOICE_TAG_ALL = /\[\[\s*voice\s*\]\]/gi;

/**
 * Speak `text` in Senko's voice and store it. Returns the voice meta, or a plain sentence saying
 * why there's no audio (never a player for audio that doesn't exist).
 */
async function recordVoice(o: ReplyOptions, text: string, mood?: string): Promise<{ meta?: VoiceMeta; error?: string; failure?: MessageMeta["voiceError"] }> {
  const STEP = 60;
  o.onMiniAgentStep?.({ id: STEP, label: "Generating speech", status: "running" });
  try {
    if (!text.trim()) throw new Error("the reply has nothing that can be spoken");
    const personality = await personalityFor(o.ownerId).catch(() => undefined);
    validateVoiceInput(text, o.voiceDurationSeconds);
    const got = await synthesizeVoice({ text, ownerId: o.ownerId, durationSeconds: o.voiceDurationSeconds, emotion: mood, personality, signal: o.signal });
    const audioId = await saveAudio(o.ownerId, got.mime, got.audio);
    o.onMiniAgentStep?.({ id: STEP, label: "Recorded a voice message", status: "done", detail: got.engine === "custom" ? `${got.voice} · own voice model` : got.voice });
    return { meta: { audioId, mime: got.mime, engine: got.engine, voice: got.voice, emotion: mood || undefined, seconds: got.seconds, model: got.model, modelKind: got.modelKind, modelFingerprint: got.modelFingerprint } };
  } catch (e) {
    const why = e instanceof VoiceError ? e.message : "Speech generation failed. Please try again later";
    o.onMiniAgentStep?.({ id: STEP, label: "Couldn't record the voice message", status: "error", detail: why });
    if (!(e instanceof VoiceError)) console.warn("[voice] Recording failed", e);
    return { error: `I couldn't record this as a voice message: ${why.replace(/[.\s]+$/, "")}.`, failure: { code: e instanceof VoiceError ? e.code : "synthesis_failed", message: e instanceof VoiceError ? e.message : "Speech generation failed.", retryAfter: e instanceof VoiceError ? e.retryAfter : undefined } };
  }
}
