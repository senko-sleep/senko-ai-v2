// Strategy monitor: notices when the agent's current approach isn't working and says so,
// cheaply (in memory, no AI calls, no browser round trips).
//
// It tracks page states (structure, not live text), what each action targeted and whether
// it did anything, and reports:
//   - loops: coming back to the same page state without having found anything new in between
//     (returning to a results list after opening each result is progress, not a loop)
//   - dead targets: a control that failed or did nothing twice this task (a third try is blocked)
//   - scroll hunting: many scrolls in a row
//   - stagnation: many page actions without reaching any new page state
// Advice goes into the next prompt with concrete alternatives; a hopeless loop stops the task.

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
  /** Fruitless returns to one state that count as a loop worth warning about. */
  loopWarn: number;
  /** Fruitless returns to one state that stop the task. */
  loopStop: number;
  /** Page actions in a row without reaching a never-seen state that stop the task. */
  stagnationStop: number;
  /** Failures/no-effects on one target before further attempts are blocked. */
  deadTarget: number;
}

const DEFAULTS: StrategyLimits = { loopWarn: 3, loopStop: 5, stagnationStop: 10, deadTarget: 2 };

/** Actions that don't try to move through the site; they never count as "no progress". */
const PASSIVE = new Set(["wait", "screenshot", "fetch_image", "make_collage", "clear_stash", "desmos", "media", "examine_images", "switch_tab", "close_tab"]);

export class StrategyMonitor {
  private states = new Map<string, { visits: number; seenAt: number; fruitless: number }>();
  private discovered = 0;
  private lastState = "";
  private sinceNewState = 0;
  private scrollRun = 0;
  private targets = new Map<string, { label: string; bad: number; reasons: string[] }>();
  readonly stats = { actions: 0, failed: 0, noEffect: 0, repeatedStates: 0, blocked: 0, recovered: 0, ms: 0 };
  private limits: StrategyLimits;

  constructor(limits: Partial<StrategyLimits> = {}) {
    this.limits = { ...DEFAULTS, ...limits };
  }

  /** Call once per observation with the page's structural state key. */
  observe(state: string) {
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
  }

  /** Call after every executed action. */
  record(a: ActionNote) {
    this.stats.actions++;
    this.stats.ms += a.ms;
    if (!a.ok) this.stats.failed++;
    else if (!a.effect) this.stats.noEffect++;
    if (!PASSIVE.has(a.action)) this.sinceNewState++;
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
    return this.states.get(this.lastState)?.fruitless || 0;
  }

  /** Short advice for the next prompt; empty when the approach looks fine. */
  advice(): string {
    const out: string[] = [];
    const laps = this.laps();
    if (laps >= this.limits.loopWarn) {
      out.push(`LOOP: you are back on this exact page state for the ${laps}${laps === 3 ? "rd" : "th"} time without finding anything new in between. The current approach goes in circles: switch method (a direct URL, the site's search, a different link or menu), or finish with done and explain what blocks you.`);
    }
    const dead = [...this.targets.values()].filter((t) => t.bad >= this.limits.deadTarget).map((t) => t.label);
    if (dead.length) out.push(`DON'T RETRY (failed or did nothing ${this.limits.deadTarget}+ times): ${dead.slice(-5).join(", ")}. Use another element, keyboard (press), a direct URL, or another route.`);
    if (this.scrollRun >= 4) out.push(`SCROLL HUNTING: ${this.scrollRun} scrolls in a row. Off-screen elements are already listed and clickable; if the target isn't listed, use the site's search or a direct URL instead of scrolling further.`);
    if (this.sinceNewState >= Math.ceil(this.limits.stagnationStop / 2)) out.push(`NO PROGRESS: ${this.sinceNewState} actions without reaching a new page state. Re-plan with a different method.`);
    return out.length ? `STRATEGY CHECK (automatic):\n- ${out.join("\n- ")}` : "";
  }

  /** A reason to stop the task, when it is clearly stuck. */
  stuck(): string | null {
    const laps = this.laps();
    if (laps >= this.limits.loopStop) return `I kept coming back to the same page (${laps} times) without finding anything new`;
    if (this.sinceNewState >= this.limits.stagnationStop) return `${this.sinceNewState} actions in a row didn't lead anywhere new`;
    return null;
  }
}
