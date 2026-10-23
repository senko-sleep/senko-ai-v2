import { useEffect, useRef, useState } from "react";

// High-rate live events (frames, cursor) skip React state entirely: the stream pushes them
// onto this tiny bus and the LiveView draws them straight to a canvas / moves the cursor.
export type LiveEvent =
  | { type: "frame"; data: string; width: number; height: number }
  | { type: "cursor"; x: number; y: number; kind: "move" | "click"; box?: { x: number; y: number; w: number; h: number } | null; width: number; height: number }
  | { type: "reset" };

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

/**
 * The agent's live browser: frames drawn to a canvas as fast as they arrive, plus Senko's
 * cursor gliding between targets while a task is running.
 */
/** Your own input in the live view, in page CSS pixels (sent to /api/sessions/:id/input). */
export type UserInput =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "move"; x: number; y: number }
  | { type: "wheel"; dx: number; dy: number; x: number; y: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string };

// Browser key names -> Playwright key names.
const KEY_MAP: Record<string, string> = { " ": "Space", Esc: "Escape", Del: "Delete", Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown" };

export function LiveView({
  bus,
  title,
  onHasFrame,
  agentRunning = false,
  interactive = false,
  onInput,
}: {
  bus: LiveBus;
  title: string;
  onHasFrame: (v: boolean) => void;
  /** Show Senko's pointer only while it is actively working. */
  agentRunning?: boolean;
  /** When true, your clicks, scrolling and typing go to the page. */
  interactive?: boolean;
  onInput?: (e: UserInput) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const geomRef = useRef<{ fit: Fit; vp: { w: number; h: number } }>({ fit: { x: 0, y: 0, w: 0, h: 0 }, vp: { w: 1280, h: 800 } });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rippleLayerRef = useRef<HTMLDivElement>(null);
  const agentRunningRef = useRef(agentRunning);
  const cursorReadyRef = useRef(false);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
    cursorReadyRef.current = false;
    if (!agentRunning) {
      if (cursorRef.current) cursorRef.current.style.opacity = "0";
      if (boxRef.current) boxRef.current.style.opacity = "0";
    }
  }, [agentRunning]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let bitmap: ImageBitmap | null = null;
    let decoding = false;
    let pending: string | null = null;
    let fit: Fit = { x: 0, y: 0, w: 0, h: 0 };
    let vp = { w: 1280, h: 800 }; // the page's viewport in CSS px (from frame/cursor metadata)
    let hasFrame = false;
    let frames = 0;

    // Cursor state: target (page px) and current (screen px), smoothed toward the target.
    let target: { x: number; y: number } | null = null;
    let cur: { x: number; y: number } | null = null;
    let clickPending = false;

    const layout = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.round(r.width * dpr));
      const H = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      fit = containFit(r.width, r.height, vp.w, vp.h);
      geomRef.current = { fit, vp };
      draw();
    };

    const draw = () => {
      if (!bitmap) return;
      const dpr = canvas.width / Math.max(1, wrap.clientWidth);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, fit.x * dpr, fit.y * dpr, fit.w * dpr, fit.h * dpr);
    };

    const decode = async (b64: string) => {
      decoding = true;
      try {
        const next = await createImageBitmap(b64ToBlob(b64));
        bitmap?.close();
        bitmap = next;
        frames++;
        if (!hasFrame) {
          hasFrame = true;
          onHasFrame(true);
        }
        draw();
      } catch {
        /* a corrupt frame: skip it */
      } finally {
        decoding = false;
        // Always jump to the newest frame that arrived while we were busy (never queue).
        if (pending) {
          const p = pending;
          pending = null;
          void decode(p);
        }
      }
    };

    const toScreen = (x: number, y: number) => ({ x: fit.x + (x / vp.w) * fit.w, y: fit.y + (y / vp.h) * fit.h });

    const ripple = (x: number, y: number) => {
      const layer = rippleLayerRef.current;
      if (!layer) return;
      const el = document.createElement("span");
      el.className = "sk-ripple";
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      layer.appendChild(el);
      setTimeout(() => el.remove(), 700);
      cursorRef.current?.classList.add("sk-cursor-press");
      setTimeout(() => cursorRef.current?.classList.remove("sk-cursor-press"), 160);
    };

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
      clearTimeout((el as unknown as { _t?: number })._t);
      (el as unknown as { _t?: number })._t = window.setTimeout(() => (el.style.opacity = "0"), 1400);
    };

    const unsub = bus.subscribe((e) => {
      if (e.type === "reset") {
        bitmap?.close();
        bitmap = null;
        hasFrame = false;
        target = null;
        cur = null;
        clickPending = false;
        cursorReadyRef.current = false;
        onHasFrame(false);
        if (cursorRef.current) cursorRef.current.style.opacity = "0";
        if (boxRef.current) boxRef.current.style.opacity = "0";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }
      if (e.type === "frame") {
        if (e.width && e.height && (e.width !== vp.w || e.height !== vp.h)) {
          vp = { w: e.width, h: e.height };
          layout();
        }
        if (decoding) pending = e.data;
        else void decode(e.data);
        return;
      }
      if (e.type === "cursor") {
        if (!agentRunningRef.current) return;
        cursorReadyRef.current = true;
        if (e.width && e.height && (e.width !== vp.w || e.height !== vp.h)) {
          vp = { w: e.width, h: e.height };
          layout();
        }
        target = { x: e.x, y: e.y };
        if (!cur || reduceMotion) cur = toScreen(e.x, e.y);
        if (e.kind === "click") clickPending = true;
        showBox(e.box);
      }
    });

    // Spring toward the target every display frame (frame-rate independent).
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const el = cursorRef.current;
      if (el && agentRunningRef.current && cursorReadyRef.current && target && cur) {
        const t = toScreen(target.x, target.y);
        const k = 1 - Math.exp(-dt * 16);
        cur = { x: cur.x + (t.x - cur.x) * k, y: cur.y + (t.y - cur.y) * k };
        const dist = Math.hypot(t.x - cur.x, t.y - cur.y);
        if (dist < 0.3) cur = t;
        el.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
        el.style.opacity = "1";
        // Click once the pointer has (nearly) arrived, so the ripple lands where it points.
        if (clickPending && dist < 6) {
          clickPending = false;
          ripple(t.x, t.y);
        }
      } else if (el) {
        el.style.opacity = "0";
        clickPending = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(layout);
    ro.observe(wrap);
    layout();

    const fpsTimer = setInterval(() => {
      setFps(frames);
      frames = 0;
    }, 1000);

    return () => {
      unsub();
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearInterval(fpsTimer);
      bitmap?.close();
    };
  }, [bus, onHasFrame]);

  // ---- your own input (takeover / after the agent is done) -----------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !interactive || !onInput) return;

    /** Screen point -> page CSS px, or null when outside the page image. */
    const toPage = (clientX: number, clientY: number) => {
      const r = wrap.getBoundingClientRect();
      const { fit, vp } = geomRef.current;
      const x = ((clientX - r.left - fit.x) / fit.w) * vp.w;
      const y = ((clientY - r.top - fit.y) / fit.h) * vp.h;
      if (!(x >= 0 && y >= 0 && x <= vp.w && y <= vp.h)) return null;
      return { x: Math.round(x), y: Math.round(y) };
    };

    let lastMove = 0;
    const onMouseMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastMove < 70) return; // ~14/s is plenty for hover menus
      lastMove = now;
      const p = toPage(e.clientX, e.clientY);
      if (p) onInput({ type: "move", ...p });
    };
    const onClick = (e: MouseEvent) => {
      const p = toPage(e.clientX, e.clientY);
      wrap.focus({ preventScroll: true });
      if (p) onInput({ type: "click", ...p });
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const p = toPage(e.clientX, e.clientY);
      if (p) onInput({ type: "click", ...p, button: "right" });
    };
    // Scroll: add up wheel ticks and send them once per display frame (the agent computer
    // glides each batch out smoothly, and queued batches merge while one is in flight).
    let wheel = { dx: 0, dy: 0, x: 0, y: 0 };
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      const p = toPage(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      wheel = { dx: wheel.dx + e.deltaX * scale, dy: wheel.dy + e.deltaY * scale, ...p };
      wheelTimer ??= setTimeout(() => {
        onInput({ type: "wheel", ...wheel });
        wheel = { dx: 0, dy: 0, x: 0, y: 0 };
        wheelTimer = null;
      }, 16);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
      // Let the browser keep its own shortcuts for leaving fullscreen etc.
      if (e.key === "Escape" && document.fullscreenElement) return;
      e.preventDefault();
      const key = KEY_MAP[e.key] || e.key;
      const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.metaKey && "Meta"].filter(Boolean) as string[];
      if (mods.length) onInput({ type: "key", key: [...mods, e.shiftKey && key.length > 1 ? "Shift" : "", key].filter(Boolean).join("+") });
      else onInput({ type: "key", key: key.length === 1 || key === "Space" ? key : e.shiftKey ? `Shift+${key}` : key });
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        e.preventDefault();
        onInput({ type: "text", text });
      }
    };

    wrap.addEventListener("mousemove", onMouseMove);
    wrap.addEventListener("click", onClick);
    wrap.addEventListener("contextmenu", onContext);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("paste", onPaste);
    return () => {
      wrap.removeEventListener("mousemove", onMouseMove);
      wrap.removeEventListener("click", onClick);
      wrap.removeEventListener("contextmenu", onContext);
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("paste", onPaste);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, [interactive, onInput]);

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 overflow-hidden outline-none ${interactive ? "sk-live-interactive cursor-default" : ""}`}
      role={interactive ? "application" : "img"}
      aria-label={interactive ? `${title || "Live browser"}: you're in control. Click, scroll and type here.` : title || "Live browser view"}
      tabIndex={interactive ? 0 : -1}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={boxRef} className="sk-target-box pointer-events-none absolute left-0 top-0 rounded-lg opacity-0" aria-hidden />
      <div ref={rippleLayerRef} className="pointer-events-none absolute inset-0" aria-hidden />
      <div ref={cursorRef} className="sk-agent-cursor pointer-events-none absolute left-0 top-0 opacity-0" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
          <path d="M3.5 2.5l16 9.2-7.1 1.6-3.4 6.6z" fill="#fff" stroke="#2a1408" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M5.4 5.6l10.3 6-4.9 1.1-2.2 4.3z" fill="url(#sk-cursor-fill)" />
          <defs>
            <linearGradient id="sk-cursor-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FFB45C" />
              <stop offset="1" stopColor="#FF7A2E" />
            </linearGradient>
          </defs>
        </svg>
        <span className="sk-cursor-tag">Senko</span>
      </div>
      {fps > 0 && (
        <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white/80 backdrop-blur" aria-hidden>
          {fps} fps
        </span>
      )}
    </div>
  );
}
