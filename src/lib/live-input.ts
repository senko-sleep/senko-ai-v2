/** Shared wire format. Keep this module free of server/browser dependencies. */
export type BrowserInput =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "down" | "up"; x: number; y: number; button: "left" | "right" | "middle"; clickCount?: number }
  | { type: "move"; x: number; y: number }
  | { type: "wheel"; dx?: number; dy?: number; x?: number; y?: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string }
  | { type: "nav"; action: "back" | "forward" | "reload" }
  | { type: "goto"; url: string };

export const INPUT_BATCH_SIZE = 64;
export const INPUT_QUEUE_LIMIT = 512;
export const INPUT_PROTOCOL_VERSION = 2;

export class InputTransportError extends Error {
  constructor(message: string, public code?: string, public epoch?: number, public control?: number) { super(message); }
}

/** Retry only explicit, pre-execution ownership rejections; never replay uncertain input. */
export async function deliverInputBatch(events: BrowserInput[], signal: AbortSignal, transport: {
  epoch(): number | undefined;
  setEpoch(epoch: number): void;
  request(events: BrowserInput[], epoch: number | undefined, signal: AbortSignal): Promise<Response>;
  claim(signal: AbortSignal): Promise<{ takeover: boolean; epoch?: number }>;
}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const epoch = transport.epoch();
    const response = await transport.request(events, epoch, signal);
    if (response.ok) return;
    const error = await response.json().catch(() => ({})) as { error?: string; code?: string; epoch?: number; control?: number };
    if (error.code === "CONTROL_REQUIRED" && attempt === 0) {
      const state = await transport.claim(signal);
      if (typeof state.epoch === "number") transport.setEpoch(state.epoch);
      if (!state.takeover) throw new InputTransportError("Browser control was not granted.", "CONTROL_REQUIRED");
      if (epoch !== undefined && state.epoch !== undefined && epoch !== state.epoch) throw new InputTransportError("View changed", "STALE_VIEW", state.epoch);
      continue;
    }
    throw new InputTransportError(error.error || "Browser input failed.", error.code, error.epoch, error.control);
  }
}

/** Ignore letterboxing/zero-sized frames and keep edge clicks within the viewport. */
export function pagePoint(x: number, y: number, fit: { x: number; y: number; w: number; h: number }, vp: { w: number; h: number }, clamp = false) {
  if (![x, y, fit.x, fit.y, fit.w, fit.h, vp.w, vp.h].every(Number.isFinite) || fit.w <= 0 || fit.h <= 0 || vp.w <= 0 || vp.h <= 0) return null;
  const px = (x - fit.x) / fit.w * vp.w, py = (y - fit.y) / fit.h * vp.h;
  if (!clamp && (px < 0 || py < 0 || px > vp.w || py > vp.h)) return null;
  return { x: Math.max(0, Math.min(vp.w - 1, Math.round(px))), y: Math.max(0, Math.min(vp.h - 1, Math.round(py))) };
}

/** Only adjacent, replaceable events may merge: never move input across a click/key. */
export function appendInput(queue: BrowserInput[], event: BrowserInput) {
  const last = queue[queue.length - 1];
  if (event.type === "move" && last?.type === "move") queue[queue.length - 1] = event;
  else if (event.type === "wheel" && last?.type === "wheel") {
    queue[queue.length - 1] = { ...event, dx: (last.dx || 0) + (event.dx || 0), dy: (last.dy || 0) + (event.dy || 0) };
  } else {
    if (queue.length >= INPUT_QUEUE_LIMIT) throw new Error("Browser input is backed up. Wait for it to catch up before continuing.");
    queue.push(event);
  }
}

export function isBrowserInput(value: unknown): value is BrowserInput {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  const point = () => Number.isFinite(e.x) && Number.isFinite(e.y);
  const button = () => ["left", "right", "middle"].includes(e.button as string);
  switch (e.type) {
    case "click": return point() && (e.button === undefined || button()) && (e.double === undefined || typeof e.double === "boolean");
    case "down": case "up": return point() && button() && (e.clickCount === undefined || (Number.isInteger(e.clickCount) && Number(e.clickCount) >= 1 && Number(e.clickCount) <= 3));
    case "move": return point();
    case "wheel": return (e.x === undefined) === (e.y === undefined) && (e.dx !== undefined || e.dy !== undefined) && ["x", "y", "dx", "dy"].every(k => e[k] === undefined || Number.isFinite(e[k]));
    case "key": return typeof e.key === "string" && e.key.length > 0 && e.key.length <= 100;
    case "text": return typeof e.text === "string" && e.text.length <= 100_000;
    case "goto": return typeof e.url === "string" && e.url.length > 0 && e.url.length <= 8192;
    case "nav": return ["back", "forward", "reload"].includes(e.action as string);
    default: return false;
  }
}

/** One HTTP request in flight, but a whole ordered batch per round trip. */
export function createInputChannel(send: (events: BrowserInput[], signal: AbortSignal) => Promise<void>, onError: (error: unknown) => void) {
  const queue: BrowserInput[] = [];
  let sending = false;
  let disposed = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const pump = async () => {
    if (sending || disposed) return;
    sending = true;
    try {
      while (queue.length && !disposed) await send(queue.splice(0, INPUT_BATCH_SIZE), controller.signal);
    } catch (error) {
      queue.length = 0;
      if (!disposed) onError(error);
    } finally { sending = false; }
  };
  const schedule = (delay = 0) => {
    if (disposed) return;
    if (flushTimer !== undefined) {
      if (delay > 0) return;
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void pump();
    }, delay);
  };
  return {
    push(event: BrowserInput) {
      if (disposed) return;
      try { appendInput(queue, event); } catch (error) { onError(error); return; }
      // Let a short burst of keyboard input collect into one browser round trip.
      // Pointer actions and scrolling stay immediate; this bounds latency while
      // avoiding one network request per character on ordinary typing.
      schedule(event.type === "key" || event.type === "text" ? 8 : 0);
    },
    dispose() { disposed = true; clearTimeout(flushTimer); flushTimer = undefined; queue.length = 0; controller.abort(); },
  };
}
