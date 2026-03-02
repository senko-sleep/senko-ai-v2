import { describe, it, expect } from "vitest";
import { estimateTokens, formatForPrompt, ToolResultStore, type ToolResult } from "@/lib/tool-results";

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("formatForPrompt", () => {
  const makeResult = (type: string, content: string, maxTokens = 500): ToolResult => ({
    type: type as ToolResult["type"],
    content,
    maxTokens,
    timestamp: Date.now(),
    turn: 0,
  });

  it("wraps results in [TOOL:type]...[/TOOL] markers", () => {
    const results = [makeResult("search_results", "1. Cat - https://example.com")];
    const output = formatForPrompt(results, 1000);
    expect(output).toContain("[TOOL:search_results]");
    expect(output).toContain("[/TOOL]");
    expect(output).toContain("1. Cat - https://example.com");
  });

  it("includes query and url attributes in header", () => {
    const results: ToolResult[] = [{
      type: "scraped_page",
      url: "https://example.com",
      query: "cats",
      content: "Page content here",
      maxTokens: 500,
      timestamp: Date.now(),
      turn: 0,
    }];
    const output = formatForPrompt(results, 1000);
    expect(output).toContain('query="cats"');
    expect(output).toContain('url="https://example.com"');
  });

  it("respects total token budget", () => {
    const longContent = "x".repeat(10000); // ~2500 tokens
    const results = [makeResult("search_results", longContent, 5000)];
    const output = formatForPrompt(results, 100); // Only 100 token budget
    // Output should be truncated, not the full 10000 chars
    expect(output.length).toBeLessThan(1000);
    expect(output).toContain("[...truncated]");
  });

  it("drops results that don't fit in budget", () => {
    const results = [
      makeResult("search_results", "First result content", 50),
      makeResult("scraped_page", "Second result content", 50),
      makeResult("browse_page", "Third result content", 50),
    ];
    // Very tight budget — should only fit 1-2 results
    const output = formatForPrompt(results, 30);
    const toolBlocks = output.match(/\[TOOL:/g) || [];
    expect(toolBlocks.length).toBeLessThanOrEqual(2);
  });

  it("returns empty string for no results", () => {
    expect(formatForPrompt([], 1000)).toBe("");
  });

  it("prioritizes newest results (sorts by timestamp descending)", () => {
    const results: ToolResult[] = [
      { type: "search_results", content: "OLD", maxTokens: 100, timestamp: 1000, turn: 0 },
      { type: "search_results", content: "NEW", maxTokens: 100, timestamp: 2000, turn: 1 },
    ];
    const output = formatForPrompt(results, 500);
    const oldIdx = output.indexOf("OLD");
    const newIdx = output.indexOf("NEW");
    // NEW should appear before OLD since it's prioritized
    expect(newIdx).toBeLessThan(oldIdx);
  });
});

describe("ToolResultStore", () => {
  it("stores and retrieves results per conversation", () => {
    const store = new ToolResultStore();
    store.add("conv1", {
      type: "search_results", content: "test", maxTokens: 100, timestamp: Date.now(), turn: 0,
    });
    const results = store.get("conv1", 0);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("test");
  });

  it("evicts stale results (older than maxAge turns)", () => {
    const store = new ToolResultStore();
    store.add("conv1", {
      type: "search_results", content: "old", maxTokens: 100, timestamp: Date.now(), turn: 0,
    });
    store.add("conv1", {
      type: "search_results", content: "new", maxTokens: 100, timestamp: Date.now(), turn: 3,
    });
    // At turn 3, with maxAge 2, turn 0 should be evicted
    const results = store.get("conv1", 3, 2);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("new");
  });

  it("clears results for a conversation", () => {
    const store = new ToolResultStore();
    store.add("conv1", {
      type: "search_results", content: "test", maxTokens: 100, timestamp: Date.now(), turn: 0,
    });
    store.clear("conv1");
    expect(store.get("conv1", 0)).toHaveLength(0);
  });

  it("returns formatted context within budget", () => {
    const store = new ToolResultStore();
    store.add("conv1", {
      type: "search_results", content: "Search data here", maxTokens: 100, timestamp: Date.now(), turn: 0,
    });
    const formatted = store.getFormattedContext("conv1", 0, 500);
    expect(formatted).toContain("[TOOL:search_results]");
    expect(formatted).toContain("Search data here");
  });
});
