// Typed failure diagnosis and recovery routing for visual/browser control.
//
// Instead of blindly retrying a failed action, the agent inspects the failure telemetry
// (missing element, covered by overlay, zero DOM/URL effect, bot verification wall,
// HTTP/navigation error, or repeated stagnation) and selects a targeted recovery tactic.

export type FailureKind =
  | "missing_element"
  | "covered_by_overlay"
  | "no_effect"
  | "verification_wall"
  | "navigation_error"
  | "stagnation";

export type RecoveryStrategy =
  | "reobserve_a11y"
  | "dismiss_overlay"
  | "switch_click_method"
  | "handoff_user"
  | "alternate_route"
  | "replan";

export interface FailureDiagnosisInput {
  action: string;
  ok: boolean;
  hadEffect: boolean;
  resultText: string;
  coveredBy?: string;
  challengeDetected?: boolean;
  elementFound?: boolean;
  repeatCount?: number;
}

export interface FailureDiagnosis {
  kind: FailureKind;
  strategy: RecoveryStrategy;
  hint: string;
  attachAccessibilityTree: boolean;
}

/**
 * Diagnose why an action failed or produced no visible effect, and return a specific
 * recovery instruction for the next step. Returns null if the action succeeded with effect.
 */
export function diagnoseFailure(input: FailureDiagnosisInput): FailureDiagnosis | null {
  const {
    action,
    ok,
    hadEffect,
    resultText,
    coveredBy,
    challengeDetected = false,
    elementFound = true,
    repeatCount = 0,
  } = input;

  if (challengeDetected || /robot check|verification required|verify you are human|captcha/i.test(resultText)) {
    return {
      kind: "verification_wall",
      strategy: "handoff_user",
      hint: "Recovery [verification_wall -> handoff_user]: A bot/human verification wall blocked the page. Hand off to the user in the live browser or switch to an alternate search/source.",
      attachAccessibilityTree: false,
    };
  }

  if (repeatCount >= 2) {
    return {
      kind: "stagnation",
      strategy: "replan",
      hint: `Recovery [stagnation -> replan]: "${action}" has been attempted ${repeatCount + 1} times without advancing the goal. Stop repeating this control; inspect the ARIA accessibility tree or navigate via a different route.`,
      attachAccessibilityTree: true,
    };
  }

  if (coveredBy || /covered by|closing overlays didn't help/i.test(resultText)) {
    const blocker = coveredBy || resultText.match(/covered by ([^.(]+)/i)?.[1]?.trim() || "an overlay";
    return {
      kind: "covered_by_overlay",
      strategy: "dismiss_overlay",
      hint: `Recovery [covered_by_overlay -> dismiss_overlay]: Target is occluded by ${blocker}. Run {"action":"dismiss"} or explicitly click the close/reject button on the dialog before retrying.`,
      attachAccessibilityTree: true,
    };
  }

  if (!elementFound || /isn't on the page anymore|hidden right now|disappeared when the pointer/i.test(resultText)) {
    return {
      kind: "missing_element",
      strategy: "reobserve_a11y",
      hint: "Recovery [missing_element -> reobserve_a11y]: The target element was removed, re-rendered, or collapsed. Use the fresh interactive element list and ARIA accessibility tree below to locate the control or open its parent menu first.",
      attachAccessibilityTree: true,
    };
  }

  if (!ok && /HTTP [45]\d\d|couldn't be found|refused or dropped|took too long|blocked or cancelled/i.test(resultText)) {
    return {
      kind: "navigation_error",
      strategy: "alternate_route",
      hint: `Recovery [navigation_error -> alternate_route]: Navigation failed (${resultText.slice(0, 100)}). Do not retry the same dead URL; use search or pick a different source domain.`,
      attachAccessibilityTree: false,
    };
  }

  if (!hadEffect || /nothing visibly changed|page didn't move/i.test(resultText)) {
    return {
      kind: "no_effect",
      strategy: "switch_click_method",
      hint: `Recovery [no_effect -> switch_click_method]: ${action} produced no DOM, scroll, focus, or URL change. Do not click the exact same element id again; try activating a nearby link/button, using keyboard navigation (press Enter/Tab/key_chord), or selecting from the ARIA accessibility tree.`,
      attachAccessibilityTree: true,
    };
  }

  if (!ok) {
    return {
      kind: "missing_element",
      strategy: "reobserve_a11y",
      hint: `Recovery [action_error -> reobserve_a11y]: ${resultText.slice(0, 140)}. Re-examine the current page elements and ARIA structure before choosing the next action.`,
      attachAccessibilityTree: true,
    };
  }

  return null;
}
