// Small client for the server API. Every call carries this device's signed cookie.
import { errorFromResponse, type ChatSummary, type Mode, type StoredMessage, type Suggestion } from "./lib";

const DEVICE_KEY = "senko.device";
const CONNECT_TIMEOUT_MS = 12_000;

function connectFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
}

function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* fine: this tab still works */
  }
  return id;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(await errorFromResponse(res));
  return (await res.json()) as T;
}

/**
 * Make sure this device is signed in. Returns "ok", or "needs-key" when the server
 * has an access key this device hasn't entered yet.
 */
export async function connect(key?: string): Promise<"ok" | "needs-key"> {
  if (!key) {
    const me = await connectFetch("/api/me");
    if (me.ok) return "ok";
    const body = (await me.json().catch(() => ({}))) as { needsKey?: boolean };
    if (me.status === 401 && body.needsKey) return "needs-key";
  }
  const res = await connectFetch("/api/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, deviceId: deviceId() }),
  });
  if (res.ok) return "ok";
  if (res.status === 401) {
    if (key) throw new Error(await errorFromResponse(res));
    return "needs-key";
  }
  throw new Error(await errorFromResponse(res));
}

export const listChats = () => api<{ chats: ChatSummary[] }>("/api/chats").then((r) => r.chats);
export const createChat = () => api<{ chat: { id: string; title: string } }>("/api/chats", { method: "POST", body: "{}" }).then((r) => r.chat);
export const getChat = (id: string) => api<{ chat: { id: string; title: string }; messages: StoredMessage[] }>(`/api/chats/${id}`);
export const deleteChat = (id: string) => api(`/api/chats/${id}`, { method: "DELETE" });
export const renameChat = (id: string, title: string) => api(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });

export interface Settings {
  personalizedSuggestions?: boolean;
  provider?: string;
  mode?: Mode;
}
export const getSettings = () => api<{ settings: Settings }>("/api/settings").then((r) => r.settings);
export const saveSettings = (settings: Partial<Settings>) =>
  api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify({ settings }) }).then((r) => r.settings);

export const getMemories = () => api<{ memories: { key: string; value: string }[] }>("/api/memories").then((r) => r.memories);
export const forgetMemory = (key?: string) => api(`/api/memories${key ? `?key=${encodeURIComponent(key)}` : ""}`, { method: "DELETE" });

export interface SuggestionResponse {
  suggestions: Suggestion[];
  personalized: boolean;
  usedHistory: boolean;
  source: "ai" | "fallback";
}
export function getSuggestions(mode: Mode, refresh = false, signal?: AbortSignal) {
  const now = new Date();
  const qs = new URLSearchParams({
    mode,
    hour: String(now.getHours()),
    weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
  });
  if (refresh) qs.set("refresh", "1");
  return api<SuggestionResponse>(`/api/suggestions?${qs}`, { signal });
}

/** Shrink a photo in the browser (max 1600px, JPEG) and upload it. */
export async function uploadImage(file: File): Promise<string> {
  const data = await shrink(file);
  const r = await api<{ id: string }>("/api/uploads", { method: "POST", body: JSON.stringify({ mime: "image/jpeg", data }) });
  return r.id;
}

async function shrink(file: File, max = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't an image I can read."));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process the image.");
    ctx.fillStyle = "#fff"; // transparent PNGs get a white background, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86).split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

let hostReadyUntil = 0;
let hostWaking: Promise<void> | null = null;
/**
 * On Vercel the agent's browser runs on a separate on-demand computer. Wake it (or confirm
 * it's up) before agent work. Instant when it's already running or not needed.
 */
export function ensureAgentHost(): Promise<void> {
  if (Date.now() < hostReadyUntil) return Promise.resolve();
  if (!hostWaking) {
    hostWaking = (async () => {
      // A cold boot can outlast the host's gateway timeout (an HTML 502/504) while the server
      // keeps booting, so retry for a while before giving up.
      let res = await fetch("/api/agent-host", { method: "POST" });
      for (let i = 0; i < 12 && !res.ok && (res.status >= 500 || res.status === 429); i++) {
        await new Promise((r) => setTimeout(r, 3000));
        res = await fetch("/api/agent-host", { method: "POST" });
      }
      if (!res.ok) throw new Error(await errorFromResponse(res));
      const j = (await res.json()) as { mode: string; expiresAt?: number };
      hostReadyUntil = j.mode === "direct" ? Date.now() + 3600_000 : Math.min(Date.now() + 60_000, (j.expiresAt || 0) - 5 * 60_000);
    })().finally(() => {
      hostWaking = null;
    });
  }
  return hostWaking;
}
