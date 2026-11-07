import { describe, it, expect } from "vitest";
import { previewStatusDoc, repairKey } from "@/components/assistant/workspace-files";

describe("workspace repair history keys", () => {
  it("stays unique when attempt numbers restart across workflow runs", () => {
    // Two runs, each with attempts 1 and 2 — the original duplicate-key `1` scenario.
    const history = [
      { id: "rep_a_1", attempt: 1, stage: "test" },
      { id: "rep_a_2", attempt: 2, stage: "test" },
      { id: "rep_b_3", attempt: 1, stage: "test" },
      { id: "rep_b_4", attempt: 2, stage: "execute" },
    ];
    const keys = history.map(repairKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("falls back to data fields for legacy records without an id", () => {
    const legacy = [
      { attempt: 1, stage: "test", timestamp: 1000, signature: "test:a" },
      { attempt: 1, stage: "test", timestamp: 2000, signature: "test:b" },
    ];
    const keys = legacy.map(repairKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("preview status document", () => {
  it("escapes compile errors instead of rendering them as markup", () => {
    const doc = previewStatusDoc("error", `<script>alert(1)</script>`);
    expect(doc).toContain("Preview build failed");
    expect(doc).not.toContain("<script>alert");
    expect(doc).toContain("&lt;script&gt;");
  });
});
