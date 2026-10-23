import type { BrowserCommand } from "@/lib/browser-commands";

export type Mode = "chat" | "agent";

export interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** True while waiting for / receiving the reply. */
  pending?: boolean;
  error?: string;
  actions?: BrowserCommand[];
  /** Assistant suggested running this request in Agent mode. */
  suggestAgent?: boolean;
  /** Set on assistant messages produced by an agent run. */
  agent?: { goal: string; status: "running" | "done" | "stopped" | "error" | "paused"; trail?: ({ label: string; url?: string } | string)[]; url?: string };
  /** e.g. "Groq · openai/gpt-oss-120b" */
  provider?: string;
  /** Attached images (ids served by /api/uploads/:id). */
  imageIds?: string[];
  /** Senko's mood line for this reply. */
  mood?: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageIds: string[];
  meta: {
    providerLabel?: string;
    model?: string;
    actions?: BrowserCommand[];
    suggestAgent?: boolean;
    error?: string;
    agent?: { goal: string; status: string; trail?: ({ label: string; url?: string } | string)[]; url?: string };
    interrupted?: boolean;
    mood?: string;
  };
}

export function fromStored(m: StoredMessage): Msg {
  const meta = m.meta || {};
  const status = meta.agent?.status;
  // Replies saved before the server pulled out mood tags still carry them in the text.
  const legacyMood = m.role === "assistant" ? /\[STATUS:[^:\]\n]*:([^\]\n]*)\]/i.exec(m.content)?.[1]?.trim() : undefined;
  const content = legacyMood !== undefined ? stripLiveTags(m.content).replace(/[ \t]+\n/g, "\n").trim() : m.content;
  return {
    id: m.id,
    role: m.role,
    content,
    imageIds: m.imageIds,
    error: meta.error && !m.content ? meta.error : undefined,
    actions: meta.actions,
    suggestAgent: meta.suggestAgent,
    mood: meta.mood || legacyMood || undefined,
    provider: meta.providerLabel ? `${meta.providerLabel}${meta.model ? ` · ${meta.model}` : ""}` : undefined,
    agent: meta.agent
      ? {
          goal: meta.agent.goal,
          // A run that was still going when the page loaded is shown as stopped.
          status: status === "done" || status === "error" || status === "paused" ? status : "stopped",
          trail: meta.agent.trail,
          url: meta.agent.url,
        }
      : undefined,
  };
}

export interface Suggestion {
  id: string;
  title: string;
  prompt: string;
  icon: string;
  mode: Mode;
}

export interface AgentStep {
  id: number;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
  url?: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  available: boolean;
  model?: string;
  detail?: string;
  local: boolean;
}

let counter = 0;
/** Works on plain-http LAN addresses too, where crypto.randomUUID is unavailable. */
export function uid(): string {
  counter = (counter + 1) % 1e6;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Read a text/event-stream response, calling onData with each JSON payload. */
export async function readSSE(res: Response, onData: (data: unknown) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The server sent an empty response.");
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue; // ": ping" keepalives etc.
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          onData(JSON.parse(data));
        } catch {
          /* ignore partial/malformed line */
        }
      }
    }
  }
}

/** Turn a failed fetch Response into a readable message. */
export async function errorFromResponse(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    if (j.error) return String(j.error);
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return "Not signed in to the app (wrong or missing password).";
  if (res.status === 404) return "The server route wasn't found. Is the app up to date?";
  if (res.status >= 500) return `The server hit an error (${res.status}). ${text.slice(0, 200)}`;
  return `Request failed (${res.status}). ${text.slice(0, 200)}`;
}

export function networkError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timed out|timeout/i.test(msg)) {
    return "The server took too long to respond. Check that the app and its local database are running, then try again.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Couldn't reach the server. Check your connection, or that the app is still running.";
  }
  return msg;
}

export const AGENT_TAG_RE = /\[\[\s*agent\s*\]\]/gi;
const MEMORY_TAG_RE = /\[(?:MEMORY|STATUS):[^\]\n]*\]?/gi;

/** Hide tags the server strips anyway ([[agent]], [MEMORY:..]) while a reply is still streaming. */
export function stripLiveTags(text: string): string {
  return text.replace(AGENT_TAG_RE, "").replace(MEMORY_TAG_RE, "");
}
