// Predictive scrolling for the live browser view. The view is a video of a real Chrome:
// a scroll goes to the server, Chrome scrolls, and the next frame comes back one round
// trip later. Until then the last frame is drawn shifted by the scroll not yet shown, so the
// page moves under your finger right away (the way remote-desktop apps hide latency).

export interface ScrollPredictor {
  /** You scrolled by dy CSS px (positive = down). */
  scrolled(dy: number): void;
  /** A new frame arrived: drop the scroll it most likely already shows. */
  onFrame(): void;
  /** Scroll (CSS px) the current picture doesn't show yet. */
  pending(): number;
  /** Set by the view: draw again. */
  repaint: () => void;
  /** The learned input-to-frame delay (ms). */
  lag(): number;
  dispose(): void;
}

/** A frame this soon after a scroll can't contain it yet (no round trip is that fast). */
const MIN_ROUND_TRIP_MS = 40;

export function createScrollPredictor(now: () => number = () => performance.now()): ScrollPredictor {
  let items: { dy: number; t: number }[] = [];
  let lag = 160;
  let waiting = 0; // when the oldest scroll not yet seen in a frame was made
  let snap: ReturnType<typeof setTimeout> | undefined;
  const p: ScrollPredictor = {
    repaint: () => {},
    scrolled(dy) {
      if (!dy || !Number.isFinite(dy)) return;
      const t = now();
      items.push({ dy, t });
      if (!waiting) waiting = t;
      p.repaint();
      // No frame came back (the page couldn't scroll further): put the picture back.
      clearTimeout(snap);
      snap = setTimeout(() => {
        if (!items.length) return;
        items = [];
        waiting = 0;
        p.repaint();
      }, Math.max(450, lag * 3));
    },
    onFrame() {
      const t = now();
      if (waiting && t - waiting >= MIN_ROUND_TRIP_MS) {
        lag = Math.min(900, Math.max(80, lag * 0.75 + (t - waiting) * 0.25));
        waiting = 0;
      }
      items = items.filter((i) => t - i.t < lag);
      if (items.length && !waiting) waiting = items[0].t;
    },
    pending: () => items.reduce((s, i) => s + i.dy, 0),
    lag: () => lag,
    dispose() {
      clearTimeout(snap);
      items = [];
    },
  };
  return p;
}
