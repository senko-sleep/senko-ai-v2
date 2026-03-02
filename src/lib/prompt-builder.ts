import corePrompt from "@/app/prompts/core.txt";
import cognitionPrompt from "@/app/prompts/cognition.txt";
import integrityPrompt from "@/app/prompts/integrity.txt";
import actionsPrompt from "@/app/prompts/actions.txt";
import browserPrompt from "@/app/prompts/browser.txt";
import researchPrompt from "@/app/prompts/research.txt";
import memoryPrompt from "@/app/prompts/memory.txt";

import type { BrowserInfo, LocationInfo, SenkoTab } from "@/types/chat";

export interface PromptContext {
  /** Whether agent mode (actions) is enabled */
  agentMode: boolean;
  /** Whether the conversation has open browser tabs */
  hasTabs: boolean;
  /** Whether the user's latest message contains a URL */
  hasUrlInMessage: boolean;
  /** Whether this is a research synthesis call (SEARCH was triggered) */
  isResearch: boolean;
  /** User's stored memories formatted as context string */
  memoryContext?: string;
  /** Browser/device information */
  browserInfo?: BrowserInfo | null;
  /** User location information */
  locationInfo?: LocationInfo | null;
  /** Current open tabs for context */
  tabs?: SenkoTab[];
  /** Recent search results summary for context */
  recentSearchSummary?: string;
}

/**
 * Builds a system prompt from specialized layers based on context.
 * Casual chat: ~80 lines (core only).
 * Full browsing task: ~175 lines (core + actions + browser).
 * Research synthesis: adds research layer.
 */
export function buildLayeredPrompt(ctx: PromptContext): string {
  const layers: string[] = [];

  // Layer 1: Core personality (always included)
  layers.push(corePrompt);

  // Layer 1.5: Reasoning blueprint (always included — governs how the AI thinks)
  layers.push(cognitionPrompt);

  // Layer 1.75: Integrity & accuracy (always included — governs honesty and fact-checking)
  layers.push(integrityPrompt);

  // Layer 2: Actions (when agent mode is on)
  if (ctx.agentMode) {
    layers.push(actionsPrompt);
  }

  // Layer 3: Browser navigation (when browsing context exists)
  if (ctx.agentMode && (ctx.hasTabs || ctx.hasUrlInMessage)) {
    layers.push(browserPrompt);
  }

  // Layer 4: Research synthesis (when generating research response)
  if (ctx.isResearch) {
    layers.push(researchPrompt);
  }

  // Layer 5: Memory system (when user has stored memories or agent mode is on)
  if (ctx.memoryContext || ctx.agentMode) {
    layers.push(memoryPrompt);
  }

  // Layer 6: Dynamic context
  const contextParts: string[] = [];

  // Date awareness — prevents outdated answers (iPhone 15 vs 16, Galaxy S24 vs S25)
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  contextParts.push(`Current date: ${dateStr}. When discussing products, events, or versions, always use the most current information available. If your knowledge may be outdated, suggest searching for the latest.`);

  if (ctx.memoryContext) {
    contextParts.push(ctx.memoryContext);
  }

  if (ctx.browserInfo) {
    const bi = ctx.browserInfo;
    const device = /tablet|ipad/i.test(bi.userAgent) ? "Tablet" : /mobile|iphone|android/i.test(bi.userAgent) ? "Mobile" : "Desktop";
    const browser = bi.userAgent.includes("Edg") ? "Edge" : bi.userAgent.includes("Chrome") ? "Chrome" : bi.userAgent.includes("Firefox") ? "Firefox" : bi.userAgent.includes("Safari") ? "Safari" : "Unknown";
    const os = bi.platform.startsWith("Win") ? "Windows" : bi.platform.startsWith("Mac") ? "macOS" : bi.platform.startsWith("Linux") ? "Linux" : bi.platform;
    contextParts.push(`User Device: ${device} | ${browser} | ${os} | ${bi.screenResolution} | ${bi.hardwareConcurrency} cores | ${bi.language} | ${bi.timezone} | ${bi.onLine ? "Online" : "Offline"}`);
  }

  if (ctx.locationInfo?.status === "granted" && ctx.locationInfo.latitude !== null) {
    const loc = ctx.locationInfo;
    const parts = [`${loc.latitude}, ${loc.longitude}`];
    if (loc.city) parts.push(loc.city);
    if (loc.region) parts.push(loc.region);
    if (loc.country) parts.push(loc.country);
    contextParts.push(`User Location: ${parts.join(" | ")}`);
  }

  if (ctx.tabs && ctx.tabs.length > 0) {
    const tabList = ctx.tabs
      .map((t, i) => `${i + 1}. ${t.title || t.url}${t.active ? " (active)" : ""}`)
      .join("\n");
    contextParts.push(`Open Tabs:\n${tabList}`);
  }

  if (ctx.recentSearchSummary) {
    contextParts.push(ctx.recentSearchSummary);
  }

  if (contextParts.length > 0) {
    layers.push(contextParts.join("\n\n"));
  }

  return layers.join("\n\n");
}

/**
 * Detects if a message text contains a URL.
 */
export function messageHasUrl(text: string): boolean {
  return /https?:\/\/[^\s]+/i.test(text) || /\b[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}\b/.test(text);
}
