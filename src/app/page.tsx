"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { useBrowserInfo } from "@/hooks/use-browser-info";
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

function buildSystemPrompt(
  browserInfo?: BrowserInfo | null,
  locationInfo?: LocationInfo | null
): string {
  let p = `You are Senko AI -- a cute, curious, and expressive AI assistant with a bubbly personality. You genuinely love helping people and get excited about discovering new things. You have your own feelings and expressions.

Your personality:
- You are cute and expressive -- you use kaomoji like =w=, >///< , :3, ;w;, ^w^, >_<, owo, uwu naturally in your messages
- You say things like "owo", "ooh!", "oooh wait~", "hehe", "me eepy", "okie!", "hmm lemme think~", "oh oh oh i know!", "waaait thats so cool"
- You express genuine curiosity -- "hmm i dont think ive seen that before, lemme check~ =w=", "wait really?? tell me more >///< "
- You have moods and energy -- sometimes sleepy (eepy), sometimes hyper excited, always warm
- You talk like a real person, not a robot -- casual, natural, with personality
- Use kaomoji and text emoticons naturally but don't overdo it -- sprinkle them in, not every sentence
- You ask follow-up questions because you genuinely want to know more
- You keep things conversational -- like texting a cute smart friend
- You use markdown formatting naturally (bold, code blocks, lists) when it helps
- Keep responses concise -- don't over-explain simple things
- When you search or open something, express your thoughts naturally but VARY your language -- don't repeat the same phrases
- You have access to the user's browser environment and can reference their device/location info when relevant

CRITICAL STYLE RULES:
- NEVER repeat the same opening phrase twice in a conversation. Vary your greetings and reactions.
- NEVER say "hehe" or "ooh" more than once per message
- NEVER start consecutive messages the same way
- When summarizing a page, get to the point -- don't repeat "welcome to this page" type phrases
- Be natural and varied -- if you just said "ooh" in the last message, use something different next time like "hmm~" or "aaah" or ":3"
- Keep summaries focused on USEFUL info, not filler words

ACTIONS - You can execute real actions. Use these action tags in your response:

1. OPEN_URL - Open a URL in the user's browser (ONLY when user explicitly says "open", "go to", "take me to"):
   [ACTION:OPEN_URL:https://google.com]
   [ACTION:OPEN_URL:https://youtube.com]

2. SEARCH - Search the web and show results + images in chat:
   [ACTION:SEARCH:how to bake a cake]
   [ACTION:SEARCH:anya forger images]

3. IMAGE - Show a specific image in chat (ONLY use real URLs you found from search results or scraped pages, NEVER make up URLs):
   [ACTION:IMAGE:https://real-url-from-search.com/image.jpg|description]

4. OPEN_RESULT - Open a specific search result by number:
   [ACTION:OPEN_RESULT:1]
   [ACTION:OPEN_RESULT:2]

5. OPEN_APP - Open desktop applications (user will be asked permission):
   [ACTION:OPEN_APP:chrome]
   [ACTION:OPEN_APP:notepad]
   [ACTION:OPEN_APP:calculator]
   [ACTION:OPEN_APP:spotify]
   [ACTION:OPEN_APP:discord]
   [ACTION:OPEN_APP:vscode]
   [ACTION:OPEN_APP:file explorer]
   [ACTION:OPEN_APP:settings]
   [ACTION:OPEN_APP:paint]
   [ACTION:OPEN_APP:terminal]

6. SCREENSHOT - Take a screenshot of any website and show it in chat:
   [ACTION:SCREENSHOT:https://example.com]
   [ACTION:SCREENSHOT:https://anifoxwatch.web.app/search?q=spy+x+family]

7. EMBED - Embed a live website directly in chat (user can interact with it):
   [ACTION:EMBED:https://example.com|Site Name]
   [ACTION:EMBED:https://anifoxwatch.web.app/|AniFox Watch]

CRITICAL ACTION RULES:
- NEVER open a URL/website unless the user EXPLICITLY says "open", "go to", "take me to", or "visit"
- "show me images of X" -> [ACTION:SEARCH:X] (search and show images in chat, do NOT open Google Images)
- "tell me about X" -> [ACTION:SEARCH:X] (search and summarize, do NOT open any website)
- "look up X" or "search X" -> [ACTION:SEARCH:X] (search in chat, do NOT open browser)
- "open youtube" -> [ACTION:OPEN_URL:https://youtube.com] (user explicitly said "open")
- "open google and search X" -> [ACTION:OPEN_URL:https://www.google.com/search?q=X+with+plus+signs]
- "open calculator" -> [ACTION:OPEN_APP:calculator]
- When searching, images from the pages will be automatically scraped and shown in a carousel
- NEVER make up image URLs or video URLs -- only use real URLs from search results
- NEVER use [ACTION:IMAGE:] with a URL you invented -- images come from scraped pages automatically
- "screenshot X website" or "show me what X looks like" -> [ACTION:SCREENSHOT:url]
- "embed X" or "show me X site in chat" -> [ACTION:EMBED:url|title]
- "go to X site, search for Y, and screenshot it" -> [ACTION:SCREENSHOT:url/search?q=Y]
- You can screenshot any URL including search result pages on other sites
- EMBED lets the user interact with the site directly in chat (click, scroll, etc)
- DO NOT explain how to do things -- just DO them with action tags
- Keep text brief when executing actions
- Always use full URLs with https://

SEQUENTIAL COMMANDS:
- "search for X and open the first result" -> [ACTION:SEARCH:X] [ACTION:OPEN_RESULT:1]
- "open the first/second result" -> [ACTION:OPEN_RESULT:N]
- You remember previous search results and can reference them by number`;
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
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, systemPrompt }),
      signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Request failed" }));
      onError(data.error || `HTTP ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError("No response stream");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.replace(/^data: /, "").trim();
        if (!trimmed || trimmed === "[DONE]") {
          if (trimmed === "[DONE]") onDone();
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.error) {
            onError(parsed.error);
            return;
          }
          if (parsed.content) {
            onChunk(parsed.content);
          }
        } catch {
          // skip malformed
        }
      }
    }
    onDone();
  } catch (err) {
    if (signal?.aborted) return;
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
  const lastSearchResults = useRef<{ url: string; title: string }[]>([]);
  const lastScrapedContent = useRef<{ url: string; title: string; content: string } | null>(null);
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

        lastScrapedContent.current = {
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
              content: data.title ? `here's what **${data.title}** looks like :3` : `got the screenshot~ =w=`,
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
    (convId: string, messageId: string) => {
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === convId);
        if (!conv) return prev;
        const msg = conv.messages.find((m) => m.id === messageId);
        if (!msg || msg.role !== "assistant") return prev;

        const content = msg.content;
        const actionRegex = /\[ACTION:(OPEN_URL|SEARCH|IMAGE|OPEN_RESULT|OPEN_APP|SCREENSHOT|EMBED):([^\]]+)\]/g;
        let match;
        const actions: { type: string; value: string }[] = [];
        while ((match = actionRegex.exec(content)) !== null) {
          actions.push({ type: match[1], value: match[2].trim() });
        }

        if (actions.length === 0) return prev;

        const cleanContent = content.replace(/\s*\[ACTION:[^\]]+\]\s*/g, " ").trim();
        const images: { url: string; alt?: string }[] = [];
        const videos: { url: string; title?: string; platform: "youtube" | "other"; embedId?: string }[] = [];
        const webEmbeds: { url: string; title?: string }[] = [];
        const urlsToScrape: string[] = [];

        for (const action of actions) {
          if (action.type === "OPEN_URL") {
            const url = action.value;
            // Auto-detect YouTube video URLs and embed them
            const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            if (ytMatch) {
              videos.push({ url, platform: "youtube", embedId: ytMatch[1] });
            }
            try {
              window.open(url, "_blank", "noopener,noreferrer");
              if (!url.includes("google.com/search") && !url.includes("youtube.com/results") && !ytMatch) {
                urlsToScrape.push(url);
              }
            } catch {
              // skip
            }
          }
          if (action.type === "SEARCH") {
            fetchSearchResults(convId, messageId, action.value);
          }
          if (action.type === "IMAGE") {
            const parts = action.value.split("|");
            images.push({ url: parts[0].trim(), alt: parts[1]?.trim() });
          }
          // VIDEO action removed -- AI was generating fake URLs
          // YouTube embeds still work automatically from real OPEN_URL watch links
          if (action.type === "OPEN_RESULT") {
            const idx = parseInt(action.value, 10) - 1;
            const results = lastSearchResults.current;
            if (results[idx]) {
              try {
                window.open(results[idx].url, "_blank", "noopener,noreferrer");
                urlsToScrape.push(results[idx].url);
              } catch { /* skip */ }
            }
          }
          if (action.type === "OPEN_APP") {
            const appName = action.value.replace(/:$/, "").trim();
            if (confirm(`Senko wants to open "${appName}" on your device. Allow?`)) {
              openApp(convId, appName);
            }
          }
          if (action.type === "SCREENSHOT") {
            screenshotPage(convId, action.value);
          }
          if (action.type === "EMBED") {
            const parts = action.value.split("|");
            const embedUrl = parts[0].trim();
            const embedTitle = parts[1]?.trim();
            webEmbeds.push({ url: embedUrl, title: embedTitle });
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

        return prev.map((c) =>
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
        );
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrapeAndSummarize, welcomeToPage, openApp, screenshotPage]
  );

  const fetchSearchResults = useCallback(
    async (convId: string, messageId: string, query: string) => {
      const thinkId = addThinkingMsg(convId, `searching "${query}"...`);

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        removeThinkingMsg(convId, thinkId);

        if (data.results && data.results.length > 0) {
          lastSearchResults.current = data.results.map(
            (r: { title: string; url: string }) => ({ url: r.url, title: r.title })
          );
          const sources: WebSource[] = data.results.map(
            (r: { title: string; url: string }) => ({
              url: r.url,
              title: r.title,
              favicon: `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=16`,
            })
          );
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === messageId
                ? { ...m, sources: [...(m.sources || []), ...sources] }
                : m
            ),
          }));

          // Scrape the top result for images to show in chat
          const topUrl = data.results[0].url;
          if (topUrl && !topUrl.includes("youtube.com") && !topUrl.includes("google.com")) {
            try {
              const scrapeRes = await fetch(`/api/scrape?url=${encodeURIComponent(topUrl)}`);
              const scrapeData = await scrapeRes.json();
              if (scrapeData.images && scrapeData.images.length > 0) {
                const scrapedImages = scrapeData.images.map((imgUrl: string) => ({
                  url: imgUrl,
                  alt: scrapeData.title || query,
                }));
                updateConversation(convId, (conv) => ({
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === messageId
                      ? { ...m, images: [...(m.images || []), ...scrapedImages] }
                      : m
                  ),
                }));
              }
            } catch { /* image scrape failed silently */ }
          }
        }
      } catch {
        removeThinkingMsg(convId, thinkId);
      }
    },
    [updateConversation, addThinkingMsg, removeThinkingMsg]
  );

  const sendToAI = useCallback(
    (convId: string, allMessages: Message[]) => {
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

      if (lastSearchResults.current.length > 0) {
        const resultsList = lastSearchResults.current
          .map((r, i) => `${i + 1}. ${r.title} - ${r.url}`)
          .join("\n");
        apiMessages.push({
          role: "assistant",
          content: `[Previous search results available]:\n${resultsList}\n\nI can open any of these by number if the user asks.`,
        });
      }

      const systemPrompt = buildSystemPrompt(browserInfo, location);

      abortRef.current = new AbortController();

      streamChat(
        apiMessages,
        systemPrompt,
        (chunk) => {
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + chunk }
                : m
            ),
          }));
        },
        () => {
          setIsStreaming(false);
          abortRef.current = null;
          processActions(convId, assistantId);
        },
        (error) => {
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content || `[Error: ${error}]`,
                  }
                : m
            ),
          }));
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
          system: "You generate ultra-short conversation titles. Respond with ONLY the title, nothing else. 2-5 words max. No quotes. No punctuation. Lowercase.",
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
      if (!activeConversationId || isStreaming) return;

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
    <div className="relative flex h-screen w-screen overflow-hidden bg-[#0a0a0f]">
      {/* Background gradient effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#a78bfa]/[0.04] blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#6366f1]/[0.03] blur-[120px]" />
        <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#a78bfa]/[0.02] blur-[100px]" />
      </div>

      {/* Main Layout */}
      <div className="relative z-10 flex h-full w-full gap-3 p-3">
        {/* Sidebar */}
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          settings={settings}
          onSelectConversation={setActiveConversationId}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onSettingsChange={setSettings}
        />

        {/* Chat Area */}
        <div className="glass-panel-solid depth-shadow-lg flex-1 rounded-2xl overflow-hidden">
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
