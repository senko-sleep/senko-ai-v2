/**
 * Token-Aware Conversation Window
 * 
 * Replaces MAX_CONTEXT_MESSAGES = 24 with token-budget windowing.
 * Allocates budget: 60% conversation, 30% tool results, 10% system headroom.
 * Trims oldest messages first, then tool content, never system prompt.
 */

import { estimateTokens } from "./tool-results";
import type { ToolResult } from "./tool-results";
import { formatForPrompt } from "./tool-results";

export interface ApiMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ContextWindowResult {
  /** Messages to send to the API (within budget) */
  apiMessages: ApiMessage[];
  /** Formatted tool context string (within budget) */
  toolContext: string;
  /** Estimated total tokens used */
  totalTokens: number;
  /** Number of messages trimmed from history */
  messagesTrimmed: number;
}

interface ContextWindowOptions {
  /** Total token budget for the entire prompt (default: 12000) */
  maxTokens?: number;
  /** Fraction of budget for conversation history (default: 0.6) */
  conversationShare?: number;
  /** Fraction of budget for tool results (default: 0.3) */
  toolShare?: number;
  /** Messages to always keep (most recent N) even under pressure (default: 4) */
  minRecentMessages?: number;
}

const DEFAULT_OPTIONS: Required<ContextWindowOptions> = {
  maxTokens: 12000,
  conversationShare: 0.6,
  toolShare: 0.3,
  minRecentMessages: 4,
};

/**
 * Build a token-budgeted context window from messages and tool results.
 * 
 * - Counts tokens per message using the 4-chars/token heuristic.
 * - Allocates budget proportionally between conversation and tool context.
 * - Trims oldest messages first, preserving at least `minRecentMessages`.
 * - Never trims the system prompt (that's handled separately by the caller).
 */
export function buildContextWindow(
  messages: ApiMessage[],
  toolResults: ToolResult[],
  options?: ContextWindowOptions
): ContextWindowResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const conversationBudget = Math.floor(opts.maxTokens * opts.conversationShare);
  const toolBudget = Math.floor(opts.maxTokens * opts.toolShare);

  // --- Tool context ---
  const toolContext = formatForPrompt(toolResults, toolBudget);
  const toolTokens = estimateTokens(toolContext);

  // --- Conversation windowing ---
  // Calculate token cost per message
  const messageCosts = messages.map(m => ({
    message: m,
    tokens: estimateTokens(m.content),
  }));

  // Try to fit all messages
  const totalMessageTokens = messageCosts.reduce((sum, mc) => sum + mc.tokens, 0);

  let selectedMessages: ApiMessage[];
  let messagesTrimmed = 0;

  if (totalMessageTokens <= conversationBudget) {
    // Everything fits
    selectedMessages = messages;
  } else {
    // Trim from the front (oldest), keeping at least minRecentMessages
    selectedMessages = [];
    let tokensRemaining = conversationBudget;
    
    // Work backwards from newest
    const reversed = [...messageCosts].reverse();
    const kept: typeof messageCosts = [];
    
    for (let i = 0; i < reversed.length; i++) {
      const mc = reversed[i];
      if (i < opts.minRecentMessages) {
        // Always keep the most recent N messages
        kept.unshift(mc);
        tokensRemaining -= mc.tokens;
      } else if (tokensRemaining >= mc.tokens && tokensRemaining > 0) {
        kept.unshift(mc);
        tokensRemaining -= mc.tokens;
      } else {
        messagesTrimmed++;
      }
    }

    selectedMessages = kept.map(mc => mc.message);
  }

  const actualMessageTokens = selectedMessages.reduce(
    (sum, m) => sum + estimateTokens(m.content), 0
  );

  return {
    apiMessages: selectedMessages,
    toolContext,
    totalTokens: actualMessageTokens + toolTokens,
    messagesTrimmed,
  };
}

/**
 * Compact assistant messages by summarizing rich content annotations.
 * Keeps conversation context lean without losing meaning.
 */
export function compactAssistantMessage(content: string, extras: {
  imageCount?: number;
  videoCount?: number;
  embedTitles?: string[];
} = {}): string {
  const annotations: string[] = [];
  if (extras.imageCount && extras.imageCount > 0) {
    annotations.push(`[showed ${extras.imageCount} images]`);
  }
  if (extras.videoCount && extras.videoCount > 0) {
    annotations.push(`[played ${extras.videoCount} video(s)]`);
  }
  if (extras.embedTitles && extras.embedTitles.length > 0) {
    const titles = extras.embedTitles.slice(0, 2).join(", ");
    annotations.push(`[opened: ${titles}]`);
  }
  if (annotations.length > 0) {
    return content + "\n" + annotations.join(" ");
  }
  return content;
}
