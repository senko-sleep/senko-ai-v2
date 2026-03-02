import { describe, it, expect } from "vitest";
import { buildContextWindow, compactAssistantMessage, type ApiMessage } from "@/lib/context-window";
import type { ToolResult } from "@/lib/tool-results";

describe("buildContextWindow", () => {
  const makeMsg = (role: "user" | "assistant", content: string): ApiMessage => ({ role, content });

  it("returns all messages when they fit within budget", () => {
    const messages = [
      makeMsg("user", "Hello"),
      makeMsg("assistant", "Hi there!"),
      makeMsg("user", "How are you?"),
    ];
    const result = buildContextWindow(messages, [], { maxTokens: 5000 });
    expect(result.apiMessages).toHaveLength(3);
    expect(result.messagesTrimmed).toBe(0);
  });

  it("trims oldest messages when over budget", () => {
    const longContent = "x".repeat(2000); // ~500 tokens each
    const messages = [
      makeMsg("user", longContent),
      makeMsg("assistant", longContent),
      makeMsg("user", longContent),
      makeMsg("assistant", longContent),
      makeMsg("user", "Latest message"),
    ];
    // Budget of 400 tokens for conversation (maxTokens: 666, 60% = ~400)
    const result = buildContextWindow(messages, [], { maxTokens: 666 });
    expect(result.messagesTrimmed).toBeGreaterThan(0);
    // Should always keep the most recent messages
    const lastMsg = result.apiMessages[result.apiMessages.length - 1];
    expect(lastMsg.content).toBe("Latest message");
  });

  it("preserves at least minRecentMessages", () => {
    const longContent = "x".repeat(4000); // ~1000 tokens
    const messages = [
      makeMsg("user", longContent),
      makeMsg("assistant", longContent),
      makeMsg("user", "Recent 1"),
      makeMsg("assistant", "Recent 2"),
      makeMsg("user", "Recent 3"),
      makeMsg("assistant", "Recent 4"),
    ];
    const result = buildContextWindow(messages, [], {
      maxTokens: 100,
      minRecentMessages: 4,
    });
    // Should keep at least the last 4 messages even if over budget
    expect(result.apiMessages.length).toBeGreaterThanOrEqual(4);
  });

  it("allocates budget for tool results", () => {
    const toolResults: ToolResult[] = [{
      type: "search_results",
      content: "Search result content here with lots of details",
      maxTokens: 200,
      timestamp: Date.now(),
      turn: 0,
    }];
    const messages = [makeMsg("user", "Search for cats")];
    const result = buildContextWindow(messages, toolResults, { maxTokens: 5000 });
    expect(result.toolContext).toContain("[TOOL:search_results]");
    expect(result.toolContext).toContain("Search result content here");
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("returns empty tool context when no results", () => {
    const messages = [makeMsg("user", "Hello")];
    const result = buildContextWindow(messages, []);
    expect(result.toolContext).toBe("");
  });

  it("trims messages when total exceeds budget", () => {
    const longContent = "x".repeat(2000); // ~500 tokens each
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeMsg(i % 2 === 0 ? "user" : "assistant", longContent)
    );
    const result = buildContextWindow(messages, [], { maxTokens: 3000, minRecentMessages: 2 });
    // Should have trimmed some messages
    expect(result.messagesTrimmed).toBeGreaterThan(0);
    // Should have fewer messages than the original 20
    expect(result.apiMessages.length).toBeLessThan(20);
    // The last message should be preserved
    expect(result.apiMessages[result.apiMessages.length - 1].content).toBe(longContent);
  });
});

describe("compactAssistantMessage", () => {
  it("appends image count annotation", () => {
    const result = compactAssistantMessage("Here are some cats!", { imageCount: 5 });
    expect(result).toContain("[showed 5 images]");
  });

  it("appends video count annotation", () => {
    const result = compactAssistantMessage("Check this out!", { videoCount: 2 });
    expect(result).toContain("[played 2 video(s)]");
  });

  it("appends embed titles annotation", () => {
    const result = compactAssistantMessage("Opened the page!", {
      embedTitles: ["Wikipedia", "Reddit"],
    });
    expect(result).toContain("[opened: Wikipedia, Reddit]");
  });

  it("returns original content when no extras", () => {
    const result = compactAssistantMessage("Just a normal message");
    expect(result).toBe("Just a normal message");
  });

  it("combines multiple annotations", () => {
    const result = compactAssistantMessage("Here!", {
      imageCount: 3,
      videoCount: 1,
      embedTitles: ["Example"],
    });
    expect(result).toContain("[showed 3 images]");
    expect(result).toContain("[played 1 video(s)]");
    expect(result).toContain("[opened: Example]");
  });
});
