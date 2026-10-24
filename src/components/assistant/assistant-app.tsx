"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Cpu, Globe, KeyRound, Loader2, MessageSquare, PanelLeftOpen, SquarePen } from "lucide-react";
import { extractOpenTags, parseBrowserCommand } from "@/lib/browser-commands";
import { MessageBubble } from "./message-bubble";
import { BrowserPanel, type BrowserState } from "./browser-panel";
import type { PageOp } from "./reader-view";
import { Composer, type Attachment } from "./composer";
import { Sidebar } from "./sidebar";
import { SettingsDialog, type Theme } from "./settings-dialog";
import { Welcome } from "./welcome";
import { FoxMark } from "./fox-mark";
import { createLiveBus } from "./live-view";
import { createInputChannel, deliverInputBatch, InputTransportError, INPUT_PROTOCOL_VERSION, type BrowserInput } from "@/lib/live-input";
import * as API from "./api";
import {
  errorFromResponse,
  fromStored,
  networkError,
  readSSE,
  stripLiveTags,
  uid,
  type AgentStep,
  type ChatSummary,
  type Mode,
  type Msg,
  type ProviderInfo,
  type StoredMessage,
  type Suggestion,
} from "./lib";

const EMPTY_BROWSER: BrowserState = { running: false, status: "", url: "", title: "", plan: [], steps: [], outcome: "idle" };
const THEME_KEY = "senko.theme";
const SUGGEST_CACHE = "senko.suggestions.v1";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

/** Open a URL in a new tab. Returns null if the browser blocked it. */
function openTab(url: string): Window | null {
  const win = window.open(url, "_blank");
  if (win) {
    try {
      win.opener = null;
    } catch {
      /* cross-origin already */
    }
  }
  return win;
}

function chatFromHash(): string | null {
  const m = /^#c=([\w-]{3,64})$/.exec(window.location.hash);
  return m ? m[1] : null;
}
function setHash(id: string | null) {
  const url = `${window.location.pathname}${window.location.search}${id ? `#c=${id}` : ""}`;
  window.history.replaceState(null, "", url);
}

export default function AssistantApp() {
  // ---- connection + data ---------------------------------------------------
  const [conn, setConn] = useState<"connecting" | "ready" | "needs-key" | "error">("connecting");
  const [connError, setConnError] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // ---- preferences -------------------------------------------------------
  const [mode, setMode] = useState<Mode>("chat");
  const [provider, setProvider] = useState("auto");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [personalized, setPersonalized] = useState(true);
  const [theme, setTheme] = useState<Theme>("dark");

  // ---- UI ----------------------------------------------------------------
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [browser, setBrowser] = useState<BrowserState>(EMPTY_BROWSER);
  const [panelOpen, setPanelOpen] = useState(false);
  const [, setSessionAvailable] = useState(false);
  const [browserOpening, setBrowserOpening] = useState(false);
  /** You're driving the agent's browser (takeover). */
  const [controlling, setControlling] = useState(false);
  /** The agent paused because you took control mid-task; "Hand back" continues it. */
  const [paused, setPaused] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ---- suggestions -------------------------------------------------------
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [sugError, setSugError] = useState<string | null>(null);
  const [usedHistory, setUsedHistory] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const agentChatRef = useRef<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const streamRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<Msg[]>([]);
  const activeRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  const patch = useCallback((id: string, fn: (m: Msg) => Msg) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  // ---- boot ----------------------------------------------------------------
  const refreshChats = useCallback(async () => {
    try {
      setChats(await API.listChats());
    } catch {
      /* keep what we have */
    } finally {
      setChatsLoading(false);
    }
  }, []);

  const boot = useCallback(
    async (key?: string) => {
      setConnError(null);
      try {
        const state = await API.connect(key);
        if (state === "needs-key") {
          setConn("needs-key");
          return;
        }
        setConn("ready");
        const [settings] = await Promise.all([API.getSettings().catch(() => ({}) as API.Settings), refreshChats()]);
        if (settings.personalizedSuggestions === false) setPersonalized(false);
        if (settings.provider) setProvider(settings.provider);
        if (settings.mode === "agent" || settings.mode === "chat") setMode(settings.mode);
        const fromHash = chatFromHash();
        if (fromHash) void openChat(fromHash);
      } catch (e) {
        if (key) {
          setConn("needs-key");
          setConnError(e instanceof Error ? e.message : String(e));
        } else {
          setConn("error");
          setConnError(networkError(e));
        }
      }
    },
    // openChat is stable enough (defined below with useCallback and no changing deps that matter on boot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshChats]
  );

  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark" || t === "system") setTheme(t);
    } catch {
      /* default: pitch black dark */
    }
    if (window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(true);
    void boot();
    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((j) => setProviders(j.providers || []))
      .catch(() => setProviders([]));
  }, [boot]);

  // ---- theme -----------------------------------------------------------------
  const applyTheme = (t: Theme) => {
    setTheme(t);
    try {
      localStorage.setItem(THEME_KEY, t); // raw value, read by the pre-paint script in layout
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = t;
  };

  // ---- preferences that sync across devices -----------------------------------
  const changeMode = (m: Mode) => {
    setMode(m);
    API.saveSettings({ mode: m }).catch(() => {});
  };
  const changeProvider = (p: string) => {
    setProvider(p);
    API.saveSettings({ provider: p }).catch(() => {});
  };
  const changePersonalized = (v: boolean) => {
    setPersonalized(v);
    setSuggestions([]);
    API.saveSettings({ personalizedSuggestions: v })
      .then(() => loadSuggestions(false, v))
      .catch((e) => setSugError(networkError(e)));
  };

  // ---- suggestions -------------------------------------------------------------
  const sugAbort = useRef<AbortController | null>(null);
  const loadSuggestions = useCallback(
    async (refresh: boolean, p = personalized, m = mode) => {
      sugAbort.current?.abort();
      const ctl = new AbortController();
      sugAbort.current = ctl;
      const cacheKey = `${m}.${p ? "p" : "g"}`;
      if (!refresh) {
        const cached = readLocal<Record<string, Suggestion[]>>(SUGGEST_CACHE, {})[cacheKey];
        if (cached?.length) setSuggestions(cached);
      }
      setSugLoading(true);
      setSugError(null);
      try {
        const r = await API.getSuggestions(m, refresh, ctl.signal);
        if (ctl.signal.aborted) return;
        setSuggestions(r.suggestions);
        setPersonalized(r.personalized);
        setUsedHistory(r.usedHistory);
        writeLocal(SUGGEST_CACHE, { ...readLocal<Record<string, Suggestion[]>>(SUGGEST_CACHE, {}), [cacheKey]: r.suggestions });
      } catch (e) {
        if (!ctl.signal.aborted) setSugError(`Couldn't load suggestions. ${networkError(e)}`);
      } finally {
        if (sugAbort.current === ctl) setSugLoading(false);
      }
    },
    [personalized, mode]
  );

  // Set after you chat, so the next welcome screen gets fresh ideas that reflect it.
  const chattedSinceSuggest = useRef(false);
  const isEmpty = messages.length === 0 && !chatLoading;
  useEffect(() => {
    if (conn !== "ready" || !isEmpty) return;
    const refresh = chattedSinceSuggest.current && personalized;
    chattedSinceSuggest.current = false;
    void loadSuggestions(refresh, personalized, mode);
    // Only re-run when the welcome screen appears or the mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, isEmpty, mode]);

  // ---- live browser stream (frames + current page) -------------------------
  const [liveBus] = useState(createLiveBus);
  const inputEpoch = useRef<number | undefined>(undefined);
  const inputControl = useRef<number | undefined>(undefined);
  const inputSession = useRef<string | undefined>(undefined);
  const inputRecovery = useRef<Promise<void> | null>(null);
  const displayRate = useRef(120);
  const sizedSession = useRef<string | null>(null);
  const panelOpenRef = useRef(false);
  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);
  const closeStream = useCallback(() => {
    if (streamRetry.current) clearTimeout(streamRetry.current);
    streamRetry.current = null;
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  // Direct live-view links (straight to the machine running the browser), per chat.
  // A link that fails once falls back to the normal path for that chat.
  const directLive = useRef<Map<string, { url: string | null; until: number }>>(new Map());
  const attachStream = useCallback(
    (chatId: string, viaHost = false) => {
      closeStream();
      if (document.hidden) return;
      const cached = directLive.current.get(chatId);
      if (!viaHost && (!cached || cached.until < Date.now())) {
        // Ask once (cheap); reconnect with whatever we learn.
        directLive.current.set(chatId, { url: null, until: Date.now() + 9 * 60_000 });
        fetch(`/api/sessions/${chatId}/live`)
          .then((r) => (r.ok ? r.json() : { url: null }))
          .then((j: { url?: string | null }) => {
            directLive.current.set(chatId, { url: j.url || null, until: Date.now() + 9 * 60_000 });
            if (j.url && activeRef.current === chatId && panelOpenRef.current) attachStream(chatId);
          })
          .catch(() => {});
      }
      const direct = viaHost ? null : directLive.current.get(chatId)?.url;
      const streamUrl = new URL(direct || `/api/sessions/${chatId}/stream`, window.location.href);
      streamUrl.searchParams.set("fps", String(displayRate.current));
      const es = new EventSource(streamUrl.href);
      streamRef.current = es;
      es.onmessage = (ev) => {
        if (streamRef.current !== es || activeRef.current !== chatId) return;
        let e: { type: string } & Record<string, unknown>;
        try {
          e = JSON.parse(ev.data);
        } catch {
          return;
        }
        // Frames and cursor moves go straight to the live view (no React re-render per frame).
        if (e.type === "reset") {
          inputChannel.current?.channel.dispose();
          inputChannel.current = null;
        }
        if ((e.type === "frame" || e.type === "reset") && typeof e.epoch === "number") {
          if (inputEpoch.current !== undefined && inputEpoch.current !== e.epoch) {
            inputChannel.current?.channel.dispose();
            inputChannel.current = null;
          }
          inputEpoch.current = e.epoch;
        }
        if (e.type === "frame" || e.type === "cursor" || e.type === "reset" || e.type === "pointer" || e.type === "audio") liveBus.emit(e as never);
        if (e.type === "status") {
          if (typeof e.sessionId === "string") {
            if (inputSession.current !== undefined && inputSession.current !== e.sessionId) {
              inputChannel.current?.channel.dispose(); inputChannel.current = null;
            }
            inputSession.current = e.sessionId;
          }
          if (typeof e.control === "number") {
            if (inputControl.current !== undefined && inputControl.current !== e.control) {
              inputChannel.current?.channel.dispose(); inputChannel.current = null;
            }
            inputControl.current = e.control;
          }
          if (typeof e.epoch === "number") inputEpoch.current = e.epoch;
          setSessionAvailable(e.status !== "closed");
          if (e.status === "active" && lastViewport.current && sizedSession.current !== e.sessionId) {
            sizedSession.current = e.sessionId as string;
            const size = lastViewport.current;
            void fetch(`/api/sessions/${chatId}/viewport`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(size) }).catch(() => {});
          }
          if (typeof e.takeover === "boolean") setControlling(e.takeover);
          const tab = (e.tabs as { url: string; title: string; active: boolean }[] | undefined)?.find((t) => t.active);
          if (tab) setBrowser((b) => ({ ...b, url: tab.url, title: tab.title }));
        }
      };
      es.onerror = () => {
        // The session may not exist yet (agent just starting) or the server restarted: retry while useful.
        es.close();
        if (streamRef.current !== es) return;
        streamRef.current = null;
        // A direct link that failed (expired, host replaced, blocked): use the normal path for a
        // minute, then ask for a fresh link.
        if (direct) directLive.current.set(chatId, { url: null, until: Date.now() + 60_000 });
        // Keep the view live whenever you're watching it, not only while a task runs.
        if ((runningRef.current || panelOpenRef.current) && activeRef.current === chatId) {
          streamRetry.current = setTimeout(() => attachStream(chatId), runningRef.current ? 1500 : 4000);
        }
      };
    },
    [closeStream, liveBus]
  );
  // Short, event-driven samples also handle moving the window between displays.
  useEffect(() => {
    let gaps: number[] = [];
    let last = 0;
    let raf = 0;
    const sample = (at: number) => {
      if (last && at > last) gaps.push(at - last);
      last = at;
      if (gaps.length < 12) raf = requestAnimationFrame(sample);
      else {
        gaps.sort((a, b) => a - b);
        const rate = Math.min(240, Math.max(1, Math.round(1000 / gaps[Math.floor(gaps.length / 2)])));
        if (Math.abs(rate - displayRate.current) > 2) {
          displayRate.current = rate;
          if (panelOpenRef.current && activeRef.current) attachStream(activeRef.current);
        }
      }
    };
    const measure = () => {
      cancelAnimationFrame(raf);
      gaps = []; last = 0;
      if (!document.hidden) raf = requestAnimationFrame(sample);
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", measure);
    };
  }, [attachStream]);
  // Your own clicks in the reader view (the HTTP browser the agent uses when there's no Chromium).
  const [pageBusy, setPageBusy] = useState(false);
  const pageOp = useCallback(async (op: PageOp) => {
    const chatId = activeRef.current;
    if (!chatId) return;
    setPageBusy(true);
    try {
      const r = await fetch(`/api/chats/${chatId}/page`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op) });
      if (!r.ok) throw new Error(await errorFromResponse(r));
      const { page } = (await r.json()) as { page: BrowserState["page"] };
      if (activeRef.current === chatId && page) setBrowser((b) => ({ ...b, page, url: page.url, title: page.title }));
    } catch (error) {
      setBrowser((b) => ({ ...b, status: error instanceof Error ? error.message : "Could not load that page." }));
    } finally {
      setPageBusy(false);
    }
  }, []);

  /** Opens (or reuses) this chat's live browser and starts streaming it. */
  const openLiveBrowser = useCallback(async () => {
    const chatId = activeRef.current;
    if (!chatId || browserOpening) return;
    setBrowserOpening(true);
    try {
      await API.ensureAgentHost();
      // Opening is idempotent, so always ask: a quick task may have been answered without a browser.
      if (!browser.running) {
        const response = await fetch(`/api/sessions/${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "open" }),
        });
        if (!response.ok) throw new Error(await errorFromResponse(response));
        if (activeRef.current !== chatId) return;
        setSessionAvailable(true);
      }
      if (activeRef.current !== chatId) return;
      if (window.innerWidth < 1440) setSidebarOpen(false);
      setPanelOpen(true);
      attachStream(chatId);
    } catch (error) {
      // No Chromium on this server: show the HTTP browser (reader view) instead.
      console.error("Could not open browser panel", error);
      try {
        const r = await fetch(`/api/chats/${chatId}/page`);
        const { page } = r.ok ? ((await r.json()) as { page: BrowserState["page"] }) : { page: null };
        if (activeRef.current === chatId) {
          setBrowser((b) => ({ ...b, page: page ?? null, url: page?.url || b.url, title: page?.title || b.title }));
          if (window.innerWidth < 1440) setSidebarOpen(false);
          setPanelOpen(true);
        }
      } catch {
        /* offline */
      }
    } finally {
      setBrowserOpening(false);
    }
  }, [attachStream, browser.running, browserOpening]);

  const toggleBrowserPanel = useCallback(async () => {
    if (panelOpen) {
      setPanelOpen(false);
      return;
    }
    await openLiveBrowser();
  }, [openLiveBrowser, panelOpen]);
  useEffect(() => closeStream, [closeStream]);
  // Agent progress uses its own stream. Hidden viewers don't need JPEG capture.
  useEffect(() => {
    if (!panelOpen) closeStream();
  }, [panelOpen, closeStream]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) closeStream();
      else if (panelOpenRef.current && activeRef.current) attachStream(activeRef.current);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [attachStream, closeStream]);

  // The real page follows the live view's size (no letterboxing, responsive layouts).
  const lastViewport = useRef<{ width: number; height: number } | null>(null);
  const sendViewport = useCallback((size: { width: number; height: number }) => {
    lastViewport.current = size;
    const chatId = activeRef.current;
    if (!chatId) return;
    void fetch(`/api/sessions/${chatId}/viewport`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(size) }).catch(() => {});
  }, []);

  // ---- open / switch chats ---------------------------------------------------
  const detach = useCallback(() => {
    inputChannel.current?.channel.dispose();
    inputChannel.current = null;
    inputEpoch.current = undefined;
    inputControl.current = undefined;
    inputSession.current = undefined;
    inputRecovery.current = null;
    abortRef.current?.abort("switch");
    abortRef.current = null;
    closeStream();
    runningRef.current = false;
    setBusy(false);
    setStreamingId(null);
    setBrowser(EMPTY_BROWSER);
    liveBus.emit({ type: "reset" });
    setPanelOpen(false);
    setSessionAvailable(false);
    setControlling(false);
    setPaused(false);
  }, [closeStream, liveBus]);

  const openChat = useCallback(
    async (id: string) => {
      if (id === activeRef.current) return;
      detach();
      setActiveId(id);
      activeRef.current = id;
      setHash(id);
      setMessages([]);
      setChatLoading(true);
      if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
      try {
        const { messages: stored } = await API.getChat(id);
        if (activeRef.current !== id) return;
        setMessages(stored.map(fromStored));
        fetch(`/api/sessions/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => {
            if (activeRef.current === id && s && (s.status === "active" || s.status === "restoring")) setSessionAvailable(true);
          })
          .catch(() => {});
      } catch {
        // Deleted or from another account: start fresh.
        setActiveId(null);
        activeRef.current = null;
        setHash(null);
      } finally {
        setChatLoading(false);
        requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
      }
    },
    [detach]
  );

  const newChat = useCallback(() => {
    detach();
    setActiveId(null);
    activeRef.current = null;
    setHash(null);
    setMessages([]);
    setAttachments([]);
    if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [detach]);

  const removeChat = useCallback(
    async (id: string) => {
      setChats((cs) => cs.filter((c) => c.id !== id));
      if (activeRef.current === id) newChat();
      await API.deleteChat(id).catch(() => refreshChats());
    },
    [newChat, refreshChats]
  );

  // ---- keyboard shortcuts --------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newChat();
      }
      if (e.key === "Escape" && sidebarOpen && !window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat, sidebarOpen]);

  // ---- auto-scroll -------------------------------------------------------
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ---- attachments ---------------------------------------------------------
  const addFiles = useCallback((files: File[]) => {
    for (const file of files.slice(0, 8)) {
      const key = uid();
      const preview = URL.createObjectURL(file);
      setAttachments((as) => [...as, { key, preview }]);
      API.uploadImage(file)
        .then((id) => setAttachments((as) => as.map((a) => (a.key === key ? { ...a, id } : a))))
        .catch((e) => setAttachments((as) => as.map((a) => (a.key === key ? { ...a, error: networkError(e) } : a))));
    }
  }, []);
  const removeAttachment = (key: string) =>
    setAttachments((as) => {
      const a = as.find((x) => x.key === key);
      if (a) URL.revokeObjectURL(a.preview);
      return as.filter((x) => x.key !== key);
    });

  // ---- chat turn -------------------------------------------------------------
  const ensureChat = useCallback(async (): Promise<string> => {
    if (activeRef.current) return activeRef.current;
    const chat = await API.createChat();
    activeRef.current = chat.id;
    setActiveId(chat.id);
    setHash(chat.id);
    setChats((cs) => [{ id: chat.id, title: chat.title, updatedAt: new Date().toISOString() }, ...cs]);
    return chat.id;
  }, []);

  const runChat = useCallback(
    async (
      chatId: string,
      content: string,
      imageIds: string[],
      replyId: string,
      opts?: { userId?: string; truncateFrom?: { messageId?: string; index?: number } }
    ) => {
      const ctl = new AbortController();
      abortRef.current = ctl;
      setBusy(true);
      setStreamingId(replyId);
      let text = "";
      let gotFirst = false;
      // Local models can take a while to load; give up after 3 minutes of silence.
      const timer = setTimeout(() => !gotFirst && ctl.abort("timeout"), 180_000);
      try {
        const res = await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            imageIds,
            provider,
            truncateFrom: opts?.truncateFrom,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(await errorFromResponse(res));
        let failed: string | null = null;
        await readSSE(res, (d) => {
          const e = d as {
            type: string;
            text?: string;
            error?: string;
            message?: StoredMessage;
            providerLabel?: string;
            model?: string;
            userMessageId?: string;
            query?: string;
            images?: { url: string; alt: string; source: string; engine: string }[];
          };
          if (e.type === "images" && e.images?.length) {
            patch(replyId, (m) => ({ ...m, scrapedImages: e.images, imageQuery: e.query }));
          } else if (e.type === "start") {
            if (opts?.userId && e.userMessageId) {
              patch(opts.userId, (m) => ({ ...m, id: e.userMessageId! }));
            }
            patch(replyId, (m) => ({ ...m, provider: e.providerLabel ? `${e.providerLabel} · ${e.model}` : undefined }));
          } else if (e.type === "delta" && e.text) {
            gotFirst = true;
            text += e.text;
            const shown = extractOpenTags(stripLiveTags(text)).clean;
            patch(replyId, (m) => ({ ...m, content: shown }));
          } else if (e.type === "done" && e.message) {
            const final = fromStored(e.message);
            patch(replyId, (m) => ({ ...final, id: m.id, provider: final.provider || m.provider }));
            if (final.actions?.[0]) openTab(final.actions[0].url); // may be blocked; the card stays
          } else if (e.type === "error") {
            failed = e.error || "Something went wrong.";
          }
        });
        if (failed) throw new Error(failed);
        patch(replyId, (m) => ({ ...m, pending: false }));
      } catch (e) {
        const reason = ctl.signal.reason;
        patch(replyId, (m) =>
          ctl.signal.aborted && reason !== "timeout"
            ? { ...m, pending: false, content: m.content || "_Stopped._" }
            : {
                ...m,
                pending: false,
                error:
                  reason === "timeout"
                    ? "No reply after 3 minutes. The model may still be loading or busy. Try again, or pick another model in Settings."
                    : networkError(e),
              }
        );
      } finally {
        clearTimeout(timer);
        if (abortRef.current === ctl) {
          abortRef.current = null;
          setBusy(false);
          setStreamingId(null);
        }
        void refreshChats(); // the title may have been set from this message
      }
    },
    [patch, provider, refreshChats]
  );

  // ---- you driving the browser -------------------------------------------------
  const controlRequest = useRef(0);
  const setControl = useCallback(async (chatId: string, on: boolean) => {
    const request = ++controlRequest.current;
    const previousSession = inputSession.current;
    if (!on) { inputChannel.current?.channel.dispose(); inputChannel.current = null; }
    setBrowser(b => b.inputError ? { ...b, inputError: undefined } : b);
    try {
      // Your click is the newest intent, so no version check: the agent bumps the control
      // version when it starts, and a click racing that status update must not be refused.
      // Setting the same mode twice is harmless, so a dropped connection is retried once.
      const claim = () => fetch(`/api/sessions/${chatId}/takeover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on, sessionId: inputSession.current }),
      });
      const r = await claim().catch(() => new Promise<Response>((resolve, reject) => setTimeout(() => claim().then(resolve, reject), 400)));
      if (!r.ok) throw new Error(await errorFromResponse(r));
      const j = (await r.json()) as { takeover: boolean; epoch?: number; control?: number; sessionId?: string };
      if (activeRef.current !== chatId || request !== controlRequest.current) return;
      if (typeof j.epoch === "number") inputEpoch.current = j.epoch;
      if (typeof j.control === "number") inputControl.current = j.control;
      if (typeof j.sessionId === "string") inputSession.current = j.sessionId;
      setControlling(j.takeover);
      if (previousSession && j.sessionId && previousSession !== j.sessionId) {
        directLive.current.delete(chatId);
        attachStream(chatId);
      }
    } catch (error) {
      if (activeRef.current !== chatId || request !== controlRequest.current) return;
      setBrowser(b => ({ ...b, inputError: error instanceof Error ? error.message : "Could not transfer browser control. Try again." }));
    }
  }, [attachStream]);

  // When a task ends, the browser is yours: you can click around right away.
  const handOverRef = useRef<(chatId: string) => void>(() => {});
  useEffect(() => {
    handOverRef.current = (chatId: string) => {
      // The server releases its lease before a terminal event. No competing
      // takeover request is needed (it could otherwise abort a newer task).
      if (activeRef.current === chatId) setControlling(true);
    };
  }, []);

  const inputChannel = useRef<{ chatId: string; channel: ReturnType<typeof createInputChannel> } | null>(null);
  useEffect(() => () => inputChannel.current?.channel.dispose(), []);
  // A batch preserves key/click ordering across a single round trip. Continuous
  // pointer/scroll input replaces adjacent queued events instead of building a backlog.
  const sendInput = useCallback(
    (ev: BrowserInput) => {
      const chatId = activeRef.current;
      if (!chatId) return;
      if (inputChannel.current?.chatId !== chatId) {
        inputChannel.current?.channel.dispose();
        const control = inputControl.current;
        const sessionId = inputSession.current;
        const channel = createInputChannel(async (events, signal) => {
          await inputRecovery.current;
          signal.throwIfAborted();
          await deliverInputBatch(events, signal, {
            epoch: () => inputEpoch.current,
            setEpoch: epoch => { inputEpoch.current = epoch; },
            request: async (events, epoch, signal) => {
              const body = JSON.stringify({ events, epoch, control: inputControl.current, sessionId: inputSession.current, protocol: INPUT_PROTOCOL_VERSION });
            const cached = directLive.current.get(chatId);
            const direct = cached && cached.until > Date.now() ? cached.url?.replace("/stream?", "/input?") : null;
            let response = direct
              ? await fetch(direct, { method: "POST", headers: { "Content-Type": "text/plain" }, body, signal })
              : null;
            // These responses guarantee no input ran. Never retry a lost response.
            if (!response || response.status === 401 || response.status === 404) {
              if (direct) directLive.current.set(chatId, { url: null, until: Date.now() + 60_000 });
              response = await fetch(`/api/sessions/${chatId}/input`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
              });
            }
              return response;
            },
            claim: async signal => {
              const claim = await fetch(`/api/sessions/${chatId}/takeover`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: true, sessionId: inputSession.current }), signal,
              });
              if (!claim.ok) throw new InputTransportError(await errorFromResponse(claim));
              const state = await claim.json() as { epoch?: number; takeover: boolean; control?: number };
              if (activeRef.current === chatId) setControlling(state.takeover);
              if (typeof state.control === "number") inputControl.current = state.control;
              return state;
            },
          });
          if (activeRef.current === chatId) setBrowser(b => b.inputError ? { ...b, inputError: undefined } : b);
        }, error => {
          if (activeRef.current !== chatId) return;
          inputChannel.current?.channel.dispose();
          inputChannel.current = null;
          if (error instanceof InputTransportError && error.code === "SESSION_CHANGED") {
            directLive.current.delete(chatId);
            inputSession.current = undefined; inputEpoch.current = undefined; inputControl.current = undefined;
            attachStream(chatId);
            return;
          }
          if (error instanceof InputTransportError && ["STALE_VIEW", "STALE_CONTROL"].includes(error.code || "")) {
            // Old coordinates must never be replayed into a different page. The next
            // gesture uses this epoch; ownership and the open browser stay intact.
            if (typeof error.epoch === "number") inputEpoch.current = error.epoch;
            if (typeof error.control === "number") inputControl.current = error.control;
            return;
          }
          setBrowser(b => ({ ...b, inputError: error instanceof Error ? error.message : "Browser input failed. Take control again to reconnect." }));
          if (typeof control === "number") {
            // Release a possibly held drag after an uncertain response. This CAS
            // cannot interrupt a newer agent/user lease and never replays the gesture.
            const recovery = fetch(`/api/sessions/${chatId}/takeover`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ on: true, resetInput: true, control, sessionId }), signal: AbortSignal.timeout(5000),
            }).then(async r => {
              const state = await r.json() as { control?: number; epoch?: number; takeover?: boolean };
              if (activeRef.current !== chatId) return;
              if (typeof state.control === "number") inputControl.current = state.control;
              if (typeof state.epoch === "number") inputEpoch.current = state.epoch;
              if (typeof state.takeover === "boolean") setControlling(state.takeover);
            }).catch(() => {}).finally(() => { if (inputRecovery.current === recovery) inputRecovery.current = null; });
            inputRecovery.current = recovery;
          }
        });
        inputChannel.current = { chatId, channel };
      }
      inputChannel.current.channel.push(ev);
    },
    [attachStream]
  );

  // ---- agent turn ------------------------------------------------------------
  const runAgent = useCallback(
    async (
      chatId: string,
      goal: string,
      imageIds: string[],
      replyId: string,
      resume = false,
      opts?: { userId?: string; truncateFrom?: { messageId?: string; index?: number } }
    ) => {
      const ctl = new AbortController();
      abortRef.current = ctl;
      agentChatRef.current = chatId;
      inputChannel.current?.channel.dispose();
      inputChannel.current = null;
      controlRequest.current++;
      runningRef.current = true;
      setBusy(true);
      if (typeof window !== "undefined" && window.innerWidth < 1440) setSidebarOpen(false);
      setPanelOpen(true);
      setSessionAvailable(true);
      // Starting (or resuming) a task gives the browser back to the agent.
      setControlling(false);
      setPaused(false);
      setBrowser((b) =>
        resume
          ? { ...b, running: true, status: "Continuing…", outcome: "running" }
          : { ...EMPTY_BROWSER, running: true, status: "Starting…", outcome: "running" }
      );
      const trail: { label: string; url?: string }[] = [];
      const end = (outcome: "done" | "stopped" | "error", url?: string) =>
        setBrowser((b) => ({
          ...b,
          running: false,
          outcome,
          status: outcome === "done" ? "Done" : outcome === "stopped" ? "Stopped" : "Error",
          url: url || b.url,
          steps: b.steps.map((s) =>
            s.status === "running" ? { ...s, status: outcome === "done" ? "done" : "error", detail: outcome === "stopped" ? "Stopped" : s.detail } : s
          ),
        }));
      let finished = false;
      let serverReplyId = "";

      try {
        // On Vercel the browser runs on an on-demand computer: wake it first (instant if up).
        const slow = setTimeout(() => setBrowser((b) => ({ ...b, status: "Starting the agent computer…" })), 800);
        try {
          await API.ensureAgentHost();
          // The host may have renewed since the last task. Do not keep watching
          // or sending input to the old, still-running browser computer.
          directLive.current.delete(chatId);
          inputSession.current = undefined; inputEpoch.current = undefined; inputControl.current = undefined;
          attachStream(chatId);
        } finally {
          clearTimeout(slow);
        }
        const res = await fetch(`/api/chats/${chatId}/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal, provider, imageIds, resume, truncateFrom: opts?.truncateFrom }),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(await errorFromResponse(res));
        let dropped: unknown = null;
        await readSSE(res, (d) => {
          const e = d as { type: string } & Record<string, unknown>;
          switch (e.type) {
            case "start":
              if (typeof e.messageId === "string") serverReplyId = e.messageId;
              if (opts?.userId && typeof e.userMessageId === "string") {
                patch(opts.userId, (m) => ({ ...m, id: String(e.userMessageId) }));
              }
              break;
            case "status":
              setBrowser((b) => ({ ...b, status: String(e.text) }));
              break;
            case "plan":
              setBrowser((b) => ({ ...b, plan: e.steps as string[] }));
              break;
            case "page": {
              const pg = e.page as NonNullable<BrowserState["page"]>;
              setBrowser((b) => ({ ...b, page: pg, url: pg.url, title: pg.title }));
              break;
            }
            case "step": {
              const s = e as unknown as AgentStep;
              setBrowser((b) => {
                const step = { id: s.id, label: s.label, status: s.status, detail: s.detail, url: s.url };
                const steps = b.steps.some((x) => x.id === s.id) ? b.steps.map((x) => (x.id === s.id ? step : x)) : [...b.steps, step];
                return { ...b, steps, status: s.status === "running" ? `${s.label}…` : b.status };
              });
              trail[s.id - 1] = { label: s.label, url: s.url };
              patch(replyId, (m) => ({ ...m, agent: { ...m.agent!, trail: trail.filter(Boolean) } }));
              break;
            }
            case "done": {
              finished = true;
              const url = e.url ? String(e.url) : "";
              end("done", url);
              handOverRef.current(chatId);
              patch(replyId, (m) => ({
                ...m,
                pending: false,
                content: String(e.answer || "Done."),
                imageIds: (e.imageIds as string[]) || [],
                provider: e.provider ? `${e.provider}${e.model ? ` · ${e.model}` : ""}` : m.provider,
                actions: url && url !== "about:blank" ? [{ url, label: "Open on my device" }] : [],
                agent: { ...m.agent!, status: "done", trail: [...trail] },
              }));
              break;
            }
            case "paused":
              finished = true;
              end("stopped");
              setPaused(true);
              handOverRef.current(chatId);
              patch(replyId, (m) => ({ ...m, pending: false, content: String(e.reason), agent: { ...m.agent!, status: "paused" } }));
              break;
            case "stopped":
              finished = true;
              end("stopped");
              handOverRef.current(chatId);
              patch(replyId, (m) => ({
                ...m,
                pending: false,
                content: m.content || "Stopped. The browser is still open where I left off.",
                agent: { ...m.agent!, status: "stopped" },
              }));
              break;
            case "error":
              finished = true;
              end("error");
              handOverRef.current(chatId);
              patch(replyId, (m) => ({ ...m, pending: false, error: String(e.message), agent: { ...m.agent!, status: "error" } }));
              break;
          }
        }).catch((err) => {
          // A dropped stream throws a bare "network error". The agent keeps going on the
          // server, so fall through to the reconnect below instead of failing.
          if (ctl.signal.aborted) throw err;
          dropped = err;
        });
        if (dropped && !serverReplyId) throw dropped;
        if (!finished && serverReplyId && !ctl.signal.aborted) {
          // The connection dropped (proxy timeout, phone sleep, flaky network) but the agent
          // keeps working on the server. Wait for its saved result instead of failing.
          setBrowser((b) => ({ ...b, status: "Still working… (reconnecting)" }));
          const deadline = Date.now() + 60 * 60_000;
          while (!ctl.signal.aborted && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 3000));
            const stored = await API.getChat(chatId).catch(() => null);
            const m = stored?.messages.find((x) => x.id === serverReplyId);
            const st = m?.meta?.agent?.status;
            if (!m || !st || st === "running") continue;
            finished = true;
            const final = fromStored(m);
            end(st === "done" ? "done" : st === "error" ? "error" : "stopped", final.agent?.url);
            handOverRef.current(chatId);
            patch(replyId, () => ({ ...final, id: replyId, pending: false }));
            // Paused (your takeover, or AI limits used up): offer Resume; take control yourself if you want.
            if (st === "paused") setPaused(true);
            break;
          }
        }
        if (!finished) throw new Error("The connection to the agent closed before it finished.");
      } catch (err) {
        if (ctl.signal.aborted) {
          if (ctl.signal.reason !== "switch") {
            end("stopped");
            handOverRef.current(chatId);
            patch(replyId, (m) => ({
              ...m,
              pending: false,
              content: m.content || "Stopped. The browser is still open where I left off.",
              agent: { ...m.agent!, status: "stopped" },
            }));
          }
        } else {
          end("error");
          handOverRef.current(chatId);
          patch(replyId, (m) => ({ ...m, pending: false, error: networkError(err), agent: { ...m.agent!, status: "error" } }));
        }
      } finally {
        runningRef.current = false;
        if (abortRef.current === ctl) {
          abortRef.current = null;
          setBusy(false);
        }
        agentChatRef.current = null;
        void refreshChats();
      }
    },
    [attachStream, patch, provider, refreshChats]
  );

  const stop = useCallback(async () => {
    const agentChat = agentChatRef.current;
    if (agentChat) {
      // The agent keeps running on the server until told to stop.
      await fetch(`/api/chats/${agentChat}/agent/stop`, { method: "POST" }).catch(() => {});
    }
    abortRef.current?.abort("stop");
  }, []);

  /** "Hand back": the agent continues the paused task from wherever you left the page. */
  const resumeAgent = useCallback(() => {
    const chatId = activeRef.current;
    if (!chatId || busy) return;
    const reply: Msg = { id: uid(), role: "assistant", content: "", pending: true, agent: { goal: "Continue", status: "running", trail: [] } };
    setMessages((ms) => [...ms, reply]);
    void runAgent(chatId, "", [], reply.id, true);
  }, [busy, runAgent]);

  // ---- send ------------------------------------------------------------------
  const send = useCallback(
    async (raw: string, forceMode?: Mode) => {
      const text = raw.trim();
      const imageIds = attachments.filter((a) => a.id).map((a) => a.id!);
      if ((!text && !imageIds.length) || busy) return;
      const m = forceMode || mode;
      chattedSinceSuggest.current = true;
      setInput("");
      attachments.forEach((a) => URL.revokeObjectURL(a.preview));
      setAttachments([]);

      const user: Msg = { id: uid(), role: "user", content: text, imageIds };
      const reply: Msg = { id: uid(), role: "assistant", content: "", pending: true };
      if (m === "agent") reply.agent = { goal: text, status: "running", trail: [] };

      // Quick "open X" commands open right inside the click/Enter, so the tab isn't blocked as a pop-up.
      const cmd = m === "chat" && !imageIds.length ? parseBrowserCommand(text) : null;
      if (cmd) {
        const win = openTab(cmd.url);
        const what = cmd.query ? `${cmd.site} results for “${cmd.query}”` : cmd.label;
        reply.pending = false;
        reply.content = win === null ? `Ready to open ${what}. Your browser blocked the new tab, so tap the button below.` : `Opened ${what} in a new tab.`;
        reply.actions = [cmd];
      }
      setMessages((ms) => [...ms, user, reply]);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));

      let chatId: string;
      try {
        chatId = await ensureChat();
      } catch (e) {
        patch(reply.id, (r) => ({ ...r, pending: false, agent: undefined, error: networkError(e) }));
        return;
      }
      // The AI-written chat title lands a moment after the first message.
      if (chats.find((c) => c.id === chatId)?.title === "New chat" || !chats.some((c) => c.id === chatId)) {
        for (const ms of [3000, 8000]) setTimeout(() => void refreshChats(), ms);
      }

      if (cmd) {
        const res = await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, record: { content: reply.content, actions: [cmd] } }),
        }).catch(() => null);
        const saved = (await res?.json().catch(() => null)) as { userMessageId?: string } | null;
        if (saved?.userMessageId) patch(user.id, (m) => ({ ...m, id: saved.userMessageId! }));
        void refreshChats();
        return;
      }
      if (m === "agent") void runAgent(chatId, text, imageIds, reply.id, false, { userId: user.id });
      else void runChat(chatId, text, imageIds, reply.id, { userId: user.id });
    },
    [attachments, busy, chats, mode, ensureChat, patch, refreshChats, runAgent, runChat]
  );

  const editMessage = useCallback(
    async (userMsgId: string, raw: string) => {
      if (busy) return;
      const ms = messagesRef.current;
      const idx = ms.findIndex((m) => m.id === userMsgId && m.role === "user");
      if (idx === -1) return;
      const target = ms[idx];
      const text = raw.trim();
      const imageIds = target.imageIds || [];
      if (!text && !imageIds.length) return;

      chattedSinceSuggest.current = true;
      const prior = ms.slice(0, idx);
      const user: Msg = { id: uid(), role: "user", content: text, imageIds };
      const reply: Msg = { id: uid(), role: "assistant", content: "", pending: true };
      const m = mode;
      if (m === "agent") reply.agent = { goal: text, status: "running", trail: [] };

      const cmd = m === "chat" && !imageIds.length ? parseBrowserCommand(text) : null;
      if (cmd) {
        const win = openTab(cmd.url);
        const what = cmd.query ? `${cmd.site} results for “${cmd.query}”` : cmd.label;
        reply.pending = false;
        reply.content = win === null ? `Ready to open ${what}. Your browser blocked the new tab, so tap the button below.` : `Opened ${what} in a new tab.`;
        reply.actions = [cmd];
      }

      setMessages([...prior, user, reply]);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));

      let chatId: string;
      try {
        chatId = await ensureChat();
      } catch (e) {
        patch(reply.id, (r) => ({ ...r, pending: false, agent: undefined, error: networkError(e) }));
        return;
      }

      const truncateFrom = { messageId: target.id, index: idx };
      if (cmd) {
        const res = await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, imageIds, truncateFrom, record: { content: reply.content, actions: [cmd] } }),
        }).catch(() => null);
        const saved = (await res?.json().catch(() => null)) as { userMessageId?: string } | null;
        if (saved?.userMessageId) patch(user.id, (u) => ({ ...u, id: saved.userMessageId! }));
        void refreshChats();
        return;
      }
      if (m === "agent") void runAgent(chatId, text, imageIds, reply.id, false, { userId: user.id, truncateFrom });
      else void runChat(chatId, text, imageIds, reply.id, { userId: user.id, truncateFrom });
    },
    [busy, mode, ensureChat, patch, refreshChats, runAgent, runChat]
  );

  const retry = useCallback(
    (errorId: string) => {
      if (busy || !activeRef.current) return;
      const ms = messagesRef.current;
      const idx = ms.findIndex((m) => m.id === errorId);
      const failed = ms[idx];
      let userIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (ms[i].role === "user") {
          userIdx = i;
          break;
        }
      }
      const prevUser = userIdx >= 0 ? ms[userIdx] : undefined;
      if (!failed || !prevUser) return;
      const reply: Msg = { id: uid(), role: "assistant", content: "", pending: true };
      if (failed.agent) reply.agent = { goal: failed.agent.goal, status: "running", trail: [] };
      setMessages([...ms.slice(0, idx), reply]);
      const ids = prevUser.imageIds || [];
      const truncateFrom = { messageId: prevUser.id, index: userIdx };
      if (failed.agent) void runAgent(activeRef.current, failed.agent.goal, ids, reply.id, false, { userId: prevUser.id, truncateFrom });
      else void runChat(activeRef.current, prevUser.content, ids, reply.id, { userId: prevUser.id, truncateFrom });
    },
    [busy, runAgent, runChat]
  );

  const runSuggestedAgent = useCallback(
    (assistantId: string) => {
      const ms = messagesRef.current;
      const idx = ms.findIndex((m) => m.id === assistantId);
      const prevUser = [...ms.slice(0, idx)].reverse().find((m) => m.role === "user");
      if (!prevUser) return;
      changeMode("agent");
      void send(prevUser.content, "agent");
    },
    [send]
  );

  /** "Run in Agent" on a prompt Senko wrote: send that exact text as an agent task. */
  const runPromptInAgent = useCallback(
    (text: string) => {
      changeMode("agent");
      void send(text, "agent");
    },
    [send]
  );

  const pickSuggestion = (s: Suggestion) => {
    if (s.mode !== mode) changeMode(s.mode);
    void send(s.prompt, s.mode);
  };

  // ---- render ----------------------------------------------------------------
  const usable = providers.filter((p) => p.available);
  const activeProvider = provider === "auto" ? usable[0] : providers.find((p) => p.id === provider);
  const activeChat = chats.find((c) => c.id === activeId);

  if (conn !== "ready") {
    return <Gate state={conn} error={connError} onKey={(k) => boot(k)} onRetry={() => boot()} />;
  }

  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSubmit={() => void send(input)}
      onStop={stop}
      busy={busy}
      mode={mode}
      attachments={attachments}
      onAddFiles={addFiles}
      onRemoveAttachment={removeAttachment}
      inputRef={inputRef}
    />
  );

  return (
    <div className="sk flex h-dvh overflow-hidden">
      {/* Sidebar: docked flush on desktop, drawer on smaller screens */}
      {sidebarOpen && (
        <>
          <div className="sk-fade fixed inset-0 z-30 bg-black/65 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />
          <aside className="sk-in fixed inset-y-0 left-0 z-40 w-[236px] lg:static lg:z-auto lg:w-[220px] lg:shrink-0">
            <Sidebar
              chats={chats}
              activeId={activeId}
              loading={chatsLoading}
              onSelect={(id) => void openChat(id)}
              onNew={newChat}
              onDelete={(id) => void removeChat(id)}
              onRename={(id, title) => {
                setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
                void API.renameChat(id, title).catch(() => refreshChats());
              }}
              onSettings={() => setSettingsOpen(true)}
              onClose={() => setSidebarOpen(false)}
            />
          </aside>
        </>
      )}

      {/* Center Conversation Column */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Sleek, unconfined top bar that blends directly into the pitch-black canvas */}
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 px-2.5 sm:gap-4 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {!sidebarOpen && (
              <>
                <button type="button" onClick={() => setSidebarOpen(true)} className="sk-btn h-7 w-7 shrink-0 rounded-md text-[var(--sk-muted)] hover:text-[var(--sk-text)]" aria-label="Show sidebar" title="Chats">
                  <PanelLeftOpen size={14.5} />
                </button>
                <button type="button" onClick={newChat} className="sk-btn h-7 w-7 shrink-0 rounded-md text-[var(--sk-muted)] hover:text-[var(--sk-text)]" aria-label="New chat" title="New chat">
                  <SquarePen size={14} />
                </button>
              </>
            )}
            <span className="hidden min-w-0 truncate pl-1 text-[12px] font-medium text-[var(--sk-muted)] md:block">
              {activeChat && activeChat.title !== "New chat" ? activeChat.title : ""}
            </span>
          </div>

          <div role="radiogroup" aria-label="Mode" className="sk-mode flex shrink-0 items-center gap-1">
            {(["chat", "agent"] as Mode[]).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => changeMode(m)}
                  disabled={busy}
                  className={`relative flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed ${
                    active ? "text-[var(--sk-text)]" : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                  }`}
                >
                  {m === "chat" ? (
                    <MessageSquare size={12} className={active ? "text-[var(--sk-accent-ink)]" : ""} aria-hidden />
                  ) : (
                    <Bot size={12.5} className={active ? "text-[var(--sk-accent-ink)]" : ""} aria-hidden />
                  )}
                  {m === "chat" ? "Chat" : "Agent"}
                </button>
              );
            })}
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden">
            <label
              className="relative hidden h-7 min-w-0 max-w-[160px] shrink items-center gap-1.5 overflow-hidden rounded-md px-2 text-[11.5px] text-[var(--sk-muted)] transition hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)] has-[:focus-visible]:shadow-[var(--sk-focus)] sm:inline-flex"
              title={activeProvider?.model ? `${activeProvider.label} · ${activeProvider.model}` : "Model"}
            >
              <Cpu size={12} className="shrink-0 text-[var(--sk-accent-ink)]" aria-hidden />
              <span className="truncate">
                {provider === "auto"
                  ? `Auto${usable[0] ? ` · ${usable[0].label}` : ""}`
                  : activeProvider?.label || provider}
              </span>
              <select
                aria-label="AI model"
                value={provider}
                onChange={(e) => changeProvider(e.target.value)}
                className="sk-select absolute inset-0 h-full w-full cursor-pointer opacity-0"
              >
                <option value="auto">Auto{usable[0] ? ` · ${usable[0].label}` : ""}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.label}
                    {p.model ? ` · ${p.model}` : ""}
                    {!p.available ? " (unavailable)" : ""}
                  </option>
                ))}
              </select>
            </label>

            {mode === "agent" && activeId && (
              <button
                type="button"
                onClick={() => void toggleBrowserPanel()}
                disabled={browserOpening}
                className={`sk-btn relative h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition disabled:cursor-wait ${
                  panelOpen
                    ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                    : "text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]"
                }`}
                aria-label={panelOpen ? "Hide browser" : "Show browser"}
                aria-pressed={panelOpen}
                title={panelOpen ? "Hide browser" : "Show browser"}
              >
                {browserOpening ? <Loader2 size={12.5} className="sk-spin text-[var(--sk-accent)]" /> : <Globe size={12.5} aria-hidden />}
                <span className="hidden sm:inline">Browser</span>
                {browser.running && <span className="sk-pulse h-1.5 w-1.5 rounded-full bg-[var(--sk-accent)]" aria-hidden />}
              </button>
            )}
          </div>
        </header>

        {/* Thread + Composer */}
        <div className="flex min-h-0 flex-1 flex-col">
          {isEmpty ? (
            <div className="sk-scroll min-h-0 flex-1 overflow-y-auto">
              <Welcome
                mode={mode}
                suggestions={suggestions}
                loading={sugLoading}
                personalized={personalized}
                usedHistory={usedHistory}
                error={sugError}
                onPick={pickSuggestion}
                onRefresh={() => void loadSuggestions(true)}
                onOpenSettings={() => setSettingsOpen(true)}
                composer={composer}
              />
            </div>
          ) : (
            <>
              <div ref={listRef} className="sk-scroll min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={busy}>
                <div className="mx-auto w-full max-w-[660px] space-y-5 px-3.5 pb-6 pt-4 sm:px-6">
                  {chatLoading ? (
                    <div className="flex justify-center pt-12 text-[var(--sk-faint)]">
                      <Loader2 className="sk-spin" size={18} aria-label="Loading chat" />
                    </div>
                  ) : (
                    messages.map((m) => (
                      <MessageBubble
                        key={m.id}
                        msg={m}
                        streaming={m.id === streamingId && !!m.content}
                        onRetry={busy ? undefined : retry}
                        onRunAgent={busy ? undefined : runSuggestedAgent}
                        onRunPrompt={busy ? undefined : runPromptInAgent}
                        onEdit={busy ? undefined : (id, next) => void editMessage(id, next)}
                      />
                    ))
                  )}
                </div>
              </div>
              <div className="mx-auto w-full max-w-[660px] shrink-0 px-3.5 pb-2.5 pt-1.5 sm:px-6">
                {composer}
                <p className="px-2 pt-1.5 text-center text-[10.5px] text-[var(--sk-faint)]">
                  {mode === "agent" ? "Agent mode drives a real browser. You can stop it anytime." : "Senko can make mistakes. Check anything important."}
                </p>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Live browser: full-height docked pane on desktop, sheet on smaller screens */}
      {panelOpen && (
        <div className="sk-in sk-overlay fixed inset-x-1.5 bottom-1.5 top-12 z-20 lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-[52%] lg:max-w-[1200px] lg:shrink-0 2xl:w-[56%]">
          <BrowserPanel
            state={browser}
            bus={liveBus}
            controlling={controlling}
            paused={paused}
            onStop={stop}
            onClose={() => setPanelOpen(false)}
            onOpenBrowser={openLiveBrowser}
            onPageOp={pageOp}
            pageBusy={pageBusy}
            opening={browserOpening}
            onToggleControl={() => activeId && void setControl(activeId, !controlling)}
            onResume={resumeAgent}
            onInput={sendInput}
            onViewport={sendViewport}
            agentName={activeProvider?.label ? `Senko · ${activeProvider.label}` : "Senko"}
            onNav={(n) => sendInput("url" in n ? { type: "goto", url: n.url } : { type: "nav", action: n.action })}
          />
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        personalized={personalized}
        onPersonalized={changePersonalized}
        theme={theme}
        onTheme={applyTheme}
        provider={provider}
        providers={providers}
        onProvider={changeProvider}
      />
    </div>
  );
}

/** Shown while connecting, when this device needs the access key, or when the server is unreachable. */
function Gate({
  state,
  error,
  onKey,
  onRetry,
}: {
  state: "connecting" | "needs-key" | "error";
  error: string | null;
  onKey: (k: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [key, setKey] = useState("");
  const [sending, setSending] = useState(false);
  return (
    <div className="sk flex h-dvh items-center justify-center p-4">
      <div className="sk-pop flex w-full max-w-xs flex-col items-center text-center">
        <FoxMark size={28} className={`mb-3 drop-shadow-[0_0_18px_rgba(255,122,26,0.5)] ${state === "connecting" ? "sk-thinking" : ""}`} title="Senko" />
        {state === "connecting" ? (
          <p className="text-[13px] text-[var(--sk-muted)]" role="status">
            Waking Senko up…
          </p>
        ) : state === "error" ? (
          <>
            <h1 className="sk-display text-[17px] font-semibold">Can&apos;t reach Senko</h1>
            <p className="mt-1.5 text-[12.5px] text-[var(--sk-muted)]">{error}</p>
            <button type="button" onClick={onRetry} className="sk-btn sk-primary mt-4 h-8 w-full rounded-lg">
              Try again
            </button>
          </>
        ) : (
          <form
            className="w-full"
            onSubmit={(e) => {
              e.preventDefault();
              if (!key.trim()) return;
              setSending(true);
              void onKey(key.trim()).finally(() => setSending(false));
            }}
          >
            <h1 className="sk-display text-[17px] font-semibold">Welcome back</h1>
            <p className="mt-1 text-[12.5px] text-[var(--sk-muted)]">Enter the access key once on this device.</p>
            <label className="sk-composer mt-4 flex items-center gap-2 rounded-xl px-3">
              <KeyRound size={13.5} className="text-[var(--sk-accent-ink)]" aria-hidden />
              <span className="sr-only">Access key</span>
              <input
                type="password"
                autoFocus
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="h-9 flex-1 bg-transparent text-[13.5px] outline-none focus-visible:shadow-none"
                placeholder="Access key"
              />
            </label>
            {error && (
              <p className="mt-1.5 text-left text-[11.5px] text-[var(--sk-danger)]" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={sending || !key.trim()} className="sk-btn sk-primary mt-3 h-8 w-full rounded-lg">
              {sending ? <Loader2 size={13.5} className="sk-spin" /> : "Continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
