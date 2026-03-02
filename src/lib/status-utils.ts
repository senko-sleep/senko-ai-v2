/**
 * Shared Status Utilities
 * 
 * Single source of truth for icon-to-color mapping, status parsing,
 * status application, and sentiment-based fallback generation.
 * Replaces 4 duplicated iconColorMap definitions across page.tsx.
 */

import type { SenkoStatus } from "@/types/chat";
import type { OpPhase } from "./operation-manager";

/** Icon-to-color mapping — defined ONCE */
export const ICON_COLOR_MAP: Record<string, string> = {
  happy: "#34d399",
  sad: "#94a3b8",
  angry: "#ef4444",
  excited: "#f97316",
  sleepy: "#a78bfa",
  hungry: "#fbbf24",
  flustered: "#fb7185",
  scared: "#8b5cf6",
  chill: "#00d4ff",
  thinking: "#60a5fa",
  love: "#f472b6",
  gaming: "#34d399",
  music: "#f472b6",
  sparkle: "#00d4ff",
  fire: "#f97316",
  crying: "#94a3b8",
  shocked: "#fbbf24",
};

const DEFAULT_COLOR = "#a78bfa";

/** Parse [STATUS:icon:text] from AI output */
export function parseStatusTag(text: string): { icon: string; text: string } | null {
  const match = text.match(/\[STATUS:([a-z]+):([^\]]+)\]/i);
  if (match) return { icon: match[1].toLowerCase(), text: match[2].trim() };
  return null;
}

/** Convert a parsed status tag into a full SenkoStatus object */
export function buildStatus(icon: string, text: string): SenkoStatus {
  return {
    icon,
    text,
    color: ICON_COLOR_MAP[icon] || DEFAULT_COLOR,
  };
}

/** Parse status from AI content and return a SenkoStatus if found */
export function extractStatusFromContent(content: string): SenkoStatus | null {
  const parsed = parseStatusTag(content);
  if (!parsed) return null;
  return buildStatus(parsed.icon, parsed.text);
}

/**
 * Map operation phase to a client-driven activity status.
 * Used during active operations — no dependency on AI tags.
 */
const PHASE_STATUS_MAP: Record<OpPhase, SenkoStatus | null> = {
  idle: null,
  searching: { icon: "thinking", text: "Searching the web...", color: ICON_COLOR_MAP.thinking },
  scraping: { icon: "sparkle", text: "Reading sources...", color: ICON_COLOR_MAP.sparkle },
  browsing: { icon: "sparkle", text: "Exploring a page...", color: ICON_COLOR_MAP.sparkle },
  reading: { icon: "thinking", text: "Analyzing content...", color: ICON_COLOR_MAP.thinking },
  generating: { icon: "fire", text: "Crafting a response...", color: ICON_COLOR_MAP.fire },
  error: { icon: "sad", text: "Something went wrong...", color: ICON_COLOR_MAP.sad },
};

/** Rotating sub-texts for search phase — keeps it feeling alive */
const SEARCH_SUBTEXTS = [
  "Searching the web...",
  "Digging through results...",
  "Looking for answers...",
  "Scouring the internet...",
];

const GENERATING_SUBTEXTS = [
  "Crafting a response...",
  "Putting thoughts together...",
  "Writing something up...",
  "Thinking and typing...",
];

/** Get a status for the current operation phase */
export function getPhaseStatus(phase: OpPhase): SenkoStatus | null {
  const base = PHASE_STATUS_MAP[phase];
  if (!base) return null;

  // Add variety to common phases
  if (phase === "searching") {
    const text = SEARCH_SUBTEXTS[Math.floor(Math.random() * SEARCH_SUBTEXTS.length)];
    return { ...base, text };
  }
  if (phase === "generating") {
    const text = GENERATING_SUBTEXTS[Math.floor(Math.random() * GENERATING_SUBTEXTS.length)];
    return { ...base, text };
  }

  return base;
}

/**
 * Infer a mood status from response content when AI omits [STATUS:...] tag.
 * Simple keyword scan — not ML, just pattern matching.
 * 
 * Inspired by core.txt: "You have real moods: eepy when tired, hyped when 
 * something's cool, dramatic when surprised, soft when someone's sad, 
 * sassy when you feel like it."
 */
export function inferStatusFromContent(content: string): SenkoStatus {
  const lower = content.toLowerCase();

  // Excited / hyped
  if (/(?:xd|hehe|lol|haha|!!|omg|yooo|let'?s\s*go|so\s*cool|amazing|awesome|fire)/.test(lower)) {
    return buildStatus("excited", pickRandom(["Hyped rn~", "This is exciting!!", "Yooo~"]));
  }

  // Flustered / blushing
  if (/(?:>\/+<|blush|>w<|kyaa|nani|embarrass)/i.test(lower)) {
    return buildStatus("flustered", pickRandom(["H-hey...!", ">////<", "S-stop~"]));
  }

  // Sad / soft
  if (/(?:;w;|twt|t_t|sad|sorry to hear|that sucks|aww|poor)/.test(lower)) {
    return buildStatus("sad", pickRandom(["Aww ;w;", "That's rough...", "Sending comfort~"]));
  }

  // Sleepy / eepy  
  if (/(?:eepy|sleepy|tired|yawn|zzz|bed|nap|rest)/.test(lower)) {
    return buildStatus("sleepy", pickRandom(["Eepy...", "Zzz...", "*yawns*"]));
  }

  // Gaming
  if (/(?:game|gaming|play(?:ing|ed|s)?|fps|rpg|mmo|controller|steam|console)/.test(lower)) {
    return buildStatus("gaming", pickRandom(["Gaming mode~", "Let's play!", "Game on~"]));
  }

  // Love / wholesome
  if (/(?:love|heart|<3|cute|adorable|wholesome|precious|headpat)/.test(lower)) {
    return buildStatus("love", pickRandom(["So wholesome~", "<3", "Precious!!"]));
  }

  // Music
  if (/(?:song|music|listen|playlist|album|artist|spotify|beat|melody)/.test(lower)) {
    return buildStatus("music", pickRandom(["Vibing to this~", "Good taste!", "♪~"]));
  }

  // Thinking / analytical
  if (/(?:hmm|interesting|actually|well|consider|technically|think about)/.test(lower)) {
    return buildStatus("thinking", pickRandom(["Hmm...", "Thinking about this~", "Interesting..."]));
  }

  // Default: chill — the baseline Senko vibe
  return buildStatus("chill", pickRandom([
    "Chillin~",
    "Vibing~",
    "Ready for anything~",
    "Just here being cozy~",
    "All good~",
  ]));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
