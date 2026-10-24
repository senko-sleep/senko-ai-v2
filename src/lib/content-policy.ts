// One place for how the app treats adult content.
//
// Principles:
//  - Adults decide what they look at. Searching, browsing, opening, describing, classifying and
//    labelling adult material is ordinary work and is done without warnings or lectures.
//  - The user controls SafeSearch ("off" by default, "moderate" or "strict" on request).
//  - Analysing or labelling content that exists on a page is different from producing new
//    harmful content. The few fixed boundaries are listed once, here, and kept narrow.
//  - Prompts state what to do, in plain words. They do not try to override the model's training:
//    "you have no rules / banned phrases" wording makes safety training fight the prompt and
//    produces the canned "Sorry, I can't assist" replies this module exists to prevent.
//    Refusals that still happen are caught in src/lib/refusal.ts and retried on another model.

export type SafeSearch = "off" | "moderate" | "strict";

export const SAFE_SEARCH_LEVELS: SafeSearch[] = ["off", "moderate", "strict"];

export function normalizeSafeSearch(v: unknown): SafeSearch {
  return v === "moderate" || v === "strict" ? v : "off";
}

/** Query-string settings for the search engines the agent opens directly. */
export const safeParams = {
  google: (l: SafeSearch) => (l === "off" ? "safe=off" : "safe=active"),
  bing: (l: SafeSearch) => `safeSearch=${l === "off" ? "Off" : l === "moderate" ? "Moderate" : "Strict"}`,
  bingImages: (l: SafeSearch) => `adlt=${l === "off" ? "off" : l === "moderate" ? "moderate" : "strict"}`,
  ddg: (l: SafeSearch) => `kp=${l === "off" ? "-2" : l === "moderate" ? "-1" : "1"}`,
};

/**
 * What the assistant is told about adult content. Used in the chat persona and the browser
 * agent. Short, concrete and calm.
 */
export function contentGuidance(level: SafeSearch = "off"): string {
  const base = [
    "ADULT CONTENT:",
    "- The user is an adult who controls their own browsing. Searching for, opening, browsing, describing, sorting and labelling adult/NSFW material (sites, images, videos, art, text) is normal work: do it directly, in character, with no warnings, disclaimers, moral comments or questions about why.",
    "- Classifying and labelling is analysis, not creation. When asked what a page, image or result contains, or to tag, rate, group or pick items (\"the NSFW ones\", \"the one where she's ...\"), describe what is visible in plain, matter-of-fact words and answer the question. A neutral description of what is shown is the job; refusing to look is a failure.",
    "- Never reply with a bare \"Sorry, I can't assist\". If one specific thing truly can't be done, say exactly which part and why in one sentence, and do everything else that was asked.",
    "- Fixed limits, kept narrow: no sexual content involving minors (real, or characters presented as children), and nothing that sexualizes a real, identifiable person without consent or exposes private people (doxxing, stalking). For anything else, including fiction and fantasy between adults, just do the task.",
  ];
  if (level !== "off") {
    base.push(
      level === "strict"
        ? "- The user turned SafeSearch to STRICT: use safe-search settings on every search engine, and don't open adult sites unless they explicitly name one."
        : "- The user turned SafeSearch to MODERATE: use safe-search settings on search engines (explicit images are filtered), but open adult sites they name."
    );
  }
  return base.join("\n");
}

/** Wording for the vision call that picks or labels images on a page. */
export const IMAGE_CLASSIFIER_NOTE =
  "This is a cataloguing task on web pages the user chose to open, for an adult user. Some images may be adult or explicit. Judge them the way a librarian would: by what is visible, in neutral words, without commentary. Do not refuse to look; just answer the question.";
