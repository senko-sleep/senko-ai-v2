// Action risk classification for the approval gate.
//
// This is deliberately structural and conservative, not a model call: it looks at the control the
// agent is about to activate (its visible label, nearby dialog text, and the page URL) and decides
// whether the action is consequential enough to need the user's explicit approval first.
// Anything it flags as "high" blocks until the user approves that exact action.
//
// Known limits (kept honest on purpose):
//  - It only sees what the observation exposes: a button labelled "Continue" on a page that
//    actually charges a card is not recognised unless nearby dialog text says so.
//  - It covers clicks, submitting typed text, and Enter/Space on the last-touched control.
//    Navigation by URL (goto) and the Desmos/media/tab actions are treated as low risk.
//  - It can only raise risk. Nothing downstream lowers it.
import type { ObservedElement } from "./interaction";

export type RiskLevel = "low" | "medium" | "high";
export type RiskCategory = "financial" | "destructive" | "security" | "external" | "none";

export interface ActionInput {
  action: string;
  id?: number | string | null;
  x?: number;
  y?: number;
  submit?: boolean;
  key?: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  category: RiskCategory;
  reasons: string[];
  /** Stable identity of this action, so an approval covers exactly it and nothing else. */
  key: string;
  /** One line for the approval prompt and the audit log. */
  summary: string;
  label: string;
}

type Target = Pick<ObservedElement, "id" | "tag" | "type" | "text" | "href"> &
  Partial<Pick<ObservedElement, "x" | "y" | "w" | "h" | "ctx" | "flags">>;

const MAX_LABEL = 60;

const FINANCIAL = /\b(buy( it)? now|place (your |my |the )?order|pay( now| securely)?|complete (the |your )?(order|purchase|payment)|confirm (the |your )?(order|purchase|payment)|purchase|subscribe|start (my |your )?(free )?trial|donate|upgrade( now)?|add (a )?payment( method)?|submit payment)\b/i;
const DESTRUCTIVE = /\b(delete|erase|destroy|wipe|deactivate|terminate|permanently|empty (the )?trash|clear all|close (my |your )?account|cancel (my |the |your )?(subscription|account|order|membership)|remove (my |your )?account|discard (changes|draft)|reset (my |your )?(account|data))\b/i;
const SECURITY = /\b((change|reset|update|set) (my |your |the )?password|(enable|disable|turn (on|off)) (two[- ]?factor|2fa|mfa|two-step)|revoke|authorize|allow access|grant (access|permission)|connect (your |my )?account|(create|generate|reveal) (an? )?(api|secret|access) (key|token)|accept (and|&) continue)\b/i;
const EXTERNAL = /\b(send( message| email| now)?|post( now)?|publish|tweet|reply|submit (review|comment|post|application)|invite|apply now|book now|reserve|confirm booking)\b/i;
const MEDIUM = /\b(checkout|sign ?in|log ?in|sign ?up|register|create (an )?account|save|submit|apply)\b/i;
/** Generic confirm buttons: risky only when the surrounding dialog says what is being confirmed. */
const GENERIC_CONFIRM = /^(yes|ok|okay|confirm|continue|proceed|i agree|agree|accept|done|submit|allow)\b[\s.!]*$/i;

const CATEGORIES: [RiskCategory, RegExp][] = [
  ["financial", FINANCIAL],
  ["destructive", DESTRUCTIVE],
  ["security", SECURITY],
  ["external", EXTERNAL],
];

function clean(text: string | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function where(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

/** The smallest observed element whose box contains a viewport point. */
export function elementAt(elements: Target[], x: number, y: number): Target | undefined {
  let best: Target | undefined;
  let bestArea = Infinity;
  for (const e of elements) {
    if (e.x === undefined || e.y === undefined || !e.w || !e.h) continue;
    if (Math.abs(x - e.x) <= e.w / 2 && Math.abs(y - e.y) <= e.h / 2 && e.w * e.h < bestArea) {
      best = e;
      bestArea = e.w * e.h;
    }
  }
  return best;
}

function classify(label: string, ctx: string, inDialog: boolean): { category: RiskCategory; reason: string } | null {
  if (label && label.length <= MAX_LABEL) {
    for (const [category, re] of CATEGORIES) {
      const m = re.exec(label);
      if (m) return { category, reason: `button text “${m[0]}”` };
    }
    // "OK" / "Yes" / "Confirm" inside a dialog that names the consequence.
    if ((inDialog || ctx) && GENERIC_CONFIRM.test(label) && ctx) {
      for (const [category, re] of CATEGORIES) {
        const m = re.exec(ctx);
        if (m) return { category, reason: `confirm button in a dialog mentioning “${m[0]}”` };
      }
    }
  }
  return null;
}

const LOW = (label: string, summary: string): RiskAssessment => ({ level: "low", category: "none", reasons: [], key: "", summary, label });

/**
 * Assess one proposed action against the current observation.
 * `lastTouched` is the control the agent last clicked or typed into, used for Enter/Space.
 */
export function assessAction(a: ActionInput, elements: Target[], url: string, lastTouched?: Target | null): RiskAssessment {
  let target: Target | undefined;
  let verb = "";

  if (a.action === "click") {
    const hasId = a.id !== undefined && a.id !== null && String(a.id) !== "";
    target = hasId ? elements.find((e) => e.id === Number(a.id)) : Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.y)) ? elementAt(elements, Number(a.x), Number(a.y)) : undefined;
    verb = "Click";
  } else if (a.action === "type" && a.submit !== false) {
    const hasId = a.id !== undefined && a.id !== null && String(a.id) !== "";
    target = hasId ? elements.find((e) => e.id === Number(a.id)) : lastTouched || undefined;
    verb = "Type and submit in";
  } else if (a.action === "press" && /^(enter|return|space| )$/i.test(String(a.key ?? ""))) {
    target = lastTouched || undefined;
    verb = `Press ${a.key} on`;
  } else {
    return LOW("", a.action);
  }

  if (!target) return LOW("", `${verb} an unidentified control`);

  const label = clean(target.text);
  const ctx = clean(target.ctx);
  const inDialog = !!target.flags?.includes("in-dialog");
  const page = where(url);
  const hit = classify(label, ctx, inDialog);
  const summary = `${verb} “${label.slice(0, 50) || target.tag}” on ${page}`;

  if (hit) {
    return {
      level: "high",
      category: hit.category,
      reasons: [hit.reason],
      key: `${hit.category}|${label.toLowerCase().slice(0, MAX_LABEL)}|${page}`,
      summary,
      label,
    };
  }
  if (target.type === "password" || (label.length <= MAX_LABEL && MEDIUM.test(label))) {
    return { level: "medium", category: "none", reasons: [target.type === "password" ? "password field" : "form action"], key: "", summary, label };
  }
  return LOW(label, summary);
}
