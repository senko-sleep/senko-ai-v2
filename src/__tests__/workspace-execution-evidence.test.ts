import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { playbackEvidenceSummary, providerHealthLabel, WorkspaceExecutionEvidence, type WorkspaceCodingTask, type WorkspaceMediaEvidence } from "@/components/assistant/workspace-execution-evidence";

const task: WorkspaceCodingTask = { goal: "Listen to the requested song", status: "incomplete", step: 3, checks: ["Actual playback after a user gesture"], playbackRequired: true, mediaPlaybackVerified: false, sourcesCount: 1 };
const playing: WorkspaceMediaEvidence = { kind: "native", url: "http://localhost:3000/", currentTime: 2, advancedSeconds: 1.2, paused: false, muted: false, readyState: 4, verified: true };

describe("workspace execution evidence", () => {
  it("never presents discovery as a healthy inference result", () => {
    expect(providerHealthLabel({ id: "test", label: "Test", model: "model", available: true })).toBe("Inference not checked");
    expect(providerHealthLabel({ id: "test", label: "Test", available: false, model: "model", health: { state: "unavailable", checkedAt: 1, status: 410, reason: "Retired", retryable: false, failures: 1 } })).toBe("Model unavailable");
  });

  it("requires advancing, unmuted, unpaused observed media", () => {
    expect(playbackEvidenceSummary([]).verified).toBe(false);
    expect(playbackEvidenceSummary([{ ...playing, paused: true }]).verified).toBe(false);
    expect(playbackEvidenceSummary([{ ...playing, muted: true }]).verified).toBe(false);
    expect(playbackEvidenceSummary([{ ...playing, advancedSeconds: 0 }]).verified).toBe(false);
    expect(playbackEvidenceSummary([{ ...playing, readyState: 0 }]).verified).toBe(false);
    expect(playbackEvidenceSummary([{ ...playing, error: "MediaError" }]).verified).toBe(false);
    expect(playbackEvidenceSummary([playing]).detail).toContain("advanced 1.20s");
  });

  it("keeps a blocked listening request visibly incomplete", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceExecutionEvidence, { task }));
    expect(html).toContain("Verification incomplete");
    expect(html).toContain("Playback remains unverified");
    expect(html).toContain("An iframe or a play-button click does not prove playback");
    expect(html).toContain("Required checks (1)");
    expect(html).not.toContain("Runtime verified");
  });

  it("does not certify an old observation when the current revision is unverified", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceExecutionEvidence, { task, media: [playing] }));
    expect(html).toContain("Playback remains unverified");
    expect(html).not.toContain("Playback observed</p>");
  });
});
