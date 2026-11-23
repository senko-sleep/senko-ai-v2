// Read-only map of what is on screen, for the optional annotations overlay. It never writes to
// the page. Ids shown are the same data-agent-id values the agent's last observation assigned.

export type AnnotationKind = "link" | "button" | "input" | "image" | "nav" | "form";

export interface Annotation {
  /** The id the agent uses for this element, when it has observed it. */
  id?: number;
  kind: AnnotationKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  clickable: boolean;
  focused?: boolean;
}

export interface AnnotationSnapshot {
  items: Annotation[];
  width: number;
  height: number;
  scrollY: number;
}

/** Runs inside the page. Self-contained: Playwright serialises it as source. */
export const ANNOTATE_SCRIPT = (max: number): AnnotationSnapshot => {
  const vw = innerWidth;
  const vh = innerHeight;
  const CONTROL = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [contenteditable=""], [contenteditable=true], [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=option], [onclick]';
  const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().slice(0, 32);
  const labelOf = (el: HTMLElement) => {
    const field = el as HTMLInputElement;
    return clean(el.getAttribute("aria-label") || el.innerText || field.placeholder || field.value || el.title || el.getAttribute("alt"));
  };
  const kindOf = (el: HTMLElement): AnnotationKind => {
    const tag = el.tagName;
    const role = el.getAttribute("role");
    if (tag === "INPUT" && /^(button|submit|reset|checkbox|radio)$/i.test((el as HTMLInputElement).type)) return "button";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || role === "combobox") return "input";
    if (tag === "A" || role === "link") return "link";
    return "button";
  };
  const onScreen = (r: DOMRect) => r.width >= 6 && r.height >= 6 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  const box = (r: DOMRect) => {
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    return { x, y, w: Math.min(vw, r.right) - x, h: Math.min(vh, r.bottom) - y };
  };
  const shown = (el: Element) => {
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05;
  };
  /** Actually on top at its centre, so boxes never mark things hidden behind a dialog. */
  const reachable = (el: Element, r: DOMRect) => {
    const b = box(r);
    const hit = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  const ours = (el: Element) => !!el.closest("#__senko_marks, [data-senko-select]");
  const items: Annotation[] = [];
  const seen = new Set<Element>();
  const active = document.activeElement;
  for (const node of Array.from(document.querySelectorAll<HTMLElement>(CONTROL))) {
    if (items.length >= max) break;
    if (seen.has(node) || ours(node)) continue;
    // A control nested in another control (a span role=button in a link) is the same target.
    if (node.parentElement?.closest(CONTROL) && !node.matches("input, select, textarea")) continue;
    seen.add(node);
    const r = node.getBoundingClientRect();
    if (!onScreen(r) || !shown(node) || !reachable(node, r)) continue;
    const raw = node.getAttribute("data-agent-id");
    items.push({
      ...(raw !== null && Number.isFinite(Number(raw)) ? { id: Number(raw) } : {}),
      kind: kindOf(node),
      label: labelOf(node),
      ...box(r),
      clickable: !(node as HTMLButtonElement).disabled,
      ...(node === active ? { focused: true } : {}),
    });
  }
  for (const img of Array.from(document.images).slice(0, 200)) {
    if (items.length >= max) break;
    if (ours(img)) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 48 || r.height < 48 || !onScreen(r) || !shown(img) || !reachable(img, r)) continue;
    items.push({ kind: "image", label: clean(img.alt), ...box(r), clickable: !!img.closest("a, button, [role=button], [role=link]") });
  }
  for (const region of Array.from(document.querySelectorAll<HTMLElement>("nav, [role=navigation], form")).slice(0, 8)) {
    const r = region.getBoundingClientRect();
    if (r.height < 20 || !onScreen(r) || !shown(region)) continue;
    items.push({ kind: region.tagName === "FORM" ? "form" : "nav", label: clean(region.getAttribute("aria-label")), ...box(r), clickable: false });
  }
  return { items, width: vw, height: vh, scrollY: Math.round(scrollY) };
};

export interface AnnotationStyle {
  stroke: string;
  fill: string;
  dashed: boolean;
}

/** Interactive targets stand out; images and page regions stay quiet. */
export function annotationStyle(item: Pick<Annotation, "kind" | "clickable">): AnnotationStyle {
  if (item.kind === "nav" || item.kind === "form") return { stroke: "rgba(255,255,255,.2)", fill: "transparent", dashed: true };
  if (item.kind === "image") return { stroke: item.clickable ? "rgba(255,170,90,.55)" : "rgba(255,255,255,.3)", fill: "transparent", dashed: !item.clickable };
  if (!item.clickable) return { stroke: "rgba(160,160,160,.5)", fill: "transparent", dashed: true };
  if (item.kind === "input") return { stroke: "rgba(92,190,255,.9)", fill: "rgba(92,190,255,.07)", dashed: false };
  return { stroke: "rgba(255,138,31,.85)", fill: "rgba(255,138,31,.06)", dashed: false };
}

/**
 * Which items get a text tag: the agent's own targets first, biggest first, skipping any tag
 * that would collide with one already placed, so a dense page stays readable.
 */
export function pickLabels<T extends Pick<Annotation, "id" | "label" | "kind" | "x" | "y" | "w" | "h">>(items: T[], limit = 28, tagHeight = 15): T[] {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: T[] = [];
  const ranked = items
    .filter((i) => i.kind !== "nav" && i.kind !== "form" && i.kind !== "image" && (i.label || i.id !== undefined))
    .sort((a, b) => Number(b.id !== undefined) - Number(a.id !== undefined) || b.w * b.h - a.w * a.h);
  for (const item of ranked) {
    if (out.length >= limit) break;
    const text = `${item.id ?? ""} ${item.label}`.trim();
    const tag = { x: item.x, y: Math.max(0, item.y - tagHeight), w: Math.min(150, text.length * 6 + 8), h: tagHeight };
    if (placed.some((p) => tag.x < p.x + p.w && tag.x + tag.w > p.x && tag.y < p.y + p.h && tag.y + tag.h > p.y)) continue;
    placed.push(tag);
    out.push(item);
  }
  return out;
}
