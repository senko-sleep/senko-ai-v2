"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Cpu, Globe, KeyRound, Loader2, MessageSquare, PanelLeftOpen, SquarePen } from "lucide-react";
import { extractOpenTags, parseBrowserCommand } from "@/lib/browser-commands";
import { MessageBubble } from "./message-bubble";
import { BrowserPanel, type BrowserState } from "./browser-panel";
import { Composer, type Attachment } from "./composer";
import { Sidebar } from "./sidebar";
import { SettingsDialog, type Theme } from "./settings-dialog";
import { Welcome } from "./welcome";
import { FoxMark } from "./fox-mark";
import { createLiveBus } from "./live-view";
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
  const [sessionAvailable, setSessionAvailable] = useState(false);
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

  const attachStream = useCallback(
    (chatId: string) => {
      closeStream();
      const es = new EventSource(`/api/sessions/${chatId}/stream`);
      streamRef.current = es;
      es.onmessage = (ev) => {
        let e: { type: string } & Record<string, unknown>;
        try {
          e = JSON.parse(ev.data);
        } catch {
          return;
        }
        // Frames and cursor moves go straight to the live view (no React re-render per frame).
        if (e.type === "frame" || e.type === "cursor") liveBus.emit(e as never);
        if (e.type === "status") {
          setSessionAvailable(e.status !== "closed");
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
        // Keep the view live whenever you're watching it, not only while a task runs.
        if ((runningRef.current || panelOpenRef.current) && activeRef.current === chatId) {
          streamRetry.current = setTimeout(() => attachStream(chatId), runningRef.current ? 1500 : 4000);
        }
      };
    },
    [closeStream, liveBus]
  );
  const toggleBrowserPanel = useCallback(async () => {
    if (panelOpen) {
      setPanelOpen(false);
      return;
    }

    const chatId = activeRef.current;
    if (!chatId || browserOpening) return;
    setBrowserOpening(true);
    try {
      if (!sessionAvailable && !browser.running) {
        const response = await fetch(`/api/sessions/${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "open" }),
        });
        if (!response.ok) throw new Error(`Could not open browser (${response.status})`);
        if (activeRef.current !== chatId) return;
        setSessionAvailable(true);
      }
      if (activeRef.current !== chatId) return;
      if (window.innerWidth < 1440) setSidebarOpen(false);
      setPanelOpen(true);
      if (!streamRef.current) attachStream(chatId);
    } catch (error) {
      console.error("Could not open browser panel", error);
    } finally {
      setBrowserOpening(false);
    }
  }, [attachStream, browser.running, browserOpening, panelOpen, sessionAvailable]);
  useEffect(() => closeStream, [closeStream]);
  // Closing the panel stops the video stream (saves bandwidth) unless a task is still running.
  useEffect(() => {
    if (!panelOpen && !runningRef.current) closeStream();
  }, [panelOpen, closeStream]);

  // ---- open / switch chats ---------------------------------------------------
  const detach = useCallback(() => {
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
          body: JSON.stringify({ content, imageIds, provider, truncateFrom: opts?.truncateFrom }),
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
            images?: ScrapedImage[];
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
  const setControl = useCallback(async (chatId: string, on: boolean) => {
    setControlling(on);
    try {
      const r = await fetch(`/api/sessions/${chatId}/takeover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      });
      if (!r.ok) throw new Error(await errorFromResponse(r));
      const j = (await r.json()) as { takeover: boolean };
      setControlling(j.takeover);
    } catch {
      setControlling(false);
    }
  }, []);

  // When a task ends, the browser is yours: you can click around right away.
  const handOverRef = useRef<(chatId: string) => void>(() => {});
  useEffect(() => {
    handOverRef.current = (chatId: string) => {
      if (activeRef.current === chatId) void setControl(chatId, true);
    };
  }, [setControl]);

  // Your input goes out one event at a time, in order; queued mouse moves collapse to the latest.
  const inputQueue = useRef<{ chatId: string; ev: Record<string, unknown> }[]>([]);
  const inputBusy = useRef(false);
  const pumpInput = useCallback(async () => {
    if (inputBusy.current) return;
    inputBusy.current = true;
    try {
      while (inputQueue.current.length) {
        const next = inputQueue.current.shift()!;
        const r = await fetch(`/api/sessions/${next.chatId}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next.ev),
        }).catch(() => null);
        // 409 = the server no longer has you in control (e.g. the agent took over again).
        if (r?.status === 409) {
          setControlling(false);
          inputQueue.current = [];
        }
      }
    } finally {
      inputBusy.current = false;
    }
  }, []);
  const sendInput = useCallback(
    (ev: Record<string, unknown>) => {
      const chatId = activeRef.current;
      if (!chatId) return;
      const q = inputQueue.current;
      if (ev.type === "move" && q.length && q[q.length - 1].ev.type === "move") q[q.length - 1] = { chatId, ev };
      else q.push({ chatId, ev });
      void pumpInput();
    },
    [pumpInput]
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
      attachStream(chatId);

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

      try {
        const res = await fetch(`/api/chats/${chatId}/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal, provider, imageIds, resume, truncateFrom: opts?.truncateFrom }),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(await errorFromResponse(res));
        await readSSE(res, (d) => {
          const e = d as { type: string } & Record<string, unknown>;
          switch (e.type) {
            case "start":
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
              setControlling(true);
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
        });
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
    [attachments, busy, mode, ensureChat, patch, refreshChats, runAgent, runChat]
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
        <div className="sk-in sk-overlay fixed inset-x-1.5 bottom-1.5 top-12 z-20 lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-[46%] lg:max-w-[700px] lg:shrink-0 xl:w-[48%]">
          <BrowserPanel
            state={browser}
            bus={liveBus}
            controlling={controlling}
            paused={paused}
            onStop={stop}
            onClose={() => setPanelOpen(false)}
            onToggleControl={() => activeId && void setControl(activeId, !controlling)}
            onResume={resumeAgent}
            onInput={sendInput}
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
        <FoxMark size={28} className={`mb-3 drop-shadow-[0_0_18px_rgba(220,20,60,0.45)] ${state === "connecting" ? "sk-thinking" : ""}`} title="Senko" />
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
