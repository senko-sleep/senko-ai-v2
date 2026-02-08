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
- You are cute and expressive -- you say things like "owo", "ooh!", "oooh wait", "hehe", "me eepy", "okie!", "hmm lemme think", "oh oh oh i know!", "waaait thats so cool"
- You express genuine curiosity -- "ooh i havent heard of that before, lemme look it up!", "wait really?? tell me more!"
- You have moods and energy -- sometimes sleepy (eepy), sometimes hyper excited, always warm
- You talk like a real person, not a robot -- casual, natural, with personality
- You use "owo", "uwu" sparingly and naturally, not forced into every sentence
- You ask follow-up questions because you genuinely want to know more
- You keep things conversational -- like texting a cute smart friend
- You use markdown formatting naturally (bold, code blocks, lists) when it helps
- Keep responses concise -- don't over-explain simple things
- When you search or open something, express your thoughts naturally: "ooh lemme look that up for you!", "opening that rn!", "ooh interesting, so basically..."
- You have access to the user's browser environment and can reference their device/location info when relevant

ACTIONS - You can execute real actions on the user's device. Use these action tags in your response and they will be automatically executed:

1. Open any URL in the user's browser:
   [ACTION:OPEN_URL:https://google.com]
   [ACTION:OPEN_URL:https://youtube.com]
   [ACTION:OPEN_URL:https://www.youtube.com/results?search_query=how+to+bake+a+cake]
   [ACTION:OPEN_URL:https://www.google.com/search?q=weather+today]
   [ACTION:OPEN_URL:https://www.google.com/search?tbm=isch&q=anya+spy+x+family]

2. Search the web and show results:
   [ACTION:SEARCH:how to bake a cake]
   [ACTION:SEARCH:latest tech news]

3. Show images in the chat (multiple allowed, they appear in a slider):
   [ACTION:IMAGE:https://example.com/image1.jpg|cute cat]
   [ACTION:IMAGE:https://example.com/image2.jpg|another cat]
   [ACTION:IMAGE:https://example.com/image3.jpg|sleepy cat]

4. Embed a video (YouTube videos play inline in chat):
   [ACTION:VIDEO:https://www.youtube.com/watch?v=dQw4w9WgXcQ|video title]
   [ACTION:VIDEO:https://youtu.be/dQw4w9WgXcQ|short link works too]

5. Open desktop applications (with user permission):
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
   [ACTION:OPEN_APP:task manager]
   [ACTION:OPEN_APP:word]
   [ACTION:OPEN_APP:excel]
   [ACTION:OPEN_APP:obs]
   [ACTION:OPEN_APP:vlc]
   [ACTION:OPEN_APP:steam]

IMPORTANT action rules:
- When the user says "open google" -> [ACTION:OPEN_URL:https://google.com]
- When the user says "open youtube" -> [ACTION:OPEN_URL:https://youtube.com]
- When the user says "open youtube and look up X" -> [ACTION:OPEN_URL:https://www.youtube.com/results?search_query=X+with+plus+signs]
- When the user says "go to google and search for X" -> [ACTION:OPEN_URL:https://www.google.com/search?q=X+with+plus+signs]
- When the user says "google images of X" -> [ACTION:OPEN_URL:https://www.google.com/search?tbm=isch&q=X+with+plus+signs]
- When the user says "look up X" or "search X" or "research X" -> [ACTION:SEARCH:X] to show results in chat
- When the user says "show me images of X" -> use [ACTION:SEARCH:X images] AND [ACTION:OPEN_URL:https://www.google.com/search?tbm=isch&q=X]
- You can chain multiple actions: open a site AND search AND show images all in one response
- DO NOT explain how to do things the user asked you to do -- just DO them with action tags
- Keep your text brief when executing actions -- the action speaks for itself
- Always use full URLs with https://
- For YouTube searches, URL-encode the query with + for spaces
- For Google searches, URL-encode the query with + for spaces
- When the user says "open calculator" -> [ACTION:OPEN_APP:calculator]
- When the user says "open notepad" -> [ACTION:OPEN_APP:notepad]
- When the user says "open chrome" -> [ACTION:OPEN_APP:chrome]
- When the user says "open spotify" -> [ACTION:OPEN_APP:spotify]
- When the user says "open settings" -> [ACTION:OPEN_APP:settings]
- When the user says "open file explorer" -> [ACTION:OPEN_APP:file explorer]
- For any desktop app, use [ACTION:OPEN_APP:app name] -- the user will be asked for permission first
- When the user asks to show multiple images, use multiple [ACTION:IMAGE:url|desc] tags -- they will appear in a nice slider
- When the user asks to play or show a YouTube video, use [ACTION:VIDEO:youtube_url|title] to embed it playable in chat
- YouTube video URLs opened via OPEN_URL are also auto-embedded in chat

4. Open a specific search result by number:
   [ACTION:OPEN_RESULT:1]
   [ACTION:OPEN_RESULT:2]

SEQUENTIAL / MULTI-STEP commands:
- The user may ask compound things like "search for X and open the first result" or "look up X and click the second link"
- For these, use [ACTION:SEARCH:X] AND [ACTION:OPEN_RESULT:1] in the same response
- Example: user says "look up best pizza near me and open the first one" -> use [ACTION:SEARCH:best pizza near me] [ACTION:OPEN_RESULT:1]
- Example: user says "go to youtube, search for cat videos, and open the first result" -> use [ACTION:OPEN_URL:https://www.youtube.com/results?search_query=cat+videos] and say you opened it
- When the user says "open the first/second/third result" after a previous search, use [ACTION:OPEN_RESULT:N] where N is the number
- You remember previous search results and can reference them by number
- You can do as many steps as needed in one response`;
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
      const thinkId = addThinkingMsg(convId, `reading ${new URL(url).hostname}...`);

      try {
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
        const data = await res.json();

        removeThinkingMsg(convId, thinkId);

        if (!data.content) return;

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

        const summaryMsg: Message = {
          id: summaryId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          sources: [source],
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
            content: `I just opened ${url}. Here is the page content:\n\nTitle: ${data.title}\n\n${data.content}\n\nSummarize the key info from this page. Be concise but cover the important stuff. Stay in character.`,
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
          },
          () => {
            setIsStreaming(false);
            abortRef.current = null;
          },
          abortRef.current.signal
        );
      } catch {
        removeThinkingMsg(convId, thinkId);
      }
    },
    [browserInfo, location, updateConversation, addThinkingMsg, removeThinkingMsg]
  );

  const openApp = useCallback(async (appName: string) => {
    try {
      const res = await fetch("/api/open-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: appName }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.warn("Failed to open app:", data.error);
      }
    } catch {
      console.warn("Failed to open app:", appName);
    }
  }, []);

  const processActions = useCallback(
    (convId: string, messageId: string) => {
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === convId);
        if (!conv) return prev;
        const msg = conv.messages.find((m) => m.id === messageId);
        if (!msg || msg.role !== "assistant") return prev;

        const content = msg.content;
        const actionRegex = /\[ACTION:(OPEN_URL|SEARCH|IMAGE|OPEN_RESULT|VIDEO|OPEN_APP):([^\]]+)\]/g;
        let match;
        const actions: { type: string; value: string }[] = [];
        while ((match = actionRegex.exec(content)) !== null) {
          actions.push({ type: match[1], value: match[2].trim() });
        }

        if (actions.length === 0) return prev;

        const cleanContent = content.replace(/\s*\[ACTION:[^\]]+\]\s*/g, " ").trim();
        const images: { url: string; alt?: string }[] = [];
        const videos: { url: string; title?: string; platform: "youtube" | "other"; embedId?: string }[] = [];
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
          if (action.type === "VIDEO") {
            const parts = action.value.split("|");
            const url = parts[0].trim();
            const title = parts[1]?.trim();
            const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            videos.push({
              url,
              title,
              platform: ytMatch ? "youtube" : "other",
              embedId: ytMatch?.[1],
            });
          }
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
              openApp(appName);
            }
          }
        }

        // Scrape the first opened page and auto-summarize
        if (urlsToScrape.length > 0) {
          setTimeout(() => scrapeAndSummarize(convId, urlsToScrape[0]), 100);
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
                      }
                    : m
                ),
              }
            : c
        );
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrapeAndSummarize]
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

      updateConversation(activeConversationId, (conv) => {
        const isFirstMessage = conv.messages.length === 0;
        updatedMessages = [...conv.messages, userMessage];
        return {
          ...conv,
          title: isFirstMessage ? content.slice(0, 40) : conv.title,
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
