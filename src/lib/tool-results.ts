/**
 * Structured Tool Result Schema
 * 
 * Replaces raw string concatenation in context assembly.
 * Each tool result (search, scrape, browse) is typed, budgeted, and isolated
 * with markers so the model can distinguish sources from conversation.
 */

export type ToolResultType = "search_results" | "scraped_page" | "browse_page" | "image_results";

export interface ToolResult {
  type: ToolResultType;
  /** The query that produced this result (for search/image) */
  query?: string;
  /** The URL that was scraped/browsed */
  url?: string;
  /** Cleaned, truncated content */
  content: string;
  /** Max tokens this result should consume in the prompt */
  maxTokens: number;
  /** When this result was created (Date.now()) */
  timestamp: number;
  /** Conversation turn number when this was created */
  turn: number;
}

/** Rough token estimate: ~4 chars per token */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate text to fit within a token budget */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 20) + "\n[...truncated]";
}

/**
 * Format tool results into prompt context with clear boundary markers.
 * Respects a total token budget — results are truncated/dropped if over budget.
 * 
 * Output format:
 * ```
 * [TOOL:search_results query="cats"]
 * 1. Cat - Wikipedia - https://en.wikipedia.org/wiki/Cat
 * ...
 * [/TOOL]
 * ```
 */
export function formatForPrompt(results: ToolResult[], budget: number): string {
  if (results.length === 0) return "";

  const parts: string[] = [];
  let tokensUsed = 0;

  // Sort by timestamp descending (newest first — most relevant)
  const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp);

  for (const result of sorted) {
    if (tokensUsed >= budget) break;

    const remaining = budget - tokensUsed;
    const resultBudget = Math.min(result.maxTokens, remaining);
    
    if (resultBudget < 20) break; // Not enough room for meaningful content

    // Build header with metadata
    const attrs: string[] = [];
    if (result.query) attrs.push(`query="${result.query}"`);
    if (result.url) attrs.push(`url="${result.url}"`);
    const header = attrs.length > 0 
      ? `[TOOL:${result.type} ${attrs.join(" ")}]`
      : `[TOOL:${result.type}]`;
    const footer = "[/TOOL]";

    // Reserve tokens for header + footer + newlines
    const overhead = estimateTokens(header) + estimateTokens(footer) + 2;
    const contentBudget = Math.max(resultBudget - overhead, 10);
    const truncated = truncateToTokens(result.content, contentBudget);

    const block = `${header}\n${truncated}\n${footer}`;
    const blockTokens = estimateTokens(block);
    
    if (tokensUsed + blockTokens > budget) {
      // Try to fit a smaller truncated version
      const available = budget - tokensUsed;
      if (available >= 30) {
        const smallContentBudget = Math.max(available - overhead, 10);
        const smallTruncated = truncateToTokens(result.content, smallContentBudget);
        const smallBlock = `${header}\n${smallTruncated}\n${footer}`;
        parts.push(smallBlock);
        tokensUsed += estimateTokens(smallBlock);
      }
      break;
    }

    parts.push(block);
    tokensUsed += blockTokens;
  }

  return parts.join("\n\n");
}

/**
 * Manages tool results for a conversation with staleness eviction.
 */
export class ToolResultStore {
  private results: Map<string, ToolResult[]> = new Map();

  /** Add a tool result for a conversation */
  add(convId: string, result: ToolResult): void {
    const existing = this.results.get(convId) || [];
    existing.push(result);
    this.results.set(convId, existing);
  }

  /** Get all results for a conversation, evicting stale ones */
  get(convId: string, currentTurn: number, maxAge: number = 2): ToolResult[] {
    const existing = this.results.get(convId) || [];
    // Evict results older than maxAge turns
    const fresh = existing.filter(r => (currentTurn - r.turn) <= maxAge);
    this.results.set(convId, fresh);
    return fresh;
  }

  /** Get formatted prompt context for a conversation */
  getFormattedContext(convId: string, currentTurn: number, budget: number): string {
    const results = this.get(convId, currentTurn);
    return formatForPrompt(results, budget);
  }

  /** Clear all results for a conversation */
  clear(convId: string): void {
    this.results.delete(convId);
  }

  /** Clear all results across all conversations */
  clearAll(): void {
    this.results.clear();
  }
}

// Singleton
let _store: ToolResultStore | null = null;

export function getToolResultStore(): ToolResultStore {
  if (!_store) {
    _store = new ToolResultStore();
  }
  return _store;
}
