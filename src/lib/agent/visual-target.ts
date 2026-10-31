import type { Page } from "playwright";

export interface VisualTarget {
  n: number; x: number; y: number; w: number; h: number;
  alt: string; source: string; token: string;
}

/** Missing confidence, malformed answers and weak matches never authorize a click. */
export function confidentTarget(targets: VisualTarget[], answer: unknown): VisualTarget | undefined {
  if (!answer || typeof answer !== "object") return;
  const pick = answer as { n?: unknown; confidence?: unknown };
  if (typeof pick.n !== "number" || !Number.isInteger(pick.n) ||
      typeof pick.confidence !== "number" || pick.confidence < 0.85 || pick.confidence > 1) return;
  return targets.find(target => target.n === pick.n);
}

/** CSS viewport coordinates; reject stale screenshots, replaced images and overlays. */
export async function resolveVisualTarget(page: Page, target: VisualTarget) {
  return page.evaluate((target) => {
    const el = document.querySelector(`[data-senko-visual="${target.token}"]`);
    if (!(el instanceof HTMLElement)) return null;
    const source = el instanceof HTMLImageElement ? el.currentSrc || el.src : el.getAttribute("src") || "";
    if (source !== target.source) return null;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.x - target.x) > 2 || Math.abs(r.y - target.y) > 2 ||
        Math.abs(r.width - target.w) > 2 || Math.abs(r.height - target.h) > 2) return null;
    const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
    const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    if (right - left < 8 || bottom - top < 8) return null;
    const x = (left + right) / 2, y = (top + bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === el || el.contains(hit))) return null;
    return { x, y, width: innerWidth, height: innerHeight };
  }, target);
}

/** Evidence for the next observation; a pointer dispatch by itself is not success. */
export async function imageSelectionState(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({
    url: location.href,
    images: Array.from(document.images).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width >= 48 && r.height >= 48 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    }).map(el => [el.currentSrc || el.src, el.getAttribute("aria-selected"), Math.round(el.width), Math.round(el.height)]),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"], [aria-selected="true"], [aria-expanded="true"]')).map(el => el.textContent?.slice(0, 500)),
  }));
}
