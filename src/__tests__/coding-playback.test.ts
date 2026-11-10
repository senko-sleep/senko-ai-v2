import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CodingWorkspaceRuntime, resetVerificationLedger } from "@/lib/agent/coding-runtime";
import { codingRequirements } from "@/lib/agent/coding-playbooks";
import { completionBlockers } from "@/lib/code-job";

const workspaces: { base: string; runtime: CodingWorkspaceRuntime }[] = [];
async function create() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "senko-playback-test-"));
  const runtime = new CodingWorkspaceRuntime("test", base); await runtime.ensureWorkspace();
  workspaces.push({ base, runtime }); return runtime;
}
afterEach(async () => {
  for (const { base, runtime } of workspaces.splice(0)) {
    await runtime.stopAllServers();
    await fs.rm(base, { recursive: true, force: true });
  }
});

describe("primary playback acceptance", () => {
  it("recognizes a listening request without imposing a backend or scraper", () => {
    const requirements = codingRequirements("Build me a beautiful website where I can listen to Mixed Nuts from SPY x FAMILY.");
    expect(requirements.playback).toBe(true);
    expect(requirements.procedure).toContain("usually needs no scraper");
    const blockers = completionBlockers([{ path: "index.html", code: "<button>Play</button>" }], [
      { command: "npm run build", exitCode: 0, revision: 1 },
      { command: "inspect", exitCode: 0, revision: 1, browserPassed: true },
    ], 1, true, requirements);
    expect(blockers.join(" ")).toContain("primary listening/playback requirement");
  });

  it("rejects a decorative Play button even when it changes its label to Playing", async () => {
    const runtime = await create();
    await runtime.writeFile("index.html", '<!doctype html><title>Decorative fixture</title><button id="play" onclick="this.textContent=\'Playing\'">Play</button>');
    const server = await runtime.startServer();
    const inspection = await runtime.inspectWebsiteWithBrowser({ url: server.url, interactions: [{ action: "click", selector: "#play" }], expectedText: ["Playing"], requireMediaPlayback: true });
    expect(inspection.interactions[0].ok).toBe(true);
    expect(inspection.mediaPlayback).toEqual([]);
    expect(inspection.passed).toBe(false);
    expect(inspection.layoutIssues.join(" ")).toContain("playback was not verified");
  }, 30_000);

  it("verifies real unmuted native media progression after a user click using a labelled test tone", async () => {
    const runtime = await create();
    // This generated tone is isolated test media, never a substitute for a requested song.
    const samples = 8000 * 8;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * 1000), 44 + i * 2);
    await fs.writeFile(path.join(runtime.workspaceDir, "labelled-test-tone.wav"), wav);
    await runtime.writeFile("index.html", '<!doctype html><title>Labelled test-tone fixture</title><audio id="media" src="/labelled-test-tone.wav"></audio><button id="play" onclick="document.querySelector(\'#media\').play()">Play test tone</button>');
    const server = await runtime.startServer();
    const inspection = await runtime.inspectWebsiteWithBrowser({ url: server.url, interactions: [{ action: "click", selector: "#play" }], requireMediaPlayback: true });
    expect(inspection.passed, JSON.stringify({ media: inspection.mediaPlayback, errors: inspection.pageErrors, console: inspection.consoleErrors, network: inspection.failedRequests, layout: inspection.layoutIssues })).toBe(true);
    expect(inspection.mediaPlayback?.[0].verified).toBe(true);
    expect(inspection.mediaPlayback?.[0].advancedSeconds).toBeGreaterThan(0.2);
    expect(inspection.mediaPlayback?.[0].muted).toBe(false);
    resetVerificationLedger(runtime.chatId, path.dirname(runtime.workspaceDir));
    const reader = new CodingWorkspaceRuntime(runtime.chatId, path.dirname(runtime.workspaceDir));
    await reader.listFiles(); await reader.refreshPersistedEvidence();
    expect(reader.ledger.browserInspections.at(-1)?.mediaPlayback?.[0].verified).toBe(true);
    await reader.writeFile("index.html", "<!doctype html><title>Changed source</title>");
    await reader.listFiles(); await reader.refreshPersistedEvidence();
    expect(reader.ledger.browserInspections.at(-1)?.passed).toBe(false);
    expect(reader.ledger.browserInspections.at(-1)?.mediaPlayback?.[0].verified).toBe(false);
  }, 30_000);
});
