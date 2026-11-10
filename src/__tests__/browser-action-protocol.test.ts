import { describe, it, expect } from "vitest";
import { BrowserFormatRecovery, parseAgentObject, parseBrowserDecision } from "@/lib/agent/action-protocol";

describe("model-independent browser action protocol", () => {
  it("normalizes complete structured envelopes without executing or guessing text", () => {
    const expected = expect.objectContaining({ action: "click", id: 12 });
    for (const value of [
      '{"action":"click","id":"12"}',
      '```json\n{"action":"click","id":12}\n```',
      JSON.stringify('{"action":"click","id":12}'),
      '{"tool":"click","parameters":{"id":12}}',
      '{"action":{"type":"click","elementId":"12"}}',
      '{"tool_calls":[{"function":{"name":"click","arguments":"{\\"id\\":12}"}}]}'.replace(/\\"/g, '\\"'),
    ].slice(0, 5)) expect(parseBrowserDecision(value)).toEqual(expected);
    expect(parseBrowserDecision(JSON.stringify({ tool_calls: [{ function: { name: "click", arguments: JSON.stringify({ id: 12 }) } }] }))).toEqual(expected);
    expect(parseBrowserDecision('Click the red button at 12')).toBeNull();
  });
  it("rejects ambiguous actions, malformed targets, and unsupported commands", () => {
    for (const text of ['{"action":"click"}', '{"action":"click","id":"img0"}', '{"action":"evaluate","code":"alert(1)"}', '{"actions":[{"action":"back"},{"action":"click","id":1}]}', '{"action":"click","id":1} {"action":"click","id":2}', '{"action":"wait","seconds":999}', '{"action":"type","id":0,"text":"x"}']) expect(parseBrowserDecision(text)).toBeNull();
    expect(parseAgentObject('text {"answer":"brace } inside text"}')).toEqual({ answer: "brace } inside text" });
  });
  it("excludes repeatedly incompatible models before the bounded recovery ends", () => {
    const recovery = new BrowserFormatRecovery();
    expect(recovery.reject("small").switchModel).toBe(false);
    expect(recovery.reject("small").switchModel).toBe(true);
    expect(recovery.excludedModels).toEqual(["small"]);
    for (let i = 0; i < 3; i++) expect(recovery.reject("other").exhausted).toBe(false);
    expect(recovery.reject("other").exhausted).toBe(true);
  });
});
