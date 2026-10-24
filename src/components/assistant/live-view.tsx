import { memo, useEffect, useRef, useState } from "react";
import { createFrameDecoder } from "@/lib/live-frame";
import { appendInput, pagePoint, type BrowserInput } from "@/lib/live-input";

// High-rate live events (frames, cursor) skip React state entirely: the stream pushes them
// onto this tiny bus and the LiveView draws them straight to a canvas / moves the cursor.
export type LiveEvent =
  | { type: "frame"; data: string; width: number; height: number; epoch?: number }
  | { type: "cursor"; x: number; y: number; kind: "move" | "click"; box?: { x: number; y: number; w: number; h: number } | null; width: number; height: number }
  | { type: "pointer"; cursor: string }
  | { type: "audio"; id: string; seq?: number; data?: string; end?: boolean }
  | { type: "reset"; epoch?: number };

export function createLiveBus() {
  const subs = new Set<(e: LiveEvent) => void>();
  return {
    emit(e: LiveEvent) {
      subs.forEach((fn) => fn(e));
    },
    subscribe(fn: (e: LiveEvent) => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}
export type LiveBus = ReturnType<typeof createLiveBus>;

function b64ToBlob(b64: string): Blob {
  // Native decoding avoids a JS loop and an intermediate UTF-16 string on modern clients.
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> }).fromBase64;
  if (fromBase64) return new Blob([fromBase64(b64)], { type: "image/jpeg" });
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

interface Fit {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where an image of size iw×ih lands inside cw×ch with object-fit: contain. */
function containFit(cw: number, ch: number, iw: number, ih: number): Fit {
  if (!iw || !ih) return { x: 0, y: 0, w: cw, h: ch };
  const s = Math.min(cw / iw, ch / ih);
  const w = iw * s;
  const h = ih * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** Your own input in the live view, in page CSS pixels (sent to /api/sessions/:id/input). */
export type UserInput = BrowserInput;

// CSS cursors the page may ask for (url() cursors fall back to the default arrow).
const CSS_CURSOR = /^(auto|default|none|context-menu|help|pointer|progress|wait|cell|crosshair|text|vertical-text|alias|copy|move|no-drop|not-allowed|grab|grabbing|all-scroll|col-resize|row-resize|[nsew]{1,2}-resize|nesw-resize|nwse-resize|zoom-in|zoom-out)$/;

/** CSS width pages are laid out at when the panel is narrower (then scaled to fit). */
const DESKTOP_WIDTH = 1280;

// Browser key names -> Playwright key names.
const KEY_MAP: Record<string, string> = { " ": "Space", Esc: "Escape", Del: "Delete", Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown" };

export const LiveView = memo(function LiveView({
  bus,
  title,
  onHasFrame,
  agentRunning = false,
  agentName = "Senko",
  interactive = false,
  onInput,
  onViewport,
}: {
  bus: LiveBus;
  title: string;
  onHasFrame: (v: boolean) => void;
  /** Show Senko's pointer only while it is actively working. */
  agentRunning?: boolean;
  /** Shown next to the AI's pointer (the bot / model driving the browser). */
  agentName?: string;
  /** When true, your clicks, scrolling and typing go to the page. */
  interactive?: boolean;
  onInput?: (e: UserInput) => void;
  /** The panel's size in CSS px; the session resizes the real page to it. */
  onViewport?: (size: { width: number; height: number }) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const geomRef = useRef<{ fit: Fit; vp: { w: number; h: number } }>({ fit: { x: 0, y: 0, w: 0, h: 0 }, vp: { w: 1280, h: 800 } });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rippleLayerRef = useRef<HTMLDivElement>(null);
  const [pageCursor, setPageCursor] = useState("default");
  const onViewportRef = useRef(onViewport);
  useEffect(() => { onViewportRef.current = onViewport; }, [onViewport]);

  useEffect(() => {
    // The AI's pointer stays on screen between tasks, just quieter.
    cursorRef.current?.classList.toggle("sk-agent-cursor-idle", !agentRunning);
    if (!agentRunning && boxRef.current) boxRef.current.style.opacity = "0";
  }, [agentRunning]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    let bitmap: ImageBitmap | null = null;
    let fit: Fit = { x: 0, y: 0, w: 0, h: 0 };
    let vp = { w: 1280, h: 800 }; // the page's viewport in CSS px (from frame/cursor metadata)
    let hasFrame = false;
    let size = { w: 0, h: 0, dpr: 1 };
    let layoutDirty = true;
    let paintDirty = false;
    let cursor: Extract<LiveEvent, { type: "cursor" }> | null = null;
    let cursorDirty = false;
    let latestHidden: Extract<LiveEvent, { type: "frame" }> | null = null;
    let raf = 0;
    let boxTimer = 0;
    const schedule = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(render);
    };
    const layout = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { w: r.width, h: r.height, dpr };
      const W = Math.max(1, Math.round(r.width * dpr));
      const H = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      fit = containFit(r.width, r.height, vp.w, vp.h);
      geomRef.current = { fit, vp };
      // JPEGs are opaque; clear letterboxing only when geometry changes.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = "high";
    };

    const draw = () => {
      if (!bitmap) return;
      const dpr = size.dpr;
      ctx.drawImage(bitmap, fit.x * dpr, fit.y * dpr, fit.w * dpr, fit.h * dpr);
    };

    const decoder = createFrameDecoder<Extract<LiveEvent, { type: "frame" }>, ImageBitmap>(
      frame => createImageBitmap(b64ToBlob(frame.data)),
      (next, frame) => {
        bitmap?.close();
        bitmap = next;
        if (frame.width && frame.height && (frame.width !== vp.w || frame.height !== vp.h)) {
          vp = { w: frame.width, h: frame.height };
          layoutDirty = true;
        }
        paintDirty = true;
        schedule();
      },
      image => image.close(),
    );

    const toScreen = (x: number, y: number) => ({ x: fit.x + (x / vp.w) * fit.w, y: fit.y + (y / vp.h) * fit.h });

    const showBox = (box: { x: number; y: number; w: number; h: number } | null | undefined) => {
      const el = boxRef.current;
      if (!el) return;
      if (!box) {
        el.style.opacity = "0";
        return;
      }
      const a = toScreen(box.x, box.y);
      const b = toScreen(box.x + box.w, box.y + box.h);
      el.style.transform = `translate3d(${a.x - 3}px, ${a.y - 3}px, 0)`;
      el.style.width = `${b.x - a.x + 6}px`;
      el.style.height = `${b.y - a.y + 6}px`;
      el.style.opacity = "1";
      clearTimeout(boxTimer);
      boxTimer = window.setTimeout(() => (el.style.opacity = "0"), 1400);
    };

    // The AI's pointer glides toward each real mouse position it reports (the agent's
    // moves arrive in bursts over the network); clicks ripple once it gets there.
    const pos = { x: NaN, y: NaN };
    let lastTick = 0;
    let pendingClick = false;
    const ripple = (x: number, y: number) => {
      const layer = rippleLayerRef.current;
      if (!layer) return;
      const el = document.createElement("span");
      el.className = "sk-ripple";
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      layer.appendChild(el);
      setTimeout(() => el.remove(), 700);
      const c = cursorRef.current;
      c?.classList.add("sk-cursor-press");
      setTimeout(() => c?.classList.remove("sk-cursor-press"), 160);
    };

    // One draw per display frame, only when a frame, geometry or cursor has changed.
    function render(now: number) {
      raf = 0;
      if (document.hidden) return;
      if (layoutDirty || size.dpr !== Math.min(window.devicePixelRatio || 1, 2)) {
        layout(); layoutDirty = false; paintDirty = true; cursorDirty = true;
      }
      if (paintDirty && bitmap) {
        draw(); paintDirty = false;
        if (!hasFrame) {
          hasFrame = true; onHasFrame(true);
          // Show the pointer from the first frame on, so it's always somewhere on screen.
          if (!cursor) { cursor = { type: "cursor", x: vp.w / 2, y: vp.h / 2, kind: "move", width: vp.w, height: vp.h }; cursorDirty = true; }
        }
      }
      const el = cursorRef.current;
      if (el && cursor && (cursorDirty || pos.x !== cursor.x || pos.y !== cursor.y)) {
        cursorDirty = false;
        const dt = Math.min(64, lastTick ? now - lastTick : 16);
        const k = Number.isNaN(pos.x) || reduceMotion ? 1 : 1 - Math.exp(-dt / 40); // ~120ms glide; animation only, it never delays the real click
        pos.x = Number.isNaN(pos.x) ? cursor.x : pos.x + (cursor.x - pos.x) * k;
        pos.y = Number.isNaN(pos.y) ? cursor.y : pos.y + (cursor.y - pos.y) * k;
        if (Math.abs(cursor.x - pos.x) < 0.5 && Math.abs(cursor.y - pos.y) < 0.5) { pos.x = cursor.x; pos.y = cursor.y; }
        const at = toScreen(pos.x, pos.y);
        el.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
        el.style.opacity = "1";
        if (pos.x === cursor.x && pos.y === cursor.y) {
          if (pendingClick) { pendingClick = false; ripple(at.x, at.y); }
          if (cursor.box) { showBox(cursor.box); cursor = { ...cursor, box: null }; }
          lastTick = 0;
        } else {
          lastTick = now;
          schedule();
        }
      }
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const unsub = bus.subscribe((e) => {
      if (e.type === "reset") {
        decoder.reset();
        latestHidden = null;
        bitmap?.close();
        bitmap = null;
        paintDirty = false;
        clearTimeout(boxTimer);
        if (boxRef.current) boxRef.current.style.opacity = "0";
        // Keep the last pixels and the pointer visible while the new document starts
        // producing frames. Clearing here creates a black flash on every nav/tab switch.
        return;
      }
      if (e.type === "frame") {
        if (document.hidden) latestHidden = e;
        else decoder.push(e);
        return;
      }
      if (e.type === "pointer") {
        setPageCursor(CSS_CURSOR.test(e.cursor) ? e.cursor : "default");
        return;
      }
      if (e.type === "cursor") {
        if (e.kind === "click") pendingClick = true;
        // Frames own the page geometry; a pointer reported for an older page size is scaled into it.
        cursor = e.width && e.height && (e.width !== vp.w || e.height !== vp.h) ? { ...e, x: (e.x / e.width) * vp.w, y: (e.y / e.height) * vp.h, box: null } : e;
        cursorDirty = true;
        schedule();
      }
    });

    // The real browser's viewport follows this panel, so pages lay out for the space you see.
    let reportTimer: ReturnType<typeof setTimeout> | undefined;
    let reported = "";
    const report = () => {
      clearTimeout(reportTimer);
      reportTimer = setTimeout(() => {
        const r = wrap.getBoundingClientRect();
        const w = Math.round(r.width), h = Math.round(r.height);
        if (w < 200 || h < 150 || `${w}x${h}` === reported) return;
        reported = `${w}x${h}`;
        // Pages get a desktop-width viewport (~1280 CSS px) shown scaled down to the panel,
        // like a normal browser window zoomed out, instead of a cramped tablet layout.
        // Same aspect ratio as the panel, so it still fills it edge to edge.
        const zoom = Math.max(0.5, Math.min(1, w / DESKTOP_WIDTH));
        onViewportRef.current?.({ width: Math.round(w / zoom), height: Math.round(h / zoom) });
      }, 250);
    };
    const resize = () => { layoutDirty = true; schedule(); report(); };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf); raf = 0; decoder.reset();
      } else {
        if (latestHidden) { decoder.push(latestHidden); latestHidden = null; }
        resize();
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    schedule();

    return () => {
      unsub();
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      decoder.dispose();
      clearTimeout(boxTimer);
      clearTimeout(reportTimer);
      bitmap?.close();
    };
  }, [bus, onHasFrame]);

  // ---- your own input (takeover / after the agent is done) -----------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !interactive || !onInput) return;

    /** Screen point -> page CSS px, or null when outside the page image. */
    const toPage = (clientX: number, clientY: number, clamp = false) => {
      const r = wrap.getBoundingClientRect();
      const { fit, vp } = geomRef.current;
      return pagePoint(clientX - r.left, clientY - r.top, fit, vp, clamp);
    };

    const continuous: BrowserInput[] = [];
    let inputRaf = 0;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let pressed: { button: "left" | "right" | "middle"; x: number; y: number; clickCount: number } | null = null;
    const flush = () => {
      cancelAnimationFrame(inputRaf); inputRaf = 0;
      clearTimeout(hoverTimer); hoverTimer = undefined;
      for (const event of continuous.splice(0)) onInput(event);
    };
    const queue = () => { if (!inputRaf) inputRaf = requestAnimationFrame(flush); };
    const onPointerMove = (e: PointerEvent) => {
      const p = toPage(e.clientX, e.clientY, !!pressed);
      if (p) {
        appendInput(continuous, { type: "move", ...p });
        if (pressed) pressed = { ...pressed, ...p };
        // Hover needs the final position, but not an HTTP request at every display
        // refresh. Drags bypass this limit; clicks flush pending input immediately.
        if (pressed) queue();
        else hoverTimer ??= setTimeout(queue, 24);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button > 2 || pressed) return;
      const p = toPage(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      (keyboardRef.current || wrap).focus({ preventScroll: true });
      flush();
      pressed = { ...p, button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left", clickCount: Math.min(3, e.detail || 1) };
      wrap.setPointerCapture(e.pointerId);
      onInput({ type: "down", ...pressed });
    };
    const release = () => { if (pressed) { flush(); onInput({ type: "up", ...pressed }); pressed = null; } };
    const onPointerUp = (e: PointerEvent) => {
      const p = toPage(e.clientX, e.clientY, true);
      if (pressed && p) pressed = { ...pressed, ...p };
      release();
      if (wrap.hasPointerCapture(e.pointerId)) wrap.releasePointerCapture(e.pointerId);
    };
    const onClick = (e: MouseEvent) => {
      // Keyboard/assistive-technology activation has no pointerdown/up sequence.
      if (e.detail === 0) { const p = toPage(e.clientX, e.clientY); if (p) { flush(); onInput({ type: "click", ...p }); } }
    };
    const onContext = (e: MouseEvent) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      const p = toPage(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      appendInput(continuous, { type: "wheel", dx: e.deltaX * scale, dy: e.deltaY * scale, ...p });
      queue();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || ["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Process", "Unidentified"].includes(e.key)) return;
      // Let the browser keep its own shortcuts for leaving fullscreen etc.
      if (e.key === "Escape" && document.fullscreenElement) return;
      const key = KEY_MAP[e.key] || e.key;
      const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.metaKey && "Meta"].filter(Boolean) as string[];
      // A real text sink enables Unicode, mobile keyboards and IME composition.
      if (!mods.length && [...e.key].length === 1 && e.target === keyboardRef.current) return;
      e.preventDefault();
      flush();
      if (!mods.length && [...e.key].length === 1) onInput({ type: "text", text: e.key });
      else if (mods.length) onInput({ type: "key", key: [...mods, e.shiftKey ? "Shift" : "", key].filter(Boolean).join("+") });
      else onInput({ type: "key", key: key.length === 1 || key === "Space" ? key : e.shiftKey ? `Shift+${key}` : key });
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        e.preventDefault();
        flush();
        onInput({ type: "text", text });
      }
    };

    const onTextInput = (e: Event) => {
      const sink = keyboardRef.current;
      if (!sink || (e as InputEvent).isComposing || !sink.value) return;
      flush(); onInput({ type: "text", text: sink.value }); sink.value = "";
    };
    const onCompositionEnd = (e: CompositionEvent) => {
      if (e.data) { flush(); onInput({ type: "text", text: e.data }); }
      if (keyboardRef.current) keyboardRef.current.value = "";
    };
    const discard = () => {
      pressed = null;
      continuous.length = 0;
      cancelAnimationFrame(inputRaf); inputRaf = 0;
      clearTimeout(hoverTimer); hoverTimer = undefined;
    };
    const unsubscribe = bus.subscribe(event => { if (event.type === "reset") discard(); });
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", release);
    wrap.addEventListener("lostpointercapture", release);
    wrap.addEventListener("focusout", release);
    wrap.addEventListener("click", onClick);
    wrap.addEventListener("contextmenu", onContext);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("paste", onPaste);
    wrap.addEventListener("compositionend", onCompositionEnd);
    wrap.addEventListener("input", onTextInput);
    if (document.activeElement?.hasAttribute("data-browser-control")) keyboardRef.current?.focus({ preventScroll: true });
    return () => {
      // The server releases held buttons on takeover/stream close. Emitting here
      // could send old-view input into the chat that just replaced this component.
      discard();
      unsubscribe();
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerdown", onPointerDown);
      wrap.removeEventListener("pointerup", onPointerUp);
      wrap.removeEventListener("pointercancel", release);
      wrap.removeEventListener("lostpointercapture", release);
      wrap.removeEventListener("focusout", release);
      wrap.removeEventListener("click", onClick);
      wrap.removeEventListener("contextmenu", onContext);
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("paste", onPaste);
      wrap.removeEventListener("compositionend", onCompositionEnd);
      wrap.removeEventListener("input", onTextInput);
    };
  }, [bus, interactive, onInput]);

  return (
    <div
      ref={wrapRef}
      className={`sk-live-view absolute inset-0 overflow-hidden outline-none ${interactive ? "sk-live-interactive" : ""}`}
      style={interactive ? { cursor: pageCursor } : undefined}
      role={interactive ? "application" : "img"}
      aria-label={interactive ? `${title || "Live browser"}: you're in control. Click, scroll and type here.` : title || "Live browser view"}
      tabIndex={interactive ? 0 : -1}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <textarea ref={keyboardRef} tabIndex={-1} aria-label="Live browser keyboard" autoComplete="off" autoCapitalize="off" spellCheck={false} className="absolute left-0 top-0 h-px w-px opacity-0" />
      <div ref={boxRef} className="sk-target-box pointer-events-none absolute left-0 top-0 rounded-lg opacity-0" aria-hidden />
      <div ref={rippleLayerRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {/* The AI's pointer: a fox-orange arrow (tip exactly at the click point) with the bot's name beside it. */}
      <div ref={cursorRef} className="sk-agent-cursor pointer-events-none absolute left-0 top-0 opacity-0" aria-hidden>
        <svg width="30" height="32" viewBox="0 0 30 32">
          <defs>
            <linearGradient id="sk-ai-cursor" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FFC56B" />
              <stop offset=".45" stopColor="#FF8A1F" />
              <stop offset="1" stopColor="#D9480A" />
            </linearGradient>
          </defs>
          <path d="M2 2.2 27 12.6c1.3.55 1.2 2.4-.15 2.75l-9.6 2.6-3.9 9.3c-.55 1.3-2.4 1.25-2.8-.1L2 2.2Z" fill="url(#sk-ai-cursor)" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <span className="sk-cursor-tag">{agentName}</span>
      </div>
    </div>
  );
});
