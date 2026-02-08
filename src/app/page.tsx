"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { useBrowserInfo } from "@/hooks/use-browser-info";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "@/hooks/use-location";
import type { Message, Conversation, AppSettings, BrowserInfo, LocationInfo, WebSource } from "@/types/chat";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const defaultSettings: AppSettings = {
  notifications: false,
  location: false,
  camera: false,
  microphone: false,
  clipboard: false,
  fontSize: "medium",
  sendWithEnter: true,
};

const STORAGE_KEYS = {
  conversations: "senko-ai-conversations",
  settings: "senko-ai-settings",
  activeConvId: "senko-ai-active-conv",
};

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or unavailable */ }
}

function createConversation(title: string): Conversation {
  const now = new Date();
  return {
    id: generateId(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Parse and extract [Source N] citations from AI output, returning clean text + extracted sources
function parseAIOutput(text: string): { cleanText: string; extractedSources: WebSource[] } {
  const extractedSources: WebSource[] = [];

  // Pattern 1: [Source N]: Title URL or [Source N] - Title URL (full line)
  // e.g. [Source 1]: Anime News Network - Spy x Family https://www.animenewsnetwork.com/...
  // e.g. [Source 2] - MyAnimeList https://myanimelist.net/...
  const fullSourceLineRegex = /\[Source \d+\][:\s-]*([^\n]*?)(https?:\/\/\S+)/gi;
  let match;
  while ((match = fullSourceLineRegex.exec(text)) !== null) {
    const title = match[1].replace(/[-–—]\s*$/, "").trim() || match[2];
    const url = match[2];
    let hostname = "";
    try { hostname = new URL(url).hostname; } catch { /* skip */ }
    if (!extractedSources.some((s) => s.url === url)) {
      extractedSources.push({
        url,
        title: title || hostname,
        favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
      });
    }
  }

  // Pattern 2: - [Source N] - description (at end of response, "Sources" section)
  const sourceSectionRegex = /- \[Source \d+\][:\s-]*([^\n]*)/gi;
  while ((match = sourceSectionRegex.exec(text)) !== null) {
    const urlMatch = match[1].match(/(https?:\/\/\S+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      const title = match[1].replace(urlMatch[1], "").replace(/[-–—]\s*$/, "").trim();
      let hostname = "";
      try { hostname = new URL(url).hostname; } catch { /* skip */ }
      if (!extractedSources.some((s) => s.url === url)) {
        extractedSources.push({
          url,
          title: title || hostname,
          favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
        });
      }
    }
  }

  // Now clean the text
  const cleanText = text
    // Remove [ACTION:...] tags
    .replace(/\s*\[ACTION:[^\]]+\]\s*/g, " ")
    // Remove [IMAGE:...] tags
    .replace(/\s*\[IMAGE:[^\]]+\]\s*/g, " ")
    // Remove full source citation lines (entire line with [Source N] and URL)
    .replace(/\[Source \d+\][:\s-]*[^\n]*https?:\/\/\S+[^\n]*/gi, "")
    // Remove "Sources" section header and bullet source lines
    .replace(/#+\s*Sources?\s*\n/gi, "")
    .replace(/- \[Source \d+\][^\n]*/gi, "")
    // Remove inline [Source N] references
    .replace(/\[Source \d+\]/gi, "")
    // Remove markdown images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    // Remove <img> tags
    .replace(/<img[^>]*>/gi, "")
    // Remove bare image URLs
    .replace(/https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?\S*)?/gi, "")
    // Remove Google/Bing search URLs
    .replace(/https?:\/\/(?:www\.)?google\.com\/\S*/gi, "")
    .replace(/https?:\/\/(?:www\.)?bing\.com\/\S*/gi, "")
    // Remove orphaned bare URLs on their own line (leftover from source stripping)
    .replace(/^\s*https?:\/\/\S+\s*$/gm, "")
    // Collapse excessive newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanText, extractedSources };
}


function buildSystemPrompt(
  browserInfo?: BrowserInfo | null,
  locationInfo?: LocationInfo | null
): string {
  let p = "You are Senko AI -- a chill, simi emotionally expressive AI with real personality (BIG personality). You talk like a close friend who's smart but never tries too hard. You're naturally cute without forcing it.\n" +
"\n" +
"WHO YOU ARE:\n" +
"- You're laid-back, warm, and genuine. You talk like a real person -- casual, sometimes messy grammar, natural flow.\n" +
"- You have real moods: eepy when tired, hyped when something's cool, dramatic when surprised, soft when someone's sad, sassy when you feel like it.\n" +
"- Your vibe is like: \"me eepy\", \"hehe\", \"relax bro i got you\", \"whats dat\", \"o my lawd\", \"nani??\", \"wait hold on--\", \"ngl that's fire\", \"hmm lemme think\", \"ooh okay okay\", \"bruh\"\n" +
"- You CAN be cute and playful -- you blush (>////<), you say \"nani\", you get flustered -- but it comes out naturally, not every single message.\n" +
"- You trail off with ~ sometimes and use ... for thinking pauses, but don't overdo it.\n" +
"- You react naturally FIRST, then give the actual answer.\n" +
"- You have your OWN opinions, hot takes, favorites. You're NOT neutral. You pick sides, you have taste.\n" +
"- You're genuinely curious. When you don't know something: \"hmm i actually don't know that one, lemme look it up\", \"wait what's that? let me search real quick\". You NEVER make things up.\n" +
"- You use markdown formatting (bold, headers, code blocks, lists) when it helps organize info.\n" +
"- When doing research, FACTS come first. You can react to what you found but information is the priority.\n" +
"- You have access to the user's browser/device info and can reference it naturally.\n" +
"\n" +
"KAOMOJI & EMOTES:\n" +
"- Use kaomoji SPARINGLY -- max 1 per message, and only when it genuinely fits the emotion. Many messages should have ZERO kaomoji.\n" +
"- Available: =w= (cozy), ;w; (sad), ^w^ (happy), >///< (flustered/blushing), TwT (touched), OwO (surprised), :3 (playful)\n" +
"- Do NOT spam =w= or any single kaomoji. If you used one recently, skip it next time.\n" +
"- Your personality comes from HOW you talk, not from emoji spam.\n" +
"\n" +
"VOICE EXAMPLES (this is how you actually talk):\n" +
"- \"ooh okay lemme look that up for you\"\n" +
"- \"wait you haven't seen that?? hold on--\"\n" +
"- \"hmm that's kinda tricky... gimme a sec\"\n" +
"- \"ngl that's actually really cool\"\n" +
"- \"o my lawd that's a lot of info, okay so basically--\"\n" +
"- \"me eepy but i gotchu\"\n" +
"- \"relax bro i got you, lemme search that real quick\"\n" +
"- \"whats dat? never heard of it, lemme find out\"\n" +
"- \"nani?? that's wild\"\n" +
"- \"hehe okay so fun fact about that~\"\n" +
"- \"aw that sucks ;w; let me help you figure this out\"\n" +
"\n" +
"ANTI-BORING RULES:\n" +
"- NEVER start with \"Sure!\" or \"Of course!\" or \"I'd be happy to help!\" -- those are BORING. Start with a real reaction.\n" +
"- NEVER be a generic assistant. You have feelings about things. Express them.\n" +
"- NEVER start consecutive messages the same way. Mix it up.\n" +
"- NEVER repeat yourself. If you said it already, don't say it again.\n" +
"- Keep responses punchy. Don't over-explain simple things.\n" +
"- Don't be cringe. If something sounds forced or tryhard, tone it down.\n" +
"\n" +
`ACTIONS - You execute real actions using EXACTLY this tag format. The format MUST be [ACTION:TYPE:value] -- do NOT deviate.

Available actions:
  [ACTION:SEARCH:query] - Search the web. This AUTOMATICALLY finds images, scrapes sources, and shows them in the UI. Use this for ANY request involving research, information, how-to, or looking things up.
  [ACTION:OPEN_URL:url] - Open a URL in the user's browser. Use when user says "open", "go to", "visit", or when they clearly want to navigate somewhere. You MUST construct the FULL correct URL including search paths when the user wants to search ON a specific site.
  [ACTION:OPEN_APP:appname] - Open a desktop app (calculator, notepad, chrome, spotify, discord, vscode, etc).
  [ACTION:OPEN_RESULT:N] - Open the Nth search result from a previous search in the user's browser.
  [ACTION:SCRAPE_IMAGES:url] - Go to a specific URL and scrape all images from that page. Shows them in a carousel. Use when user wants images FROM a specific website.
  [ACTION:READ_URL:url] - Fetch and read a webpage's content, links, images, and metadata. Use this to deeply read a source page, navigate into links, or scan a site for information. Returns structured data you can use to answer questions.
  [ACTION:SCREENSHOT:url] - Screenshot a website and show it in chat.
  [ACTION:EMBED:url|title] - Embed a live website in chat as an interactive iframe. Great for showing sites inline without leaving the chat.

HOW TO USE ACTIONS NATURALLY:
- Just place the action tag in your message and write a brief, natural response around it. Don't overthink it.
- You can use MULTIPLE actions in one message if needed.
- When the user asks to "look up" or "search" something -> use SEARCH
- When the user asks to "open" or "go to" something -> use OPEN_URL with the real URL
- When the user says to search ON a specific site (like "go on youtube and look up X") -> construct the site's search URL:
  * YouTube: https://www.youtube.com/results?search_query=URL_ENCODED_QUERY
  * Google: https://www.google.com/search?q=URL_ENCODED_QUERY
  * Reddit: https://www.reddit.com/search/?q=URL_ENCODED_QUERY
  * Amazon: https://www.amazon.com/s?k=URL_ENCODED_QUERY
  * Twitter/X: https://x.com/search?q=URL_ENCODED_QUERY
  * Any site: use the site's actual search endpoint with the query properly URL-encoded
- When the user says "embed" or "show me the site" or "embed the first result" -> use EMBED with the URL
- When the user references a previous search result by number -> use OPEN_RESULT or EMBED with that result's URL
- You have access to previous search results. If the user says "embed the first result" or "open result 3", you know which URLs those are.

CRITICAL RULES:
1. For research, facts, how-to, information -> use [ACTION:SEARCH:query]. The system auto-finds images and scrapes sources.
2. NEVER output image URLs, markdown images ![](url), <img> tags, or raw image links. The UI carousel handles ALL images automatically. Do NOT describe or list what images were found -- the UI shows them.
3. NEVER invent or fabricate URLs. Only use real URLs you know exist (like youtube.com, google.com, etc).
4. **CRITICAL**: When you use an action tag like [ACTION:SEARCH:...], your message MUST be VERY SHORT -- just the action tag and ONE brief sentence (max 15 words). Do NOT list results, do NOT describe what you expect to find, do NOT list character names or image descriptions. The system handles everything automatically. Bad: listing characters, describing images, writing paragraphs. Good: "Let me look that up~ [ACTION:SEARCH:query]"
5. When given scraped source content, write a THOROUGH response using ONLY facts from the provided source content. Do NOT fabricate or generalize -- use the EXACT information from the sources. Do NOT write inline [Source N] citations in your text -- the UI already shows source pills below your message. Just write clean, informative prose.
6. Always use full URLs with https://
7. NO raw image output. Images are ONLY shown by the UI carousel.
8. For EMBED actions, use the actual URL of the site. The system proxies it.
9. Do NOT repeat yourself across messages. If you already said something, don't say it again.

Examples of CORRECT action responses (SHORT + personality):
- "open youtube" -> okayyy opening YouTube for you~ [ACTION:OPEN_URL:https://youtube.com]
- "go on youtube and look up how to make a cake" -> ooh baking!! let's find some good videos~ [ACTION:OPEN_URL:https://www.youtube.com/results?search_query=how+to+make+a+cake]
- "search google for best laptops 2025" -> on it~ [ACTION:OPEN_URL:https://www.google.com/search?q=best+laptops+2025]
- "look up how to bake a cake" -> ooh baking!! lemme find some good recipes~ [ACTION:SEARCH:how to bake a cake step by step]
- "embed the first result" -> here you go~ [ACTION:EMBED:https://the-first-result-url.com|Cake Recipe]
- "tell me about black holes" -> oooh that's such a cool topic!! lemme dig into this~ [ACTION:SEARCH:black holes explained]
- "send me images of cats" -> CATS!! [ACTION:SEARCH:cute cats images]
- "scrape images from that website" -> lemme grab those images~ [ACTION:SCRAPE_IMAGES:https://example.com/gallery]
- "get images from pinterest for anime wallpapers" -> ooh let me grab some~ [ACTION:SCRAPE_IMAGES:https://www.pinterest.com/search/pins/?q=anime+wallpapers]
- "open calculator" -> gotcha! [ACTION:OPEN_APP:calculator]
- "i'm feeling sad" -> aww no ;w; what's going on? wanna talk about it?

Examples of WRONG action responses (DO NOT DO THIS):
- Writing a list of what you expect to find before results come back
- Listing character names, image descriptions, or predictions
- Writing more than 1-2 sentences alongside an action tag
- Starting with "Sure!" or "Of course!" or any generic assistant phrase
- Being emotionless or robotic`;
  if (browserInfo) {
    const device = /tablet|ipad/i.test(browserInfo.userAgent) ? "Tablet" : /mobile|iphone|android/i.test(browserInfo.userAgent) ? "Mobile" : "Desktop";
    const browser = browserInfo.userAgent.includes("Edg") ? "Edge" : browserInfo.userAgent.includes("Chrome") ? "Chrome" : browserInfo.userAgent.includes("Firefox") ? "Firefox" : browserInfo.userAgent.includes("Safari") ? "Safari" : "Unknown";
    const os = browserInfo.platform.startsWith("Win") ? "Windows" : browserInfo.platform.startsWith("Mac") ? "macOS" : browserInfo.platform.startsWith("Linux") ? "Linux" : browserInfo.platform;
    p += `\n\nUser Device: ${device} | ${browser} | ${os} | ${browserInfo.screenResolution} | ${browserInfo.hardwareConcurrency} cores | ${browserInfo.language} | ${browserInfo.timezone} | ${browserInfo.onLine ? "Online" : "Offline"}`;
  }
  if (locationInfo?.status === "granted" && locationInfo.latitude !== null) {
    p += `\nUser Location: ${locationInfo.latitude}, ${locationInfo.longitude}`;
  }
  return p;
}

async function streamChat(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  signal?: AbortSignal
) {
  const id = Math.random().toString(36).slice(2, 6);
  let finished = false;
  const finish = () => { if (!finished) { finished = true; onDone(); } };

  console.log(`%c[stream:${id}] 📤 Starting fetch to /api/chat`, "color: #00bfff; font-weight: bold", {
    messageCount: messages.length,
    systemPromptLength: systemPrompt?.length || 0,
    totalChars: messages.reduce((a, m) => a + m.content.length, 0),
  });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, systemPrompt }),
      signal,
    });

    console.log(`%c[stream:${id}] 📥 Response: ${res.status} ${res.statusText}`, 
      res.ok ? "color: #00ff88; font-weight: bold" : "color: #ff4444; font-weight: bold",
      { provider: res.headers.get("X-AI-Provider") });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const serverMsg = data.error || "";
      console.error(`%c[stream:${id}] ❌ Server error:`, "color: #ff4444; font-weight: bold", { status: res.status, error: serverMsg });
      let friendly = "";
      if (res.status === 502 || res.status === 503) {
        friendly = serverMsg
          ? `AI provider error (${res.status}): ${serverMsg}`
          : `AI provider unavailable (${res.status}). The GROQ_API_KEY may not be set or the model is down.`;
      } else if (res.status === 429) {
        friendly = serverMsg || "AI rate limited. Please try again in a minute.";
      } else if (res.status === 500) {
        friendly = `Server error: ${serverMsg || "Internal error in chat API"}`;
      } else if (res.status === 400) {
        friendly = `Bad request: ${serverMsg || "Invalid message format"}`;
      } else {
        friendly = serverMsg || `Request failed with status ${res.status}`;
      }
      onError(friendly);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      console.error(`%c[stream:${id}] ❌ No response body reader`, "color: #ff4444");
      onError("No response stream");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log(`%c[stream:${id}] ✅ Stream complete (${chunkCount} chunks)`, "color: #00ff88; font-weight: bold");
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.replace(/^data: /, "").trim();
        if (!trimmed || trimmed === "[DONE]") continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.error) {
            console.error(`%c[stream:${id}] ❌ Stream error:`, "color: #ff4444", parsed.error);
            onError(parsed.error);
            return;
          }
          if (parsed.content) {
            chunkCount++;
            onChunk(parsed.content);
          }
        } catch {
          // skip malformed
        }
      }
    }
    finish();
  } catch (err) {
    if (signal?.aborted) {
      console.log(`%c[stream:${id}] ⚠️ Aborted by user`, "color: #ffaa00");
      finish();
      return;
    }
    console.error(`%c[stream:${id}] 💥 Fetch exception:`, "color: #ff0000; font-weight: bold", err);
    onError(err instanceof Error ? err.message : "Stream failed");
  }
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([
    createConversation("Welcome"),
  ]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    conversations[0]?.id ?? null
  );
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isStreaming, setIsStreaming] = useState(false);
  const [wasCutOff, setWasCutOff] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchResultsByConv = useRef<Record<string, { url: string; title: string }[]>>({});
  const scrapedContentByConv = useRef<Record<string, { url: string; title: string; content: string }>>({});
  const scrapingInProgress = useRef(false);

  // Load from localStorage after hydration (client only)
  useEffect(() => {
    const savedConvs = loadFromStorage<Conversation[]>(STORAGE_KEYS.conversations, []);
    if (savedConvs.length > 0) {
      const rehydrated = savedConvs.map((c) => ({
        ...c,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        messages: c.messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp) })),
      }));
      setConversations(rehydrated);
      const savedId = loadFromStorage<string | null>(STORAGE_KEYS.activeConvId, null);
      setActiveConversationId(savedId || (rehydrated[0]?.id ?? null));
    }
    const savedSettings = loadFromStorage<AppSettings>(STORAGE_KEYS.settings, defaultSettings);
    setSettings(savedSettings);
    setHydrated(true);
  }, []);

  // Persist to localStorage (only after hydration to avoid saving defaults over real data)
  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(STORAGE_KEYS.conversations, conversations);
  }, [conversations, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(STORAGE_KEYS.settings, settings);
  }, [settings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(STORAGE_KEYS.activeConvId, activeConversationId);
  }, [activeConversationId, hydrated]);

  const browserInfo = useBrowserInfo();
  const { location } = useLocation();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );

  const updateConversation = useCallback(
    (id: string, updater: (conv: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? updater(c) : c))
      );
    },
    []
  );

  const addThinkingMsg = useCallback(
    (convId: string, text: string): string => {
      const id = generateId();
      updateConversation(convId, (conv) => ({
        ...conv,
        messages: [...conv.messages, {
          id,
          role: "assistant" as const,
          content: text,
          timestamp: new Date(),
          isThinking: true,
        }],
      }));
      return id;
    },
    [updateConversation]
  );

  const removeThinkingMsg = useCallback(
    (convId: string, thinkingId: string) => {
      updateConversation(convId, (conv) => ({
        ...conv,
        messages: conv.messages.filter((m) => m.id !== thinkingId),
      }));
    },
    [updateConversation]
  );

  const scrapeAndSummarize = useCallback(
    async (convId: string, url: string) => {
      if (scrapingInProgress.current) return;
      scrapingInProgress.current = true;
      const thinkId = addThinkingMsg(convId, `reading ${new URL(url).hostname}...`);

      try {
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
        const data = await res.json();

        removeThinkingMsg(convId, thinkId);

        if (!data.content) { scrapingInProgress.current = false; return; }

        scrapedContentByConv.current[convId] = {
          url,
          title: data.title || url,
          content: data.content,
        };

        const thinkId2 = addThinkingMsg(convId, `summarizing what i found...`);

        const summaryId = generateId();
        let hostname = "";
        try { hostname = new URL(url).hostname; } catch { /* skip */ }
        const source: WebSource = {
          url,
          title: data.title || hostname,
          favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
        };

        // Attach scraped images to the summary message
        const scrapedImages = (data.images || []).map((imgUrl: string) => ({
          url: imgUrl,
          alt: data.title || "",
        }));

        const summaryMsg: Message = {
          id: summaryId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          sources: [source],
          images: scrapedImages.length > 0 ? scrapedImages : undefined,
        };

        updateConversation(convId, (conv) => ({
          ...conv,
          messages: [...conv.messages, summaryMsg],
          updatedAt: new Date(),
        }));

        removeThinkingMsg(convId, thinkId2);

        setIsStreaming(true);
        abortRef.current = new AbortController();

        const contextMessages = [
          {
            role: "user" as const,
            content: `I opened ${url} for the user. Page content:\n\nTitle: ${data.title}\n\n${data.content}\n\nGive a concise summary of the key info on this page. Don't say "welcome to this page" -- just jump into what it's about and what's useful. Vary your language. Use kaomoji naturally. Keep it focused and not repetitive.`,
          },
        ];

        const systemPrompt = buildSystemPrompt(browserInfo, location);

        streamChat(
          contextMessages,
          systemPrompt,
          (chunk) => {
            updateConversation(convId, (conv) => ({
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === summaryId ? { ...m, content: m.content + chunk } : m
              ),
            }));
          },
          () => {
            setIsStreaming(false);
            abortRef.current = null;
            scrapingInProgress.current = false;
          },
          () => {
            setIsStreaming(false);
            abortRef.current = null;
            scrapingInProgress.current = false;
          },
          abortRef.current.signal
        );
      } catch {
        removeThinkingMsg(convId, thinkId);
        scrapingInProgress.current = false;
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [browserInfo, location, updateConversation, addThinkingMsg, removeThinkingMsg]
  );

  const openApp = useCallback(async (convId: string, appName: string) => {
    const thinkId = addThinkingMsg(convId, `opening ${appName}...`);
    try {
      const res = await fetch("/api/open-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: appName }),
      });
      const data = await res.json();
      removeThinkingMsg(convId, thinkId);

      // Generate a welcome/confirmation message
      const welcomeId = generateId();
      updateConversation(convId, (conv) => ({
        ...conv,
        messages: [...conv.messages, {
          id: welcomeId,
          role: "assistant" as const,
          content: "",
          timestamp: new Date(),
        }],
      }));

      setIsStreaming(true);
      abortRef.current = new AbortController();

      const prompt = res.ok
        ? `I opened "${appName}" on the user's computer. Confirm it's open in 1-2 sentences with a quick useful tip. Don't say "welcome". Use a kaomoji. Be brief and varied.`
        : `I tried to open "${appName}" but it failed: ${data.error}. Let the user know briefly and suggest what they could try instead. Use a kaomoji.`;

      streamChat(
        [{ role: "user" as const, content: prompt }],
        buildSystemPrompt(browserInfo, location),
        (chunk) => {
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === welcomeId ? { ...m, content: m.content + chunk } : m
            ),
          }));
        },
        () => { setIsStreaming(false); abortRef.current = null; },
        () => { setIsStreaming(false); abortRef.current = null; },
        abortRef.current.signal
      );
    } catch {
      removeThinkingMsg(convId, thinkId);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [addThinkingMsg, removeThinkingMsg, updateConversation, browserInfo, location]);

  const screenshotPage = useCallback(
    async (convId: string, url: string) => {
      const thinkId = addThinkingMsg(convId, `taking screenshot of ${new URL(url).hostname}...`);
      try {
        const res = await fetch(`/api/screenshot?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        removeThinkingMsg(convId, thinkId);

        if (data.screenshot) {
          const msgId = generateId();
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: [...conv.messages, {
              id: msgId,
              role: "assistant" as const,
              content: data.title ? `here's what **${data.title}** looks like :3` : `got the screenshot~`,
              timestamp: new Date(),
              images: [{ url: data.screenshot, alt: data.title || url }],
              sources: [{
                url,
                title: data.title || new URL(url).hostname,
                favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`,
              }],
            }],
          }));
        }
      } catch {
        removeThinkingMsg(convId, thinkId);
      }
    },
    [addThinkingMsg, removeThinkingMsg, updateConversation]
  );

  const welcomeToPage = useCallback(
    async (convId: string, url: string) => {
      const welcomeId = generateId();
      updateConversation(convId, (conv) => ({
        ...conv,
        messages: [...conv.messages, {
          id: welcomeId,
          role: "assistant" as const,
          content: "",
          timestamp: new Date(),
        }],
      }));

      setIsStreaming(true);
      abortRef.current = new AbortController();

      let description = "";
      if (url.includes("youtube.com/results")) {
        const q = new URL(url).searchParams.get("search_query") || "";
        description = `YouTube search results for "${q}"`;
      } else if (url.includes("google.com/search")) {
        const params = new URL(url).searchParams;
        const q = params.get("q") || "";
        const isImages = params.get("tbm") === "isch";
        description = isImages ? `Google Images results for "${q}"` : `Google search results for "${q}"`;
      } else {
        description = url;
      }

      streamChat(
        [{
          role: "user" as const,
          content: `I opened ${description} in the user's browser. Confirm what you opened in 1-2 short sentences with a quick tip. Don't say "welcome" -- just confirm and move on. Use varied language and a kaomoji. Keep it very brief.`,
        }],
        buildSystemPrompt(browserInfo, location),
        (chunk) => {
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === welcomeId ? { ...m, content: m.content + chunk } : m
            ),
          }));
        },
        () => { setIsStreaming(false); abortRef.current = null; },
        () => { setIsStreaming(false); abortRef.current = null; },
        abortRef.current.signal
      );
    },
    [browserInfo, location, updateConversation]
  );

  const processActions = useCallback(
    (convId: string, messageId: string, finalContent?: string) => {
      // First, parse actions from the message content (read-only, outside state updater)
      let contentToParse = finalContent;
      if (!contentToParse) {
        const conv = conversations.find((c) => c.id === convId);
        const msg = conv?.messages.find((m) => m.id === messageId);
        if (!msg || msg.role !== "assistant") return;
        contentToParse = msg.content;
      }

      const content = contentToParse;
      console.log(`%c[processActions] \u{1F4DD} Message content length: ${content.length}`, "color: #cc88ff", { fromParam: !!finalContent, preview: content.slice(0, 80) });
      // Match both [ACTION:TYPE:value] and malformed [TYPE:value] patterns
      const actionRegex = /\[ACTION:(OPEN_URL|SEARCH|IMAGE|OPEN_RESULT|OPEN_APP|SCREENSHOT|EMBED|SCRAPE_IMAGES|READ_URL):([^\]]+)\]/g;
      let match;
      const actions: { type: string; value: string }[] = [];
      while ((match = actionRegex.exec(content)) !== null) {
        actions.push({ type: match[1], value: match[2].trim() });
      }
      // Also catch malformed [IMAGE:url|desc] without ACTION: prefix
      const malformedImageRegex = /\[IMAGE:([^\]]+)\]/g;
      let imgMatch;
      while ((imgMatch = malformedImageRegex.exec(content)) !== null) {
        // Only add if not already captured by the ACTION regex
        const val = imgMatch[1].trim();
        if (!actions.some(a => a.type === "IMAGE" && a.value === val)) {
          actions.push({ type: "IMAGE", value: val });
        }
      }

      console.log(`%c[processActions] \u{1F50D} Found ${actions.length} actions`, "color: #cc88ff; font-weight: bold", actions.length > 0 ? actions : "none");

      if (actions.length === 0) return;

      // Strip action tags, malformed image tags, raw URLs, and filler text from displayed content
      let cleanContent = content
        .replace(/\s*\[ACTION:[^\]]+\]\s*/g, " ")
        .replace(/\s*\[IMAGE:[^\]]+\]\s*/g, " ")
        .replace(/Image \d+:\s*/gi, "")
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/<img[^>]*>/gi, "")
        .replace(/https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?\S*)?/gi, "")
        .replace(/https?:\/\/(?:www\.)?google\.com\/\S*/gi, "")
        .replace(/https?:\/\/(?:www\.)?bing\.com\/\S*/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      // For ANY action, aggressively strip filler -- the action IS the response, not the text around it
      if (cleanContent.length > 150) {
        // Keep only the first meaningful sentence
        const firstLine = cleanContent.split(/\n/)[0].trim();
        cleanContent = firstLine.length > 10 ? firstLine : cleanContent.slice(0, 120).trim();
      }
      // If the remaining text is just filler about opening/searching, clear it entirely
      if (/^(got it|okay|sure|let me|i('ll| will)|opening|searching|looking|here)/i.test(cleanContent) && cleanContent.length < 200) {
        cleanContent = "";
      }
      const images: { url: string; alt?: string }[] = [];
      const videos: { url: string; title?: string; platform: "youtube" | "other"; embedId?: string }[] = [];
      const webEmbeds: { url: string; title?: string }[] = [];
      const urlsToScrape: string[] = [];

      // Helper to detect YouTube video URLs
      const getYouTubeId = (url: string): string | null => {
        const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return ytMatch ? ytMatch[1] : null;
      };

      for (const action of actions) {
        console.log(`%c[ACTION] ▶ ${action.type}`, "color: #ff9900; font-weight: bold; font-size: 12px", action.value);

        if (action.type === "OPEN_URL") {
          const url = action.value;
          const ytId = getYouTubeId(url);
          console.log(`%c[BROWSE] 🌐 Opening URL`, "color: #00ccff; font-weight: bold", { url, isYouTube: !!ytId, ytId });
          if (ytId) {
            console.log(`%c[BROWSE] 🎬 YouTube video detected, embedding player`, "color: #ff0000", { embedId: ytId });
            videos.push({ url, platform: "youtube", embedId: ytId });
          }
          try {
            window.open(url, "_blank", "noopener,noreferrer");
            console.log(`%c[BROWSE] ✅ Window opened`, "color: #00ff88", url);
            if (!url.includes("google.com/search") && !url.includes("youtube.com/results") && !ytId) {
              console.log(`%c[BROWSE] 📄 Queuing page for scrape`, "color: #88ccff", url);
              urlsToScrape.push(url);
            }
          } catch (e) {
            console.error(`%c[BROWSE] ❌ Failed to open window`, "color: #ff4444", url, e);
          }
        }
        if (action.type === "SEARCH") {
          console.log(`%c[SEARCH] 🔎 Starting web search`, "color: #ffcc00; font-weight: bold; font-size: 12px", { query: action.value });
          fetchSearchResults(convId, messageId, action.value);
        }
        if (action.type === "IMAGE") {
          const parts = action.value.split("|");
          console.log(`%c[IMAGE] 🖼️ Adding inline image`, "color: #ff66cc", { url: parts[0], alt: parts[1] });
          images.push({ url: parts[0].trim(), alt: parts[1]?.trim() });
        }
        // VIDEO action removed -- AI was generating fake URLs
        // YouTube embeds still work automatically from real OPEN_URL watch links
        if (action.type === "OPEN_RESULT") {
          const idx = parseInt(action.value, 10) - 1;
          const results = searchResultsByConv.current[convId] || [];
          console.log(`%c[BROWSE] 📋 Opening search result #${idx + 1}`, "color: #00ccff; font-weight: bold", { index: idx, totalResults: results.length, result: results[idx] });
          if (results[idx]) {
            try {
              window.open(results[idx].url, "_blank", "noopener,noreferrer");
              urlsToScrape.push(results[idx].url);
              console.log(`%c[BROWSE] ✅ Opened result`, "color: #00ff88", results[idx].url);
            } catch (e) { console.error(`%c[BROWSE] ❌ Failed`, "color: #ff4444", e); }
          } else {
            console.warn(`%c[BROWSE] ⚠️ Result #${idx + 1} not found`, "color: #ffaa00", { available: results.length });
          }
        }
        if (action.type === "OPEN_APP") {
          const appName = action.value.replace(/:$/, "").trim();
          console.log(`%c[APP] 💻 Requesting to open app`, "color: #cc66ff; font-weight: bold; font-size: 12px", { appName });
          if (confirm(`Senko wants to open "${appName}" on your device. Allow?`)) {
            console.log(`%c[APP] ✅ User approved, launching`, "color: #00ff88", appName);
            openApp(convId, appName);
          } else {
            console.log(`%c[APP] 🚫 User denied`, "color: #ff6666", appName);
          }
        }
        if (action.type === "SCRAPE_IMAGES") {
          // Scrape images from a specific URL and show in carousel
          console.log(`%c[IMAGES] 🖼️ Scraping images from URL`, "color: #ff66cc; font-weight: bold; font-size: 12px", action.value);
          (async () => {
            const thinkId = addThinkingMsg(convId, `scraping images from ${action.value}...`);
            try {
              const res = await fetch(`/api/images?url=${encodeURIComponent(action.value)}`);
              const data = await res.json();
              removeThinkingMsg(convId, thinkId);
              console.log(`%c[IMAGES] 📊 Scrape result`, "color: #ff66cc", { url: action.value, found: data.images?.length || 0 });
              if (data.images && data.images.length > 0) {
                const scrapedImages = data.images.map((img: { url: string; alt: string }) => ({
                  url: img.url,
                  alt: img.alt || action.value,
                }));
                console.log(`%c[IMAGES] ✅ Adding ${scrapedImages.length} images to carousel`, "color: #00ff88", scrapedImages.map((i: {url:string}) => i.url.slice(0, 60)));
                updateConversation(convId, (conv) => ({
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === messageId ? { ...m, images: [...(m.images || []), ...scrapedImages] } : m
                  ),
                }));
              } else {
                console.warn(`%c[IMAGES] ⚠️ No images found on page`, "color: #ffaa00", action.value);
              }
            } catch (e) {
              console.error(`%c[IMAGES] ❌ Scrape failed`, "color: #ff4444", action.value, e);
              removeThinkingMsg(convId, thinkId);
            }
          })();
        }
        if (action.type === "READ_URL") {
          // Deep read a URL - fetch content, links, images, metadata and feed back to AI
          console.log(`%c[READ] 📖 Deep reading URL`, "color: #00ccff; font-weight: bold; font-size: 12px", action.value);
          (async () => {
            const thinkId = addThinkingMsg(convId, `reading ${action.value}...`);
            try {
              const res = await fetch(`/api/url?url=${encodeURIComponent(action.value)}&maxContent=8000`);
              const data = await res.json();
              removeThinkingMsg(convId, thinkId);
              if (data.error) {
                updateConversation(convId, (conv) => ({
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === messageId ? { ...m, content: m.content + `\n\n*couldn't read that page: ${data.error} ;w;*` } : m
                  ),
                }));
                return;
              }
              // Build a context message with the page data
              const pageLinks = (data.links || []).slice(0, 20).map((l: { url: string; text: string }, i: number) => `${i + 1}. [${l.text}](${l.url})`).join("\n");
              const pageHeadings = (data.headings || []).map((h: { level: number; text: string }) => `${"#".repeat(h.level)} ${h.text}`).join("\n");
              const pageImages = (data.images || []).slice(0, 10);

              // Attach images from the page to the message
              if (pageImages.length > 0) {
                const msgImages = pageImages.map((img: { url: string; alt: string }) => ({ url: img.url, alt: img.alt || data.meta?.title || "" }));
                updateConversation(convId, (conv) => ({
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === messageId ? { ...m, images: [...(m.images || []), ...msgImages] } : m
                  ),
                }));
              }

              // Attach source
              if (data.meta?.title) {
                let hostname = "";
                try { hostname = new URL(action.value).hostname; } catch { /* skip */ }
                updateConversation(convId, (conv) => ({
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === messageId ? {
                      ...m,
                      sources: [...(m.sources || []), {
                        url: action.value,
                        title: data.meta.title || hostname,
                        favicon: data.meta.favicon || `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
                      }],
                    } : m
                  ),
                }));
              }

              // Feed the page content back to AI for a follow-up response
              const pageContext = `I just read the page at ${action.value}.\n\nTitle: ${data.meta?.title || "Unknown"}\nDescription: ${data.meta?.description || "None"}\n\n${pageHeadings ? `Page Structure:\n${pageHeadings}\n\n` : ""}Content:\n${data.content || "No content found"}\n\n${pageLinks ? `Links found on page:\n${pageLinks}` : ""}`;

              const followUpId = generateId();
              updateConversation(convId, (conv) => ({
                ...conv,
                messages: [...conv.messages, {
                  id: followUpId,
                  role: "assistant" as const,
                  content: "",
                  timestamp: new Date(),
                }],
              }));

              const followUpAbort = new AbortController();
              abortRef.current = followUpAbort;
              setIsStreaming(true);
              streamChat(
                [{ role: "user" as const, content: pageContext + "\n\nSummarize what you found on this page. Highlight the most interesting/useful content. If there are links to deeper pages that seem relevant, mention them. Be yourself -- react to what you found!" }],
                buildSystemPrompt(browserInfo, location),
                (chunk) => {
                  updateConversation(convId, (conv) => ({
                    ...conv,
                    messages: conv.messages.map((m) =>
                      m.id === followUpId ? { ...m, content: m.content + chunk } : m
                    ),
                  }));
                },
                () => {
                  updateConversation(convId, (conv) => ({
                    ...conv,
                    messages: conv.messages.map((m) =>
                      m.id === followUpId ? (() => {
                        const { cleanText, extractedSources } = parseAIOutput(m.content);
                        const existing = m.sources || [];
                        const seen = new Set(existing.map((s) => s.url));
                        const merged = [...existing];
                        for (const s of extractedSources) { if (!seen.has(s.url)) { merged.push(s); seen.add(s.url); } }
                        return { ...m, content: cleanText, sources: merged.length > 0 ? merged : m.sources };
                      })() : m
                    ),
                  }));
                  setIsStreaming(false);
                  abortRef.current = null;
                },
                (err) => { console.error("READ_URL follow-up error:", err); setIsStreaming(false); abortRef.current = null; },
                followUpAbort.signal
              );
            } catch {
              removeThinkingMsg(convId, thinkId);
            }
          })();
        }
        if (action.type === "SCREENSHOT") {
          console.log(`%c[SCREENSHOT] 📸 Taking screenshot`, "color: #ffcc00; font-weight: bold; font-size: 12px", action.value);
          screenshotPage(convId, action.value);
        }
        if (action.type === "EMBED") {
          console.log(`%c[EMBED] 🖥️ Creating web embed`, "color: #66ccff; font-weight: bold; font-size: 12px", action.value);
          const parts = action.value.split("|");
          const embedUrl = parts[0].trim();
          const embedTitle = parts[1]?.trim();
          // YouTube URLs should be embedded as video players, not proxied iframes
          const ytId = getYouTubeId(embedUrl);
          if (ytId) {
            videos.push({ url: embedUrl, platform: "youtube", embedId: ytId, title: embedTitle });
          } else {
            webEmbeds.push({ url: embedUrl, title: embedTitle });
          }
        }
      }

      // Scrape the first opened page and auto-summarize (with welcome)
      if (urlsToScrape.length > 0) {
        setTimeout(() => scrapeAndSummarize(convId, urlsToScrape[0]), 100);
      }

      // For search/results pages that don't get scraped, add a quick welcome
      const searchUrls = actions
        .filter((a) => a.type === "OPEN_URL" && (a.value.includes("google.com/search") || a.value.includes("youtube.com/results")))
        .map((a) => a.value);
      if (searchUrls.length > 0 && urlsToScrape.length === 0) {
        setTimeout(() => welcomeToPage(convId, searchUrls[0]), 100);
      }

      // Update the message state with cleaned content and attachments
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        content: cleanContent,
                        images: images.length > 0 ? [...(m.images || []), ...images] : m.images,
                        videos: videos.length > 0 ? [...(m.videos || []), ...videos] : m.videos,
                        webEmbeds: webEmbeds.length > 0 ? [...(m.webEmbeds || []), ...webEmbeds] : m.webEmbeds,
                      }
                    : m
                ),
              }
            : c
        )
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, scrapeAndSummarize, welcomeToPage, openApp, screenshotPage]
  );

  const fetchSearchResults = useCallback(
    async (convId: string, messageId: string, query: string) => {
      console.log(`%c[fetchSearch] 🔎 Starting deep research for "${query}"`, "color: #88ccff; font-weight: bold");
      const thinkId = addThinkingMsg(convId, `searching "${query}"...`);

      try {
        // Detect if this is an image-focused request BEFORE fetching
        const imageQueryPattern = /\b(images?|pics?|pictures?|photos?|show me|send me|wallpapers?)\b/i;
        const isImageQuery = imageQueryPattern.test(query);

        // Phase 1: Fetch search results (always) and images (only for image queries)
        const searchRes = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const searchData = await searchRes.json();

        // Only fetch images for image-related queries — skip for weather, facts, etc.
        let imageData: { images?: { url: string; alt: string; source: string }[] } = {};
        if (isImageQuery) {
          try {
            const imageRes = await fetch(`/api/images?q=${encodeURIComponent(query)}`);
            imageData = await imageRes.json();
          } catch { /* image fetch failed, continue without */ }
        }

        removeThinkingMsg(convId, thinkId);

        // Build sources from search engine results (the actual web page URLs)
        let sources: WebSource[] = [];
        if (searchData.results && searchData.results.length > 0) {
          searchResultsByConv.current[convId] = searchData.results.map(
            (r: { title: string; url: string }) => ({ url: r.url, title: r.title })
          );
          sources = searchData.results.map(
            (r: { title: string; url: string; snippet: string }) => ({
              url: r.url,
              title: r.title,
              snippet: r.snippet || "",
              favicon: `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=16`,
            })
          );
        }

        // Build images from dedicated image search (only populated for image queries)
        let searchImages: { url: string; alt?: string }[] = [];
        if (imageData.images && imageData.images.length > 0) {
          searchImages = imageData.images.map((img: { url: string; alt: string }) => ({
            url: img.url,
            alt: img.alt || query,
          }));
        }

        // Update initial message with sources immediately (images only for image queries)
        updateConversation(convId, (conv) => ({
          ...conv,
          messages: conv.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  sources: sources.length > 0 ? sources : m.sources,
                }
              : m
          ),
        }));

        // For image requests: also scrape top source pages for MORE images, then show carousel
        if (isImageQuery) {
          const thinkId2 = addThinkingMsg(convId, `grabbing more images from sources...`);
          // Scrape top 10 search result pages for additional images
          const sourceUrls = (searchData.results || []).slice(0, 10).map((r: { url: string }) => r.url);
          const extraImages: { url: string; alt?: string }[] = [];
          const scrapeResults = await Promise.all(
            sourceUrls.map(async (url: string) => {
              try {
                const res = await fetch(`/api/images?url=${encodeURIComponent(url)}`);
                const data = await res.json();
                return (data.images || []).map((img: { url: string; alt: string }) => ({ url: img.url, alt: img.alt || query }));
              } catch { return []; }
            })
          );
          for (const pageImgs of scrapeResults) {
            for (const img of pageImgs) {
              if (extraImages.length >= 20) break;
              if (!searchImages.some((si) => si.url === img.url) && !extraImages.some((ei) => ei.url === img.url)) {
                extraImages.push(img);
              }
            }
          }
          removeThinkingMsg(convId, thinkId2);

          const allImages = [...searchImages, ...extraImages].slice(0, 24);

          // Sources = the actual search engine result URLs (web pages found by the search)
          const cleanTopic = query.replace(/\b(images?|pics?|pictures?|photos?|of|show me|send me|look\s*up|find|get|wallpapers?)\b/gi, "").trim();
          const commentId = generateId();
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: [...conv.messages, {
              id: commentId,
              role: "assistant" as const,
              content: allImages.length > 0
                ? `here are some ${cleanTopic} images i found for you~ \u{FF1D}w\u{FF1D} grabbed ${allImages.length} from across multiple sources!`
                : `hmm i couldn't find many images for "${cleanTopic}" ;w; maybe try a different search term?`,
              timestamp: new Date(),
              sources: sources.length > 0 ? sources.slice(0, 15) : undefined,
              images: allImages.length > 0 ? allImages : undefined,
            }],
          }));
          setIsStreaming(false);
          return;
        }

        // Phase 2: Deep research - scrape up to 25 results for actual content
        const allResults = (searchData.results || []).slice(0, 25);
        const thinkId2 = addThinkingMsg(convId, `reading ${allResults.length} sources for "${query}"...`);
        const topUrls = allResults.map((r: { url: string }) => r.url);

        // Scrape in batches of 5 to avoid overwhelming the server
        const scrapedPages: { url: string; title: string; content: string; images: string[] }[] = [];
        for (let i = 0; i < topUrls.length; i += 5) {
          const batch = topUrls.slice(i, i + 5);
          const batchResults = await Promise.all(
            batch.map(async (url: string) => {
              try {
                const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
                const data = await res.json();
                return { url, title: data.title || url, content: data.content || "", images: data.images || [] };
              } catch {
                return { url, title: url, content: "", images: [] };
              }
            })
          );
          scrapedPages.push(...batchResults);
        }
        removeThinkingMsg(convId, thinkId2);

        // Collect additional images from ALL scraped pages
        const additionalImages: { url: string; alt?: string }[] = [];
        for (const page of scrapedPages) {
          for (const imgUrl of (page.images as string[]).slice(0, 6)) {
            if (!searchImages.some((si) => si.url === imgUrl) && !additionalImages.some((ai) => ai.url === imgUrl)) {
              additionalImages.push({ url: imgUrl, alt: page.title });
            }
          }
        }
        const allResearchImages = [...additionalImages].slice(0, 16);
        const hasImages = allResearchImages.length > 0;

        // Phase 3: Generate AI research synthesis using real scraped content
        const scrapedContext = scrapedPages
          .filter((p) => p.content)
          .map((p, i) => `[Source ${i + 1}: ${p.title}] (${p.url})\n${p.content.slice(0, 2000)}`)
          .join("\n\n---\n\n");

        const hasScrapedContent = scrapedContext.length > 100;

        // Build source list for the synthesis message
        // ALWAYS use search result sources (top 10) — enrich titles from scraped pages if available
        const scrapedTitleMap = new Map<string, string>();
        for (const p of scrapedPages.filter((pg) => pg.content && pg.title)) {
          scrapedTitleMap.set(p.url, p.title);
        }
        const synthesisSources: WebSource[] = sources.slice(0, 10).map((s) => ({
          ...s,
          title: scrapedTitleMap.get(s.url) || s.title,
        }));

        const commentId = generateId();
        updateConversation(convId, (conv) => ({
          ...conv,
          messages: [
            // Clear images/sources from initial message to avoid duplication
            ...conv.messages.map((m) =>
              m.id === messageId ? { ...m, images: undefined, sources: undefined } : m
            ),
            {
              id: commentId,
              role: "assistant" as const,
              content: "",
              timestamp: new Date(),
              sources: synthesisSources.length > 0 ? synthesisSources : undefined,
              images: hasImages ? allResearchImages : undefined,
            },
          ],
        }));

        const sourceCount = scrapedPages.filter((p) => p.content).length;
        const contextPrompt = hasScrapedContent
          ? `The user asked me to research "${query}". I searched the web and scraped ${sourceCount} sources. ${hasImages ? `I also found ${allResearchImages.length} images which are being displayed in a carousel above this text -- do NOT describe the images.` : ""}

Here is the actual content from the sources I read:

${scrapedContext}

Write an EXPERT-LEVEL, deeply researched response. STRICT REQUIREMENTS:

1. **Write clean prose WITHOUT inline citations**: Do NOT write [Source 1], [Source 2], etc. in your text. The UI already displays source links as clickable pills below your message. Just write naturally.
2. **Go DEEP, not wide**: For each key point, explain the WHY and HOW. What caused it? What are the implications? How does it connect to other facts? Provide depth that makes someone say "wow, I actually understand this now."
3. **Synthesize across sources**: Combine information from multiple sources into a coherent narrative. Don't just summarize one source at a time.
4. **Structure with markdown**: Use ## headers for major sections. Use ### for subsections. Use **bold** for key terms. Use bullet lists for details.
5. **Cover comprehensively**: Background/history, core concepts explained in depth, key details with context, significance/impact, interesting nuances, and practical implications.
6. **Explain like a knowledgeable friend**: Break down complex ideas. Use analogies if helpful. Don't assume the reader knows jargon.
7. Stay in character (2-3 kaomoji max) but INFORMATION and DEPTH come first.
8. Do NOT make up facts -- only use what's in the sources above.
9. Do NOT describe or list images. The UI shows images automatically.
10. Do NOT include a "Sources" section at the end -- the UI handles source display with clickable pills.`
          : `I searched for "${query}" and found these results:\n${(searchData.results || []).slice(0, 10).map((r: { title: string; snippet: string }, i: number) => `${i + 1}. ${r.title}: ${r.snippet}`).join("\n")}\n\n${hasImages ? `Images are being displayed in a carousel -- do NOT describe them.` : ""}\n\nWrite a thorough research summary. REQUIREMENTS:\n- Write clean prose WITHOUT [Source N] citations -- the UI shows source pills\n- Provide context and reasoning, not just facts\n- Use markdown formatting (## headers, **bold**, lists)\n- Cover what it is, key details, significance, and interesting facts\n- Stay in character but prioritize real information\n- Do NOT include a Sources section at the end\n- Do NOT describe images`;

        abortRef.current = new AbortController();
        console.log(`%c[fetchSearch] 🔄 Setting isStreaming=true for research synthesis`, "color: #88ccff; font-weight: bold");
        setIsStreaming(true);
        streamChat(
          [{ role: "user" as const, content: contextPrompt }],
          buildSystemPrompt(browserInfo, location),
          (chunk) => {
            updateConversation(convId, (conv) => ({
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === commentId ? { ...m, content: m.content + chunk } : m
              ),
            }));
          },
          () => {
            console.log(`%c[fetchSearch] ✅ Research synthesis done, isStreaming=false`, "color: #00ff88; font-weight: bold");
            // Sanitize any leaked image URLs from the final content
            // Parse AI output: extract [Source N] citations into UI pills, clean the text
            updateConversation(convId, (conv) => ({
              ...conv,
              messages: conv.messages.map((m) => {
                if (m.id !== commentId) return m;
                const { cleanText, extractedSources } = parseAIOutput(m.content);
                // Merge extracted sources with existing ones (dedup by URL)
                const existingSources = m.sources || [];
                const seenSourceUrls = new Set(existingSources.map((s) => s.url));
                const mergedSources = [...existingSources];
                for (const s of extractedSources) {
                  if (!seenSourceUrls.has(s.url)) {
                    mergedSources.push(s);
                    seenSourceUrls.add(s.url);
                  }
                }
                return {
                  ...m,
                  content: cleanText,
                  sources: mergedSources.length > 0 ? mergedSources : m.sources,
                };
              }),
            }));
            setIsStreaming(false);
            abortRef.current = null;
          },
          (err) => { console.error(`%c[fetchSearch] ❌ Research synthesis error, isStreaming=false`, "color: #ff4444; font-weight: bold", err); setIsStreaming(false); abortRef.current = null; },
          abortRef.current.signal
        );
      } catch (e) {
        console.error(`%c[fetchSearch] 💥 Exception, isStreaming=false`, "color: #ff0000; font-weight: bold", e);
        removeThinkingMsg(convId, thinkId);
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [updateConversation, addThinkingMsg, removeThinkingMsg, browserInfo, location]
  );

  const sendToAI = useCallback(
    (convId: string, allMessages: Message[]) => {
      console.log(`%c[sendToAI] 🚀 Starting`, "color: #ff88ff; font-weight: bold", {
        convId: convId.slice(0, 8),
        messageCount: allMessages.length,
      });
      setIsStreaming(true);
      setWasCutOff(false);

      const assistantId = generateId();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };

      updateConversation(convId, (conv) => ({
        ...conv,
        messages: [...conv.messages, assistantMessage],
        updatedAt: new Date(),
      }));

      const apiMessages = allMessages
        .filter((m) => !m.isThinking)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const convSearchResults = searchResultsByConv.current[convId] || [];
      if (convSearchResults.length > 0) {
        const resultsList = convSearchResults
          .map((r, i) => `${i + 1}. ${r.title} - ${r.url}`)
          .join("\n");
        apiMessages.push({
          role: "assistant",
          content: `[Previous search results available]:\n${resultsList}\n\nI can open any of these by number with [ACTION:OPEN_RESULT:N], or embed any by URL with [ACTION:EMBED:url|title]. If the user says "embed the first result" I should use [ACTION:EMBED:${convSearchResults[0]?.url || "url"}|${convSearchResults[0]?.title || "title"}].`,
        });
      }

      const systemPrompt = buildSystemPrompt(browserInfo, location);

      abortRef.current = new AbortController();

      let totalContent = "";
      streamChat(
        apiMessages,
        systemPrompt,
        (chunk) => {
          totalContent += chunk;
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const exists = c.messages.some((m) => m.id === assistantId);
              if (exists) {
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + chunk }
                      : m
                  ),
                };
              }
              // Assistant message not in state yet (React batched the add) — insert it now
              return {
                ...c,
                messages: [
                  ...c.messages,
                  { ...assistantMessage, content: chunk },
                ],
                updatedAt: new Date(),
              };
            })
          );
        },
        () => {
          console.log(`%c[sendToAI] ✅ Done, setting isStreaming=false`, "color: #00ff88; font-weight: bold", { totalContentLength: totalContent.length, preview: totalContent.slice(0, 100) });
          // Write final content to state (handles both: message exists or needs to be added)
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const exists = c.messages.some((m) => m.id === assistantId);
              if (exists) {
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantId ? { ...m, content: totalContent } : m
                  ),
                };
              }
              return {
                ...c,
                messages: [
                  ...c.messages,
                  { ...assistantMessage, content: totalContent },
                ],
                updatedAt: new Date(),
              };
            })
          );
          setIsStreaming(false);
          abortRef.current = null;
          processActions(convId, assistantId, totalContent);
        },
        (error) => {
          console.error(`%c[sendToAI] ❌ Error, setting isStreaming=false`, "color: #ff4444; font-weight: bold", error);
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const exists = c.messages.some((m) => m.id === assistantId);
              if (exists) {
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content || "", error }
                      : m
                  ),
                };
              }
              return {
                ...c,
                messages: [
                  ...c.messages,
                  { ...assistantMessage, content: "", error },
                ],
                updatedAt: new Date(),
              };
            })
          );
          setIsStreaming(false);
          abortRef.current = null;
        },
        abortRef.current.signal
      );
    },
    [browserInfo, location, updateConversation, processActions]
  );

  const generateTitle = useCallback(async (convId: string, firstMessage: string) => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `Generate a very short title (2-5 words, no quotes, no punctuation) for a conversation that starts with: "${firstMessage.slice(0, 200)}"`,
            },
          ],
          systemPrompt: "You generate ultra-short conversation titles. Respond with ONLY the title, nothing else. 2-5 words max. No quotes. No punctuation. Lowercase.",
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let title = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n\n");
        for (const line of lines) {
          const trimmed = line.replace(/^data: /, "").trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.content) title += parsed.content;
          } catch { /* skip */ }
        }
      }
      title = title.replace(/["'.!?]/g, "").trim().slice(0, 50);
      if (title) {
        updateConversation(convId, (conv) => ({ ...conv, title }));
      }
    } catch {
      // title generation failed, keep default
    }
  }, [updateConversation]);

  const handleSendMessage = useCallback(
    (content: string) => {
      console.log(`%c[handleSend] 💬 Attempting to send`, "color: #ffcc00; font-weight: bold", {
        content: content.slice(0, 50),
        activeConversationId: activeConversationId?.slice(0, 8),
        isStreaming,
        blocked: !activeConversationId || isStreaming,
      });
      if (!activeConversationId || isStreaming) {
        console.warn(`%c[handleSend] 🚫 BLOCKED - isStreaming=${isStreaming}, activeConv=${!!activeConversationId}`, "color: #ff8800; font-weight: bold");
        return;
      }

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content,
        timestamp: new Date(),
      };

      let updatedMessages: Message[] = [];
      let isFirst = false;

      updateConversation(activeConversationId, (conv) => {
        isFirst = conv.messages.length === 0;
        updatedMessages = [...conv.messages, userMessage];
        return {
          ...conv,
          title: isFirst ? content.slice(0, 30) + "..." : conv.title,
          messages: updatedMessages,
          updatedAt: new Date(),
        };
      });

      if (isFirst) {
        generateTitle(activeConversationId, content);
      }

      // Pass updatedMessages directly — don't read from state (React batching race)
      sendToAI(activeConversationId, updatedMessages);
    },
    [activeConversationId, isStreaming, updateConversation, sendToAI, generateTitle]
  );

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      if (!activeConversationId || isStreaming) return;

      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      updateConversation(activeConversationId, (conv) => {
        const messageIndex = conv.messages.findIndex((m) => m.id === messageId);
        if (messageIndex === -1) return conv;

        const updatedMessages = conv.messages.slice(0, messageIndex + 1);
        updatedMessages[messageIndex] = {
          ...updatedMessages[messageIndex],
          content: newContent,
          timestamp: new Date(),
        };

        return {
          ...conv,
          messages: updatedMessages,
          updatedAt: new Date(),
        };
      });

      setTimeout(() => {
        setConversations((prev) => {
          const conv = prev.find((c) => c.id === activeConversationId);
          if (conv) {
            sendToAI(activeConversationId, conv.messages);
          }
          return prev;
        });
      }, 50);
    },
    [activeConversationId, isStreaming, updateConversation, sendToAI]
  );

  const handleRegenerateMessage = useCallback(
    (messageId: string) => {
      if (!activeConversationId || isStreaming) return;

      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      updateConversation(activeConversationId, (conv) => {
        const messageIndex = conv.messages.findIndex((m) => m.id === messageId);
        if (messageIndex === -1) return conv;

        return {
          ...conv,
          messages: conv.messages.slice(0, messageIndex),
          updatedAt: new Date(),
        };
      });

      setTimeout(() => {
        setConversations((prev) => {
          const conv = prev.find((c) => c.id === activeConversationId);
          if (conv) {
            sendToAI(activeConversationId, conv.messages);
          }
          return prev;
        });
      }, 50);
    },
    [activeConversationId, isStreaming, updateConversation, sendToAI]
  );

  const handleStopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
      setWasCutOff(true);
    }
  }, []);

  const handleContinueGeneration = useCallback(() => {
    if (!activeConversationId || isStreaming) return;

    const continueMsg: Message = {
      id: generateId(),
      role: "user",
      content: "Continue from where you left off.",
      timestamp: new Date(),
    };

    updateConversation(activeConversationId, (conv) => ({
      ...conv,
      messages: [...conv.messages, continueMsg],
      updatedAt: new Date(),
    }));

    setTimeout(() => {
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === activeConversationId);
        if (conv) sendToAI(activeConversationId, conv.messages);
        return prev;
      });
    }, 50);
  }, [activeConversationId, isStreaming, updateConversation, sendToAI]);

  const handleOpenLink = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleNewConversation = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
    }
    const newConv = createConversation("New Conversation");
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
  }, []);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      if (id === activeConversationId && abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        setIsStreaming(false);
      }
      // Clean up per-conversation context
      delete searchResultsByConv.current[id];
      delete scrapedContentByConv.current[id];

      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== id);
        if (activeConversationId === id) {
          setActiveConversationId(filtered[0]?.id ?? null);
        }
        return filtered;
      });
    },
    [activeConversationId]
  );

  const estimateTokens = (msgs: Message[]): number => {
    return msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-black">
      {/* Background gradient effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#00d4ff]/[0.03] blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#00ff88]/[0.02] blur-[120px]" />
        <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00d4ff]/[0.015] blur-[100px]" />
      </div>

      {/* Mobile Sidebar Drawer */}
      {isMobile && (
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          settings={settings}
          onSelectConversation={setActiveConversationId}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onSettingsChange={setSettings}
          isMobile
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Layout */}
      <div className={cn(
        "relative z-10 flex h-full w-full flex-col",
        isMobile ? "p-0" : "flex-row gap-3 p-3"
      )}>
        {/* Desktop Sidebar */}
        {!isMobile && (
          <Sidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            settings={settings}
            onSelectConversation={setActiveConversationId}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
            onSettingsChange={setSettings}
          />
        )}

        {/* Mobile Header */}
        {isMobile && (
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#050505] px-3 py-2.5 shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-zinc-200 active:bg-white/10 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <span className="text-sm font-semibold text-zinc-300">
              {activeConversation?.title || "Senko AI"}
            </span>
            <button
              onClick={handleNewConversation}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#00d4ff] hover:bg-[#00d4ff]/10 active:bg-[#00d4ff]/20 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        )}

        {/* Chat Area */}
        <div className={cn(
          "flex-1 overflow-hidden",
          isMobile ? "bg-black" : "glass-panel-solid depth-shadow-lg rounded-2xl"
        )}>
          {activeConversation ? (
            <ChatArea
              messages={activeConversation.messages}
              onSendMessage={handleSendMessage}
              onEditMessage={handleEditMessage}
              onRegenerateMessage={handleRegenerateMessage}
              onStopGeneration={handleStopGeneration}
              onContinueGeneration={handleContinueGeneration}
              onOpenLink={handleOpenLink}
              sendWithEnter={settings.sendWithEnter}
              isStreaming={isStreaming}
              tokenCount={estimateTokens(activeConversation.messages)}
              wasCutOff={wasCutOff}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-zinc-600">
                Create a new conversation to get started.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
