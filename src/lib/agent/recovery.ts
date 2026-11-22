// Typed failure diagnosis and bounded recovery routing for visual/browser control.
//
// Instead of blindly retrying a failed action, the agent inspects the failure telemetry
// (missing element, covered by overlay, zero DOM/URL effect, bot verification wall,
// HTTP 403/404/429, timeouts, non-animated thumbnails, duplicate media, empty search
// results, or repeated stagnation) and selects a targeted recovery tactic.

export type FailureKind =
  | "missing_element"
  | "covered_by_overlay"
  | "no_effect"
  | "verification_wall"
  | "navigation_error"
  | "http_403"
  | "http_404"
  | "http_429"
  | "timeout"
  | "not_animated"
  | "duplicate_media"
  | "unsupported_media"
  | "empty_results"
  | "stagnation";

export type RecoveryStrategy =
  | "reobserve_a11y"
  | "dismiss_overlay"
  | "switch_click_method"
  | "handoff_user"
  | "alternate_route"
  | "switch_source"
  | "backoff_and_switch"
  | "pick_direct_media"
  | "pick_distinct_candidate"
  | "refine_query"
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
  errorCode?: string;
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
    errorCode,
  } = input;

  if (challengeDetected || /robot check|verification required|verify you are human|captcha/i.test(resultText)) {
    return {
      kind: "verification_wall",
      strategy: "handoff_user",
      hint: "Recovery [verification_wall -> handoff_user]: A bot/human verification wall blocked the page. Switch to a permitted alternate search/source instead of retrying this host.",
      attachAccessibilityTree: false,
    };
  }

  if (errorCode === "http_403" || (!ok && /\bHTTP 403\b|access denied|hotlink/i.test(resultText))) {
    return {
      kind: "http_403",
      strategy: "switch_source",
      hint: "Recovery [http_403 -> switch_source]: Resource returned HTTP 403 (access denied/hotlink-protected). Do NOT retry this URL; pick a candidate from a different permitted host or source.",
      attachAccessibilityTree: false,
    };
  }

  if (errorCode === "http_429" || (!ok && /\bHTTP 429\b|rate[- ]limit|too many requests/i.test(resultText))) {
    return {
      kind: "http_429",
      strategy: "backoff_and_switch",
      hint: "Recovery [http_429 -> backoff_and_switch]: Host is rate-limiting requests (HTTP 429). Stop hitting this host and switch to another permitted source.",
      attachAccessibilityTree: false,
    };
  }

  if (errorCode === "http_404" || (!ok && /\bHTTP 404\b|\bHTTP 410\b|not found/i.test(resultText))) {
    return {
      kind: "http_404",
      strategy: "alternate_route",
      hint: "Recovery [http_404 -> alternate_route]: Resource does not exist (HTTP 404/410). Reject this URL and choose a different candidate.",
      attachAccessibilityTree: false,
    };
  }

  if (errorCode === "not_animated" || (!ok && /not an animated gif|static .*thumbnail|single-frame/i.test(resultText))) {
    return {
      kind: "not_animated",
      strategy: "pick_direct_media",
      hint: "Recovery [not_animated -> pick_direct_media]: That URL was a static preview/thumbnail, not an animated GIF. Look for a direct .gif URL (marked GIF) or open the source page to get the real animated file.",
      attachAccessibilityTree: false,
    };
  }

  if (errorCode === "duplicate" || (!ok && /duplicate media|exact same image bytes/i.test(resultText))) {
    return {
      kind: "duplicate_media",
      strategy: "pick_distinct_candidate",
      hint: "Recovery [duplicate_media -> pick_distinct_candidate]: That URL points to media you already collected. Select a different, distinct candidate.",
      attachAccessibilityTree: false,
    };
  }

  if (errorCode === "search_page" || errorCode === "unsupported_format" || errorCode === "too_large" || (!ok && /search-result page|unsupported image format|not a valid decodable image|too large/i.test(resultText))) {
    return {
      kind: "unsupported_media",
      strategy: "pick_direct_media",
      hint: "Recovery [unsupported_media -> pick_direct_media]: The target URL is not a valid deliverable image (e.g. HTML/search page, unsupported format, or over 8 MB). Use a direct .gif/.png/.jpg/.webp URL from the observed images list.",
      attachAccessibilityTree: false,
    };
  }

  if (errorCode === "timeout" || (!ok && /timed out|took too long/i.test(resultText))) {
    return {
      kind: "timeout",
      strategy: "alternate_route",
      hint: "Recovery [timeout -> alternate_route]: Request timed out. Avoid retrying the same slow host repeatedly; pick a faster alternative source.",
      attachAccessibilityTree: false,
    };
  }

  if (repeatCount >= 2) {
    return {
      kind: "stagnation",
      strategy: "replan",
      hint: `Recovery [stagnation -> replan]: "${action}" has been attempted ${repeatCount + 1} times without advancing the goal. Stop repeating this control; inspect the ARIA accessibility tree or navigate via a genuinely different route.`,
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

  if (!ok && /HTTP [45]\d\d|couldn't be found|refused or dropped|blocked or cancelled/i.test(resultText)) {
    return {
      kind: "navigation_error",
      strategy: "alternate_route",
      hint: `Recovery [navigation_error -> alternate_route]: Navigation failed (${resultText.slice(0, 100)}). Do not retry the same dead URL; use search or pick a different source domain.`,
      attachAccessibilityTree: false,
    };
  }

  if (!ok && /no results|0 images|empty/i.test(resultText)) {
    return {
      kind: "empty_results",
      strategy: "refine_query",
      hint: "Recovery [empty_results -> refine_query]: Search or page yielded no usable results. Refine the search terms or switch to a site that directly hosts the requested media.",
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
