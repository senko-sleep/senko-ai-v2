/**
 * Client-Side Telemetry
 * 
 * Lightweight event logger stored in localStorage. No external dependencies.
 * Privacy-first: all data stays client-side. Exportable as JSON.
 * Enable with NEXT_PUBLIC_TELEMETRY=1 env var.
 */

export type TelemetryEvent =
  | { type: "search"; query: string; latencyMs: number; sourceCount: number; hadFallback: boolean }
  | { type: "response"; latencyMs: number; tokenEstimate: number; model: string; hadThinkBlock: boolean }
  | { type: "embed_attempt"; url: string; embedType: "video" | "web"; success: boolean; fallback?: string }
  | { type: "error"; source: string; message: string; recovered: boolean }
  | { type: "status_miss"; reason: "no_tag" | "parse_fail"; fallbackUsed: string }
  | { type: "model_fallback"; from: string; to: string; reason: string };

interface StoredEvent {
  event: TelemetryEvent;
  timestamp: number;
}

const STORAGE_KEY = "senko-telemetry";
const MAX_EVENTS = 500;

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return process.env.NEXT_PUBLIC_TELEMETRY === "1";
  } catch {
    return false;
  }
}

function loadEvents(): StoredEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredEvent[];
  } catch {
    return [];
  }
}

function saveEvents(events: StoredEvent[]): void {
  try {
    // Keep only the most recent MAX_EVENTS
    const trimmed = events.slice(-MAX_EVENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* storage full */ }
}

/** Log a telemetry event */
export function logEvent(event: TelemetryEvent): void {
  if (!isEnabled()) return;
  const events = loadEvents();
  events.push({ event, timestamp: Date.now() });
  saveEvents(events);
}

/** Get a summary of telemetry data for dev console */
export function getSummary(): {
  totalEvents: number;
  searches: { count: number; avgLatencyMs: number; avgSources: number; fallbackRate: number };
  responses: { count: number; avgLatencyMs: number; avgTokens: number };
  embeds: { attempts: number; successRate: number; byType: Record<string, { total: number; success: number }> };
  errors: { count: number; recoveryRate: number; topSources: Record<string, number> };
  statusMisses: { count: number; rate: number };
} {
  const events = loadEvents();
  const searches = events.filter(e => e.event.type === "search").map(e => e.event as Extract<TelemetryEvent, { type: "search" }>);
  const responses = events.filter(e => e.event.type === "response").map(e => e.event as Extract<TelemetryEvent, { type: "response" }>);
  const embeds = events.filter(e => e.event.type === "embed_attempt").map(e => e.event as Extract<TelemetryEvent, { type: "embed_attempt" }>);
  const errors = events.filter(e => e.event.type === "error").map(e => e.event as Extract<TelemetryEvent, { type: "error" }>);
  const statusMisses = events.filter(e => e.event.type === "status_miss");

  const avg = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

  const embedsByType: Record<string, { total: number; success: number }> = {};
  for (const e of embeds) {
    if (!embedsByType[e.embedType]) embedsByType[e.embedType] = { total: 0, success: 0 };
    embedsByType[e.embedType].total++;
    if (e.success) embedsByType[e.embedType].success++;
  }

  const errorSources: Record<string, number> = {};
  for (const e of errors) {
    errorSources[e.source] = (errorSources[e.source] || 0) + 1;
  }

  return {
    totalEvents: events.length,
    searches: {
      count: searches.length,
      avgLatencyMs: Math.round(avg(searches.map(s => s.latencyMs))),
      avgSources: Math.round(avg(searches.map(s => s.sourceCount)) * 10) / 10,
      fallbackRate: searches.length === 0 ? 0 : searches.filter(s => s.hadFallback).length / searches.length,
    },
    responses: {
      count: responses.length,
      avgLatencyMs: Math.round(avg(responses.map(r => r.latencyMs))),
      avgTokens: Math.round(avg(responses.map(r => r.tokenEstimate))),
    },
    embeds: {
      attempts: embeds.length,
      successRate: embeds.length === 0 ? 1 : embeds.filter(e => e.success).length / embeds.length,
      byType: embedsByType,
    },
    errors: {
      count: errors.length,
      recoveryRate: errors.length === 0 ? 1 : errors.filter(e => e.recovered).length / errors.length,
      topSources: errorSources,
    },
    statusMisses: {
      count: statusMisses.length,
      rate: responses.length === 0 ? 0 : statusMisses.length / responses.length,
    },
  };
}

/** Export all events as JSON string */
export function exportEvents(): string {
  return JSON.stringify(loadEvents(), null, 2);
}

/** Clear all telemetry data */
export function clearEvents(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
}

// Expose to dev console
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__senkoTelemetry = {
    summary: getSummary,
    export: exportEvents,
    clear: clearEvents,
    log: logEvent,
  };
}
