// Strategy monitor: notices when the agent's current approach isn't working and says so,
// cheaply (in memory, no AI calls, no browser round trips).
//
// It tracks:
//   - page states & normalized URLs (stripping tracking params that otherwise disguise loops)
//   - A<->B oscillation (e.g. bouncing between web search and images tab with no new progress)
//   - search-query deduplication (prevents repeating identical searches)
//   - failed URLs & per-host failure categories (403, 404, 429, timeout, not_animated, duplicate)
//   - dead targets: a control that failed or did nothing twice this task (a third try is blocked)
//   - scroll hunting & stagnation
//   - explicit task progress (stashed/delivered media, extracted facts) so productive returns
//     to a results list are never misclassified as loops.

import { normalizeSearchKey, normalizeUrl, type PageKind } from "./url-utils";
import { hostOf } from "./nav-memory";

export interface ActionNote {
  action: string;
  /** Stable key of what the action targeted (element fingerprint, URL, query), if any. */
  target?: string;
  label?: string;
  ok: boolean;
  /** Whether the page visibly changed (navigation, new content, state). */
  effect: boolean;
  why?: string;
  ms: number;
}

export interface StrategyLimits {
  /** Fruitless returns to one state/URL that count as a loop worth warning about. */
  loopWarn: number;
  /** Fruitless returns to one state/URL that stop the task. */
  loopStop: number;
  /** Page actions in a row without reaching a never-seen state or making progress that stop the task. */
  stagnationStop: number;
  /** Failures/no-effects on one target before further attempts are blocked. */
  deadTarget: number;
  /** Max 403/blocked failures on a single host before advising a host switch. */
  maxHost403: number;
}

const DEFAULTS: StrategyLimits = {
  loopWarn: 3,
  loopStop: 5,
  stagnationStop: 10,
  deadTarget: 2,
  maxHost403: 2,
};

/** Actions that don't try to move through the site; when they SUCCEED they never count as "no progress". */
const PASSIVE = new Set([
  "wait", "screenshot", "fetch_image", "fetch_images", "send_images", "send_video",
  "make_collage", "clear_stash", "desmos", "media", "examine_images",
  "switch_tab", "close_tab",
]);

export type FailedUrlCategory =
  | "http_403"
  | "http_404"
  | "http_429"
  | "timeout"
  | "unsupported_format"
  | "not_animated"
  | "duplicate"
  | "network_error"
  | "search_page";

export interface FailedUrlRecord {
  url: string;
  category: FailedUrlCategory;
  reason: string;
  attempts: number;
  at: number;
}

export interface StrategySnapshot {
  failedUrls: [string, FailedUrlRecord][];
  triedSearches: [string, { count: number; query: string; engine: string; kind: "web" | "images"; progressAtRun: number }][];
  host403: [string, number][];
  hostRateLimitUntil: [string, number][];
  visitedUrls: [string, { visits: number; fruitless: number; pageKind: PageKind }][];
}

export class StrategyMonitor {
  private states = new Map<string, { visits: number; seenAt: number; fruitless: number }>();
  private visitedUrls = new Map<string, { visits: number; seenAt: number; fruitless: number; progressAtVisit: number; pageKind: PageKind }>();
  private recentUrls: string[] = [];
  private discovered = 0;
  private progressCounter = 0;
  private lastState = "";
  private lastNormUrl = "";
  private sinceNewState = 0;
  private scrollRun = 0;
  private targets = new Map<string, { label: string; bad: number; reasons: string[] }>();
  private failedUrls = new Map<string, FailedUrlRecord>();
  private triedSearches = new Map<string, { count: number; query: string; engine: string; kind: "web" | "images"; progressAtRun: number }>();
  private host403 = new Map<string, number>();
  private hostRateLimitUntil = new Map<string, number>();
  private categoryRetries = new Map<string, number>();

  readonly stats = {
    actions: 0,
    failed: 0,
    noEffect: 0,
    repeatedStates: 0,
    repeatedUrls: 0,
    oscillations: 0,
    blocked: 0,
    recovered: 0,
    ms: 0,
  };
  private limits: StrategyLimits;

  constructor(limits: Partial<StrategyLimits> = {}) {
    this.limits = { ...DEFAULTS, ...limits };
  }

  /**
   * Record genuine forward progress (e.g. a new valid image/GIF stashed, delivered to chat,
   * or new structured evidence extracted). Prevents returning to a results list after
   * productive work from being flagged as a loop.
   */
  recordProgress() {
    this.progressCounter++;
    this.discovered++;
    this.sinceNewState = 0;
  }

  /** Call once per observation with the page's structural state key (and optional raw URL + page kind). */
  observe(state: string, rawUrl?: string, pageKind: PageKind = "content_page") {
    const st = this.states.get(state);
    if (!st) {
      this.discovered++;
      this.sinceNewState = 0;
      this.states.set(state, { visits: 1, seenAt: this.discovered, fruitless: 1 });
    } else {
      st.visits++;
      this.stats.repeatedStates++;
      // Back here with nothing new found since the last visit: one more lap of a loop.
      st.fruitless = this.discovered === st.seenAt ? st.fruitless + 1 : 1;
      st.seenAt = this.discovered;
    }
    this.lastState = state;

    if (rawUrl) {
      const norm = normalizeUrl(rawUrl);
      if (norm && norm !== "about:blank") {
        const u = this.visitedUrls.get(norm);
        if (!u) {
          this.visitedUrls.set(norm, { visits: 1, seenAt: this.discovered, fruitless: 1, progressAtVisit: this.progressCounter, pageKind });
        } else {
          // Only increment visit/fruitless if we navigated away and came back, or stayed on the same URL across turns.
          u.visits++;
          u.pageKind = pageKind;
          this.stats.repeatedUrls++;
          u.fruitless = this.discovered === u.seenAt ? u.fruitless + 1 : 1;
          u.seenAt = this.discovered;
          u.progressAtVisit = this.progressCounter;
        }
        if (this.recentUrls[this.recentUrls.length - 1] !== norm) {
          this.recentUrls.push(norm);
          if (this.recentUrls.length > 16) this.recentUrls.shift();
          if (this.detectOscillation()) this.stats.oscillations++;
        }
        this.lastNormUrl = norm;
      }
    }
  }

  /** Detect A -> B -> A -> B ping-pong navigation between two normalized URLs. */
  detectOscillation(): boolean {
    const n = this.recentUrls.length;
    if (n < 4) return false;
    const [a, b, c, d] = this.recentUrls.slice(-4);
    return a === c && b === d && a !== b;
  }

  /** Visit count for a normalized URL in this task. */
  urlVisits(rawUrl: string): number {
    const norm = normalizeUrl(rawUrl);
    return this.visitedUrls.get(norm)?.visits ?? 0;
  }

  /**
   * Returns a block reason when the agent tries to `goto` a URL it already visited
   * without making any new progress since that visit (prevents bouncing back to
   * duckduckgo/bing/previously-visited sites that already yielded nothing).
   */
  revisitUrlReason(rawUrl: string): string | null {
    const norm = normalizeUrl(rawUrl);
    if (!norm || norm === "about:blank") return null;
    const rec = this.visitedUrls.get(norm);
    if (!rec) return null;
    if (rec.visits >= 1 && rec.progressAtVisit === this.progressCounter) {
      return `Already visited ${rawUrl.slice(0, 90)} (${rec.visits}x) with no new progress since then. Try a genuinely different website or strategy instead of revisiting.`;
    }
    return null;
  }

  /** Record a search attempt so duplicate searches are detected and prevented. */
  recordSearch(engine: string, kind: "web" | "images", query: string) {
    const key = normalizeSearchKey(engine, kind, query);
    const prev = this.triedSearches.get(key);
    this.triedSearches.set(key, {
      count: (prev?.count ?? 0) + 1,
      query,
      engine,
      kind,
      progressAtRun: this.progressCounter,
    });
  }

  /**
   * Returns a human-readable block reason if the agent is trying to repeat the exact same
   * search query+engine+kind that already ran without new progress.
   */
  duplicateSearchReason(engine: string, kind: "web" | "images", query: string): string | null {
    const key = normalizeSearchKey(engine, kind, query);
    const prev = this.triedSearches.get(key);
    if (!prev) return null;
    if (prev.count >= 1 && prev.progressAtRun === this.progressCounter) {
      return `Already searched ${prev.engine} (${prev.kind}) for "${prev.query}" (${prev.count}x) without new progress. Refine the query with different terms or switch to a different source.`;
    }
    return null;
  }

  /** Record a failed media/page URL with its structured failure category. */
  recordFailedUrl(rawUrl: string, category: FailedUrlCategory, reason: string, retryAfterMs?: number) {
    const norm = normalizeUrl(rawUrl) || rawUrl;
    const prev = this.failedUrls.get(norm);
    this.failedUrls.set(norm, {
      url: rawUrl,
      category,
      reason: reason.slice(0, 160),
      attempts: (prev?.attempts ?? 0) + 1,
      at: Date.now(),
    });
    const host = hostOf(rawUrl);
    if (host) {
      if (category === "http_403") {
        this.host403.set(host, (this.host403.get(host) ?? 0) + 1);
      }
      if (category === "http_429") {
        const waitMs = Math.min(5 * 60_000, Math.max(15_000, retryAfterMs ?? 60_000));
        this.hostRateLimitUntil.set(host, Date.now() + waitMs);
      }
    }
    this.categoryRetries.set(category, (this.categoryRetries.get(category) ?? 0) + 1);
  }

  /** Check whether a URL has already failed with a terminal/non-retryable error (403, 404, not_animated, duplicate, search_page). */
  failedUrlReason(rawUrl: string): string | null {
    const norm = normalizeUrl(rawUrl) || rawUrl;
    const rec = this.failedUrls.get(norm);
    if (!rec) return null;
    if (
      rec.category === "http_403" ||
      rec.category === "http_404" ||
      rec.category === "not_animated" ||
      rec.category === "duplicate" ||
      rec.category === "unsupported_format" ||
      rec.category === "search_page" ||
      rec.attempts >= 2
    ) {
      return `URL already failed (${rec.category}: ${rec.reason}). Pick a different candidate or source.`;
    }
    return null;
  }

  /** Check whether a host is currently in a 429 rate-limit cooldown. */
  hostRateLimitRemainingMs(rawUrl: string, now = Date.now()): number {
    const host = hostOf(rawUrl);
    if (!host) return 0;
    const until = this.hostRateLimitUntil.get(host) ?? 0;
    return Math.max(0, until - now);
  }

  /** Number of 403 responses seen from this host so far. */
  host403Count(rawUrl: string): number {
    const host = hostOf(rawUrl);
    return host ? (this.host403.get(host) ?? 0) : 0;
  }

  /** Hosts that repeatedly returned 403 or are currently rate-limited. */
  problemHosts(now = Date.now()): string[] {
    const out: string[] = [];
    for (const [h, count] of this.host403) {
      if (count >= this.limits.maxHost403) out.push(`${h} (${count}x HTTP 403)`);
    }
    for (const [h, until] of this.hostRateLimitUntil) {
      if (until > now) out.push(`${h} (rate-limited for ${Math.ceil((until - now) / 1000)}s)`);
    }
    return out;
  }

  /** Call after every executed action. */
  record(a: ActionNote) {
    this.stats.actions++;
    this.stats.ms += a.ms;
    if (!a.ok) this.stats.failed++;
    else if (!a.effect) this.stats.noEffect++;
    // Passive actions that SUCCEED don't count as stagnation; FAILED passive actions (e.g. repeated 403 fetch_image) DO.
    if (!PASSIVE.has(a.action) || !a.ok) this.sinceNewState++;
    this.scrollRun = a.action === "scroll" ? this.scrollRun + 1 : 0;
    if (!a.target) return;
    const t = this.targets.get(a.target) || { label: a.label || a.target, bad: 0, reasons: [] };
    if (!a.ok || !a.effect) {
      t.bad++;
      if (a.why) t.reasons.push(a.why.slice(0, 80));
    } else if (t.bad > 0) {
      // A later success means the earlier trouble was transient: forgive it.
      t.bad = 0;
      this.stats.recovered++;
    }
    this.targets.set(a.target, t);
  }

  /** A target that already failed or did nothing too often: don't spend another step on it. */
  blocked(target: string | undefined): string | null {
    if (!target) return null;
    const t = this.targets.get(target);
    if (!t || t.bad < this.limits.deadTarget) return null;
    this.stats.blocked++;
    return `${t.label} already failed ${t.bad}x this task (${[...new Set(t.reasons)].slice(-2).join("; ") || "no visible effect"})`;
  }

  private laps() {
    const stateLaps = this.states.get(this.lastState)?.fruitless || 0;
    const urlLaps = this.lastNormUrl ? (this.visitedUrls.get(this.lastNormUrl)?.fruitless || 0) : 0;
    return Math.max(stateLaps, urlLaps);
  }

  /** Short advice for the next prompt; empty when the approach looks fine. */
  advice(): string {
    const out: string[] = [];
    const laps = this.laps();
    if (laps >= this.limits.loopWarn) {
      out.push(
        `LOOP: you are back on this exact page for the ${laps}${laps === 3 ? "rd" : "th"} time without finding anything new in between. The current approach goes in circles: switch method (a direct URL, a different site/source, or a genuinely different search query), or finish with done and explain what blocks you.`
      );
    }
    if (this.detectOscillation()) {
      out.push(
        `OSCILLATION: you are bouncing back and forth between the same two pages (${this.recentUrls.slice(-2).join(" <-> ")}) without progress. Stop toggling tabs/views and navigate to a genuinely different source or strategy.`
      );
    }
    const dead = [...this.targets.values()].filter((t) => t.bad >= this.limits.deadTarget).map((t) => t.label);
    if (dead.length) {
      out.push(
        `DON'T RETRY (failed or did nothing ${this.limits.deadTarget}+ times): ${dead.slice(-5).join(", ")}. Use another element, keyboard (press), a direct URL, or another route.`
      );
    }
    const badHosts = this.problemHosts();
    if (badHosts.length) {
      out.push(
        `RESTRICTED/RATE-LIMITED HOSTS: ${badHosts.slice(-4).join(", ")}. Do not keep requesting blocked/rate-limited resources from these hosts; switch to a permitted alternative source.`
      );
    }
    if (this.scrollRun >= 4) {
      out.push(
        `SCROLL HUNTING: ${this.scrollRun} scrolls in a row. Off-screen elements are already listed and clickable; if the target isn't listed, use the site's search or a direct URL instead of scrolling further.`
      );
    }
    if (this.sinceNewState >= Math.ceil(this.limits.stagnationStop / 2)) {
      out.push(`NO PROGRESS: ${this.sinceNewState} actions without reaching a new page state or collecting new results. Re-plan with a different method.`);
    }
    return out.length ? `STRATEGY CHECK (automatic):\n- ${out.join("\n- ")}` : "";
  }

  /** Summary of already-tried searches & failed URLs so the model has full memory of failed attempts. */
  memorySummary(): string {
    const lines: string[] = [];
    if (this.triedSearches.size > 0) {
      const list = [...this.triedSearches.values()]
        .slice(-6)
        .map((s) => `${s.engine}/${s.kind}:"${s.query}" (${s.count}x)`);
      lines.push(`Searches already run: ${list.join(", ")}`);
    }
    if (this.failedUrls.size > 0) {
      const list = [...this.failedUrls.values()]
        .slice(-6)
        .map((f) => `${f.url.slice(0, 80)} [${f.category}]`);
      lines.push(`Failed URLs (do NOT retry): ${list.join(" | ")}`);
    }
    return lines.join("\n");
  }

  /** A reason to stop the task, when it is clearly stuck. */
  stuck(): string | null {
    const laps = this.laps();
    if (laps >= this.limits.loopStop) return `I kept coming back to the same page (${laps} times) without finding anything new`;
    if (this.sinceNewState >= this.limits.stagnationStop) return `${this.sinceNewState} actions in a row didn't lead anywhere new`;
    return null;
  }

  /** A new approach starts: clear the loop counters but keep the memory of what already failed. */
  clearStuck() {
    for (const s of this.states.values()) s.fruitless = 1;
    for (const u of this.visitedUrls.values()) u.fruitless = 1;
    this.sinceNewState = 0;
    this.scrollRun = 0;
  }

  /** Serialize durable failure/search memory for checkpoints. */
  serialize(): StrategySnapshot {
    return {
      failedUrls: [...this.failedUrls.entries()].slice(-40),
      triedSearches: [...this.triedSearches.entries()].slice(-20),
      host403: [...this.host403.entries()].slice(-20),
      hostRateLimitUntil: [...this.hostRateLimitUntil.entries()].filter(([, t]) => t > Date.now()).slice(-20),
      visitedUrls: [...this.visitedUrls.entries()]
        .slice(-30)
        .map(([k, v]) => [k, { visits: v.visits, fruitless: v.fruitless, pageKind: v.pageKind }]),
    };
  }

  /** Restore durable failure/search memory from a checkpoint. */
  restore(snap?: StrategySnapshot | null) {
    if (!snap) return;
    for (const [k, v] of snap.failedUrls || []) this.failedUrls.set(k, v);
    for (const [k, v] of snap.triedSearches || []) this.triedSearches.set(k, v);
    for (const [k, v] of snap.host403 || []) this.host403.set(k, v);
    const now = Date.now();
    for (const [k, v] of snap.hostRateLimitUntil || []) if (v > now) this.hostRateLimitUntil.set(k, v);
    for (const [k, v] of snap.visitedUrls || []) {
      this.visitedUrls.set(k, { visits: v.visits, seenAt: this.discovered, fruitless: 1, progressAtVisit: this.progressCounter, pageKind: v.pageKind });
    }
  }
}
