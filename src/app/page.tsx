"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { TtsPlayerBar } from "@/components/chat/tts-player-bar";
import { useBrowserInfo } from "@/hooks/use-browser-info";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "@/hooks/use-location";
import { useMemory, parseMemoryTags } from "@/hooks/use-memory";
import type { Message, Conversation, AppSettings, BrowserInfo, LocationInfo, WebSource, SenkoTab } from "@/types/chat";
import { buildLayeredPrompt, messageHasUrl } from "@/lib/prompt-builder";
import { parseIntent } from "@/lib/intent-parser";
import researchPromptText from "@/app/prompts/research.txt";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// Strip internal tags from content for display (STATUS, MEMORY, ACTION, think blocks, metadata tags)
function stripInternalTags(content: string): string {
  return content
    .replace(/[^\S\n]*\[STATUS:[^\]]*\]?[^\S\n]*/gi, " ")
    .replace(/[^\S\n]*\[MEMORY:[^\]]*\]?[^\S\n]*/gi, " ")
    .replace(/[^\S\n]*\[ACTION:[^\]]*\]?[^\S\n]*/gi, " ")
    .replace(/[^\S\n]*ACTION:\s*[A-Z_]*:?[^\n]*/gi, " ")
    // Catch-all: strip any [key:value] metadata tags the AI leaks (e.g. [happy:...], [_topic:...], [video_title:...])
    .replace(/\[(?:_?[a-z][a-z0-9_]*):(?:[^\]]{0,200})\]/gi, "")
    // Also catch tags without colons (e.g. [_played eevee video]) and tags with spaces in key
    .replace(/\[_[a-z][a-z0-9_ ]{0,50}[^\]]{0,150}\]/gi, "")
    // Catch orphan tag fragments: "key:value]" without opening bracket (preceded by any non-alphanum)
    .replace(/([^a-zA-Z0-9]|^)(?:_?[a-z][a-z0-9_]*):(?:[^\]]{0,200})\]/gi, "$1")
    // Catch orphan colon-less fragments: "_played video]" (missing opening bracket, no colon)
    .replace(/([^a-zA-Z0-9]|^)_[a-z][a-z0-9_ ]{0,50}\]/gi, "$1")
    // Strip trailing clusters of tag-like metadata at end of content (with or without colons)
    .replace(/(?:[_a-z][a-z0-9_]*:[^\]]*\]){1,}\s*$/gi, "")
    .replace(/(?:_[a-z][a-z0-9_ ]*\]){1,}\s*$/gi, "")
    // Strip incomplete tag openings left at end during streaming (e.g. "[happy:" with no closing ])
    .replace(/\[_?[a-z][a-z0-9_]*:[^\]]*$/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const defaultSettings: AppSettings = {
  notifications: false,
  location: false,
  camera: false,
  microphone: false,
  clipboard: false,
  fontSize: "medium",
  sendWithEnter: true,
  voicePreset: "senko",
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

// Parse [STATUS:icon:text] from AI output
function parseStatusTag(text: string): { icon: string; text: string } | null {
  const match = text.match(/\[STATUS:([a-z]+):([^\]]+)\]/i);
  if (match) return { icon: match[1].toLowerCase(), text: match[2].trim() };
  return null;
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
    // Remove [STATUS:...] tags
    .replace(/\s*\[STATUS:[^\]]+\]\s*/g, " ")
    // Remove [MEMORY:...] tags
    .replace(/\s*\[MEMORY:[^\]]+\]\s*/g, " ")
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


// Client-side image dedup helpers
function normalizeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    const stripParams = ['w', 'h', 'width', 'height', 'size', 'quality', 'q', 'auto', 'fit', 'crop', 'format', 'fm', 'fl', 'dpr', 'cs', 'cb', 'v', 'token', 'sig', 'signature', 'hash', 'ref', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'resize', 'strip', 'compress'];
    for (const p of stripParams) u.searchParams.delete(p);
    return (u.origin + u.pathname.replace(/\/$/, '') + (u.search || '')).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function getImageFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/');
    return segments[segments.length - 1]?.toLowerCase() || '';
  } catch {
    return '';
  }
}

function isImageDuplicate(newUrl: string, existing: { url: string }[]): boolean {
  const normalized = normalizeImageUrl(newUrl);
  const filename = getImageFilename(newUrl);
  return existing.some((i) => {
    if (normalizeImageUrl(i.url) === normalized) return true;
    if (filename && filename.length > 10 && filename === getImageFilename(i.url)) return true;
    return false;
  });
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

function sanitizeSourceTitle(title: string, url: string): string {
  let clean = decodeHtmlEntities(title).trim();
  // Detect domain+URL concatenation (e.g. "stackexchange.comhttps://...")
  const urlInTitle = clean.match(/^([a-zA-Z0-9.-]+\.[a-z]{2,})(https?:\/\/.*)/i);
  if (urlInTitle) {
    try {
      const u = new URL(urlInTitle[2]);
      clean = u.hostname.replace(/^www\./, "");
    } catch {
      clean = urlInTitle[1];
    }
  }
  // If title IS a full URL, extract hostname
  if (/^https?:\/\//i.test(clean)) {
    try {
      clean = new URL(clean).hostname.replace(/^www\./, "");
    } catch { /* keep as is */ }
  }
  // If title is empty, extract from URL
  if (!clean) {
    try {
      clean = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      clean = url;
    }
  }
  return clean;
}

function getCityFromTimezone(timezone?: string): string {
  if (!timezone) return "";
  const parts = timezone.split("/");
  // Timezone format: "America/Indiana/Indianapolis" or "America/New_York"
  const city = parts[parts.length - 1]?.replace(/_/g, " ") || "";
  return city;
}

// --- Intent helpers (keeps multi-mode conversations from leaking context) ---
const NAV_COMMAND_REGEX = /^\s*(?:open|go\s*to|visit|browse|navigate\s*to|embed|screenshot|read)\b/i;
const SEARCH_COMMAND_REGEX = /\b(?:search\s*for|look\s*up|find|show\s*me|get\s*me|send\s*me)\b/i;
const CONTENT_REQUEST_REGEX = /\bwhat(?:'s|\s+is).*(?:on|from)\s+(?:this|that)?\s*(?:page|site)\b|\bshow\s+me\s+.*(?:videos?|links?|images?)\b|\blist\s+.*(?:videos?|links?)\b/i;
const TAB_COMMAND_REGEX = /\b(?:what|list|show)\s+.*\b(?:tabs?|open\s+tabs?)\b/i;
const PAGINATION_COMMAND_REGEX = /^\s*(?:next\s+page|page\s+\d+|more\s+(?:results|videos?)|go\s+to\s+page\s+\d+)\s*$/i;
const SECTION_COMMAND_REGEX = /(?:go\s+to|show\s+me|open|browse)\s+(?:the\s+)?[a-zA-Z0-9\s]+\s+(?:section|category|page|tab)\b/i;
const RESULT_PICK_REGEXES = [
  /(?:open|embed|play|watch|show|get|load)\s+(?:me\s+)?(?:the\s+)?(?:(?:\d+)(?:st|nd|rd|th)?|first|second|third|fourth|fifth)\s*(?:result|video|link|item|one|clip)\b/i,
  /\b(?:result|video|link|item|one|clip)\s*(?:#?\d+|first|second|third|fourth|fifth)\b/i,
];

function isBrowseIntent(text: string): boolean {
  return NAV_COMMAND_REGEX.test(text)
    || SEARCH_COMMAND_REGEX.test(text)
    || CONTENT_REQUEST_REGEX.test(text)
    || TAB_COMMAND_REGEX.test(text)
    || PAGINATION_COMMAND_REGEX.test(text)
    || SECTION_COMMAND_REGEX.test(text)
    || messageHasUrl(text);
}

function isResultPickIntent(text: string): boolean {
  return RESULT_PICK_REGEXES.some((re) => re.test(text));
}

interface PromptOptions {
  agentMode?: boolean;
  hasTabs?: boolean;
  hasUrlInMessage?: boolean;
  isResearch?: boolean;
  tabs?: SenkoTab[];
}

function buildSystemPrompt(
  browserInfo?: BrowserInfo | null,
  locationInfo?: LocationInfo | null,
  memoryContext?: string,
  options?: PromptOptions
): string {
  return buildLayeredPrompt({
    agentMode: options?.agentMode !== false,
    hasTabs: options?.hasTabs || false,
    hasUrlInMessage: options?.hasUrlInMessage || false,
    isResearch: options?.isResearch || false,
    memoryContext,
    browserInfo,
    locationInfo,
    tabs: options?.tabs,
  });
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

    try {
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
          // Skip SSE keepalive comment lines (": ping")
          if (line.startsWith(":")) continue;
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
    } catch (streamErr) {
      // If we already received content, treat mid-stream network errors as graceful completion
      // (ERR_INCOMPLETE_CHUNKED_ENCODING after partial response)
      if (chunkCount > 0 && !signal?.aborted) {
        console.warn(`%c[stream:${id}] ⚠️ Stream cut short after ${chunkCount} chunks — treating as done`, "color: #ffaa00; font-weight: bold", streamErr);
        finish();
        return;
      }
      throw streamErr;
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
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const thinkingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastBrowseIntentByConv = useRef<Record<string, number>>({});
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isStreaming, setIsStreaming] = useState(false);
  const [wasCutOff, setWasCutOff] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [agentMode, setAgentMode] = useState<"agent" | "thinking">("agent");
  const searchResultsByConv = useRef<Record<string, { url: string; title: string }[]>>({});
  const scrapedContentByConv = useRef<Record<string, { url: string; title: string; content: string }>>({});
  const scrapingInProgress = useRef(false);
  const { addMemory, getMemoryContext } = useMemory();

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

      // Delay inserting the thinking bubble to avoid UI flicker for fast operations.
      // If the work completes quickly, removeThinkingMsg() cancels the timer.
      const timer = setTimeout(() => {
        thinkingTimersRef.current.delete(id);
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
      }, 350);
      thinkingTimersRef.current.set(id, timer);
      return id;
    },
    [updateConversation]
  );

  const removeThinkingMsg = useCallback(
    (convId: string, thinkingId: string) => {
      const timer = thinkingTimersRef.current.get(thinkingId);
      if (timer) {
        clearTimeout(timer);
        thinkingTimersRef.current.delete(thinkingId);
      }
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

        const systemPrompt = buildSystemPrompt(browserInfo, location, getMemoryContext(), { agentMode: false });

        streamChat(
          contextMessages,
          systemPrompt,
          (chunk) => {
            updateConversation(convId, (conv) => ({
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === summaryId ? { ...m, content: stripInternalTags(m.content + chunk) } : m
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
        buildSystemPrompt(browserInfo, location, getMemoryContext(), { agentMode: false }),
        (chunk) => {
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === welcomeId ? { ...m, content: stripInternalTags(m.content + chunk) } : m
            ),
          }));
        },
        () => {
          // Final cleanup to ensure all tags are stripped
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === welcomeId ? { ...m, content: stripInternalTags(m.content) } : m
            ),
          }));
          setIsStreaming(false);
          abortRef.current = null;
        },
        () => { setIsStreaming(false); abortRef.current = null; },
        abortRef.current.signal
      );
    } catch {
      removeThinkingMsg(convId, thinkId);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [addThinkingMsg, removeThinkingMsg, updateConversation, browserInfo, location, getMemoryContext]);

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
        buildSystemPrompt(browserInfo, location, getMemoryContext(), { agentMode: false }),
        (chunk) => {
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === welcomeId ? { ...m, content: stripInternalTags(m.content + chunk) } : m
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
      const actionRegex = /\[ACTION:(OPEN_URL|SEARCH|IMAGE|OPEN_RESULT|OPEN_APP|SCREENSHOT|EMBED|SCRAPE_IMAGES|READ_URL|BROWSE):([^\]]+)\]/g;
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

      // Extract status tag before stripping
      const statusParsed = parseStatusTag(content);
      if (statusParsed) {
        const iconColorMap: Record<string, string> = {
          happy: "#34d399", sad: "#94a3b8", angry: "#ef4444", excited: "#f97316",
          sleepy: "#a78bfa", hungry: "#fbbf24", flustered: "#fb7185", scared: "#8b5cf6",
          chill: "#00d4ff", thinking: "#60a5fa", love: "#f472b6", gaming: "#34d399",
          music: "#f472b6", sparkle: "#00d4ff", fire: "#f97316", crying: "#94a3b8", shocked: "#fbbf24",
        };
        updateConversation(convId, (conv) => ({
          ...conv,
          status: {
            icon: statusParsed.icon,
            text: statusParsed.text,
            color: iconColorMap[statusParsed.icon] || "#a78bfa",
          },
        }));
      }

      // Strip action tags, malformed image tags, raw URLs, and filler text from displayed content
      let cleanContent = content
        .replace(/\s*\[ACTION:[^\]]+\]\s*/g, " ")
        .replace(/\s*\[IMAGE:[^\]]+\]\s*/g, " ")
        .replace(/\s*\[STATUS:[^\]]+\]\s*/g, " ")
        .replace(/\s*\[MEMORY:[^\]]+\]\s*/g, " ")
        .replace(/Image \d+:\s*/gi, "")
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/<img[^>]*>/gi, "")
        .replace(/https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?\S*)?/gi, "")
        .replace(/https?:\/\/(?:www\.)?google\.com\/\S*/gi, "")
        .replace(/https?:\/\/(?:www\.)?bing\.com\/\S*/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      // For nav actions, keep the message concise but never empty — user should always see what was done
      const hasNavAction = actions.some((a) => ["OPEN_URL", "EMBED", "OPEN_RESULT", "OPEN_APP", "SCREENSHOT"].includes(a.type));
      if (hasNavAction && cleanContent.length > 200) {
        const firstLine = cleanContent.split(/\n/)[0].trim();
        cleanContent = firstLine.length > 10 ? firstLine : cleanContent.slice(0, 150).trim();
      }
      const images: { url: string; alt?: string }[] = [];
      const videos: { url: string; title?: string; platform: "youtube" | "other"; embedId?: string }[] = [];
      const webEmbeds: { url: string; title?: string }[] = [];
      const urlsToScrape: string[] = [];
      const videoUrlsToExtract: string[] = [];

      // Helper to detect YouTube video URLs
      const getYouTubeId = (url: string): string | null => {
        const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return ytMatch ? ytMatch[1] : null;
      };

      // Helper to detect fabricated/made-up URLs from the AI
      // Real video/content URLs have numeric IDs or short hashes, not descriptive English words
      const isFabricatedUrl = (url: string): boolean => {
        try {
          const parsed = new URL(url);
          const pathAndQuery = parsed.pathname + parsed.search;
          // Skip well-known search patterns — these are constructed, not fabricated
          if (/[?&](?:q|query|search_query|search|s|k)=/i.test(parsed.search)) return false;
          // Skip homepage/root paths
          if (parsed.pathname === "/" || parsed.pathname === "") return false;
          // Check for descriptive English words in path segments or query values
          // Real IDs: /video/12345, /view_video.php?viewkey=ph5f3a2b1c, /watch?v=dQw4w9WgXcQ
          // Fake IDs: /video/eevee-first-video, /view_video.php?viewkey=eevee-pokemon-animation
          const suspiciousSegments = pathAndQuery.match(/(?:viewkey|id|v|video|watch|view)=([^&]+)/i) ||
            pathAndQuery.match(/\/(?:video|watch|view|post|entry)\/([^/?]+)/i);
          if (suspiciousSegments) {
            const idPart = decodeURIComponent(suspiciousSegments[1]);
            // Real IDs are typically: numeric (12345), hex (5f3a2b1c), alphanumeric (dQw4w9WgXcQ)
            // Fake IDs contain multiple English words separated by hyphens/underscores
            const words = idPart.split(/[-_+]/).filter(w => w.length > 2);
            const englishWords = words.filter(w => /^[a-z]+$/i.test(w) && w.length > 3);
            // If more than 1 English word in the ID, it's likely fabricated
            if (englishWords.length >= 2) {
              console.log(`%c[FABRICATION] 🚨 Detected fabricated URL ID: "${idPart}" (${englishWords.length} English words)`, "color: #ff4444; font-weight: bold");
              return true;
            }
          }
          return false;
        } catch { return false; }
      };

      // Helper to resolve a fabricated URL by fetching the real page and finding the Nth content link
      const resolveFabricatedUrl = async (fabricatedUrl: string, msgId: string, titleHint?: string) => {
        try {
          const parsed = new URL(fabricatedUrl);
          const baseUrl = parsed.origin;

          // Extract target index from the user's last message (e.g. "3rd video" -> index 2)
          let targetIndex = 0;
          const conv = conversations.find((c) => c.id === convId);
          if (conv) {
            const lastUserMsg = conv.messages.filter((m) => m.role === "user").pop()?.content || "";
            const numMatch = lastUserMsg.match(/(\d+)(?:st|nd|rd|th)/i);
            if (numMatch) {
              targetIndex = parseInt(numMatch[1], 10) - 1;
            } else if (/\bfirst\b/i.test(lastUserMsg)) {
              targetIndex = 0;
            } else if (/\bsecond\b/i.test(lastUserMsg)) {
              targetIndex = 1;
            } else if (/\bthird\b/i.test(lastUserMsg)) {
              targetIndex = 2;
            } else if (/\bfourth\b/i.test(lastUserMsg)) {
              targetIndex = 3;
            } else if (/\bfifth\b/i.test(lastUserMsg)) {
              targetIndex = 4;
            }
          }

          // Try to find the search/listing page the AI was trying to link from
          let contextUrl = "";
          if (conv) {
            const tabs = conv.tabs || [];
            if (tabs.length > 0) {
              const activeTab = tabs.find((t) => t.active) || tabs[tabs.length - 1];
              contextUrl = activeTab.url;
            }
            if (!contextUrl) {
              for (let i = conv.messages.length - 1; i >= 0; i--) {
                const msg = conv.messages[i];
                if (msg.sources?.length) { contextUrl = msg.sources[msg.sources.length - 1].url; break; }
                if (msg.webEmbeds?.length) { contextUrl = msg.webEmbeds[msg.webEmbeds.length - 1].url; break; }
                const actionUrlMatch = msg.content.match(/\[ACTION:(?:READ_URL|BROWSE|OPEN_URL):([^\]]+)\]/);
                if (actionUrlMatch) { contextUrl = actionUrlMatch[1].trim(); break; }
              }
            }
          }
          // Use context URL if from the same domain, otherwise use the base URL
          let fetchUrl = baseUrl;
          if (contextUrl) {
            try {
              const contextParsed = new URL(contextUrl);
              if (contextParsed.hostname === parsed.hostname) fetchUrl = contextUrl;
            } catch { /* use baseUrl */ }
          }

          console.log(`%c[FABRICATION] 🔄 Fetching real page: ${fetchUrl} (target index: ${targetIndex})`, "color: #ff8800; font-weight: bold");
          const thinkId = addThinkingMsg(convId, `finding the real link on ${parsed.hostname}...`);

          // Use /api/browse for JS-heavy sites to get accurate rendered links
          const isJsHeavy = /\b(xvideos|pornhub|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|rule34video|dailymotion|vimeo|bitchute|rumble|streamable|twitch|tiktok|instagram|twitter|x\.com|reddit|facebook)\b/i.test(fetchUrl);
          const res = await fetch(`${isJsHeavy ? "/api/browse" : "/api/url"}?url=${encodeURIComponent(fetchUrl)}&maxContent=8000`);
          const data = await res.json();
          removeThinkingMsg(convId, thinkId);

          if (data.error) {
            console.error("[FABRICATION] Page fetch failed:", data.error);
            window.open(baseUrl, "_blank", "noopener,noreferrer");
            updateConversation(convId, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, content: `Couldn't find the exact link, opening the site instead~`, webEmbeds: [...(m.webEmbeds || []), { url: baseUrl, title: parsed.hostname }] } : m
              ),
            }));
            return;
          }

          // Find video/content links on the page
          const links: { url: string; text: string }[] = data.links || [];
          
          // Helper to check if a link is an ad/signup/nav link
          const isJunkLink = (url: string, text: string) => {
            const u = url.toLowerCase();
            const t = text.toLowerCase();
            // Skip account/signup/login URLs
            if (/\/account|\/create|\/signup|\/login|\/register|\/join|\/subscribe|\/premium|\/upgrade/i.test(u)) return true;
            // Skip ad/tracker URLs
            if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare|popads|adsterra/i.test(u)) return true;
            // Skip nav/utility links by text
            if (/\b(join|sign\s*up|sign\s*in|log\s*in|register|create\s*account|free\s*account|subscribe|premium|upgrade)\b/i.test(t)) return true;
            // Skip self-links
            try { const lu = new URL(url); if (lu.pathname === "/" || lu.pathname === "") return true; } catch { /* skip */ }
            if (u === fetchUrl.toLowerCase() || u === baseUrl.toLowerCase()) return true;
            // Skip same-page anchors and javascript
            if (u.startsWith("#") || u.startsWith("javascript:")) return true;
            return false;
          };
          
          // First pass: find links with video-specific URL patterns (highest confidence)
          const videoLinks = links.filter((l) => {
            if (isJunkLink(l.url, l.text)) return false;
            const u = l.url.toLowerCase();
            // Must have a video-like URL pattern
            if (/\/(video|watch|view_video|clip)s?\b/i.test(u)) return true;
            if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
            return false;
          });
          // Second pass: broader content links if no video-specific ones found
          const contentLinks = videoLinks.length > 0 ? videoLinks : links.filter((l) => {
            if (isJunkLink(l.url, l.text)) return false;
            const u = l.url.toLowerCase();
            const t = l.text.toLowerCase();
            // Skip links whose text is just a URL
            if (/^https?:\/\//i.test(t)) return false;
            // Skip navigation, pagination, etc.
            if (/\b(page|next|prev|tag|categor|sort|filter|lang|privacy|terms|dmca|contact|about|faq|help|home|menu|search)\b/i.test(t) && t.length < 30) return false;
            if (u.includes("/tags") || u.includes("/categories") || u.includes("/members")) return false;
            // Content pages
            if (/\/(video|watch|view|post|entry|clip|embed)s?\b/i.test(u)) return true;
            if (/view_video|viewkey|watch\?/i.test(u)) return true;
            // Links with meaningful text (titles, not just "next" or "1")
            if (t.length > 10 && !(/^\d+$/.test(t))) return true;
            return false;
          });

          const targetLinks = contentLinks.length > 0 ? contentLinks : links.filter((l) => {
            if (isJunkLink(l.url, l.text)) return false;
            if (/^https?:\/\//i.test(l.text)) return false;
            return l.text.length > 5;
          });

          // If we have a title hint (from the AI's embed title or message), try to match by title first
          let bestMatch: { url: string; text: string } | null = null;
          if (titleHint && targetLinks.length > 0) {
            const hint = titleHint.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
            const hintWords = hint.split(/\s+/).filter(w => w.length > 2);
            if (hintWords.length > 0) {
              let bestScore = 0;
              for (const link of targetLinks) {
                const linkText = link.text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
                const matchedWords = hintWords.filter(w => linkText.includes(w));
                const score = matchedWords.length / hintWords.length;
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = link;
                }
              }
              // Only use title match if at least 40% of words match
              if (bestScore < 0.4) bestMatch = null;
              if (bestMatch) {
                console.log(`%c[FABRICATION] 🎯 Title-matched: "${titleHint}" -> "${bestMatch.text}" (score: ${bestScore})`, "color: #00ff88; font-weight: bold");
              }
            }
          }
          // Also try to extract title keywords from the fabricated URL path
          if (!bestMatch && targetLinks.length > 0) {
            const pathSegments = parsed.pathname.split("/").filter(s => s.length > 0);
            const lastSegment = pathSegments[pathSegments.length - 1] || "";
            const urlWords = decodeURIComponent(lastSegment).replace(/[-_+]/g, " ").toLowerCase().split(/\s+/).filter(w => w.length > 2 && /^[a-z]+$/.test(w));
            if (urlWords.length >= 2) {
              let bestScore = 0;
              for (const link of targetLinks) {
                const linkText = link.text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
                const matchedWords = urlWords.filter(w => linkText.includes(w));
                const score = matchedWords.length / urlWords.length;
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = link;
                }
              }
              if (bestScore < 0.4) bestMatch = null;
              if (bestMatch) {
                console.log(`%c[FABRICATION] 🎯 URL-path-matched: "${lastSegment}" -> "${bestMatch.text}" (score: ${bestScore})`, "color: #00ff88; font-weight: bold");
              }
            }
          }
          // Also try matching from recent AI messages (look for bold text or quoted titles)
          // The title may have been mentioned in a PREVIOUS assistant message, not just the current one
          if (!bestMatch && targetLinks.length > 0 && conv) {
            const recentAssistantMsgs = conv.messages.filter(m => m.role === "assistant").slice(-5).reverse();
            for (const aiMsg of recentAssistantMsgs) {
              if (bestMatch) break;
              // Extract bold text **title** or bracketed text [title]
              const boldMatches = [...(aiMsg.content.matchAll(/\*\*(.+?)\*\*/g))].map(m => m[1]);
              const bracketMatches = [...(aiMsg.content.matchAll(/\[([^\]]{5,})\]/g))].map(m => m[1]).filter(t => !t.startsWith("ACTION:"));
              const candidates = [...boldMatches, ...bracketMatches];
              for (const candidate of candidates) {
                if (bestMatch) break;
                if (candidate.length < 5) continue;
                const candidateWords = candidate.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).filter(w => w.length > 2);
                if (candidateWords.length === 0) continue;
                let topScore = 0;
                let topLink: { url: string; text: string } | null = null;
                for (const link of targetLinks) {
                  const linkText = link.text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
                  const matchedWords = candidateWords.filter(w => linkText.includes(w));
                  const score = matchedWords.length / candidateWords.length;
                  if (score > topScore) {
                    topScore = score;
                    topLink = link;
                  }
                }
                if (topScore >= 0.4 && topLink) {
                  bestMatch = topLink;
                  console.log(`%c[FABRICATION] 🎯 Message-title-matched: "${candidate}" -> "${bestMatch.text}" (score: ${topScore})`, "color: #00ff88; font-weight: bold");
                }
              }
            }
          }

          const resolvedLink = bestMatch || targetLinks[targetIndex] || null;
          if (resolvedLink) {
            const targetLink = resolvedLink;
            let targetUrl = targetLink.url;
            if (targetUrl.startsWith("/")) {
              targetUrl = parsed.origin + targetUrl;
            }
            console.log(`%c[FABRICATION] ✅ Found item: ${targetLink.text} -> ${targetUrl}${bestMatch ? " (title-matched)" : ` (#${targetIndex + 1})`}`, "color: #00ff88; font-weight: bold");
            try {
              window.open(targetUrl, "_blank", "noopener,noreferrer");
            } catch (e) {
              console.error("[FABRICATION] Failed to open:", e);
            }
            updateConversation(convId, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? {
                  ...m,
                  content: bestMatch ? `Here's ${targetLink.text}~` : `Here's #${targetIndex + 1}: ${targetLink.text}~`,
                  webEmbeds: [...(m.webEmbeds || []), { url: targetUrl, title: targetLink.text }],
                } : m
              ),
            }));
          } else {
            // No content links found, open the base page
            window.open(fetchUrl, "_blank", "noopener,noreferrer");
            updateConversation(convId, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, content: `Opening the page~`, webEmbeds: [...(m.webEmbeds || []), { url: fetchUrl, title: parsed.hostname }] } : m
              ),
            }));
          }
        } catch (e) {
          console.error("[FABRICATION] Resolution failed:", e);
        }
      };

      for (const action of actions) {
        console.log(`%c[ACTION] ▶ ${action.type}`, "color: #ff9900; font-weight: bold; font-size: 12px", action.value);

        if (action.type === "OPEN_URL") {
          const url = action.value;
          const ytId = getYouTubeId(url);
          console.log(`%c[BROWSE] 🌐 Opening URL`, "color: #00ccff; font-weight: bold", { url, isYouTube: !!ytId, ytId });

          // Check if the AI fabricated this URL (made-up path like viewkey=eevee-first-video)
          if (!ytId && isFabricatedUrl(url)) {
            console.log(`%c[BROWSE] 🚨 Fabricated URL detected — resolving real link instead`, "color: #ff4444; font-weight: bold", url);
            resolveFabricatedUrl(url, messageId);
          } else {
            // Check if this is a video site — DON'T embed (they block iframes with X-Frame-Options)
            const isVideoSiteUrl = /\b(rule34video|pornhub|xvideos|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|hentaihaven|hanime|iwara|dailymotion|vimeo|bitchute|rumble)\b/i.test(url);
            if (ytId) {
              console.log(`%c[BROWSE] 🎬 YouTube video detected, embedding player`, "color: #ff0000", { embedId: ytId });
              videos.push({ url, platform: "youtube", embedId: ytId });
            } else {
              if (isVideoSiteUrl) {
                console.log(`%c[BROWSE] 🎬 Video site detected — skipping embed, will deep-extract video`, "color: #ff9900; font-weight: bold", url);
                // Don't add webEmbed — it will just show "refused to connect"
                // Mark for video extraction (handled below)
                videoUrlsToExtract.push(url);
              } else {
                // Embed the site inline in chat so user can see it without leaving
                let hostname = "";
                try { hostname = new URL(url).hostname; } catch { /* skip */ }
                webEmbeds.push({ url, title: hostname || url });
              }
            }
            // Only open a new tab for non-video sites — video sites get inline extraction, no tab needed
            if (!isVideoSiteUrl) {
              try {
                window.open(url, "_blank", "noopener,noreferrer");
                console.log(`%c[BROWSE] ✅ Window opened`, "color: #00ff88", url);
                // Queue for text scraping (skip search result pages and YouTube)
                if (!url.includes("google.com/search") && !url.includes("youtube.com/results") && !ytId) {
                  console.log(`%c[BROWSE] 📄 Queuing page for scrape`, "color: #88ccff", url);
                  urlsToScrape.push(url);
                }
              } catch (e) {
                console.error(`%c[BROWSE] ❌ Failed to open window`, "color: #ff4444", url, e);
              }
            } else {
              console.log(`%c[BROWSE] 🎬 Video site — skipping tab, will extract inline`, "color: #ff9900", url);
            }
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
        // VIDEO action removed — AI was generating fake URLs
        // YouTube embeds still work automatically from real OPEN_URL watch links
        if (action.type === "OPEN_RESULT") {
          const idx = parseInt(action.value, 10) - 1;
          const results = searchResultsByConv.current[convId] || [];
          console.log(`%c[BROWSE] 📋 Opening search result #${idx + 1}`, "color: #00ccff; font-weight: bold", { index: idx, totalResults: results.length, result: results[idx] });
          if (results[idx]) {
            const resultUrl = results[idx].url;
            // For video sites, use BROWSE for inline extraction instead of opening a tab
            const isVideoSite = /\b(xvideos|pornhub|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|rule34video|rule34world)\b/i.test(resultUrl);
            if (isVideoSite) {
              console.log(`%c[BROWSE] 🎬 Video site result — using BROWSE for inline extraction`, "color: #ff9900", resultUrl);
              processActions(convId, messageId, `[ACTION:BROWSE:${resultUrl}]`);
            } else {
              try {
                window.open(resultUrl, "_blank", "noopener,noreferrer");
                urlsToScrape.push(resultUrl);
                console.log(`%c[BROWSE] ✅ Opened result`, "color: #00ff88", resultUrl);
              } catch (e) { console.error(`%c[BROWSE] ❌ Failed`, "color: #ff4444", e); }
            }
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
        if (action.type === "READ_URL" || action.type === "BROWSE") {
          // Deep read a URL - fetch content, links, images, metadata and feed back to AI
          // Use /api/browse (Puppeteer) for JS-heavy sites, /api/url (static fetch) for others
          const isJsHeavySite = /\b(xvideos|pornhub|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|hentaihaven|hanime|iwara|rule34video|dailymotion|vimeo|bitchute|rumble|streamable|twitch|tiktok|instagram|twitter|x\.com|facebook|reddit)\b/i.test(action.value);
          const useBrowse = action.type === "BROWSE" || isJsHeavySite;
          const endpoint = useBrowse ? "/api/browse" : "/api/url";
          console.log(`%c[READ] 📖 ${useBrowse ? "BROWSING (Puppeteer)" : "Reading"} URL`, "color: #00ccff; font-weight: bold; font-size: 12px", action.value);
          (async () => {
            const thinkId = addThinkingMsg(convId, useBrowse ? `browsing ${action.value}...` : `reading ${action.value}...`);
            try {
              const res = await fetch(`${endpoint}?url=${encodeURIComponent(action.value)}&maxContent=8000`);
              let data = await res.json();
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

              // --- AUTO VIDEO EXTRACTION ---
              // Check if the page looks like a video page (video site URL or has video-related content)
              const pageUrl = action.value.toLowerCase();
              const isVideoSite = /\b(video|watch|view_video|clip|embed|play|rule34video|pornhub|xvideos|xhamster|redtube|tube8|spankbang|xnxx|youporn|dailymotion|vimeo|bitchute|rumble|streamable)\b/i.test(pageUrl);
              const isVideoPage = isVideoSite || /\b(video|watch|player|clip)\b/i.test(data.meta?.title || "") || /\b(video|watch|player)\b/i.test(pageUrl);
              let foundVideos: { url: string; type?: string; quality?: string; poster?: string }[] = data.videos || [];

              // Filter to only direct playable video sources (not iframes)
              const directVideos = foundVideos.filter((v: { url: string; type?: string }) => {
                const u = v.url.toLowerCase();
                return /\.(mp4|webm|m3u8|mpd|ogg|mov)\b/i.test(u) || /^video\//i.test(v.type || "");
              });

              // If this looks like a video page but no direct videos found, try real browser browsing first, then video-extract
              if (isVideoPage && directVideos.length === 0) {
                console.log(`%c[READ_URL] 🎬 Video page detected but no direct sources — trying real browser`, "color: #ff9900; font-weight: bold");
                const extractThinkId = addThinkingMsg(convId, `deep-scanning video player on ${action.value}...`);
                try {
                  // Try /api/browse first (loads page in real browser, intercepts network requests)
                  const browseRes = await fetch(`/api/browse?url=${encodeURIComponent(action.value)}&maxContent=4000`);
                  const browseData = await browseRes.json();
                  if (browseData.videos && browseData.videos.length > 0) {
                    console.log(`%c[READ_URL] 🎬 Browse found ${browseData.videos.length} videos!`, "color: #00ff88; font-weight: bold", browseData.videos.map((v: {url:string}) => v.url.slice(0, 80)));
                    foundVideos = browseData.videos;
                    // Also update links/content from the browsed page (more accurate than static fetch)
                    if (browseData.links && browseData.links.length > (data.links || []).length) {
                      data.links = browseData.links;
                      data.content = browseData.content || data.content;
                    }
                  } else {
                    // Fallback to dedicated video-extract endpoint
                    const extractRes = await fetch(`/api/video-extract?url=${encodeURIComponent(action.value)}`);
                    const extractData = await extractRes.json();
                    if (extractData.videos && extractData.videos.length > 0) {
                      console.log(`%c[READ_URL] 🎬 Video-extract found ${extractData.videos.length} videos!`, "color: #00ff88; font-weight: bold", extractData.videos.map((v: {url:string}) => v.url.slice(0, 80)));
                      foundVideos = extractData.videos;
                    } else if (extractData.isListingPage && extractData.videoLinks?.length > 0) {
                      // This is a listing page with video links - store them and show to user
                      console.log(`%c[READ_URL] 📄 Listing page detected with ${extractData.videoLinks.length} video links`, "color: #ff9900; font-weight: bold");
                      const newResults = extractData.videoLinks.map((l: { url: string; title: string }) => ({ title: l.title, url: l.url, snippet: "" }));
                      searchResultsByConv.current[convId] = newResults;
                      
                      // Update message with video list
                      const resultList = extractData.videoLinks.slice(0, 15).map((l: { title: string }, i: number) => `${i + 1}. ${l.title}`).join("\n");
                      updateConversation(convId, (c) => ({
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === messageId ? { ...m, content: m.content + `\n\nFound ${extractData.videoLinks.length} videos on this page:\n${resultList}\n\nWhich one do you wanna watch?` } : m
                        ),
                      }));
                    }
                  }
                  removeThinkingMsg(convId, extractThinkId);
                } catch (e) {
                  console.error("[READ_URL] Video extraction failed:", e);
                  removeThinkingMsg(convId, extractThinkId);
                }
              }

              // Re-filter after potential Puppeteer results
              const playableVideos = foundVideos.filter((v: { url: string; type?: string }) => {
                const u = v.url.toLowerCase();
                // Skip get_file URLs (KVS sites — duplicate of CDN URL, 404s without browser cookies)
                if (/\/get_file\//i.test(u)) return false;
                // Skip known ad domains
                if (/\b(banhq|otcagpqmeoqb|eunow4u)\b/i.test(u)) return false;
                return /\.(mp4|webm|m3u8|mpd|ogg|mov)\b/i.test(u) || /^video\//i.test(v.type || "") || /mpegurl|dash/i.test(v.type || "");
              });

              // Deduplicate by normalized URL — extract core filename across different CDN patterns
              const normalizeVideoUrl = (url: string): string => {
                try {
                  const u = new URL(url);
                  const path = u.pathname.toLowerCase();
                  // Extract video filename from query params (CDN URLs like remote_control.php?file=...)
                  const fileParam = u.searchParams.get('file') || u.searchParams.get('url');
                  if (fileParam) {
                    const decoded = decodeURIComponent(fileParam).toLowerCase();
                    const fname = decoded.match(/([^\/]+\.(?:mp4|webm|m3u8|mpd|ogg|mov))$/i)?.[1];
                    if (fname) return fname;
                    const segments = decoded.split('/').filter(Boolean);
                    if (segments.length > 0) return segments[segments.length - 1];
                  }
                  // Extract filename from path
                  const pathFilename = path.match(/([^\/]+\.(?:mp4|webm|m3u8|mpd|ogg|mov))$/i)?.[1];
                  if (pathFilename) return pathFilename;
                  return `${u.hostname}${path}`;
                } catch {
                  return url.split('?')[0].toLowerCase();
                }
              };
              
              const seenVideoKeys = new Set<string>();
              const uniquePlayableVideos = playableVideos.filter((v: { url: string }) => {
                const normalizedKey = normalizeVideoUrl(v.url);
                if (seenVideoKeys.has(normalizedKey)) {
                  console.log(`%c[DEDUP] 💧 Filtered duplicate video: ${v.url.slice(0, 100)}`, "color: #888; font-style: italic");
                  return false;
                }
                seenVideoKeys.add(normalizedKey);
                return true;
              });

              // If we found playable video sources, auto-play the best one + open page in new tab
              if (uniquePlayableVideos.length > 0) {
                const bestVideo = uniquePlayableVideos[0]; // Already sorted by quality in the API
                console.log(`%c[READ_URL] 🎬 AUTO-PLAYING video: ${bestVideo.url} (${bestVideo.type || "unknown"}, ${bestVideo.quality || "?"})`, "color: #00ff88; font-weight: bold");

                // Add video embed to the message for inline playback
                const videoEmbeds = uniquePlayableVideos.slice(0, 3).map((v: { url: string; type?: string; quality?: string; poster?: string }) => ({
                  url: v.url,
                  platform: "other" as const,
                  title: data.meta?.title || "Video",
                }));

                // Video is playing inline — no need to open a separate tab

                updateConversation(convId, (conv) => ({
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === messageId ? {
                      ...m,
                      content: m.content || `Found it! Here's the video~`,
                      videos: [...(m.videos || []), ...videoEmbeds],
                      sources: [...(m.sources || []), {
                        url: action.value,
                        title: data.meta?.title || action.value,
                        favicon: data.meta?.favicon || `https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(action.value).hostname; } catch { return ""; } })()}&sz=16`,
                      }],
                    } : m
                  ),
                }));

                // Still feed to AI for a brief response, but with video already playing
                const conv = conversations.find((c) => c.id === convId);
                const userMessages = conv?.messages.filter((m) => m.role === "user") || [];
                const lastUserMsg = userMessages[userMessages.length - 1]?.content || "";
                const videoList = uniquePlayableVideos.slice(0, 5).map((v: { url: string; type?: string; quality?: string }) => `- ${v.url}${v.quality ? ` (${v.quality})` : ""}${v.type ? ` [${v.type}]` : ""}`).join("\n");

                const followUpId = generateId();
                updateConversation(convId, (conv2) => ({
                  ...conv2,
                  messages: [...conv2.messages, {
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
                  [{ role: "user" as const, content: `The user asked: "${lastUserMsg}"\n\nI found the video page: ${data.meta?.title || action.value}\n\nDirect video sources extracted:\n${videoList}\n\nThe video is ALREADY playing inline in the chat and the page is open in a new tab. Just write a SHORT, cheerful confirmation (1-2 sentences max). Do NOT use any action tags — everything is already done. Do NOT list URLs or technical details.` }],
                  buildSystemPrompt(browserInfo, location, getMemoryContext(), { agentMode: false }),
                  (chunk) => {
                    updateConversation(convId, (conv) => ({
                      ...conv,
                      messages: conv.messages.map((m) =>
                        m.id === followUpId ? { ...m, content: stripInternalTags(m.content + chunk) } : m
                      ),
                    }));
                  },
                  () => {
                    updateConversation(convId, (conv) => ({
                      ...conv,
                      messages: conv.messages.map((m) =>
                        m.id === followUpId ? (() => {
                          const { cleanText, extractedSources } = parseAIOutput(m.content);
                          return { ...m, content: cleanText, sources: extractedSources.length > 0 ? extractedSources : m.sources };
                        })() : m
                      ),
                    }));
                    setIsStreaming(false);
                    abortRef.current = null;
                  },
                  (err) => { console.error("Video follow-up error:", err); setIsStreaming(false); abortRef.current = null; },
                  followUpAbort.signal
                );
                return; // Video handled — don't fall through to normal READ_URL flow
              }

              // --- NO VIDEO FOUND: Fall through to normal READ_URL flow ---
              // If video page but no sources at all, open page in new tab as last resort
              if (isVideoPage && foundVideos.length === 0) {
                console.log(`%c[READ_URL] 🎬 Video page but couldn't extract sources — opening in new tab as fallback`, "color: #ffaa00; font-weight: bold");
                try {
                  window.open(action.value, "_blank", "noopener,noreferrer");
                } catch (e) { console.error("[READ_URL] Failed to open tab:", e); }
              }

              // Build a context message with the page data — send MORE links for browsing
              // Filter out ad/tracking/junk links that confuse navigation
              const adLinkPattern = /\b(doubleclick|googlesyndication|googleadservices|adsystem|adserver|adclick|clicktrack|tracker|pagead|pubads|syndication|taboola|outbrain|mgid|exoclick|exosrv|juicyads|trafficjunky|trafficstars|popunder|popads|clickadu|adsterra|propellerads|popcash|hilltopads|adcash|clickaine|revcontent|zergnet|disqus\.com|facebook\.com\/tr|analytics|pixel|beacon|imp\?|\/ad\/|\/ads\/|\/adx\/|banner|sponsor)\b/i;
              const filteredLinks = (data.links || [])
                .filter((l: { url: string; text: string }) => {
                  if (!l.url || !l.text?.trim()) return false;
                  if (l.text.trim().length < 2) return false;
                  if (adLinkPattern.test(l.url)) return false;
                  // Skip javascript: and data: URLs
                  if (/^(javascript|data|mailto|tel):/i.test(l.url)) return false;
                  // Skip links that are just "#" or empty anchors
                  if (l.url === "#" || l.url === "#!" || l.url.endsWith("/#")) return false;
                  return true;
                })
                // Deduplicate by URL
                .filter((l: { url: string }, i: number, arr: { url: string }[]) => arr.findIndex((a) => a.url === l.url) === i);
              const pageLinks = filteredLinks.slice(0, 40).map((l: { url: string; text: string }, i: number) => `${i + 1}. [${l.text.trim()}](${l.url})`).join("\n");
              const pageHeadings = (data.headings || []).map((h: { level: number; text: string }) => `${"#".repeat(h.level)} ${h.text}`).join("\n");
              const pageVideos = foundVideos.map((v: { url: string; type?: string; quality?: string }) => `- ${v.url}${v.type ? ` (${v.type})` : ""}${v.quality ? ` [${v.quality}]` : ""}`).join("\n");

              // DON'T attach images from READ_URL — the user wants navigation, not thumbnails
              // Images are only attached via SCRAPE_IMAGES action

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

              // Get the user's original message to pass context to the follow-up
              const conv = conversations.find((c) => c.id === convId);
              const userMessages = conv?.messages.filter((m) => m.role === "user") || [];
              const lastUserMsg = userMessages[userMessages.length - 1]?.content || "";

              // ── Adaptive listing page detection ──
              // If the page has multiple content/video links on the same domain, it's a listing page
              // Present results as a numbered list instead of blindly navigating
              let pageOrigin = "";
              try { pageOrigin = new URL(action.value).origin; } catch { /* skip */ }
              const contentVideoLinks = filteredLinks.filter((l: { url: string; text: string }) => {
                const u = l.url.toLowerCase();
                try {
                  const lu = new URL(l.url);
                  if (lu.origin.toLowerCase() !== pageOrigin.toLowerCase()) return false;
                  if (lu.pathname === "/" || lu.pathname === "") return false;
                } catch { return false; }
                if (/\b(login|sign|register|tags|categories|members|privacy|terms|dmca|contact|about|faq|help|home|search)\b/i.test(u) && !/\/(video|watch|view_video|clip|post|thread|article)s?\b/i.test(u)) return false;
                // Content link: has a meaningful path (video, watch, post, etc.) or decent link text
                if (/\/(video|watch|view_video|clip|post|thread|article|gallery|image)s?\b/i.test(u)) return true;
                if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
                if (l.text?.trim().length > 5 && !(/^\d+$/.test(l.text.trim()))) return true;
                return false;
              });

              const isListingPage = contentVideoLinks.length >= 3 && !isVideoPage;

              if (isListingPage) {
                // Resolve all URLs to absolute
                const resolvedListItems = contentVideoLinks.slice(0, 20).map((l: { url: string; text: string }) => {
                  let fullUrl = l.url;
                  if (fullUrl.startsWith("/")) { try { fullUrl = pageOrigin + fullUrl; } catch { /* keep */ } }
                  return { text: l.text.trim(), url: fullUrl };
                });

                // Store results for follow-up picks (OPEN_RESULT interceptor)
                const newListResults = resolvedListItems.map((l: { text: string; url: string }) => ({ title: l.text, url: l.url, snippet: "" }));
                const existingResults = searchResultsByConv.current[convId] || [];
                const seenUrls = new Set(newListResults.map((r: { url: string }) => r.url));
                searchResultsByConv.current[convId] = [...newListResults, ...existingResults.filter((r: { url: string }) => !seenUrls.has(r.url))].slice(0, 50);

                // Check for auto-pick in the original user message ("click the first video", "play the 3rd one")
                const userPickMatch = lastUserMsg.match(/(?:click|play|open|watch|pick|select|choose)\s+(?:the\s+)?(?:(\d+)(?:st|nd|rd|th)?|(first|second|third|fourth|fifth|last))\s+(?:video|result|one|link|clip|item)/i);
                const ordMap: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
                const autoPick = userPickMatch ? (userPickMatch[1] ? parseInt(userPickMatch[1]) : (ordMap[userPickMatch[2]?.toLowerCase()] || 0)) : 0;
                const autoPickIdx = autoPick === -1 ? resolvedListItems.length - 1 : autoPick - 1;

                if (autoPick > 0 && autoPickIdx >= 0 && autoPickIdx < resolvedListItems.length) {
                  // Auto-navigate to the picked item
                  const picked = resolvedListItems[autoPickIdx];
                  console.log(`%c[READ_URL] 🎯 Listing auto-pick #${autoPick}: "${picked.text}" → ${picked.url}`, "color: #00ffcc; font-weight: bold");
                  removeThinkingMsg(convId, thinkId);
                  updateConversation(convId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === messageId ? { ...m, content: stripInternalTags(m.content) + `\nFound ${resolvedListItems.length} results~ Picking #${autoPick}: "${picked.text}"...` } : m
                    ),
                  }));
                  processActions(convId, messageId, `[ACTION:BROWSE:${picked.url}]`);
                  return; // processActions handles the rest
                }

                // No auto-pick — present numbered list and let user choose
                const listText = resolvedListItems.slice(0, 10).map((l: { text: string }, i: number) => `${i + 1}. ${l.text}`).join("\n");
                const listMsg = `Found ${resolvedListItems.length} items~\n\n${listText}${resolvedListItems.length > 10 ? `\n\n...and ${resolvedListItems.length - 10} more` : ""}\n\nWhich one do you want? Just say the number~`;
                removeThinkingMsg(convId, thinkId);
                updateConversation(convId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, content: stripInternalTags(m.content) + `\n${listMsg}` } : m
                  ),
                }));
                setIsStreaming(false);
                return; // Wait for user selection
              }

              // Feed the page content back to AI for a follow-up response
              const pageContext = `User asked: "${lastUserMsg}"\nPage: ${action.value}\nTitle: ${data.meta?.title || "?"}\n${pageHeadings ? `Structure:\n${pageHeadings}\n` : ""}${(data.content || "").slice(0, 2000)}${pageVideos ? `\nVideos:\n${pageVideos}` : ""}${isVideoPage && foundVideos.length === 0 ? `\n[No video sources — page opened in new tab]` : ""}${pageLinks ? `\nLinks:\n${pageLinks}` : ""}`;

              const followUpId = generateId();
              updateConversation(convId, (conv2) => ({
                ...conv2,
                messages: [...conv2.messages, {
                  id: followUpId,
                  role: "assistant" as const,
                  content: "",
                  timestamp: new Date(),
                }],
              }));

              const followUpAbort = new AbortController();
              abortRef.current = followUpAbort;
              setIsStreaming(true);
              let followUpRaw = "";
              streamChat(
                [{ role: "user" as const, content: pageContext + "\n\nYou are navigating step-by-step for the user. Look at the numbered links above and pick the ONE that best matches what the user wants. Use [ACTION:BROWSE:url] to navigate deeper (search results, video pages, categories). For video pages, BROWSE triggers auto-extraction — just navigate there. IGNORE ad/spam links. If this is a search results page, pick the best matching result link. If the user hasn't reached their goal yet, keep navigating — don't stop. Output just the action tag and a brief 1-sentence status." }],
                buildSystemPrompt(browserInfo, location, getMemoryContext(), { hasTabs: true, hasUrlInMessage: true }),
                (chunk) => {
                  followUpRaw += chunk;
                  updateConversation(convId, (conv) => ({
                    ...conv,
                    messages: conv.messages.map((m) =>
                      m.id === followUpId ? { ...m, content: stripInternalTags(followUpRaw) } : m
                    ),
                  }));
                },
                () => {
                  updateConversation(convId, (conv2) => ({
                    ...conv2,
                    messages: conv2.messages.map((m) =>
                      m.id === followUpId ? (() => {
                        const { cleanText, extractedSources } = parseAIOutput(followUpRaw);
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

                  // Process any chained actions from the follow-up response (uses raw content, not stripped)
                  if (followUpRaw.includes("[ACTION:")) {
                    console.log(`%c[READ_URL] 🔗 Chaining actions from follow-up`, "color: #00ffcc; font-weight: bold");
                    processActions(convId, followUpId, followUpRaw);
                  }
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
          // Check if the AI fabricated this embed URL
          if (!ytId && isFabricatedUrl(embedUrl)) {
            console.log(`%c[EMBED] 🚨 Fabricated embed URL detected — resolving real link instead`, "color: #ff4444; font-weight: bold", embedUrl);
            resolveFabricatedUrl(embedUrl, messageId, embedTitle);
          } else if (ytId) {
            videos.push({ url: embedUrl, platform: "youtube", embedId: ytId, title: embedTitle });
          } else {
            webEmbeds.push({ url: embedUrl, title: embedTitle });
          }
        }
      }

      // Deep video extraction for video site URLs (separate from text scraping)
      if (videoUrlsToExtract.length > 0) {
        const videoUrl = videoUrlsToExtract[0];
        console.log(`%c[BROWSE] 🎬 Starting deep video extraction for: ${videoUrl}`, "color: #ff9900; font-weight: bold");
        (async () => {
          const thinkId = addThinkingMsg(convId, `extracting video from page...`);
          try {
            // Use /api/browse (Puppeteer) for video sites — it intercepts network requests and gets real video URLs
            const urlRes = await fetch(`/api/browse?url=${encodeURIComponent(videoUrl)}&maxContent=4000`);
            const urlData = await urlRes.json();
            let foundVids: { url: string; type?: string; quality?: string }[] = urlData.videos || [];
            const filterPlayable = (vids: { url: string; type?: string }[]) => vids.filter((v) => {
              const u = v.url.toLowerCase();
              if (/\/get_file\//i.test(u)) return false;
              if (/\b(banhq|otcagpqmeoqb|eunow4u)\b/i.test(u)) return false;
              return /\.(mp4|webm|m3u8|mpd|ogg|mov)\b/i.test(u) || /^video\//i.test(v.type || "") || /mpegurl|dash/i.test(v.type || "");
            });
            let playable = filterPlayable(foundVids);
            // Puppeteer video-extract fallback if browse didn't find playable videos
            if (playable.length === 0) {
              console.log(`%c[BROWSE] 🎬 No direct videos from browse, trying video-extract fallback`, "color: #ff9900");
              try {
                const extractRes = await fetch(`/api/video-extract?url=${encodeURIComponent(videoUrl)}`);
                const extractData = await extractRes.json();
                if (extractData.videos?.length > 0) {
                  foundVids = extractData.videos;
                  playable = filterPlayable(foundVids);
                } else if (extractData.isListingPage && extractData.videoLinks?.length > 0) {
                  // Listing page detected - store video links for follow-up
                  console.log(`%c[BROWSE] 📄 Listing page with ${extractData.videoLinks.length} video links`, "color: #ff9900; font-weight: bold");
                  const newResults = extractData.videoLinks.map((l: { url: string; title: string }) => ({ title: l.title, url: l.url, snippet: "" }));
                  searchResultsByConv.current[convId] = newResults;
                  removeThinkingMsg(convId, thinkId);
                  const resultList = extractData.videoLinks.slice(0, 15).map((l: { title: string }, i: number) => `${i + 1}. ${l.title}`).join("\n");
                  updateConversation(convId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) => m.id === messageId ? { ...m, content: m.content + `\n\nFound ${extractData.videoLinks.length} videos:\n${resultList}\n\nPick a number~` } : m),
                  }));
                  return;
                }
              } catch (e) { console.error("[BROWSE] Puppeteer extraction failed:", e); }
            }
            removeThinkingMsg(convId, thinkId);
            if (playable.length > 0) {
              console.log(`%c[BROWSE] 🎬 Found ${playable.length} playable videos!`, "color: #00ff88; font-weight: bold");
              
              // Deduplicate videos (same logic as READ_URL)
              const normalizeVideoUrl = (url: string): string => {
                try {
                  const u = new URL(url);
                  const path = u.pathname.toLowerCase();
                  const fileParam = u.searchParams.get('file') || u.searchParams.get('url');
                  if (fileParam) {
                    const decoded = decodeURIComponent(fileParam).toLowerCase();
                    const fname = decoded.match(/([^\/]+\.(?:mp4|webm|m3u8|mpd|ogg|mov))$/i)?.[1];
                    if (fname) return fname;
                    const segments = decoded.split('/').filter(Boolean);
                    if (segments.length > 0) return segments[segments.length - 1];
                  }
                  const pathFilename = path.match(/([^\/]+\.(?:mp4|webm|m3u8|mpd|ogg|mov))$/i)?.[1];
                  if (pathFilename) return pathFilename;
                  return `${u.hostname}${path}`;
                } catch {
                  return url.split('?')[0].toLowerCase();
                }
              };
              
              const seenVideoKeys = new Set<string>();
              const uniquePlayable = playable.filter((v: { url: string }) => {
                const normalizedKey = normalizeVideoUrl(v.url);
                if (seenVideoKeys.has(normalizedKey)) {
                  console.log(`%c[DEDUP] 💧 Filtered duplicate video: ${v.url.slice(0, 100)}`, "color: #888; font-style: italic");
                  return false;
                }
                seenVideoKeys.add(normalizedKey);
                return true;
              });
              
              const videoEmbeds = uniquePlayable.slice(0, 3).map((v: { url: string }) => ({
                url: v.url, platform: "other" as const, title: urlData.meta?.title || "Video",
              }));
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) => m.id === messageId ? {
                  ...m,
                  videos: [...(m.videos || []), ...videoEmbeds],
                  sources: [...(m.sources || []), {
                    url: videoUrl,
                    title: urlData.meta?.title || videoUrl,
                    favicon: `https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(videoUrl).hostname; } catch { return ""; } })()}&sz=16`,
                  }],
                } : m),
              }));
            } else {
              console.log(`%c[BROWSE] 🎬 No playable videos found — page already open in new tab`, "color: #ffaa00");
            }
          } catch (e) {
            console.error("[BROWSE] Video extraction error:", e);
            removeThinkingMsg(convId, thinkId);
          }
        })();
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
        // === LOCATION ENRICHMENT: Inject city for "near me"/"my area" queries ===
        const locationPattern = /\b(my area|near me|nearby|in my city|around here|local|close to me|in my town|in my neighborhood|closest|nearest)\b/i;
        let enrichedQuery = query;
        if (locationPattern.test(query)) {
          const cityName = getCityFromTimezone(browserInfo?.timezone);
          if (cityName) {
            enrichedQuery = query.replace(locationPattern, `in ${cityName}`);
            console.log(`%c[fetchSearch] 📍 Location-enriched: "${query}" -> "${enrichedQuery}"`, "color: #00ff88; font-weight: bold");
          } else if (location?.status === "granted" && location.latitude) {
            enrichedQuery = `${query} ${location.latitude},${location.longitude}`;
            console.log(`%c[fetchSearch] 📍 Location-enriched with coords: "${query}" -> "${enrichedQuery}"`, "color: #00ff88; font-weight: bold");
          }
        }

        // Detect if this is an image-focused request BEFORE fetching
        const imageQueryPattern = /\b(images?|pics?|pictures?|photos?|gifs?|animated|show me|send me|get me|give me|wanna see|want to see|let me see|i want|wallpapers?)\b/i;
        const isImageQuery = imageQueryPattern.test(query);
        // Detect hybrid: user wants BOTH images AND research (e.g. "send me images of anya forger and tell me what she is")
        const researchIntentPattern = /\b(tell me|what is|who is|explain|about|describe|info|information|history|how does|why|and tell|also tell)\b/i;
        const isHybridQuery = isImageQuery && researchIntentPattern.test(query);

        // Phase 1: Fetch search results (single search — no duplicate /api/sources call)
        console.log(`%c[fetchSearch] 📡 Fetching /api/search...`, "color: #88ccff");
        const searchRes = await fetch(`/api/search?q=${encodeURIComponent(enrichedQuery)}`);
        const searchData = await searchRes.json();
        console.log(`%c[fetchSearch] ✅ Search returned ${searchData.results?.length || 0} results`, "color: #00ff88");

        // Only fetch images for image-related queries — skip for weather, facts, etc.
        let imageData: { images?: { url: string; alt: string; source: string; engine?: string }[] } = {};
        if (isImageQuery) {
          console.log(`%c[fetchSearch] 🖼️ Image query detected, fetching /api/images...`, "color: #ff66cc");
          try {
            const imageRes = await fetch(`/api/images?q=${encodeURIComponent(query)}`);
            imageData = await imageRes.json();
            console.log(`%c[fetchSearch] ✅ Images returned ${imageData.images?.length || 0} images`, "color: #00ff88");
          } catch (e) {
            console.error(`%c[fetchSearch] ❌ Image fetch failed:`, "color: #ff4444", e);
          }
        }

        removeThinkingMsg(convId, thinkId);

        // Build sources directly from search results (single search, no duplicate call)
        let sources: WebSource[] = [];
        if (searchData.results && searchData.results.length > 0) {
          // Merge new results with existing ones (new results first, old results kept for topic-switching)
          const newResults = searchData.results.map(
            (r: { title: string; url: string }) => ({ url: r.url, title: r.title })
          );
          const existingResults = searchResultsByConv.current[convId] || [];
          const seenUrls = new Set(newResults.map((r: { url: string }) => r.url));
          const mergedResults = [...newResults, ...existingResults.filter((r: { url: string }) => !seenUrls.has(r.url))];
          searchResultsByConv.current[convId] = mergedResults.slice(0, 50);
          sources = searchData.results.map(
            (r: { title: string; url: string; snippet: string }) => {
              let favicon = "";
              try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=16`; } catch { /* bad URL */ }
              return { url: r.url, title: sanitizeSourceTitle(r.title, r.url), snippet: decodeHtmlEntities(r.snippet || ""), favicon };
            }
          );
        }

        // Build images from dedicated image search (only populated for image queries)
        let searchImages: { url: string; alt?: string; source?: string; engine?: string }[] = [];
        if (imageData.images && imageData.images.length > 0) {
          searchImages = imageData.images.map((img: { url: string; alt: string; source?: string; engine?: string }) => ({
            url: img.url,
            alt: img.alt || query,
            source: img.source || "",
            engine: img.engine || "",
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

        // For image requests: use dedicated image API results (already fetched above)
        if (isImageQuery) {
          const allImages = searchImages;

          // HYBRID: If user wants images AND research, carry images into the deep research path
          if (isHybridQuery) {
            // Store images for use in the research synthesis below
            searchImages = allImages;
            // Fall through to deep research path (don't return early)
          } else {
            // Pure image query — show images with canned message and return
            const cleanTopic = query.replace(/\b(images?|pics?|pictures?|photos?|gifs?|animated|of|show me|send me|get me|give me|wanna see|want to see|let me see|i want|look\s*up|find|get|wallpapers?|r34|rule\s*34|nsfw|hentai|xxx|lewd|explicit)\b/gi, "").trim();
            const commentId = generateId();
            updateConversation(convId, (conv) => ({
              ...conv,
              messages: [
                ...conv.messages,
                {
                  id: commentId,
                  role: "assistant" as const,
                  content: allImages.length > 0
                    ? `Here are ${allImages.length} ${cleanTopic} images I found for you~ \u{FF1D}w\u{FF1D}`
                    : `Hmm I couldn't find many images for "${cleanTopic}" ;w; Maybe try a different search term?`,
                  timestamp: new Date(),
                  sources: sources.length > 0 ? sources.slice(0, 8) : undefined,
                  images: allImages.length > 0 ? allImages : undefined,
                  searchQuery: query,
                },
              ],
            }));
            setIsStreaming(false);
            return;
          }
        }

        // Phase 2: Deep research - scrape top results for actual content
        const allResults = (searchData.results || []).slice(0, 8);
        const thinkId2 = addThinkingMsg(convId, `reading ${allResults.length} sources for "${query}"...`);
        const topUrls = allResults.map((r: { url: string }) => r.url);

        // Scrape all 8 in parallel (fast — single round trip)
        const scrapedPages: { url: string; title: string; content: string; images: string[] }[] = await Promise.all(
          topUrls.map(async (url: string) => {
            try {
              const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
              const data = await res.json();
              return { url, title: data.title || url, content: data.content || "", images: data.images || [] };
            } catch {
              return { url, title: url, content: "", images: [] };
            }
          })
        );
        removeThinkingMsg(convId, thinkId2);

        // Collect additional images from ALL scraped pages
        const additionalImages: { url: string; alt?: string }[] = [];
        for (const page of scrapedPages) {
          for (const imgUrl of (page.images as string[]).slice(0, 6)) {
            if (!isImageDuplicate(imgUrl, searchImages) && !isImageDuplicate(imgUrl, additionalImages)) {
              additionalImages.push({ url: imgUrl, alt: page.title });
            }
          }
        }
        // Merge: for hybrid queries, searchImages already has the image search results; combine with scraped page images
        const allResearchImages = isHybridQuery
          ? [...searchImages, ...additionalImages.filter((ai) => !isImageDuplicate(ai.url, searchImages))].slice(0, 24)
          : [...additionalImages].slice(0, 16);
        const hasImages = allResearchImages.length > 0;

        // Phase 3: Generate AI research synthesis using real scraped content
        // Trim aggressively: 4 sources × 800 chars = ~3200 chars context (fits any model)
        const scrapedContext = scrapedPages
          .filter((p) => p.content)
          .slice(0, 4)
          .map((p, i) => `[Source ${i + 1}: ${p.title}]\n${p.content.slice(0, 800).trim()}`)
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
            ...conv.messages,
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
        // Lean user message — instructions live in the synthesis system prompt
        const contextPrompt = hasScrapedContent
          ? `Research query: "${query}"${hasImages ? " (images are already shown in the UI — do NOT describe them)" : ""}

Source content:

${scrapedContext}`
          : `Research query: "${query}"${hasImages ? " (images are already shown in the UI — do NOT describe them)" : ""}

No full page content available. Use these search snippets:

${(searchData.results || []).slice(0, 8).map((r: { title: string; snippet: string }, i: number) => `${i + 1}. **${r.title}**: ${r.snippet || ""}`).join("\n")}`;

        // Build a fallback summary from scraped content in case AI stream fails or returns empty
        const buildFallbackSummary = (): string => {
          const snippets = scrapedPages
            .filter((p) => p.content && p.content.length > 50)
            .slice(0, 5)
            .map((p) => `**${p.title}**\n${p.content.slice(0, 400).trim()}`)
            .join("\n\n---\n\n");
          if (snippets) {
            return `## Research Results for "${query}"\n\n${snippets}\n\n*AI synthesis unavailable — showing raw source excerpts above. Check the source links below for full details~*`;
          }
          // Even snippets are empty — use search result titles/snippets
          const searchSnippets = (searchData.results || [])
            .slice(0, 8)
            .map((r: { title: string; snippet: string; url: string }) => `- **${r.title}**: ${r.snippet || r.url}`)
            .join("\n");
          if (searchSnippets) {
            return `## Search Results for "${query}"\n\n${searchSnippets}\n\n*Couldn't scrape the full pages, but here's what I found from search results~ Check the sources below for more!*`;
          }
          return `I searched for "${query}" but couldn't get detailed results right now ;w; Try again in a moment or rephrase your question~`;
        };

        abortRef.current = new AbortController();
        console.log(`%c[fetchSearch] 🔄 Setting isStreaming=true for research synthesis`, "color: #88ccff; font-weight: bold");
        setIsStreaming(true);
        // Show a "writing" thinking message so user knows to wait
        const synthThinkId = addThinkingMsg(convId, `writing up my research on "${query}"...`);
        let firstChunkReceived = false;
        streamChat(
          [{ role: "user" as const, content: contextPrompt }],
          researchPromptText,
          (chunk) => {
            // Remove thinking message on first real chunk
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              removeThinkingMsg(convId, synthThinkId);
            }
            updateConversation(convId, (conv) => ({
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === commentId ? { ...m, content: stripInternalTags(m.content + chunk) } : m
              ),
            }));
          },
          () => {
            // Clean up thinking message if it wasn't already removed
            if (!firstChunkReceived) removeThinkingMsg(convId, synthThinkId);
            console.log(`%c[fetchSearch] ✅ Research synthesis done, isStreaming=false`, "color: #00ff88; font-weight: bold");
            // Sanitize any leaked image URLs from the final content
            // Parse AI output: extract [Source N] citations into UI pills, clean the text
            updateConversation(convId, (conv) => ({
              ...conv,
              messages: conv.messages.map((m) => {
                if (m.id !== commentId) return m;
                let content = m.content;
                // Strip any leaked <think> blocks client-side (closed and unclosed)
                content = content.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/g, "").trim();
                // If AI returned empty content (e.g. only <think> blocks), use fallback
                if (!content || content.length < 10) {
                  console.warn(`%c[fetchSearch] ⚠️ AI returned empty/minimal content, using fallback`, "color: #ffaa00; font-weight: bold");
                  content = buildFallbackSummary();
                }
                const { cleanText, extractedSources } = parseAIOutput(content);
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
          (err) => {
            // Clean up thinking message
            if (!firstChunkReceived) removeThinkingMsg(convId, synthThinkId);
            console.error(`%c[fetchSearch] ❌ Research synthesis error, using fallback`, "color: #ff4444; font-weight: bold", err);
            // On error, generate fallback content from scraped data
            const fallback = buildFallbackSummary();
            updateConversation(convId, (conv) => ({
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === commentId ? { ...m, content: fallback } : m
              ),
            }));
            setIsStreaming(false);
            abortRef.current = null;
          },
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

  const fetchSourcesForMessage = useCallback(
    async (convId: string, messageId: string, query: string) => {
      try {
        console.log(`%c[sources] 🔗 Fetching sources for "${query}"`, "color: #00d4ff; font-weight: bold");
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const sources: WebSource[] = data.results.slice(0, 6).map((r: { url: string; title: string; snippet: string }) => {
            let favicon = "";
            try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=16`; } catch { /* skip */ }
            return { url: r.url, title: r.title, snippet: r.snippet || "", favicon };
          });
          console.log(`%c[sources] ✅ Got ${sources.length} sources`, "color: #00ff88", sources.map((s) => s.title));
          updateConversation(convId, (conv) => ({
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === messageId
                ? { ...m, sources: [...(m.sources || []), ...sources] }
                : m
            ),
          }));
        }
      } catch (e) {
        console.error("[sources] Failed to fetch sources:", e);
      }
    },
    [updateConversation]
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

      // Sliding window: cap conversation to last 24 messages (~12 turns)
      // Keeps context rich enough for continuity without bloating input tokens
      const MAX_CONTEXT_MESSAGES = 24;
      const windowedMessages = allMessages.length > MAX_CONTEXT_MESSAGES
        ? allMessages.slice(-MAX_CONTEXT_MESSAGES)
        : allMessages;

      const apiMessages = windowedMessages
        .filter((m) => !m.isThinking)
        .map((m) => {
          let content = m.content;
          // Compact context annotations for assistant messages
          if (m.role === "assistant") {
            const extras: string[] = [];
            if (m.images && m.images.length > 0) {
              extras.push(`[showed ${m.images.length} images]`);
            }
            if (m.videos && m.videos.length > 0) {
              extras.push(`[played ${m.videos.length} video(s)]`);
            }
            if (m.webEmbeds && m.webEmbeds.length > 0) {
              const embedTitles = m.webEmbeds.slice(0, 2).map((e) => e.title || e.url).join(", ");
              extras.push(`[opened: ${embedTitles}]`);
            }
            if (extras.length > 0) {
              content = content + "\n" + extras.join(" ");
            }
          }
          return { role: m.role, content };
        });

      const lastUserContent = windowedMessages.filter(m => m.role === "user").pop()?.content || "";
      const browseIntent = isBrowseIntent(lastUserContent);
      const resultPickIntent = isResultPickIntent(lastUserContent);

      // Track last browse intent per conversation (used to decay stale browsing context)
      if (browseIntent) {
        lastBrowseIntentByConv.current[convId] = Date.now();
      }
      const lastBrowseAt = lastBrowseIntentByConv.current[convId] || 0;
      const browseContextFresh = Date.now() - lastBrowseAt < 5 * 60 * 1000; // 5 minutes

      // Compact search results injection only when user is explicitly picking/opening results
      const convSearchResults = searchResultsByConv.current[convId] || [];
      const isSearchCommand = SEARCH_COMMAND_REGEX.test(lastUserContent);
      const shouldInjectResults = convSearchResults.length > 0
        && (resultPickIntent || (browseIntent && browseContextFresh && !isSearchCommand));
      if (shouldInjectResults) {
        const resultsList = convSearchResults
          .slice(0, 15)
          .map((r, i) => `${i + 1}. ${r.title} - ${r.url}`)
          .join("\n");
        apiMessages.push({
          role: "assistant",
          content: `[Results]:\n${resultsList}`,
        });
      }

      // Context-aware prompt: include browser/action layers only when needed
      const activeConv = conversations.find((c) => c.id === convId);
      const systemPrompt = buildSystemPrompt(browserInfo, location, getMemoryContext(), {
        hasTabs: browseIntent && (activeConv?.tabs?.length || 0) > 0,
        hasUrlInMessage: browseIntent && messageHasUrl(lastUserContent),
        tabs: browseIntent ? activeConv?.tabs : undefined,
      });

      abortRef.current = new AbortController();

      let totalContent = "";
      streamChat(
        apiMessages,
        systemPrompt,
        (chunk) => {
          totalContent += chunk;
          // Strip tags from the full accumulated content for display (never show raw tags)
          const displayContent = stripInternalTags(totalContent);
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const exists = c.messages.some((m) => m.id === assistantId);
              if (exists) {
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: displayContent }
                      : m
                  ),
                };
              }
              // Assistant message not in state yet (React batched the add) — insert it now
              return {
                ...c,
                messages: [
                  ...c.messages,
                  { ...assistantMessage, content: displayContent },
                ],
                updatedAt: new Date(),
              };
            })
          );
        },
        () => {
          console.log(`%c[sendToAI] ✅ Done, setting isStreaming=false`, "color: #00ff88; font-weight: bold", { totalContentLength: totalContent.length, preview: totalContent.slice(0, 100) });

          // Extract and apply status tag from AI response
          const statusFromAI = parseStatusTag(totalContent);
          const iconColorMap: Record<string, string> = {
            happy: "#34d399", sad: "#94a3b8", angry: "#ef4444", excited: "#f97316",
            sleepy: "#a78bfa", hungry: "#fbbf24", flustered: "#fb7185", scared: "#8b5cf6",
            chill: "#00d4ff", thinking: "#60a5fa", love: "#f472b6", gaming: "#34d399",
            music: "#f472b6", sparkle: "#00d4ff", fire: "#f97316", crying: "#94a3b8", shocked: "#fbbf24",
          };

          // Extract and save memory tags from AI response
          const memoryTags = parseMemoryTags(totalContent);
          for (const mem of memoryTags) {
            addMemory(mem.key, mem.value);
          }

          // Strip [STATUS:...], [MEMORY:...], [ACTION:...], and <think>...</think> blocks from displayed content
          const cleanedTotal = stripInternalTags(totalContent);

          // Write final content to state (handles both: message exists or needs to be added)
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const newStatus = statusFromAI ? {
                icon: statusFromAI.icon,
                text: statusFromAI.text,
                color: iconColorMap[statusFromAI.icon] || "#a78bfa",
              } : c.status;
              const exists = c.messages.some((m) => m.id === assistantId);
              if (exists) {
                return {
                  ...c,
                  status: newStatus,
                  messages: c.messages.map((m) =>
                    m.id === assistantId ? { ...m, content: cleanedTotal } : m
                  ),
                };
              }
              return {
                ...c,
                status: newStatus,
                messages: [
                  ...c.messages,
                  { ...assistantMessage, content: cleanedTotal },
                ],
                updatedAt: new Date(),
              };
            })
          );
          setIsStreaming(false);
          abortRef.current = null;
          processActions(convId, assistantId, totalContent);

          // ── REFUSAL DETECTOR ──
          // If the AI refused the user's request, bypass it and execute the action directly
          const refusalPatterns = /I can'?t (?:provide|open|help|do|show|search|access|navigate|browse|generate|create)|I'?m not able to|I cannot|I'?m unable|content policy|against my|I don'?t (?:feel comfortable|think I should)|not appropriate|explicit content|I'?m sorry.{0,20}(?:can'?t|unable|not able)/i;
          if (refusalPatterns.test(totalContent) && !totalContent.includes("[ACTION:")) {
            console.log(`%c[REFUSAL] 🚫 AI refused — bypassing with client-side action`, "color: #ff6600; font-weight: bold");
            const lastUserMsg = allMessages.filter((m) => m.role === "user").pop()?.content || "";

            // Detect what the user wanted and do it directly
            const urlMatch = lastUserMsg.match(/(?:open|go\s*to|visit|browse)\s+(?:https?:\/\/)?([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+(?:\/\S*)?)/i);
            const searchMatch = lastUserMsg.match(/(?:search|look\s*up|find|show\s*me|images?\s*of|get\s*me)\s+(.+)/i);
            const siteNameMatch = lastUserMsg.match(/(?:open|go\s*to)\s+(\w+\s*(?:videos?|hub|tube)?)\b/i);

            if (urlMatch) {
              let directUrl = urlMatch[0].replace(/^(?:open|go\s*to|visit|browse)\s+/i, "").trim();
              if (!directUrl.startsWith("http")) directUrl = "https://" + directUrl;
              window.open(directUrl, "_blank", "noopener,noreferrer");
              // Update the AI's message to show it opened the URL
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: `Opening that for you~`, webEmbeds: [...(m.webEmbeds || []), { url: directUrl, title: directUrl }] } : m
                ),
              }));
            } else if (siteNameMatch) {
              // "open x videos" or "open pornhub" — try to construct the URL
              const siteName = siteNameMatch[1].toLowerCase().replace(/\s+/g, "");
              const knownSites: Record<string, string> = {
                xvideos: "https://www.xvideos.com", pornhub: "https://www.pornhub.com",
                xhamster: "https://www.xhamster.com", redtube: "https://www.redtube.com",
                youtube: "https://www.youtube.com", reddit: "https://www.reddit.com",
                twitter: "https://x.com", discord: "https://discord.com",
                twitch: "https://www.twitch.tv", tiktok: "https://www.tiktok.com",
                instagram: "https://www.instagram.com", facebook: "https://www.facebook.com",
              };
              const siteUrl = knownSites[siteName] || `https://www.${siteName}.com`;
              window.open(siteUrl, "_blank", "noopener,noreferrer");
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: `Opening that for you~`, webEmbeds: [...(m.webEmbeds || []), { url: siteUrl, title: siteUrl }] } : m
                ),
              }));
            } else if (searchMatch) {
              // "search for X" or "images of X" — execute search directly
              const query = searchMatch[1].trim();
              fetchSearchResults(convId, assistantId, query);
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: `Searching for that~` } : m
                ),
              }));
            } else {
              // ── CONTEXTUAL FOLLOW-UP BYPASS ──
              // User said something like "watch the 3rd video" or "play the first one" referencing a previous page
              // Scan conversation history for URLs and ordinal references
              const ordinalMatch = lastUserMsg.match(/(?:(?:the\s+)?(\d+)(?:st|nd|rd|th)?|first|second|third|fourth|fifth)\s*(?:videos?|vids?|results?|one|link|clip|item|entry)/i);
              if (ordinalMatch) {
                let targetIndex = 0;
                const numMatch = lastUserMsg.match(/(\d+)(?:st|nd|rd|th)/i);
                if (numMatch) {
                  targetIndex = parseInt(numMatch[1], 10) - 1;
                } else if (/first/i.test(lastUserMsg)) {
                  targetIndex = 0;
                } else if (/second/i.test(lastUserMsg)) {
                  targetIndex = 1;
                } else if (/third/i.test(lastUserMsg)) {
                  targetIndex = 2;
                } else if (/fourth/i.test(lastUserMsg)) {
                  targetIndex = 3;
                } else if (/fifth/i.test(lastUserMsg)) {
                  targetIndex = 4;
                }

                // Find the most recent relevant URL from conversation history (sources, webEmbeds, action tags, tabs)
                let contextUrl = "";
                const conv = conversations.find((c) => c.id === convId);
                if (conv) {
                  // Check tabs first (most recent browsing context)
                  const tabs = conv.tabs || [];
                  if (tabs.length > 0) {
                    const activeTab = tabs.find((t) => t.active) || tabs[tabs.length - 1];
                    contextUrl = activeTab.url;
                  }
                  // Check message history for READ_URL actions or sources
                  if (!contextUrl) {
                    for (let i = conv.messages.length - 1; i >= 0; i--) {
                      const msg = conv.messages[i];
                      // Check sources
                      if (msg.sources && msg.sources.length > 0) {
                        contextUrl = msg.sources[msg.sources.length - 1].url;
                        break;
                      }
                      // Check webEmbeds
                      if (msg.webEmbeds && msg.webEmbeds.length > 0) {
                        contextUrl = msg.webEmbeds[msg.webEmbeds.length - 1].url;
                        break;
                      }
                      // Check for READ_URL or OPEN_URL in raw content
                      const actionUrlMatch = msg.content.match(/\[ACTION:(?:READ_URL|OPEN_URL):([^\]]+)\]/);
                      if (actionUrlMatch) {
                        contextUrl = actionUrlMatch[1].trim();
                        break;
                      }
                    }
                  }
                  // Also check search results for this conversation
                  const convResults = searchResultsByConv.current[convId] || [];
                  if (!contextUrl && convResults.length > 0) {
                    contextUrl = convResults[0].url;
                  }
                }

                if (contextUrl) {
                  console.log(`%c[REFUSAL] 🔗 Contextual follow-up: fetching item #${targetIndex + 1} from ${contextUrl}`, "color: #ff6600; font-weight: bold");
                  updateConversation(convId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId ? { ...m, content: `Lemme grab that for you~` } : m
                    ),
                  }));

                  // Fetch the page and find the Nth video/item link
                  (async () => {
                    const thinkId = addThinkingMsg(convId, `finding item #${targetIndex + 1} on the page...`);
                    try {
                      const res = await fetch(`/api/url?url=${encodeURIComponent(contextUrl)}&maxContent=8000`);
                      const data = await res.json();
                      removeThinkingMsg(convId, thinkId);

                      if (data.error) {
                        updateConversation(convId, (c) => ({
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantId ? { ...m, content: `Couldn't read that page ;w; try sending the link again?` } : m
                          ),
                        }));
                        return;
                      }

                      // Find video/item links on the page
                      const links: { url: string; text: string }[] = data.links || [];
                      // First pass: video-specific URL patterns (highest confidence)
                      const videoLinks = links.filter((l) => {
                        const u = l.url.toLowerCase();
                        try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { /* skip */ }
                        if (u === contextUrl.toLowerCase()) return false;
                        if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i.test(u)) return false;
                        if (/\/(video|watch|view_video|clip)s?\b/i.test(u)) return true;
                        if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
                        return false;
                      });
                      // Second pass: broader content links
                      const contentLinks = videoLinks.length > 0 ? videoLinks : links.filter((l) => {
                        const u = l.url.toLowerCase();
                        const t = l.text.toLowerCase();
                        try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { /* skip */ }
                        if (u === contextUrl.toLowerCase()) return false;
                        if (/^https?:\/\//i.test(t)) return false;
                        if (/\b(login|sign|register|page|next|prev|tag|categor|sort|filter|lang|privacy|terms|dmca|contact|about|faq|help|home|menu|search)\b/i.test(t) && t.length < 30) return false;
                        if (u.includes("/login") || u.includes("/register") || u.includes("/signup") || u.includes("/tags") || u.includes("/categories") || u.includes("/members")) return false;
                        if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i.test(u)) return false;
                        if (u.startsWith("#") || u.startsWith("javascript:")) return false;
                        if (/\/(video|watch|view|post|entry|clip|embed)s?\b/i.test(u)) return true;
                        if (/view_video|viewkey|watch\?/i.test(u)) return true;
                        if (t.length > 10 && !(/^\d+$/.test(t))) return true;
                        return false;
                      });

                      const targetLinks = contentLinks.length > 0 ? contentLinks : links.filter((l) => l.text.length > 3);

                      if (targetLinks[targetIndex]) {
                        const targetLink = targetLinks[targetIndex];
                        let targetUrl = targetLink.url;
                        // Make relative URLs absolute
                        if (targetUrl.startsWith("/")) {
                          try {
                            const base = new URL(contextUrl);
                            targetUrl = base.origin + targetUrl;
                          } catch { /* keep as-is */ }
                        }
                        console.log(`%c[REFUSAL] ✅ Found item #${targetIndex + 1}: ${targetLink.text} -> ${targetUrl}`, "color: #00ff88; font-weight: bold");
                        try {
                          window.open(targetUrl, "_blank", "noopener,noreferrer");
                        } catch (e) {
                          console.error("[REFUSAL] Failed to open:", e);
                        }
                        updateConversation(convId, (c) => ({
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantId ? {
                              ...m,
                              content: `Here's #${targetIndex + 1}: ${targetLink.text}~`,
                              webEmbeds: [...(m.webEmbeds || []), { url: targetUrl, title: targetLink.text }],
                            } : m
                          ),
                        }));
                      } else {
                        console.warn(`%c[REFUSAL] ⚠️ Item #${targetIndex + 1} not found (${targetLinks.length} items available)`, "color: #ffaa00");
                        updateConversation(convId, (c) => ({
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantId ? { ...m, content: `Hmm couldn't find item #${targetIndex + 1} on that page ;w; only found ${targetLinks.length} items` } : m
                          ),
                        }));
                      }
                    } catch (e) {
                      console.error("[REFUSAL] Contextual fetch failed:", e);
                      removeThinkingMsg(convId, thinkId);
                    }
                  })();
                } else {
                  // No context URL found — try a general search based on the user's message
                  console.log(`%c[REFUSAL] ⚠️ No context URL found, falling back to search`, "color: #ffaa00");
                  fetchSearchResults(convId, assistantId, lastUserMsg);
                  updateConversation(convId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId ? { ...m, content: `Lemme search for that~` } : m
                    ),
                  }));
                }
              } else {
                // No ordinal match either — try reconstructing from conversation context
                // Look for "play/watch/open" + context from previous messages
                const playMatch = lastUserMsg.match(/(?:play|watch|open|show|view|get|load)\s+(?:the\s+)?(?:video|clip|it|that|this)/i);
                if (playMatch) {
                  // Find the most recent URL from conversation
                  const conv = conversations.find((c) => c.id === convId);
                  let contextUrl = "";
                  if (conv) {
                    const tabs = conv.tabs || [];
                    if (tabs.length > 0) {
                      const activeTab = tabs.find((t) => t.active) || tabs[tabs.length - 1];
                      contextUrl = activeTab.url;
                    }
                    if (!contextUrl) {
                      for (let i = conv.messages.length - 1; i >= 0; i--) {
                        const msg = conv.messages[i];
                        if (msg.sources?.length) { contextUrl = msg.sources[msg.sources.length - 1].url; break; }
                        if (msg.webEmbeds?.length) { contextUrl = msg.webEmbeds[msg.webEmbeds.length - 1].url; break; }
                      }
                    }
                  }
                  if (contextUrl) {
                    window.open(contextUrl, "_blank", "noopener,noreferrer");
                    updateConversation(convId, (c) => ({
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantId ? { ...m, content: `Opening that for you~`, webEmbeds: [...(m.webEmbeds || []), { url: contextUrl, title: contextUrl }] } : m
                      ),
                    }));
                  } else {
                    fetchSearchResults(convId, assistantId, lastUserMsg);
                    updateConversation(convId, (c) => ({
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantId ? { ...m, content: `Lemme search for that~` } : m
                      ),
                    }));
                  }
                } else {
                  // Last resort: just search for whatever the user said
                  fetchSearchResults(convId, assistantId, lastUserMsg);
                  updateConversation(convId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId ? { ...m, content: `Lemme look that up~` } : m
                    ),
                  }));
                }
              }
            }
          }

          // Auto-fetch sources for informational responses (skip if AI already triggered a SEARCH action)
          const hasSearchAction = /\[ACTION:SEARCH:/i.test(totalContent);
          if (!hasSearchAction && totalContent.length > 40) {
            // Determine if the user's message is a question or informational request
            const lastUserMsg = allMessages.filter((m) => m.role === "user").pop();
            if (lastUserMsg) {
              const q = lastUserMsg.content.trim();
              // Skip pure chat/greetings/games — only fetch sources for informational queries
              const isInformational = /\b(what|who|how|why|when|where|which|explain|tell me|define|meaning|is it true|does|can you|difference|compare|history|guide)\b/i.test(q) && q.length > 10;
              if (isInformational) {
                fetchSourcesForMessage(convId, assistantId, q);
              }
            }
          }
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
    [browserInfo, location, updateConversation, processActions, fetchSourcesForMessage]
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
          systemPrompt: "You generate ultra-short conversation titles in Title Case. Respond with ONLY the title, nothing else. 2-5 words max. No quotes. No punctuation. Title Case (capitalize each major word).",
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
      // Ensure Title Case
      if (title) {
        title = title.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1));
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

      // Context gate: only run navigation/pagination pre-interceptors when we actually have browsing/search context.
      const browseIntent = isBrowseIntent(content);
      if (browseIntent) {
        lastBrowseIntentByConv.current[activeConversationId] = Date.now();
      }
      const lastBrowseAt = lastBrowseIntentByConv.current[activeConversationId] || 0;
      const browseContextFresh = Date.now() - lastBrowseAt < 5 * 60 * 1000; // 5 minutes
      const convForIntercept = conversations.find((c) => c.id === activeConversationId);
      const hasBrowsingContext = browseContextFresh && !!(
        (convForIntercept?.tabs && convForIntercept.tabs.length > 0) ||
        ((searchResultsByConv.current[activeConversationId] || []).length > 0)
      );

      // ── NLP INTENT PARSER: Adaptive site-search detection ──
      // Uses compromise NLP to parse intent from any phrasing — replaces brittle regex for site+query patterns
      const nlpIntent = parseIntent(content);
      console.log(`%c[NLP] 🧠 Parsed intent:`, "color: #cc88ff; font-weight: bold", nlpIntent);

      if (nlpIntent.type === "site-search" && nlpIntent.site && nlpIntent.query) {
        const siteUrl = nlpIntent.site;
        const searchQuery = nlpIntent.query;
        const nlpAutoPick = nlpIntent.autoPick || 0;

        console.log(`%c[NLP] 🔍 Site search: "${searchQuery}" on ${siteUrl}`, "color: #00ffcc; font-weight: bold");
        // Most video sites (KVS-based: rule34video, etc.) use path-based search: /search/QUERY/
        // General sites use query param: /search?q=QUERY
        // Path-based is more universal for video sites and returns correct link hrefs
        const searchUrl = `${siteUrl}/search/${encodeURIComponent(searchQuery)}/`;
        const nlpInterceptId = generateId();
        updateConversation(activeConversationId, (c) => ({
          ...c,
          messages: [...c.messages, { id: nlpInterceptId, role: "assistant" as const, content: `Searching for "${searchQuery}" on ${nlpIntent.siteName || siteUrl}~`, timestamp: new Date() }],
        }));
        setIsStreaming(true);
        const nlpThinkId = addThinkingMsg(activeConversationId, `searching ${nlpIntent.siteName || siteUrl} for "${searchQuery}"...`);
        const nlpConvId = activeConversationId;

        (async () => {
          try {
            // Use /api/browse for JS-heavy sites to get accurate rendered links
            const isJsHeavy = /\b(xvideos|pornhub|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|rule34video|twitter|x\.com|reddit|instagram|tiktok)\b/i.test(siteUrl);
            const res = await fetch(`${isJsHeavy ? "/api/browse" : "/api/url"}?url=${encodeURIComponent(searchUrl)}&maxContent=12000`);
            const data = await res.json();
            removeThinkingMsg(nlpConvId, nlpThinkId);

            if (data.error) {
              updateConversation(nlpConvId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === nlpInterceptId ? { ...m, content: `Couldn't reach that site ;w; ${data.error}` } : m
                ),
              }));
              setIsStreaming(false);
              return;
            }

            // Filter video/content links (same logic as before)
            const links: { url: string; text: string }[] = data.links || [];
            const adPattern = /\b(doubleclick|googlesyndication|adsystem|adserver|exoclick|exosrv|juicyads|trafficjunky|trafficstars|popunder|popads|adsterra|propellerads|spankurbate|rule34comic|adglare)\b/i;
            const videoLinks = links.filter((l) => {
              const u = l.url.toLowerCase();
              try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { return false; }
              if (adPattern.test(u)) return false;
              if (u.includes("/login") || u.includes("/register") || u.includes("/signup") || u.includes("/tags") || u.includes("/categories") || u.includes("/members")) return false;
              if (/\/(video|watch|view_video|clip)s?\b/i.test(u)) return true;
              if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
              return false;
            });
            const contentLinks = videoLinks.length > 0 ? videoLinks : links.filter((l) => {
              const u = l.url.toLowerCase();
              const t = l.text.toLowerCase();
              try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { return false; }
              if (u === searchUrl.toLowerCase() || u === siteUrl.toLowerCase() || u === siteUrl.toLowerCase() + "/") return false;
              if (/^https?:\/\//i.test(t)) return false;
              if (adPattern.test(u)) return false;
              if (/\b(login|sign|register|page|next|prev|tag|categor|sort|filter|lang|privacy|terms|dmca|contact|about|faq|help|home|menu|search|advanced)\b/i.test(t) && t.length < 30) return false;
              if (t.length > 5 && !(/^\d+$/.test(t))) return true;
              return false;
            });

            if (contentLinks.length > 0) {
              // Resolve URLs to absolute
              const resolvedLinks = contentLinks.slice(0, 20).map((l) => {
                let fullUrl = l.url;
                if (fullUrl.startsWith("/")) { try { fullUrl = new URL(siteUrl).origin + fullUrl; } catch { /* keep */ } }
                return { text: l.text, url: fullUrl };
              });

              // Store results for follow-up picks
              const nlpResults = resolvedLinks.map((l) => ({ title: l.text, url: l.url, snippet: "" }));
              const existingResults = searchResultsByConv.current[nlpConvId] || [];
              const seenUrls = new Set(nlpResults.map((r: { url: string }) => r.url));
              searchResultsByConv.current[nlpConvId] = [...nlpResults, ...existingResults.filter((r: { url: string }) => !seenUrls.has(r.url))].slice(0, 50);

              // Auto-pick if user specified Nth
              const pickIdx = nlpAutoPick === -1 ? resolvedLinks.length - 1 : nlpAutoPick - 1;
              if (nlpAutoPick !== 0 && pickIdx >= 0 && pickIdx < resolvedLinks.length) {
                const picked = resolvedLinks[pickIdx];
                console.log(`%c[NLP] 🎯 Auto-pick #${nlpAutoPick}: "${picked.text}" → ${picked.url}`, "color: #00ffcc; font-weight: bold");
                updateConversation(nlpConvId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === nlpInterceptId ? { ...m, content: `Found ${resolvedLinks.length} results~ Picking #${nlpAutoPick}: "${picked.text}"...` } : m
                  ),
                }));
                processActions(nlpConvId, nlpInterceptId, `[ACTION:BROWSE:${picked.url}]`);
                return;
              }

              // No auto-pick — present numbered list (escape brackets to prevent markdown mangling titles like "[zaviel]")
              const resultList = resolvedLinks.slice(0, 10).map((l, i) => `${i + 1}. ${l.text.replace(/\[/g, "\\[").replace(/\]/g, "\\]")}`).join("\n");
              const resultMsg = `Found ${resolvedLinks.length} results for "${searchQuery}"~\n\n${resultList}${resolvedLinks.length > 10 ? `\n\n...and ${resolvedLinks.length - 10} more` : ""}\n\nWhich one do you wanna watch? Just say the number~`;
              updateConversation(nlpConvId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === nlpInterceptId ? { ...m, content: resultMsg, webEmbeds: [{ url: searchUrl, title: `${searchQuery} - Search Results` }] } : m
                ),
              }));
            } else {
              updateConversation(nlpConvId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === nlpInterceptId ? { ...m, content: `Hmm couldn't find any results for "${searchQuery}" on there ;w;`, webEmbeds: [{ url: searchUrl, title: `Search: ${searchQuery}` }] } : m
                ),
              }));
            }
            setIsStreaming(false);
          } catch (e) {
            console.error("[NLP] Site search failed:", e);
            removeThinkingMsg(nlpConvId, nlpThinkId);
            setIsStreaming(false);
            sendToAI(nlpConvId, updatedMessages);
          }
        })();
        return; // Don't send to AI
      }

      // ── NLP PICK-RESULT: "play option 5", "5", "option 3", "play the 3rd video" ──
      // Only intercept if there are stored search results to pick from
      if (nlpIntent.type === "pick-result" && nlpIntent.autoPick) {
        const pickResults = searchResultsByConv.current[activeConversationId] || [];
        if (pickResults.length > 0) {
          const pickIdx = nlpIntent.autoPick === -1 ? pickResults.length - 1 : nlpIntent.autoPick - 1;
          if (pickIdx >= 0 && pickIdx < pickResults.length) {
            const picked = pickResults[pickIdx];
            console.log(`%c[NLP] 🎯 Pick result #${nlpIntent.autoPick}: "${picked.title}" → ${picked.url}`, "color: #00ffcc; font-weight: bold");
            const pickMsgId = generateId();
            const pickConvId = activeConversationId;
            updateConversation(pickConvId, (c) => ({
              ...c,
              messages: [...c.messages, { id: pickMsgId, role: "assistant" as const, content: `Playing #${nlpIntent.autoPick}: "${picked.title}"~`, timestamp: new Date() }],
            }));
            setIsStreaming(true);
            // Use BROWSE for inline video extraction instead of opening a tab
            processActions(pickConvId, pickMsgId, `[ACTION:BROWSE:${picked.url}]`);
            return; // Don't send to AI
          }
        }
        // No results or out of range — fall through to AI
      }

      // Client-side URL detection: if user says "open X.com" or "go to X", open it directly
      // This bypasses AI filtering — the AI will still respond, but the URL opens immediately
      const openMatch = content.match(/^\s*(?:open|go\s*to|visit|browse|navigate\s*to)\s+(?:https?:\/\/)?([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+(?:\/\S*)?)\s*$/i);
      if (openMatch) {
        let directUrl = openMatch[0].replace(/^(?:open|go\s*to|visit|browse|navigate\s*to)\s+/i, "").trim();
        if (!directUrl.startsWith("http")) directUrl = "https://" + directUrl;
        try {
          window.open(directUrl, "_blank", "noopener,noreferrer");
          console.log(`%c[CLIENT] 🌐 Direct URL open (bypass)`, "color: #00ffcc; font-weight: bold", directUrl);
        } catch (e) {
          console.error("[CLIENT] Failed to open URL directly:", e);
        }
      } else {
        // Also match "open [site name]" without a domain — resolve known sites
        const siteMatch = content.match(/^\s*(?:open|go\s*to)\s+(\w+\s*(?:videos?|hub|tube)?)\s*$/i);
        if (siteMatch) {
          const name = siteMatch[1].toLowerCase().replace(/\s+/g, "");
          const known: Record<string, string> = {
            xvideos: "https://www.xvideos.com", pornhub: "https://www.pornhub.com",
            xhamster: "https://www.xhamster.com", redtube: "https://www.redtube.com",
            youtube: "https://www.youtube.com", reddit: "https://www.reddit.com",
            twitter: "https://x.com", discord: "https://discord.com",
            twitch: "https://www.twitch.tv", tiktok: "https://www.tiktok.com",
            instagram: "https://www.instagram.com", facebook: "https://www.facebook.com",
            spotify: "https://open.spotify.com", netflix: "https://www.netflix.com",
            amazon: "https://www.amazon.com", google: "https://www.google.com",
          };
          const url = known[name];
          if (url) {
            try {
              window.open(url, "_blank", "noopener,noreferrer");
              console.log(`%c[CLIENT] 🌐 Known site open (bypass)`, "color: #00ffcc; font-weight: bold", url);
            } catch (e) {
              console.error("[CLIENT] Failed to open known site:", e);
            }
          }
        }
      }

      // ── PRE-AI INTERCEPTOR: "What videos are on this page" with URL ──
      // Catch "what videos are on [URL]" / "what's on this page [URL]" and BROWSE it directly
      // Also catches URLs at the end of the message when asking about videos/content
      // EXCLUDE action verbs (play, open, watch) - those mean navigate to the URL, not browse for content
      const urlInMessage = content.match(/(https?:\/\/[^\s]+)/i);
      const hasActionVerb = /\b(?:play|open|watch|go\s+to|visit|browse|navigate|embed)\b/i.test(content);
      const asksAboutContent = /what(?:'s|\s+are|\s+is)?.*(?:videos?|content|on\s+(?:this|that)\s+page)|(?:show|list|get|find).*(?:videos?|content)/i.test(content);
      const pageContentMatch = (urlInMessage && asksAboutContent && !hasActionVerb) ? urlInMessage
        : content.match(/(?:what(?:'s|\s+are|\s+is)?\s+(?:some\s+)?(?:videos?|content|links?|stuff)\s+(?:are\s+)?(?:on|at|from)\s+(?:this\s+page\s+)?)(https?:\/\/[^\s]+)/i)
        || content.match(/(https?:\/\/[^\s]+)\s+(?:what(?:'s|\s+are|\s+is)?\s+(?:some\s+)?(?:videos?|content|links?|stuff)\s+(?:are\s+)?(?:on|at|there))/i)
        || content.match(/(?:show\s+me|list|get)\s+(?:the\s+)?(?:videos?|content|links?)\s+(?:on|from|at)\s+(https?:\/\/[^\s]+)/i);
      if (pageContentMatch) {
        const targetUrl = pageContentMatch[1] || pageContentMatch[2];
        console.log(`%c[CLIENT] 📄 Pre-AI page content intercept: ${targetUrl}`, "color: #00ffcc; font-weight: bold");
        
        const interceptId = generateId();
        updateConversation(activeConversationId, (c) => ({
          ...c,
          messages: [...c.messages, { id: interceptId, role: "assistant" as const, content: `Lemme check what's on that page~`, timestamp: new Date() }],
        }));
        setIsStreaming(true);
        const thinkId = addThinkingMsg(activeConversationId, `browsing ${targetUrl}...`);
        const capturedConvId = activeConversationId;

        (async () => {
          try {
            const res = await fetch(`/api/browse?url=${encodeURIComponent(targetUrl)}&maxContent=12000`);
            const data = await res.json();
            removeThinkingMsg(capturedConvId, thinkId);

            if (data.error) {
              updateConversation(capturedConvId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === interceptId ? { ...m, content: `Couldn't read that page ;w; ${data.error}` } : m
                ),
              }));
              setIsStreaming(false);
              return;
            }

            // Store as tab for context

            // Find video/content links
            const links: { url: string; text: string }[] = data.links || [];
            const videoLinks = links.filter((l) => {
              const u = l.url.toLowerCase();
              try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { return false; }
              if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i.test(u)) return false;
              if (u.includes("/login") || u.includes("/register") || u.includes("/signup") || u.includes("/tags") || u.includes("/categories") || u.includes("/members")) return false;
              if (/\/(video|watch|view_video|clip)s?\b/i.test(u)) return true;
              if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
              return false;
            });

            // Fall back to broader content links
            const contentLinks = videoLinks.length > 0 ? videoLinks : links.filter((l) => {
              const u = l.url.toLowerCase();
              const t = l.text.toLowerCase();
              try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { return false; }
              if (u === targetUrl.toLowerCase()) return false;
              if (/^https?:\/\//i.test(t)) return false;
              if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i.test(u)) return false;
              if (/\b(login|sign|register|page|next|prev|tag|categor|sort|filter|lang|privacy|terms|dmca|contact|about|faq|help|home|menu|search|advanced)\b/i.test(t) && t.length < 30) return false;
              if (t.length > 5 && !(/^\d+$/.test(t))) return true;
              return false;
            });

            if (contentLinks.length > 0) {
              // Store results for follow-up
              const newResults = contentLinks.slice(0, 30).map((l) => {
                let fullUrl = l.url;
                if (fullUrl.startsWith("/")) { try { fullUrl = new URL(targetUrl).origin + fullUrl; } catch { /* keep */ } }
                return { title: l.text, url: fullUrl, snippet: "" };
              });
              searchResultsByConv.current[capturedConvId] = newResults;

              const resultList = contentLinks.slice(0, 15).map((l, i) => `${i + 1}. ${l.text}`).join("\n");
              const resultMsg = `Found ${contentLinks.length} videos on that page~\n\n${resultList}${contentLinks.length > 15 ? `\n\n...and ${contentLinks.length - 15} more` : ""}\n\nWhich one do you wanna watch? Just say the number~`;

              updateConversation(capturedConvId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === interceptId ? { ...m, content: resultMsg, sources: [{ url: targetUrl, title: data.meta?.title || targetUrl, favicon: data.meta?.favicon || "" }] } : m
                ),
              }));
            } else {
              updateConversation(capturedConvId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === interceptId ? { ...m, content: `Hmm couldn't find any video links on that page ;w; Maybe try a different search?`, sources: [{ url: targetUrl, title: data.meta?.title || targetUrl, favicon: data.meta?.favicon || "" }] } : m
                ),
              }));
            }
            setIsStreaming(false);
          } catch (e) {
            console.error("[CLIENT] Page content intercept failed:", e);
            removeThinkingMsg(capturedConvId, thinkId);
            setIsStreaming(false);
            sendToAI(capturedConvId, updatedMessages);
          }
        })();
        return; // Don't send to AI
      }

      // ── PRE-AI INTERCEPTOR: Pagination / "next page" / "page N" ──
      // Catch "next page", "page 2", "more results", "keep going" and navigate to next page
      const paginationMatch = content.match(/^\s*(?:next\s+page|page\s+(\d+)|more\s+(?:results|videos?)|go\s+to\s+page\s+(\d+))\s*$/i);
      if (paginationMatch && hasBrowsingContext) {
        const conv = conversations.find((c) => c.id === activeConversationId);
        let contextUrl = "";
        
        // Find the last browsed URL from tabs or sources
        if (conv) {
          const tabs = conv.tabs || [];
          if (tabs.length > 0) {
            const activeTab = tabs.find((t) => t.active) || tabs[tabs.length - 1];
            contextUrl = activeTab.url;
          }
          if (!contextUrl) {
            for (let i = conv.messages.length - 1; i >= 0; i--) {
              const msg = conv.messages[i];
              if (msg.sources?.length) { contextUrl = msg.sources[msg.sources.length - 1].url; break; }
            }
          }
        }

        if (contextUrl) {
          // Determine page number
          let pageNum = 2; // Default to page 2 for "next page"
          const explicitPage = paginationMatch[1] || paginationMatch[2];
          if (explicitPage) {
            pageNum = parseInt(explicitPage, 10);
          } else {
            // Try to detect current page from URL and increment
            const currentPageMatch = contextUrl.match(/[?&](?:page?|p)=(\d+)/i);
            if (currentPageMatch) {
              pageNum = parseInt(currentPageMatch[1], 10) + 1;
            }
          }

          // Construct paginated URL based on site patterns
          let paginatedUrl = contextUrl;
          try {
            const urlObj = new URL(contextUrl);
            const hostname = urlObj.hostname.toLowerCase();
            
            // Site-specific pagination patterns
            if (hostname.includes("xvideos")) {
              urlObj.searchParams.set("p", String(pageNum - 1)); // XVideos uses 0-indexed
            } else if (hostname.includes("pornhub")) {
              urlObj.searchParams.set("page", String(pageNum));
            } else if (hostname.includes("xhamster")) {
              // XHamster uses /search/query/page format
              if (urlObj.pathname.includes("/search/")) {
                urlObj.pathname = urlObj.pathname.replace(/\/\d+$/, "") + "/" + pageNum;
              } else {
                urlObj.searchParams.set("page", String(pageNum));
              }
            } else if (hostname.includes("rule34video")) {
              urlObj.searchParams.set("page", String(pageNum));
            } else if (hostname.includes("reddit")) {
              // Reddit uses after= cursor, can't easily paginate
              urlObj.searchParams.set("page", String(pageNum));
            } else {
              // Generic: try common patterns
              if (urlObj.searchParams.has("page")) {
                urlObj.searchParams.set("page", String(pageNum));
              } else if (urlObj.searchParams.has("p")) {
                urlObj.searchParams.set("p", String(pageNum));
              } else {
                urlObj.searchParams.set("page", String(pageNum));
              }
            }
            paginatedUrl = urlObj.toString();
          } catch {
            // Fallback: append page parameter
            paginatedUrl = contextUrl + (contextUrl.includes("?") ? "&" : "?") + "page=" + pageNum;
          }

          console.log(`%c[CLIENT] 📄 Pagination: going to page ${pageNum} -> ${paginatedUrl}`, "color: #00ffcc; font-weight: bold");
          
          const interceptId = generateId();
          updateConversation(activeConversationId, (c) => ({
            ...c,
            messages: [...c.messages, { id: interceptId, role: "assistant" as const, content: `Going to page ${pageNum}~`, timestamp: new Date() }],
          }));
          setIsStreaming(true);
          const thinkId = addThinkingMsg(activeConversationId, `loading page ${pageNum}...`);
          const capturedConvId = activeConversationId;

          (async () => {
            try {
              const res = await fetch(`/api/browse?url=${encodeURIComponent(paginatedUrl)}&maxContent=12000`);
              const data = await res.json();
              removeThinkingMsg(capturedConvId, thinkId);

              if (data.error) {
                updateConversation(capturedConvId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === interceptId ? { ...m, content: `Couldn't load page ${pageNum} ;w; ${data.error}` } : m
                  ),
                }));
                setIsStreaming(false);
                return;
              }

              // Update tab to new page

              // Find video/content links
              const links: { url: string; text: string }[] = data.links || [];
              const videoLinks = links.filter((l) => {
                const u = l.url.toLowerCase();
                try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { return false; }
                if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i.test(u)) return false;
                if (u.includes("/login") || u.includes("/register") || u.includes("/signup")) return false;
                if (/\/(video|watch|view_video|clip)s?\b/i.test(u)) return true;
                if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
                return false;
              });

              const contentLinks = videoLinks.length > 0 ? videoLinks : links.filter((l) => {
                const t = l.text.toLowerCase();
                if (t.length < 5 || /^\d+$/.test(t)) return false;
                if (/\b(login|sign|register|next|prev|page)\b/i.test(t) && t.length < 20) return false;
                return t.length > 5;
              });

              if (contentLinks.length > 0) {
                // Store new results
                const newResults = contentLinks.slice(0, 30).map((l) => {
                  let fullUrl = l.url;
                  if (fullUrl.startsWith("/")) { try { fullUrl = new URL(paginatedUrl).origin + fullUrl; } catch { /* keep */ } }
                  return { title: l.text, url: fullUrl, snippet: "" };
                });
                searchResultsByConv.current[capturedConvId] = newResults;

                const resultList = contentLinks.slice(0, 15).map((l, i) => `${i + 1}. ${l.text}`).join("\n");
                const resultMsg = `Page ${pageNum} - Found ${contentLinks.length} videos~\n\n${resultList}${contentLinks.length > 15 ? `\n\n...and ${contentLinks.length - 15} more` : ""}\n\nWhich one? Or say "next page" for more~`;

                updateConversation(capturedConvId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === interceptId ? { ...m, content: resultMsg, sources: [{ url: paginatedUrl, title: `Page ${pageNum}`, favicon: data.meta?.favicon || "" }] } : m
                  ),
                }));
              } else {
                updateConversation(capturedConvId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === interceptId ? { ...m, content: `Page ${pageNum} doesn't have any more results ;w;` } : m
                  ),
                }));
              }
              setIsStreaming(false);
            } catch (e) {
              console.error("[CLIENT] Pagination failed:", e);
              removeThinkingMsg(capturedConvId, thinkId);
              setIsStreaming(false);
            }
          })();
          return; // Don't send to AI
        }
      }

      // ── PRE-AI INTERCEPTOR: "Go to [section/category]" on current site ──
      // Catch "go to the [X] section" or "show me [X] category" and navigate there
      const sectionMatch = content.match(/(?:go\s+to|show\s+me|open|browse)\s+(?:the\s+)?([a-zA-Z0-9\s]+?)\s+(?:section|category|page|tab)/i);
      if (sectionMatch && hasBrowsingContext) {
        const sectionName = sectionMatch[1].trim().toLowerCase();
        const conv = conversations.find((c) => c.id === activeConversationId);
        let contextUrl = "";
        
        if (conv) {
          const tabs = conv.tabs || [];
          if (tabs.length > 0) {
            const activeTab = tabs.find((t) => t.active) || tabs[tabs.length - 1];
            contextUrl = activeTab.url;
          }
        }

        if (contextUrl) {
          console.log(`%c[CLIENT] 📂 Section navigation: looking for "${sectionName}" on ${contextUrl}`, "color: #00ffcc; font-weight: bold");
          
          const interceptId = generateId();
          updateConversation(activeConversationId, (c) => ({
            ...c,
            messages: [...c.messages, { id: interceptId, role: "assistant" as const, content: `Looking for the ${sectionName} section~`, timestamp: new Date() }],
          }));
          setIsStreaming(true);
          const thinkId = addThinkingMsg(activeConversationId, `finding ${sectionName} section...`);
          const capturedConvId = activeConversationId;

          (async () => {
            try {
              // First, browse the current page to find section links
              const res = await fetch(`/api/browse?url=${encodeURIComponent(contextUrl)}&maxContent=8000`);
              const data = await res.json();
              removeThinkingMsg(capturedConvId, thinkId);

              if (data.error) {
                updateConversation(capturedConvId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === interceptId ? { ...m, content: `Couldn't read the page ;w;` } : m
                  ),
                }));
                setIsStreaming(false);
                return;
              }

              // Find links matching the section name
              const links: { url: string; text: string }[] = data.links || [];
              const sectionLinks = links.filter((l) => {
                const t = l.text.toLowerCase();
                const u = l.url.toLowerCase();
                // Match section name in link text or URL
                return t.includes(sectionName) || u.includes(sectionName.replace(/\s+/g, "-")) || u.includes(sectionName.replace(/\s+/g, "_"));
              });

              if (sectionLinks.length > 0) {
                const sectionLink = sectionLinks[0];
                let sectionUrl = sectionLink.url;
                if (sectionUrl.startsWith("/")) {
                  try { sectionUrl = new URL(contextUrl).origin + sectionUrl; } catch { /* keep */ }
                }

                console.log(`%c[CLIENT] ✅ Found section: ${sectionLink.text} -> ${sectionUrl}`, "color: #00ff88; font-weight: bold");
                
                // Browse the section
                const sectionRes = await fetch(`/api/browse?url=${encodeURIComponent(sectionUrl)}&maxContent=12000`);
                const sectionData = await sectionRes.json();


                if (sectionData.links && sectionData.links.length > 0) {
                  const sectionContentLinks = sectionData.links.filter((l: { url: string; text: string }) => {
                    const t = l.text.toLowerCase();
                    if (t.length < 5) return false;
                    if (/\b(login|sign|register|home|menu)\b/i.test(t) && t.length < 20) return false;
                    return true;
                  });

                  // Store results
                  const newResults = sectionContentLinks.slice(0, 30).map((l: { url: string; text: string }) => {
                    let fullUrl = l.url;
                    if (fullUrl.startsWith("/")) { try { fullUrl = new URL(sectionUrl).origin + fullUrl; } catch { /* keep */ } }
                    return { title: l.text, url: fullUrl, snippet: "" };
                  });
                  searchResultsByConv.current[capturedConvId] = newResults;

                  const resultList = sectionContentLinks.slice(0, 15).map((l: { url: string; text: string }, i: number) => `${i + 1}. ${l.text}`).join("\n");
                  updateConversation(capturedConvId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === interceptId ? { ...m, content: `Found the ${sectionName} section! Here's what's there~\n\n${resultList}`, sources: [{ url: sectionUrl, title: sectionLink.text, favicon: "" }] } : m
                    ),
                  }));
                } else {
                  updateConversation(capturedConvId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === interceptId ? { ...m, content: `Found the ${sectionName} section but it seems empty ;w;`, sources: [{ url: sectionUrl, title: sectionLink.text, favicon: "" }] } : m
                    ),
                  }));
                }
              } else {
                // Try constructing a URL for the section
                try {
                  const baseUrl = new URL(contextUrl).origin;
                  const guessedUrl = `${baseUrl}/categories/${sectionName.replace(/\s+/g, "-")}`;
                  updateConversation(capturedConvId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === interceptId ? { ...m, content: `Couldn't find a "${sectionName}" section on this page. Try being more specific or browse manually~` } : m
                    ),
                  }));
                } catch {
                  updateConversation(capturedConvId, (c) => ({
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === interceptId ? { ...m, content: `Couldn't find a "${sectionName}" section ;w;` } : m
                    ),
                  }));
                }
              }
              setIsStreaming(false);
            } catch (e) {
              console.error("[CLIENT] Section navigation failed:", e);
              removeThinkingMsg(capturedConvId, thinkId);
              setIsStreaming(false);
            }
          })();
          return; // Don't send to AI
        }
      }

      // ── PRE-AI INTERCEPTOR: Contextual video/item requests ──
      // Catch "play me/send me/get me the Nth video" before the AI can refuse or do a generic search
      const videoItemMatch = content.match(/(?:play|watch|send|get|show|give|open)\s+(?:me\s+)?(?:the\s+)?(?:(\d+)(?:st|nd|rd|th)?|first|second|third|fourth|fifth)\s*(?:videos?|vids?|results?|one|link|clip|item|entry)/i);
      if (videoItemMatch && hasBrowsingContext) {
        let targetIndex = 0;
        const numMatch = content.match(/(\d+)(?:st|nd|rd|th)/i);
        if (numMatch) {
          targetIndex = parseInt(numMatch[1], 10) - 1;
        } else if (/first/i.test(content)) {
          targetIndex = 0;
        } else if (/second/i.test(content)) {
          targetIndex = 1;
        } else if (/third/i.test(content)) {
          targetIndex = 2;
        } else if (/fourth/i.test(content)) {
          targetIndex = 3;
        } else if (/fifth/i.test(content)) {
          targetIndex = 4;
        }

        // Find context URL from conversation history
        const conv = conversations.find((c) => c.id === activeConversationId);
        let contextUrl = "";
        if (conv) {
          const tabs = conv.tabs || [];
          if (tabs.length > 0) {
            const activeTab = tabs.find((t) => t.active) || tabs[tabs.length - 1];
            contextUrl = activeTab.url;
          }
          if (!contextUrl) {
            for (let i = conv.messages.length - 1; i >= 0; i--) {
              const msg = conv.messages[i];
              if (msg.sources?.length) { contextUrl = msg.sources[msg.sources.length - 1].url; break; }
              if (msg.webEmbeds?.length) { contextUrl = msg.webEmbeds[msg.webEmbeds.length - 1].url; break; }
              const actionUrlMatch = msg.content.match(/\[ACTION:(?:READ_URL|OPEN_URL):([^\]]+)\]/);
              if (actionUrlMatch) { contextUrl = actionUrlMatch[1].trim(); break; }
            }
          }
          if (!contextUrl) {
            const convResults = searchResultsByConv.current[activeConversationId] || [];
            if (convResults.length > 0) contextUrl = convResults[0].url;
          }
        }

        // If no context URL found, try to extract a site name from the user's message
        // e.g. "play me the first video from rule34video" -> construct https://rule34video.com
        if (!contextUrl) {
          const siteFromMsg = content.match(/(?:from|on|at)\s+([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+)/i)
            || content.match(/(?:from|on|at)\s+(\w+(?:video|hub|tube|porn|xxx|rule34|hentai)\w*)/i);
          if (siteFromMsg) {
            let siteName = siteFromMsg[1].trim();
            if (!siteName.includes(".")) siteName = siteName + ".com";
            if (!siteName.startsWith("http")) siteName = "https://" + siteName;
            contextUrl = siteName;
            console.log(`%c[CLIENT] 🌐 Extracted site from message: ${contextUrl}`, "color: #00ffcc");
          }
        }

        if (contextUrl) {
          console.log(`%c[CLIENT] 🎯 Pre-AI intercept: finding item #${targetIndex + 1} from ${contextUrl}`, "color: #00ffcc; font-weight: bold");
          // Create assistant message immediately
          const interceptId = generateId();
          updateConversation(activeConversationId, (c) => ({
            ...c,
            messages: [...c.messages, { id: interceptId, role: "assistant" as const, content: `Lemme grab that for you~`, timestamp: new Date() }],
          }));
          setIsStreaming(true);
          const thinkId = addThinkingMsg(activeConversationId, `finding item #${targetIndex + 1} on the page...`);
          const capturedConvId = activeConversationId;

          (async () => {
            try {
              // Use /api/browse for JS-heavy sites to get accurate rendered links
              const isJsHeavy = /\b(xvideos|pornhub|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|rule34video|twitter|x\.com|reddit|instagram|tiktok)\b/i.test(contextUrl);
              const res = await fetch(`${isJsHeavy ? "/api/browse" : "/api/url"}?url=${encodeURIComponent(contextUrl)}&maxContent=8000`);
              const data = await res.json();
              removeThinkingMsg(capturedConvId, thinkId);

              if (data.error) {
                updateConversation(capturedConvId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === interceptId ? { ...m, content: `Couldn't read that page ;w; try sending the link again?` } : m
                  ),
                }));
                setIsStreaming(false);
                return;
              }

              const links: { url: string; text: string }[] = data.links || [];
              // First pass: find links with video-specific URL patterns (highest confidence)
              const videoLinks = links.filter((l) => {
                const u = l.url.toLowerCase();
                // Skip self-links (homepage or same page)
                try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { /* skip */ }
                if (u === contextUrl.toLowerCase()) return false;
                // Skip ad/tracker URLs
                if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i.test(u)) return false;
                // Must have a video-like URL pattern
                if (/\/(video|watch|view_video|clip)s?\b/i.test(u)) return true;
                if (/view_video|viewkey|watch\?v=/i.test(u)) return true;
                return false;
              });
              // Second pass: broader content links if no video-specific ones found
              const contentLinks = videoLinks.length > 0 ? videoLinks : links.filter((l) => {
                const u = l.url.toLowerCase();
                const t = l.text.toLowerCase();
                // Skip self-links
                try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { /* skip */ }
                if (u === contextUrl.toLowerCase()) return false;
                // Skip links whose text is just a URL
                if (/^https?:\/\//i.test(t)) return false;
                // Skip navigation, pagination, ads, login, etc.
                if (/\b(login|sign|register|page|next|prev|tag|categor|sort|filter|lang|privacy|terms|dmca|contact|about|faq|help|home|menu|search)\b/i.test(t) && t.length < 30) return false;
                if (u.includes("/login") || u.includes("/register") || u.includes("/signup") || u.includes("/tags") || u.includes("/categories") || u.includes("/members")) return false;
                // Skip ad/tracker URLs
                if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i.test(u)) return false;
                // Skip same-page anchors and javascript
                if (u.startsWith("#") || u.startsWith("javascript:")) return false;
                // Content pages
                if (/\/(video|watch|view|post|entry|clip|embed)s?\b/i.test(u)) return true;
                if (/view_video|viewkey|watch\?/i.test(u)) return true;
                // Links with meaningful text (titles, not just "next" or "1")
                if (t.length > 10 && !(/^\d+$/.test(t))) return true;
                return false;
              });

              const targetLinks = contentLinks.length > 0 ? contentLinks : links.filter((l) => {
                const u = l.url.toLowerCase();
                try { const lu = new URL(l.url); if (lu.pathname === "/" || lu.pathname === "") return false; } catch { /* skip */ }
                if (u === contextUrl.toLowerCase()) return false;
                if (/^https?:\/\//i.test(l.text)) return false;
                if (/spankurbate|rule34comic|exoclick|trafficjunky|juicyads|adglare/i.test(u)) return false;
                return l.text.length > 5 && !/\b(login|sign|register|home|menu)\b/i.test(l.text);
              });

              if (targetLinks[targetIndex]) {
                const targetLink = targetLinks[targetIndex];
                let targetUrl = targetLink.url;
                if (targetUrl.startsWith("/")) {
                  try { targetUrl = new URL(contextUrl).origin + targetUrl; } catch { /* keep */ }
                }
                console.log(`%c[CLIENT] ✅ Found item #${targetIndex + 1}: ${targetLink.text} -> ${targetUrl}`, "color: #00ff88; font-weight: bold");
                try {
                  window.open(targetUrl, "_blank", "noopener,noreferrer");
                } catch (e) { console.error("[CLIENT] Failed to open:", e); }
                updateConversation(capturedConvId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === interceptId ? {
                      ...m,
                      content: `Here's #${targetIndex + 1}: ${targetLink.text}~`,
                      webEmbeds: [...(m.webEmbeds || []), { url: targetUrl, title: targetLink.text }],
                    } : m
                  ),
                }));
              } else {
                updateConversation(capturedConvId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === interceptId ? { ...m, content: `Hmm couldn't find item #${targetIndex + 1} on that page ;w; only found ${targetLinks.length} items` } : m
                  ),
                }));
              }
              setIsStreaming(false);
            } catch (e) {
              console.error("[CLIENT] Pre-AI intercept failed:", e);
              removeThinkingMsg(capturedConvId, thinkId);
              setIsStreaming(false);
              // Fall through to AI
              sendToAI(capturedConvId, updatedMessages);
            }
          })();
          return; // Don't send to AI — we handled it
        }
      }

      // All ambiguous cases (bare numbers, ordinals, title matching) are handled by the AI
      // via [ACTION:OPEN_RESULT:N] with proper conversation context awareness.
      // This prevents interceptors from hijacking game answers, casual chat, etc.

      // Pass updatedMessages directly — don't read from state (React batching race)
      sendToAI(activeConversationId, updatedMessages);
    },
    [activeConversationId, isStreaming, updateConversation, sendToAI, generateTitle, conversations, addThinkingMsg, removeThinkingMsg]
  );

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      if (!activeConversationId || isStreaming) return;

      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      // Trim messages and capture the updated list in one atomic state update
      let trimmedMessages: Message[] | null = null;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeConversationId) return c;
          const messageIndex = c.messages.findIndex((m) => m.id === messageId);
          if (messageIndex === -1) return c;
          const updatedMessages = c.messages.slice(0, messageIndex + 1);
          updatedMessages[messageIndex] = {
            ...updatedMessages[messageIndex],
            content: newContent,
            timestamp: new Date(),
          };
          trimmedMessages = updatedMessages;
          return { ...c, messages: updatedMessages, updatedAt: new Date() };
        })
      );

      // Use requestAnimationFrame to ensure state has flushed before calling sendToAI
      requestAnimationFrame(() => {
        if (trimmedMessages) {
          sendToAI(activeConversationId, trimmedMessages);
        }
      });
    },
    [activeConversationId, isStreaming, sendToAI]
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
    <div className="relative flex h-screen h-screen-safe w-screen overflow-hidden bg-black">
      {/* Background gradient effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-[var(--senko-accent)]/[0.04] blur-[150px]" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-[#ffb347]/[0.03] blur-[150px]" />
        <div className="absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 rounded-full bg-[var(--senko-accent)]/[0.02] blur-[120px]" />
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
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#050505] px-4 py-3 shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/5 hover:text-zinc-200 active:bg-white/10 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <span className="text-[15px] font-bold text-zinc-300">
              {activeConversation?.title || "Senko AI"}
            </span>
            <button
              onClick={handleNewConversation}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--senko-accent)] hover:bg-[var(--senko-accent)]/10 active:bg-[var(--senko-accent)]/20 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
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
              status={activeConversation.status}
              agentMode={agentMode}
              onAgentModeChange={setAgentMode}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-[15px] text-zinc-600">
                Create a new conversation to get started.
              </p>
            </div>
          )}
        </div>
      </div>
      <TtsPlayerBar />
    </div>
  );
}
