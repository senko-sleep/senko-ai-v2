// How the agent sees and touches the page.
//
// One in-page script (PAGE_SCRIPT) does all DOM work, so each step costs few browser round
// trips (each one is a network hop on a cloud browser):
//   observe  list interactive elements (on-screen first, open menus/dialogs before the rest,
//            then nearby off-screen ones), with a fingerprint per element, page state
//            (overlay / loading), on-screen text and the real viewport size.
//   resolve  find an observed element again (by id, or by fingerprint if the page re-rendered
//            it), scroll it into view if needed, and pick a point on it that really hits it
//            (not a banner or header covering it).
//   verify   after the pointer arrives, wait a few frames and check the target hasn't moved
//            or been covered (hover menus, late banners, layout shifts) before pressing.
//   settle   wait until the DOM is quiet and nothing is loading, instead of fixed sleeps.
//
// The visible cursor is decoupled from execution: the live view animates toward the target
// from one event while the real pointer moves there in a single step.
import type { Page } from "playwright";
import type { ElementFingerprint } from "./nav-memory";
import { orTimeout } from "./timeouts";

export interface Box { x: number; y: number; w: number; h: number }

export interface ObservedElement {
  id: number;
  tag: string;
  type: string;
  text: string;
  href: string;
  /** Center and size in viewport CSS px. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** "above" / "below" / "side" when the element is outside the viewport (clicking scrolls to it). */
  off?: string;
  /** What covers its center, when something does. */
  covered?: string;
  /** new | disabled | expanded | collapsed | checked | selected | in-dialog | in-menu */
  flags?: string[];
  ctx?: string;
  fp?: ElementFingerprint;
}

export interface PageState {
  vw: number;
  vh: number;
  scrollY: number;
  scrollH: number;
  overlay: string | null;
  loading: boolean;
}

export interface DomObservation {
  elements: ObservedElement[];
  images: { url: string; alt: string; col: number; row: number }[];
  text: string;
  pageText?: string;
  atBottom: boolean;
  state?: PageState;
  /** Interactive elements left out of the list (it is capped). */
  more?: { onScreen: number; offScreen: number };
}

export type Resolved =
  | { status: "ok"; x: number; y: number; box: Box; vw: number; vh: number; how: "id" | "fingerprint"; scrolled: boolean }
  | { status: "covered"; x: number; y: number; box: Box; vw: number; vh: number; how: "id" | "fingerprint"; scrolled: boolean; by: string }
  | { status: "missing" }
  | { status: "hidden" };

export type Verified =
  | { ok: true; mark: number; url: string; scrollY: number; focus: string; value: string }
  | { ok: false; why: "missing" | "moved" | "covered"; by?: string };

export type ScriptArg =
  | { cmd: "observe"; max: number }
  | { cmd: "resolve"; id: number; fp: ElementFingerprint | null }
  | { cmd: "activate"; id: number; fp: ElementFingerprint | null }
  | { cmd: "verify"; id: number; x: number; y: number; frames: number }
  | { cmd: "settle"; quietMs: number; maxMs: number }
  | { cmd: "effect"; id: number; mark: number; url: string; scrollY: number; focus: string; value: string };

/** Runs inside the page. Self-contained: Playwright serialises it as source. */
export const PAGE_SCRIPT = async (arg: ScriptArg): Promise<unknown> => {
  type W = Window & {
    __senkoMO?: MutationObserver;
    __senkoMut?: { n: number; at: number };
    __senkoTicks?: WeakMap<Node, number>;
    __senkoSeen?: WeakSet<Element>;
    __senkoObserved?: boolean;
  };
  const w = window as W;
  const SEL =
    'a[href], button, input:not([type=hidden]), textarea, select, video, summary, [contenteditable=""], [contenteditable=true], [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=treeitem], [onclick], [aria-label][tabindex]';
  const LAYER = '[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open], [role=menu], [role=listbox], [role=tooltip]';
  const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
  const labelOf = (el: HTMLElement): string => {
    const input = el as HTMLInputElement;
    const t = norm(el.getAttribute("aria-label") || el.innerText || input.value || input.placeholder || el.title || el.getAttribute("alt") || "");
    return (t || norm((el.querySelector("img[alt]") as HTMLImageElement | null)?.alt)).slice(0, 90);
  };
  // The text that tells repeated controls apart: the heading or first words of their item/card.
  const ctxOf = (el: HTMLElement, label: string): string => {
    const item = el.parentElement?.closest("article, li, tr, [role=row], [role=listitem], [role=article], section, fieldset, form, [class*=card], [class*=item], [class*=post]") as HTMLElement | null;
    if (!item) return "";
    const h = item.querySelector("h1, h2, h3, h4, h5, h6, [role=heading], legend, th") as HTMLElement | null;
    let t = h && !el.contains(h) ? norm(h.innerText || h.textContent) : "";
    // Fall back to the item's own words only for small items (not a page-wide form/section).
    if (!t && (item.textContent || "").length < 600) t = norm(item.innerText).replace(label, "").trim();
    return t.slice(0, 50);
  };
  const visible = (el: Element) => {
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) !== 0;
  };
  const describe = (node: Element | null): string => {
    if (!node) return "something";
    let top: HTMLElement | null = node as HTMLElement;
    // The element that actually covers: the outermost fixed/sticky/dialog ancestor of the hit.
    for (let a: HTMLElement | null = node as HTMLElement; a && a !== document.body; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === "fixed" || pos === "sticky" || a.matches(LAYER)) top = a;
    }
    const name = norm(top!.getAttribute("aria-label") || top!.innerText || "").slice(0, 60);
    const tag = top!.tagName.toLowerCase() + (top!.id ? `#${top!.id}` : "");
    return name ? `${tag} "${name}"` : tag;
  };
  const hits = (el: HTMLElement, x: number, y: number) => {
    const h = document.elementFromPoint(x, y);
    if (!h) return false;
    if (h === el || el.contains(h)) return true;
    const lab = h.closest("label") as HTMLLabelElement | null;
    return !!lab && lab.control === el;
  };
  const busy = () => {
    if (document.readyState === "loading") return true;
    const vh = innerHeight;
    for (const el of Array.from(document.querySelectorAll('[aria-busy="true"], [role=progressbar]:not([aria-valuenow]), [class*=spinner], [class*=loading], [class*=skeleton], [class*=loader]')).slice(0, 40)) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > vh || r.width * r.height > innerWidth * vh * 0.9) continue;
      if (visible(el)) return true;
    }
    return false;
  };
  const IGNORE = new Set(["style", "data-agent-id", "aria-valuenow", "aria-valuetext"]);
  // Counts page changes that matter (elements added/removed, state attributes), not animation ticks.
  // Counts page changes that matter: elements added/removed, state attributes, and text that
  // changed in a place that isn't constantly changing. Tickers (clocks, viewer counts, video
  // time) update the same element over and over, so an element whose text changed within the
  // last 3s doesn't count again.
  const count = (recs: MutationRecord[]) => {
    let n = 0;
    const now = performance.now();
    const ticks = (w.__senkoTicks ??= new WeakMap<Node, number>());
    for (const r of recs) {
      if (r.type === "attributes") {
        if (!IGNORE.has(r.attributeName || "")) n++;
        continue;
      }
      if (r.type === "childList" && Array.from(r.addedNodes).concat(Array.from(r.removedNodes)).some((x) => x.nodeType === 1)) {
        n++;
        continue;
      }
      // Text-only change (childList of text nodes, or characterData).
      const owner = r.type === "characterData" ? r.target.parentNode : r.target;
      if (!owner) continue;
      const last = ticks.get(owner);
      ticks.set(owner, now);
      if (last === undefined || now - last > 3000) n++;
    }
    if (n && w.__senkoMut) {
      w.__senkoMut.n += n;
      w.__senkoMut.at = now;
    }
  };
  const installMO = () => {
    if (w.__senkoMO) return;
    w.__senkoMut = { n: 0, at: performance.now() };
    w.__senkoMO = new MutationObserver(count);
    w.__senkoMO.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  const flush = () => count(w.__senkoMO?.takeRecords() || []);
  const frame = () => new Promise<void>((r) => { requestAnimationFrame(() => r()); setTimeout(r, 50); });
  const valueOf = (el: Element | null) => {
    if (!el) return "";
    const i = el as HTMLInputElement;
    return `${i.value ?? ""}|${i.checked ?? ""}|${el.getAttribute("aria-expanded") || ""}|${el.getAttribute("aria-checked") || ""}|${el.getAttribute("aria-selected") || ""}|${el.getAttribute("aria-pressed") || ""}|${(el as HTMLDetailsElement).open ?? ""}`;
  };
  const focusKey = () => {
    const a = document.activeElement as HTMLElement | null;
    return a ? `${a.tagName}|${a.getAttribute("data-agent-id") || ""}|${a.id}` : "";
  };

  installMO();

  if (arg.cmd === "observe") {
    const vw = innerWidth;
    const vh = innerHeight;
    document.querySelectorAll("[data-agent-id]").forEach((e) => e.removeAttribute("data-agent-id"));
    const seen = (w.__senkoSeen ??= new WeakSet());
    const first = !w.__senkoObserved;
    w.__senkoObserved = true;
    type Cand = { el: HTMLElement; r: DOMRect; label: string; tag: string; on: boolean; dist: number; layer: Element | null; order: number; chrome: boolean };
    const cands: Cand[] = [];
    const linkSeen = new Set<string>();
    let order = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(SEL))) {
      if (cands.length >= 700) break;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const label = labelOf(el);
      const isField = tag === "input" || tag === "textarea" || tag === "select" || tag === "video" || el.isContentEditable;
      if (!label && !isField) continue;
      const href = (el as HTMLAnchorElement).href || "";
      // The same link twice (logo + title) is one choice; repeated buttons are not.
      if (href) {
        const k = `${label}|${href}`;
        if (linkSeen.has(k)) continue;
        linkSeen.add(k);
      }
      const on = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      const dist = on ? 0 : r.right <= 0 || r.left >= vw ? 1e7 + Math.abs(r.top) : r.top >= vh ? r.top - vh : -r.bottom;
      cands.push({ el, r, label, tag, on, dist, layer: el.closest(LAYER), order: order++, chrome: !!el.closest("nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]") });
    }
    // What the user is looking at comes first: open menus/dialogs, then what just appeared
    // (the result of the last action), then main content, then site navigation/header/footer;
    // reading order within each. Then the nearest off-screen elements.
    const totalNew = first ? 0 : cands.filter((c) => !seen.has(c.el)).length;
    // Only a few new elements is a menu/popup/result appearing; a whole re-render isn't news.
    const isNew = (c: Cand) => totalNew > 0 && totalNew <= 15 && !seen.has(c.el);
    const rank = (c: Cand) => (c.layer ? 0 : isNew(c) ? 1 : c.chrome ? 3 : 2);
    const onScreen = cands.filter((c) => c.on).sort((a, b) => rank(a) - rank(b) || a.order - b.order);
    const offScreen = cands.filter((c) => !c.on && c.dist < 1e7).sort((a, b) => (a.chrome ? 1 : 0) - (b.chrome ? 1 : 0) || a.dist - b.dist);
    const reserve = Math.min(offScreen.length, 10);
    const picked = [...onScreen.slice(0, arg.max - reserve), ...offScreen].slice(0, arg.max);
    const more = { onScreen: Math.max(0, onScreen.length - picked.filter((c) => c.on).length), offScreen: Math.max(0, offScreen.length - picked.filter((c) => !c.on).length) };
    const dupes = new Map<string, number>();
    for (const c of picked) dupes.set(`${c.tag}|${c.label}`, (dupes.get(`${c.tag}|${c.label}`) || 0) + 1);
    const nth = new Map<string, number>();
    const out = picked.map((c, i) => {
      const id = i + 1;
      c.el.setAttribute("data-agent-id", String(id));
      const input = c.el as HTMLInputElement;
      const ctx = (dupes.get(`${c.tag}|${c.label}`) || 0) > 1 || c.label.length < 3 ? ctxOf(c.el, c.label) : "";
      const nk = `${c.tag}|${c.label}|${ctx}`;
      const n = nth.get(nk) || 0;
      nth.set(nk, n + 1);
      const flags: string[] = [];
      if (isNew(c)) flags.push("new");
      if (input.disabled || c.el.getAttribute("aria-disabled") === "true") flags.push("disabled");
      const exp = c.el.getAttribute("aria-expanded");
      if (exp) flags.push(exp === "true" ? "expanded" : "collapsed");
      if (input.checked || c.el.getAttribute("aria-checked") === "true" || c.el.getAttribute("aria-pressed") === "true") flags.push("checked");
      if (c.el.getAttribute("aria-selected") === "true") flags.push("selected");
      if (c.layer) flags.push(c.layer.matches("[role=menu], [role=listbox]") ? "in-menu" : "in-dialog");
      let covered: string | undefined;
      const cx = Math.min(vw - 1, Math.max(0, c.r.left + c.r.width / 2));
      const cy = Math.min(vh - 1, Math.max(0, c.r.top + c.r.height / 2));
      if (c.on && !hits(c.el, cx, cy)) {
        const h = document.elementFromPoint(cx, cy);
        if (h && !(h as HTMLElement).contains(c.el)) covered = describe(h);
      }
      const href = (c.el as HTMLAnchorElement).href || "";
      return {
        id,
        tag: c.tag,
        type: input.type || "",
        text: c.label,
        href: href.slice(0, 4096),
        x: Math.round(cx),
        y: Math.round(cy),
        w: Math.round(c.r.width),
        h: Math.round(c.r.height),
        off: c.on ? undefined : c.dist >= 1e7 ? "side" : c.r.top >= vh ? "below" : "above",
        covered,
        flags: flags.length ? flags : undefined,
        ctx: ctx || undefined,
        fp: { tag: c.tag, text: c.label, href: href.slice(0, 600), role: c.el.getAttribute("role") || "", ctx, nth: n },
      };
    });
    for (const c of cands) seen.add(c.el);

    // Text actually on screen, in reading order; the rest of the page separately.
    const vis: string[] = [];
    let len = 0;
    let lastTop = NaN;
    let lastParent: Element | null = null;
    let parentOn = false;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    for (let i = 0; walker.nextNode() && len < 1400 && i < 6000; i++) {
      const t = walker.currentNode as Text;
      const s = norm(t.data);
      if (!s) continue;
      const p = t.parentElement;
      if (!p || p.closest("script, style, noscript, template, [aria-hidden=true]")) continue;
      if (p !== lastParent) {
        lastParent = p;
        const r = p.getBoundingClientRect();
        parentOn = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
        if (parentOn) {
          if (vis.length && Math.abs(r.top - lastTop) > 4) vis.push("\n");
          lastTop = r.top;
        }
      }
      if (!parentOn) continue;
      vis.push(s);
      len += s.length + 1;
    }
    const text = vis.join(" ").replace(/ ?\n ?/g, "\n").replace(/\n+/g, "\n").trim();
    const body = norm((document.body?.innerText || "").slice(0, 6000));
    const pageText = window.scrollY > 40 || body.length > text.length + 200 ? body.slice(0, 900) : "";

    // Overlays: a dialog, or a fixed layer covering a big part of the screen.
    let overlay: string | null = null;
    for (const d of Array.from(document.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]'))) {
      const r = d.getBoundingClientRect();
      if (r.width > 60 && r.height > 40 && r.bottom > 0 && r.top < vh && visible(d)) { overlay = describe(d); break; }
    }
    if (!overlay) {
      for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.85], [0.5, 0.15], [0.2, 0.5], [0.8, 0.5]]) {
        let a = document.elementFromPoint(vw * fx, vh * fy) as HTMLElement | null;
        for (; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).position !== "fixed") continue;
          const r = a.getBoundingClientRect();
          if (r.width * r.height >= vw * vh * 0.2 && r.height < vh * 0.97) { overlay = describe(a); break; }
          if (r.width * r.height >= vw * vh * 0.97) { overlay = describe(a); break; }
        }
        if (overlay) break;
      }
    }
    const atBottom = window.scrollY + vh >= document.documentElement.scrollHeight - 20;
    const images = Array.from(document.images).filter((img) => {
      const rect = img.getBoundingClientRect();
      return img.complete && img.naturalWidth >= 80 && img.naturalHeight >= 60 && rect.width >= 60 && rect.height >= 40
        && rect.bottom > 0 && rect.top < vh * 1.5 && rect.right > 0 && rect.left < vw
        && getComputedStyle(img).visibility !== "hidden" && /^https?:\/\//.test(img.currentSrc || img.src);
    }).slice(0, 24).map((img) => {
      const rect = img.getBoundingClientRect();
      const col = Math.min(3, Math.max(0, Math.floor(rect.left / (vw / 4))));
      const row = Math.min(3, Math.max(0, Math.floor(rect.top / (vh / 4))));
      return { url: img.currentSrc || img.src, alt: (img.alt || img.title || "").slice(0, 160), col, row };
    });
    return {
      elements: out, images, text: text.slice(0, 1400), pageText, atBottom, more,
      state: { vw, vh, scrollY: Math.round(window.scrollY), scrollH: document.documentElement.scrollHeight, overlay, loading: busy() },
    };
  }

  // An observed element by id; if the page replaced the node (re-render) or the id now points
  // at something else, the same control is found again by its fingerprint.
  const findEl = (id: number, fp: ElementFingerprint | null): { el: HTMLElement | null; how: "id" | "fingerprint" } => {
    let el = document.querySelector<HTMLElement>(`[data-agent-id="${id}"]`);
    if (el && fp && (el.tagName.toLowerCase() !== fp.tag || labelOf(el) !== fp.text)) el = null;
    if (el || !fp) return { el, how: "id" };
    const all = Array.from(document.querySelectorAll<HTMLElement>(SEL)).filter(
      (e) => e.tagName.toLowerCase() === fp.tag && labelOf(e) === fp.text && (!fp.href || (e as HTMLAnchorElement).href === fp.href) && visible(e)
    );
    const same = fp.ctx ? all.filter((e) => ctxOf(e, fp.text) === fp.ctx) : all;
    el = same[fp.nth] || (same.length === 1 ? same[0] : null) || (!fp.ctx && all.length === 1 ? all[0] : null);
    if (el) el.setAttribute("data-agent-id", String(id));
    return { el, how: "fingerprint" };
  };

  if (arg.cmd === "activate") {
    // Keyboard activation: focus the control and let the caller press Enter/Space. Works
    // when the pointer can't reach it (an invisible layer on top, a broken backdrop).
    const { el, how } = findEl(arg.id, arg.fp);
    if (!el || !el.isConnected || !visible(el)) return { ok: false };
    let r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
      r = el.getBoundingClientRect();
    }
    el.focus({ preventScroll: true });
    const a = document.activeElement;
    if (!(a === el || el.contains(a))) return { ok: false };
    const role = el.getAttribute("role") || "";
    const t = (el as HTMLInputElement).type || "";
    const key = /checkbox|radio|switch/.test(role) || t === "checkbox" || t === "radio" ? " " : "Enter";
    flush();
    return {
      ok: true, key, how, box: { x: r.left, y: r.top, w: r.width, h: r.height }, x: r.left + r.width / 2, y: r.top + r.height / 2, vw: innerWidth, vh: innerHeight,
      check: { ok: true, mark: w.__senkoMut!.n, url: location.href, scrollY: Math.round(scrollY), focus: focusKey(), value: valueOf(el) },
    };
  }

  if (arg.cmd === "resolve") {
    const vw = innerWidth;
    const vh = innerHeight;
    const { el, how } = findEl(arg.id, arg.fp);
    if (!el || !el.isConnected) return { status: "missing" };
    let r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !visible(el)) return { status: "hidden" };
    let scrolled = false;
    if (r.top < 0 || r.bottom > vh || r.left < 0 || r.right > vw) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
      scrolled = true;
      r = el.getBoundingClientRect();
    }
    const box = { x: r.left, y: r.top, w: r.width, h: r.height };
    const clampX = (x: number) => Math.min(vw - 2, Math.max(1, x));
    const clampY = (y: number) => Math.min(vh - 2, Math.max(1, y));
    // Center first, then other points on the element (a sticky bar may hide just part of it).
    const spots = [[0.5, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.5], [0.7, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]];
    for (const [fx, fy] of spots) {
      const x = clampX(r.left + r.width * fx);
      const y = clampY(r.top + r.height * fy);
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (hits(el, x, y)) return { status: "ok", x, y, box, vw, vh, how, scrolled };
    }
    const x = clampX(r.left + r.width / 2);
    const y = clampY(r.top + r.height / 2);
    return { status: "covered", x, y, box, vw, vh, how, scrolled, by: describe(document.elementFromPoint(x, y)) };
  }

  if (arg.cmd === "verify") {
    const el = document.querySelector<HTMLElement>(`[data-agent-id="${arg.id}"]`);
    if (!el) return { ok: false, why: "missing" };
    let r = el.getBoundingClientRect();
    // Hovering can open menus, start animations or load banners: let a few frames pass and
    // make sure the target is still exactly where the pointer is.
    for (let i = 0; i < arg.frames; i++) {
      await frame();
      if (!el.isConnected) return { ok: false, why: "missing" };
      const r2 = el.getBoundingClientRect();
      if (Math.abs(r2.left - r.left) > 1 || Math.abs(r2.top - r.top) > 1 || Math.abs(r2.width - r.width) > 2 || Math.abs(r2.height - r.height) > 2) return { ok: false, why: "moved" };
      r = r2;
    }
    if (arg.x < r.left - 1 || arg.x > r.right + 1 || arg.y < r.top - 1 || arg.y > r.bottom + 1) return { ok: false, why: "moved" };
    if (!hits(el, arg.x, arg.y)) return { ok: false, why: "covered", by: describe(document.elementFromPoint(arg.x, arg.y)) };
    flush();
    return { ok: true, mark: w.__senkoMut!.n, url: location.href, scrollY: Math.round(scrollY), focus: focusKey(), value: valueOf(el) };
  }

  if (arg.cmd === "settle") {
    const start = performance.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 40));
      flush();
      // Quiet since the action, not just since the page last changed: UIs often react a
      // little later (a menu opening on a timer, a fetch filling a list).
      const quiet = performance.now() - Math.max(w.__senkoMut!.at, start) >= arg.quietMs;
      if (quiet && !busy()) return { quiet: true, ms: Math.round(performance.now() - start) };
      if (performance.now() - start >= arg.maxMs) return { quiet: false, busy: busy(), ms: Math.round(performance.now() - start) };
    }
  }

  if (arg.cmd === "effect") {
    // Did the click visibly do anything? DOM change, navigation, scroll, focus or state.
    flush();
    const el = document.querySelector(`[data-agent-id="${arg.id}"]`);
    return (
      location.href !== arg.url ||
      w.__senkoMut!.n !== arg.mark ||
      Math.abs(Math.round(scrollY) - arg.scrollY) > 2 ||
      focusKey() !== arg.focus ||
      (!!el && valueOf(el) !== arg.value) ||
      !el
    );
  }
  return null;
};

/** Longest any single PAGE_SCRIPT call may take. A tab that can't answer within it is frozen. */
const PAGE_CALL_MS = Number(process.env.AGENT_PAGE_CALL_MS || 20_000);

/** One typed call into PAGE_SCRIPT, bounded: a hung tab fails the call instead of freezing the agent. */
export function pageCall(page: Page, arg: ScriptArg): Promise<unknown> {
  return orTimeout(page.evaluate(PAGE_SCRIPT, arg), PAGE_CALL_MS, `reading the page (${arg.cmd})`);
}

export function observeDom(page: Page, max = 60): Promise<DomObservation> {
  return pageCall(page, { cmd: "observe", max }) as Promise<DomObservation>;
}

/**
 * Wait for the page to finish reacting: a navigation's document, then a quiet DOM with no
 * visible loading indicators. Bounded, so busy pages (tickers, players) don't stall the agent.
 */
export async function settlePage(page: Page, opts: { navigated: boolean; signal?: AbortSignal }): Promise<void> {
  const run = () =>
    pageCall(page, { cmd: "settle", quietMs: opts.navigated ? 350 : 250, maxMs: opts.navigated ? 4000 : 1500 });
  if (opts.navigated) await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
  if (opts.signal?.aborted) return;
  await run().catch(async () => {
    // The document was replaced mid-wait (a navigation): wait for the new one and settle it.
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
    await run().catch(() => {});
  });
}

/** Notices a main-frame navigation the page starts after an action (link click, form submit). */
export function watchNavigation(page: Page) {
  let started = false;
  const onRequest = (req: { isNavigationRequest(): boolean; frame(): unknown }) => {
    try {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) started = true;
    } catch {
      /* frame detached */
    }
  };
  page.on("request", onRequest as never);
  return {
    get started() {
      return started;
    },
    stop: () => page.off("request", onRequest as never),
  };
}

export interface PointerHost {
  emit(e: { type: "cursor"; x: number; y: number; kind: "move" | "click"; box?: Box | null; width: number; height: number }): void;
}

export type ClickOutcome =
  | { ok: true; how: "id" | "fingerprint"; method: string; check: Extract<Verified, { ok: true }>; x: number; y: number }
  | { ok: false; reason: string; covered?: string };

/**
 * Point at an observed element and click it (or only hover). Every step is checked against
 * the live page: the element is found again if it was re-rendered, the click point must hit
 * it, and the point is re-checked after the pointer arrives. A covering overlay is closed
 * once (Escape / close / reject buttons) before giving up and reporting what covers it.
 */
export async function pointAndClick(
  page: Page,
  host: PointerHost,
  target: { id: number; fp: ElementFingerprint | null },
  opts: { hoverOnly?: boolean; signal?: AbortSignal; dismiss?: (page: Page) => Promise<string>; prefer?: "keyboard" | "pointer" } = {}
): Promise<ClickOutcome> {
  // Memory says the pointer doesn't work on this control but the keyboard does: go straight there.
  if (opts.prefer === "keyboard" && !opts.hoverOnly) {
    const k = await activateByKeyboard(page, host, target, "keyboard (remembered)");
    if (k) return k;
  }
  let dismissed = false;
  let lastWhy = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    opts.signal?.throwIfAborted();
    const r = (await pageCall(page, { cmd: "resolve", id: target.id, fp: target.fp })) as Resolved;
    if (r.status === "missing") return { ok: false, reason: "That element isn't on the page anymore (it was removed or the page changed). Look at the fresh element list." };
    if (r.status === "hidden") return { ok: false, reason: "That element is hidden right now (collapsed or not rendered). Open its menu/section first." };
    if (r.status === "covered") {
      if (!dismissed && opts.dismiss) {
        dismissed = true;
        await opts.dismiss(page).catch(() => "");
        await settlePage(page, { navigated: false, signal: opts.signal });
        continue;
      }
      // Something (often invisible) still sits on top: try the keyboard instead of the pointer.
      if (!opts.hoverOnly) {
        const k = await activateByKeyboard(page, host, target, `keyboard (pointer blocked by ${r.by})`);
        if (k) return k;
      }
      return { ok: false, reason: `It is covered by ${r.by}${dismissed ? " (closing overlays didn't help)" : ""}. Close or deal with that first.`, covered: r.by };
    }
    // The visible cursor glides there on its own; the real pointer jumps in one step.
    host.emit({ type: "cursor", x: r.x, y: r.y, kind: "move", box: r.box, width: r.vw, height: r.vh });
    await page.mouse.move(r.x, r.y);
    opts.signal?.throwIfAborted();
    const v = (await pageCall(page, { cmd: "verify", id: target.id, x: r.x, y: r.y, frames: 3 })) as Verified;
    if (!v.ok) {
      lastWhy = v.why === "covered" ? `covered by ${v.by}` : v.why;
      if (v.why === "missing" && !target.fp) return { ok: false, reason: "The element disappeared when the pointer reached it." };
      continue; // moved / re-rendered / newly covered: find it again
    }
    if (opts.hoverOnly) return { ok: true, how: r.how, method: "hover", check: v, x: r.x, y: r.y };
    host.emit({ type: "cursor", x: r.x, y: r.y, kind: "click", box: null, width: r.vw, height: r.vh });
    await page.mouse.down();
    await page.mouse.up();
    const method = [dismissed ? "closed an overlay first" : "", attempt > (dismissed ? 1 : 0) ? "re-aimed after the page moved" : "", r.how === "fingerprint" ? "found again after a re-render" : ""].filter(Boolean).join(", ") || "pointer";
    return { ok: true, how: r.how, method, check: v, x: r.x, y: r.y };
  }
  if (!opts.hoverOnly) {
    const k = await activateByKeyboard(page, host, target, `keyboard (pointer target unstable: ${lastWhy || "moving"})`);
    if (k) return k;
  }
  return { ok: false, reason: `The target kept moving or being covered (${lastWhy || "unstable layout"}). Wait for the page to settle, then try again.` };
}

/** Focus the control and press Enter (Space for checkboxes/switches). Null if it can't take focus. */
export async function activateByKeyboard(page: Page, host: PointerHost, target: { id: number; fp: ElementFingerprint | null }, method: string): Promise<ClickOutcome | null> {
  const a = (await pageCall(page, { cmd: "activate", id: target.id, fp: target.fp }).catch(() => null)) as
    | { ok: false }
    | { ok: true; key: string; how: "id" | "fingerprint"; box: Box; x: number; y: number; vw: number; vh: number; check: Extract<Verified, { ok: true }> }
    | null;
  if (!a?.ok) return null;
  host.emit({ type: "cursor", x: a.x, y: a.y, kind: "move", box: a.box, width: a.vw, height: a.vh });
  await page.keyboard.press(a.key === " " ? "Space" : "Enter");
  return { ok: true, how: a.how, method, check: a.check, x: a.x, y: a.y };
}

/** Whether the page visibly reacted since `verify` (DOM change, navigation, scroll, focus, state). */
export async function hadEffect(page: Page, id: number, check: Extract<Verified, { ok: true }>, urlBefore: string): Promise<boolean> {
  if (page.url() !== urlBefore) return true;
  return (await pageCall(page, { cmd: "effect", id, mark: check.mark, url: check.url, scrollY: check.scrollY, focus: check.focus, value: check.value }).catch(() => true)) as boolean; // the document went away: it navigated
}
