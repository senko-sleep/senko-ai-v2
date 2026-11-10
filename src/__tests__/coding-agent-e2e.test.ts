import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import {
  CodingWorkspaceRuntime,
  WorkspaceSecurityError,
  assessCommandRisk,
  buildSanitizedChildEnv,
  redactSecrets,
  resolveSafeWorkspacePath,
  verifyAndSanitizeCodingClaims,
} from "../lib/agent/coding-runtime";
import { runAutonomousCodingWorkflow } from "../lib/agent/coding-agent";

const activeRuntimes: CodingWorkspaceRuntime[] = [];

function createTestRuntime(prefix: string): CodingWorkspaceRuntime {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const runtime = new CodingWorkspaceRuntime(id);
  activeRuntimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  while (activeRuntimes.length > 0) {
    const rt = activeRuntimes.pop()!;
    await rt.stopAllServers();
    try {
      fs.rmSync(rt.workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors on Windows file locks
    }
  }
});

describe("GODMODE Autonomous Node.js Coding Agent — End-to-End Verification", () => {
  it("launches Vite on its assigned port even when project config hardcodes another port", async () => {
    const runtime = createTestRuntime("e2e-vite-port");
    await runtime.writeFile("package.json", JSON.stringify({ scripts: { dev: "vite" } }));
    await runtime.writeFile("vite.config.mjs", "export default { server: { port: 3000 } };");
    await runtime.writeFile("index.html", "<!doctype html><title>Managed port fixture</title><h1>Assigned port</h1>");
    const server = await runtime.startServer({ command: "npm run dev", timeoutMs: 15_000 });
    expect(server.status, server.stderr).toBe("running");
    expect(await (await fetch(server.url)).text()).toContain("Assigned port");
    expect(server.stdout).toContain(`--port ${server.port}`);
  }, 25_000);
  it(
    "executes a full 12-criterion E2E Node.js Playlist web application workflow: write -> install -> execute -> fail test -> repair -> pass test -> launch server -> inspect in Playwright Chromium -> verify",
    async () => {
      const runtime = createTestRuntime("e2e-playlist");

      // 1. Seed initial Node.js playlist application with a deliberate bug in playlist.js
      // so the initial `npm test` run genuinely fails and must be repaired by the bounded loop.
      const buggyPlaylistJs = `class Playlist {
  constructor(name = "Senko's Chill Playlist") {
    this.name = name;
    this.tracks = [];
    this.currentIndex = 0;
    this.isPlaying = false;
  }

  addTrack(title, artist, durationSec) {
    if (!title || !artist || typeof durationSec !== "number" || durationSec <= 0) {
      throw new Error("Invalid track metadata");
    }
    const track = { id: this.tracks.length + 1, title, artist, durationSec };
    this.tracks.push(track);
    return track;
  }

  removeTrack(id) {
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.tracks.splice(idx, 1);
    if (this.currentIndex >= this.tracks.length) {
      this.currentIndex = Math.max(0, this.tracks.length - 1);
    }
    return true;
  }

  play(index = this.currentIndex) {
    if (this.tracks.length === 0) return null;
    if (index < 0 || index >= this.tracks.length) {
      throw new Error("Track index out of range");
    }
    this.currentIndex = index;
    this.isPlaying = true;
    return this.tracks[this.currentIndex];
  }

  next() {
    if (this.tracks.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.tracks.length;
    this.isPlaying = true;
    return this.tracks[this.currentIndex];
  }

  totalDuration() {
    // BUG: forgets to accumulate durationSec, returns 0
    return 0;
  }
}

module.exports = { Playlist };
`;

      const fixedPlaylistJs = buggyPlaylistJs.replace(
        "// BUG: forgets to accumulate durationSec, returns 0\n    return 0;",
        "return this.tracks.reduce((sum, t) => sum + t.durationSec, 0);"
      );

      const testJs = `const test = require("node:test");
const assert = require("node:assert/strict");
const { Playlist } = require("./playlist.js");

test("Playlist adds tracks, navigates next, and computes totalDuration", () => {
  const pl = new Playlist("Spy x Family Mix");
  pl.addTrack("Mixed Nuts", "Official HIGE DANdism", 213);
  pl.addTrack("Comedy", "Gen Hoshino", 230);
  pl.addTrack("SOUVENIR", "BUMP OF CHICKEN", 263);

  assert.equal(pl.tracks.length, 3);
  assert.equal(pl.totalDuration(), 706);

  const first = pl.play(0);
  assert.equal(first.title, "Mixed Nuts");
  assert.equal(pl.isPlaying, true);

  const second = pl.next();
  assert.equal(second.title, "Comedy");

  assert.equal(pl.removeTrack(second.id), true);
  assert.equal(pl.tracks.length, 2);
  assert.equal(pl.totalDuration(), 476);
});
`;

      const serverJs = `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Playlist } = require("./playlist.js");

const playlist = new Playlist("Senko's Chill Playlist");
playlist.addTrack("Mixed Nuts", "Official HIGE DANdism", 213);
playlist.addTrack("Comedy", "Gen Hoshino", 230);
playlist.addTrack("SOUVENIR", "BUMP OF CHICKEN", 263);

const port = Number(process.env.PORT || 0);
const server = http.createServer((req, res) => {
  if (req.url === "/api/playlist") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        name: playlist.name,
        tracks: playlist.tracks,
        totalDuration: playlist.totalDuration(),
        currentTrack: playlist.tracks[playlist.currentIndex] || null,
      })
    );
    return;
  }

  const htmlPath = path.join(__dirname, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  console.log(\`Playlist server listening on http://127.0.0.1:\${addr.port}\`);
});
`;

      const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Senko's Chill Playlist</title>
  <style>
    :root {
      --bg: #121212;
      --card: #1e1e1e;
      --accent: #bb86fc;
      --text: #e0e0e0;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, sans-serif;
      display: flex;
      justify-content: center;
      padding: 32px;
    }
    .playlist-container {
      width: 100%;
      max-width: 500px;
      background: var(--card);
      border-radius: 14px;
      padding: 24px;
      box-sizing: border-box;
    }
    .track-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 8px;
      background: rgba(255,255,255,0.04);
    }
    button {
      background: var(--accent);
      color: #121212;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main class="playlist-container">
    <h1 id="playlist-title">Senko's Chill Playlist</h1>
    <p id="now-playing" data-testid="now-playing">Now Playing: Mixed Nuts</p>
    <p id="total-duration">Total Duration: 706s</p>
    <div id="tracks">
      <div class="track-row"><span>1. Mixed Nuts — Official HIGE DANdism</span><span>3:33</span></div>
      <div class="track-row"><span>2. Comedy — Gen Hoshino</span><span>3:50</span></div>
      <div class="track-row"><span>3. SOUVENIR — BUMP OF CHICKEN</span><span>4:23</span></div>
    </div>
    <button id="next-btn" data-testid="next-track" onclick="advanceTrack()">Next Track</button>
  </main>
  <script>
    const names = ["Mixed Nuts", "Comedy", "SOUVENIR"];
    let idx = 0;
    function advanceTrack() {
      idx = (idx + 1) % names.length;
      document.getElementById("now-playing").textContent = "Now Playing: " + names[idx];
    }
  </script>
</body>
</html>
`;

      const packageJson = JSON.stringify(
        {
          name: "senko-playlist-app",
          version: "1.0.0",
          private: true,
          main: "playlist.js",
          scripts: {
            test: "node --test test.js",
            start: "node server.js",
          },
        },
        null,
        2
      );

      await runtime.writeFile("package.json", packageJson);
      await runtime.writeFile("playlist.js", buggyPlaylistJs);
      await runtime.writeFile("test.js", testJs);
      await runtime.writeFile("server.js", serverJs);
      await runtime.writeFile("index.html", indexHtml);

      const stagesObserved = new Set<string>();

      const result = await runAutonomousCodingWorkflow({
        chatId: runtime.chatId,
        goal: "Make a Node.js playlist application and run tests.",
        inspectBrowser: true,
        interactions: [{ action: "click", selector: "#next-btn" }],
        expectedText: ["Senko's Chill Playlist", "Now Playing: Comedy"],
        maxRepairAttempts: 2,
        onStep: (step) => {
          stagesObserved.add(step.stage);
        },
        customRepair: async ({ runtime: rt, errorOutput }) => {
          // Verify that the failure output genuinely contains the failing assertion (0 !== 706)
          expect(errorOutput).toContain("706");
          await rt.writeFile("playlist.js", fixedPlaylistJs);
          return {
            probableCause: "Playlist.totalDuration() returned hardcoded 0 instead of summing track durations.",
            modifiedFiles: ["playlist.js"],
          };
        },
      });

      // Verify workflow completion & ledger authenticity
      expect(result.testPassed).toBe(true);
      expect(result.filesCreatedOrModified).toEqual(
        expect.arrayContaining(["package.json", "playlist.js", "test.js", "server.js", "index.html"])
      );

      // Verify initial test failed and repaired test passed
      expect(result.ledger.testRuns.length).toBeGreaterThanOrEqual(2);
      expect(result.ledger.testRuns[0].status).toBe("failed");
      expect(result.ledger.testRuns[0].exitCode).not.toBe(0);
      expect(result.ledger.testRuns[result.ledger.testRuns.length - 1].status).toBe("passed");
      expect(result.ledger.testRuns[result.ledger.testRuns.length - 1].exitCode).toBe(0);
      expect(result.ledger.testStatus).toBe("passed");

      // Verify repair attempt was recorded with diff history
      expect(result.repairs.length).toBe(1);
      expect(result.repairs[0].resolved).toBe(true);
      expect(result.repairs[0].filesModified).toContain("playlist.js");

      const playlistDiff = result.ledger.diffs.find((d) => d.path === "playlist.js");
      expect(playlistDiff).toBeDefined();
      expect(playlistDiff?.unifiedDiff).toContain("reduce");

      // Verify real browser inspection ran against the live localhost server
      expect(result.browserInspection).not.toBeNull();
      const lastBrowser = result.browserInspection!;
      expect(lastBrowser.passed).toBe(true);
      expect(lastBrowser.title).toBe("Senko's Chill Playlist");
      expect(lastBrowser.consoleErrors).toEqual([]);
      expect(lastBrowser.pageErrors).toEqual([]);
      expect(lastBrowser.failedRequests).toEqual([]);
      expect(lastBrowser.brokenImages).toEqual([]);
      expect(lastBrowser.layoutIssues).toEqual([]);
      expect(lastBrowser.interactions.length).toBe(1);
      expect(lastBrowser.interactions[0].ok).toBe(true);
      expect(lastBrowser.visibleTextExcerpt).toContain("Now Playing: Comedy");
      expect((lastBrowser.screenshotBase64 || "").length).toBeGreaterThan(100);

      // Verify key workflow stages were emitted
      expect(stagesObserved.has("understand")).toBe(true);
      expect(stagesObserved.has("test")).toBe(true);
      expect(stagesObserved.has("repair")).toBe(true);
      expect(stagesObserved.has("execute")).toBe(true);
      expect(stagesObserved.has("inspect")).toBe(true);
      expect(stagesObserved.has("verify")).toBe(true);
    },
    60_000
  );

  it("prevents fabricated test claims when tests were not run or failed", async () => {
    const runtime = createTestRuntime("anti-fabrication");
    await runtime.writeFile("playlist.js", "module.exports = {};\n");

    // Case 1: Model claims "All tests passed!" without running any tests
    const checkNotRun = verifyAndSanitizeCodingClaims(
      "Here is playlist.js.\nHere is test.js.\nAll tests passed!",
      runtime.ledger
    );
    expect(checkNotRun.fabricatedClaimDetected).toBe(true);
    expect(checkNotRun.sanitizedText).toContain('test status is "not_run"');
    expect(checkNotRun.sanitizedText).toContain("### Verification & Execution Report");

    // Case 2: Model claims "All tests passed!" when the test actually failed
    await runtime.writeFile(
      "test.js",
      `const test = require("node:test"); const assert = require("node:assert"); test("fails", () => { assert.equal(1, 2); });`
    );
    await runtime.runCommand("node --test test.js");
    expect(runtime.ledger.testStatus).toBe("failed");

    const checkFailed = verifyAndSanitizeCodingClaims(
      "I ran the test suite and all tests passed!",
      runtime.ledger
    );
    expect(checkFailed.fabricatedClaimDetected).toBe(true);
    expect(checkFailed.sanitizedText).toContain('test status is "failed"');
    expect(checkFailed.sanitizedText).toContain("**Test status**: **FAILED**");
  });

  it("enforces workspace security boundaries, secret redaction, and command risk controls", async () => {
    const runtime = createTestRuntime("security-bounds");

    // 1. Path traversal outside workspace is blocked
    expect(() => resolveSafeWorkspacePath(runtime.workspaceDir, "../../etc/passwd")).toThrow(
      WorkspaceSecurityError
    );
    expect(() => resolveSafeWorkspacePath(runtime.workspaceDir, "..\\..\\Windows\\System32")).toThrow(
      WorkspaceSecurityError
    );

    // 2. Writing or reading .env files is blocked
    await expect(runtime.writeFile(".env", "SECRET=123")).rejects.toThrow(WorkspaceSecurityError);
    await expect(runtime.writeFile(".env.production", "SECRET=123")).rejects.toThrow(WorkspaceSecurityError);

    // 3. Command risk checks block destructive system operations and flag sensitive deployments
    expect(assessCommandRisk("rm -rf /").blocked).toBe(true);
    expect(assessCommandRisk("npm publish").requiresApproval).toBe(true);
    expect(assessCommandRisk("npm test").blocked).toBe(false);
    expect(assessCommandRisk("npm test").requiresApproval).toBe(false);

    const pubRec = await runtime.runCommand("npm publish");
    expect(pubRec.exitCode).toBeNull();
    expect(pubRec.blockedReason).toContain("requires authorization");

    // 4. Child environment strips API keys/secrets and redactSecrets scrubs tokens from logs
    const sanitizedEnv = buildSanitizedChildEnv({
      OPENAI_API_KEY: "sk-proj-1234567890abcdefghijklmnop",
      DATABASE_URL: "postgres://admin:supersecret@db.internal:5432/prod",
    });
    expect(sanitizedEnv.OPENAI_API_KEY).toBeUndefined();
    expect(sanitizedEnv.DATABASE_URL).toBeUndefined();

    const scrubbed = redactSecrets(
      "Connected with sk-proj-1234567890abcdefghijklmnop and postgres://admin:supersecret@db.internal:5432/prod"
    );
    expect(scrubbed).not.toContain("sk-proj-1234567890abcdefghijklmnop");
    expect(scrubbed).not.toContain("supersecret");
    expect(scrubbed).toContain("[REDACTED_SECRET]");

    // 5. File CRUD (move, delete, list) works inside sandbox
    await runtime.writeFile("src/temp.js", "console.log('hi');\n");
    await runtime.moveFile("src/temp.js", "src/renamed.js");
    const afterMove = (await runtime.listFiles()).map((f) => f.path);
    expect(afterMove).toContain("src/renamed.js");
    expect(afterMove).not.toContain("src/temp.js");
    await runtime.deleteFile("src/renamed.js");
    const afterDelete = (await runtime.listFiles()).map((f) => f.path);
    expect(afterDelete).not.toContain("src/renamed.js");
  });

  it("supports network diagnostics and localhost HTTP probing", async () => {
    const runtime = createTestRuntime("network-probe");
    await runtime.writeFile("index.html", "<!DOCTYPE html><html><head><title>Probe</title></head><body>OK</body></html>");
    const srv = await runtime.startServer();

    const probe = await runtime.probeNetwork(srv.url);
    expect(probe.online).toBe(true);
    expect(probe.httpReachable).toBe(true);
    expect(probe.httpStatus).toBe(200);
    expect(probe.dnsResolved).toBe(true);
    expect(typeof probe.staticEgressConfigured).toBe("boolean");
  });

  it(
    "builds, tests, bundles, and visually inspects a full TypeScript + React 19 (.tsx/.ts) application without requiring manual index.html boilerplate",
    async () => {
      const runtime = createTestRuntime("tsx-react-app");

      const playlistTs = `export interface Track {
  id: number;
  title: string;
  artist: string;
  durationSec: number;
}

export function calculateTotalDuration(tracks: Track[]): number {
  return tracks.reduce((sum, t) => sum + t.durationSec, 0);
}
`;

      const testTs = `import test from "node:test";
import assert from "node:assert/strict";
import { calculateTotalDuration, type Track } from "./src/playlist.ts";

test("TypeScript calculateTotalDuration sums Track[] durations accurately", () => {
  const tracks: Track[] = [
    { id: 1, title: "Idol", artist: "YOASOBI", durationSec: 213 },
    { id: 2, title: "Kick Back", artist: "Kenshi Yonezu", durationSec: 193 },
  ];
  assert.equal(calculateTotalDuration(tracks), 406);
});
`;

      const appTsx = `import React, { useState } from "react";
import { calculateTotalDuration, type Track } from "./playlist";

const INITIAL_TRACKS: Track[] = [
  { id: 1, title: "Idol", artist: "YOASOBI", durationSec: 213 },
  { id: 2, title: "Kick Back", artist: "Kenshi Yonezu", durationSec: 193 },
];

export default function App() {
  const [tracks] = useState<Track[]>(INITIAL_TRACKS);
  const [activeIdx, setActiveIdx] = useState(0);
  const current = tracks[activeIdx];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <h1 className="text-2xl font-bold">TSX React Studio Player</h1>
      <p id="active-track">Playing: {current.title} by {current.artist}</p>
      <p id="total-sec">Total Seconds: {calculateTotalDuration(tracks)}</p>
      <button
        id="switch-btn"
        onClick={() => setActiveIdx((i) => (i + 1) % tracks.length)}
        className="mt-4 rounded bg-violet-500 px-4 py-2 font-semibold text-white"
      >
        Switch Track
      </button>
    </div>
  );
}
`;

      await runtime.writeFile("src/playlist.ts", playlistTs);
      await runtime.writeFile("src/App.tsx", appTsx);
      await runtime.writeFile("test.ts", testTs);

      const wf = await runAutonomousCodingWorkflow({
        chatId: runtime.chatId,
        goal: "Build and verify a TypeScript + React 19 playlist metadata selector",
        inspectBrowser: true,
        interactions: [{ action: "click", selector: "#switch-btn" }],
        expectedText: ["TSX React Studio Player", "Playing: Kick Back by Kenshi Yonezu", "Total Seconds: 406"],
      });

      expect(wf.testPassed).toBe(true);
      expect(wf.ledger.testStatus).toBe("passed");
      expect(wf.browserInspection).not.toBeNull();
      expect(wf.browserInspection?.consoleErrors).toEqual([]);
      expect(wf.browserInspection?.pageErrors).toEqual([]);
      expect(wf.browserInspection?.failedRequests).toEqual([]);
      expect(wf.browserInspection?.brokenImages).toEqual([]);
      expect(wf.browserInspection?.layoutIssues).toEqual([]);
      expect(wf.browserInspection?.interactions.every((i) => i.ok)).toBe(true);
      expect(wf.browserInspection?.passed).toBe(true);
      expect(wf.browserInspection?.visibleTextExcerpt).toContain("Playing: Kick Back by Kenshi Yonezu");
    },
    60_000
  );

  it(
    "inspects website in Chromium, assigns browser/playability problems to ledger.issues, repairs code, and loops until fixed & playable",
    async () => {
      const runtime = createTestRuntime("e2e-visual-issue-loop");

      // Seed a React TSX app using the installed lucide icon package.
      // AND has a deliberate runtime crash on mount so Chromium inspection catches it, assigns the problem, repairs it, and verifies playability.
      const brokenAppTsx = `import React, { useState } from "react";
import { Play as PlayIcon, SkipForward as ForwardIcon } from "lucide-react";

export default function App() {
  const [trackIdx, setTrackIdx] = useState(0);
  const tracks = ["Mixed Nuts", "Comedy", "SOUVENIR"];
  // Deliberate runtime exception on initial render:
  if (tracks.length > 0) {
    throw new Error("Player audio engine uninitialized");
  }
  return (
    <div className="p-6 bg-zinc-900 text-white">
      <h1>Live Playable Music Player</h1>
      <p id="current-song">Now Playing: {tracks[trackIdx]}</p>
      <button onClick={() => setTrackIdx((i) => (i + 1) % tracks.length)}>
        <PlayIcon className="w-4 h-4" /> Next Song <ForwardIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
`;

      const fixedAppTsx = `import React, { useState } from "react";
import { Play as PlayIcon, SkipForward as ForwardIcon } from "lucide-react";

export default function App() {
  const [trackIdx, setTrackIdx] = useState(0);
  const tracks = ["Mixed Nuts", "Comedy", "SOUVENIR"];
  return (
    <div className="p-6 bg-zinc-900 text-white">
      <h1>Live Playable Music Player</h1>
      <p id="current-song">Now Playing: {tracks[trackIdx]}</p>
      <button onClick={() => setTrackIdx((i) => (i + 1) % tracks.length)}>
        <PlayIcon className="w-4 h-4" /> Next Song <ForwardIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
`;

      await runtime.writeFile("src/App.tsx", brokenAppTsx);

      const wf = await runAutonomousCodingWorkflow({
        chatId: runtime.chatId,
        goal: "Inspect website, assign problems, fix crash, and verify playable controls",
        inspectBrowser: true,
        maxRepairAttempts: 2,
        customRepair: async ({ stage, errorOutput, runtime: rt }) => {
          expect(stage).toBe("browser");
          expect(errorOutput).toContain("Player audio engine uninitialized");
          // Verify that the issue was assigned into ledger.issues before repair completes
          expect(rt.ledger.issues?.length).toBeGreaterThan(0);
          await rt.writeFile("src/App.tsx", fixedAppTsx);
          return {
            probableCause: "Removed uninitialized audio engine throw in src/App.tsx so player renders and buttons work.",
            modifiedFiles: ["src/App.tsx"],
          };
        },
      });

      expect(wf.browserInspection).not.toBeNull();
      expect(wf.browserInspection?.passed).toBe(true);
      expect(wf.browserInspection?.pageErrors).toEqual([]);
      // Automatic playability probe clicked the button and advanced from "Mixed Nuts" to "Comedy"
      expect(wf.browserInspection?.interactions.length).toBeGreaterThanOrEqual(1);
      expect(wf.browserInspection?.interactions[0].ok).toBe(true);
      expect(wf.browserInspection?.visibleTextExcerpt).toContain("Now Playing: Comedy");
      // All assigned issues in ledger.issues are now marked "fixed"
      expect(wf.ledger.issues?.every((i) => i.status === "fixed")).toBe(true);
    },
    60_000
  );



  it(
    "builds, tests, scrapes, and visually verifies an advanced Spy x Family Manga & Web Scraper website in TypeScript/TSX",
    async () => {
      const runtime = createTestRuntime("e2e-spy-x-family-manga-scraper");

      const mangaScraperTs = `export interface MangaVolume {
  id: string;
  malId: number;
  title: string;
  authors: string;
  chapters: number;
  volumes: number;
  score: number;
  status: string;
  synopsis: string;
  coverImage: string;
  samplePages: { page: number; caption: string; imageUrl: string }[];
}

export function makeMangaPageSvg(title: string, label: string): string {
  const safeT = title.replace(/[<>&"']/g, "").slice(0, 26);
  const safeL = label.replace(/[<>&"']/g, "").slice(0, 32);
  const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="600" viewBox="0 0 420 600">
    <rect width="420" height="600" rx="16" fill="#0f172a" stroke="#ec4899" stroke-width="4"/>
    <rect x="24" y="24" width="372" height="240" rx="8" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/>
    <text x="210" y="140" text-anchor="middle" fill="#f472b6" font-family="system-ui,sans-serif" font-size="24" font-weight="800">\${safeT}</text>
    <text x="210" y="178" text-anchor="middle" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="15">\${safeL}</text>
    <rect x="24" y="284" width="178" height="280" rx="8" fill="#1e293b"/>
    <rect x="218" y="284" width="178" height="280" rx="8" fill="#1e293b"/>
    <text x="113" y="425" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="13">Operation Strix</text>
    <text x="307" y="425" text-anchor="middle" fill="#f9a8d4" font-family="monospace" font-size="13">Waku Waku!</text>
  </svg>\`;
  return \`data:image/svg+xml;utf8,\${encodeURIComponent(svg)}\`;
}

export const CURATED_SPY_FAMILY_MANGA: MangaVolume[] = [
  {
    id: "spy-x-family-main",
    malId: 119161,
    title: "SPY x FAMILY",
    authors: "Tatsuya Endo",
    chapters: 112,
    volumes: 14,
    score: 8.58,
    status: "Publishing",
    synopsis: "Master spy Twilight must build a fake family with telepath Anya and assassin Yor to execute Operation Strix.",
    coverImage: "https://cdn.myanimelist.net/images/manga/3/219741l.jpg",
    samplePages: [
      { page: 1, caption: "Mission 1: Operation Strix Begins", imageUrl: makeMangaPageSvg("SPY x FAMILY", "Mission 1 · Page 1") },
      { page: 2, caption: "Anya Reads Loid's Mind at the Orphanage", imageUrl: makeMangaPageSvg("SPY x FAMILY", "Mission 1 · Page 2") },
      { page: 3, caption: "Eden Academy Entrance Interview", imageUrl: makeMangaPageSvg("SPY x FAMILY", "Mission 2 · Page 3") },
    ],
  },
  {
    id: "spy-x-family-eyes-only",
    malId: 146522,
    title: "SPY x FAMILY Official Fanbook: EYES ONLY",
    authors: "Tatsuya Endo",
    chapters: 12,
    volumes: 1,
    score: 8.12,
    status: "Finished",
    synopsis: "Classified intelligence dossier on the Forger family, WISE headquarters, and Eden Academy.",
    coverImage: makeMangaPageSvg("EYES ONLY", "Official Intelligence Dossier"),
    samplePages: [
      { page: 1, caption: "Forger Family Dossier Overview", imageUrl: makeMangaPageSvg("EYES ONLY", "Dossier · Page 1") },
      { page: 2, caption: "WISE Handler & Twilight Equipment", imageUrl: makeMangaPageSvg("EYES ONLY", "Dossier · Page 2") },
    ],
  },
];

export async function scrapeSpyFamilyManga(query = "Spy x Family"): Promise<MangaVolume[]> {
  try {
    const res = await fetch(\`https://api.jikan.moe/v4/manga?q=\${encodeURIComponent(query)}&limit=4&sfw=true\`);
    if (!res.ok) throw new Error(\`Jikan HTTP \${res.status}\`);
    const json = (await res.json()) as { data?: Array<any> };
    const list = Array.isArray(json.data) ? json.data : [];
    if (list.length === 0) return CURATED_SPY_FAMILY_MANGA;
    return list.map((item, idx) => {
      const title = item.title_english || item.title || "SPY x FAMILY";
      return {
        id: \`mal-manga-\${item.mal_id || idx}\`,
        malId: Number(item.mal_id || 119161),
        title,
        authors: item.authors?.[0]?.name || "Tatsuya Endo",
        chapters: Number(item.chapters || 112),
        volumes: Number(item.volumes || 14),
        score: Number(item.score || 8.58),
        status: item.status || "Publishing",
        synopsis: item.synopsis || CURATED_SPY_FAMILY_MANGA[0].synopsis,
        coverImage: item.images?.jpg?.large_image_url || makeMangaPageSvg(title, "Official Cover"),
        samplePages: [
          { page: 1, caption: \`\${title} · Chapter 1 Page 1\`, imageUrl: makeMangaPageSvg(title, "Chapter 1 · Page 1") },
          { page: 2, caption: \`\${title} · Chapter 1 Page 2\`, imageUrl: makeMangaPageSvg(title, "Chapter 1 · Page 2") },
        ],
      };
    });
  } catch {
    return CURATED_SPY_FAMILY_MANGA;
  }
}
`;

      const mangaAppTsx = `import React, { useState } from "react";
import { CURATED_SPY_FAMILY_MANGA, makeMangaPageSvg, scrapeSpyFamilyManga, type MangaVolume } from "./scraper";
import { BookOpen, Globe, ChevronRight, ChevronLeft, Star } from "lucide-react";

export default function App() {
  const [volumes, setVolumes] = useState<MangaVolume[]>(CURATED_SPY_FAMILY_MANGA);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pageIdx, setPageIdx] = useState(0);
  const [query, setQuery] = useState("Spy x Family");
  const [status, setStatus] = useState("Jikan v4 Manga Scraper Ready · Operation Strix Active");

  const currentManga = volumes[selectedIdx] || volumes[0];
  const pages = currentManga.samplePages;
  const activePage = pages[pageIdx] || pages[0];

  const handleNextPage = () => {
    setPageIdx((p) => (p + 1) % pages.length);
  };

  const handleScrape = async () => {
    setStatus(\`Scraping Jikan v4 Manga API for "\${query}"...\`);
    const items = await scrapeSpyFamilyManga(query);
    setVolumes(items);
    setSelectedIdx(0);
    setPageIdx(0);
    setStatus(\`Scraped \${items.length} SPY x FAMILY manga entries from Jikan v4 API\`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-pink-400" />
            <div>
              <h1 className="text-xl font-bold">SPY x FAMILY Manga Reader & Live Web Scraper</h1>
              <p className="text-xs text-slate-400">{status}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Manga search query"
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
            />
            <button
              type="button"
              onClick={() => void handleScrape()}
              className="px-3 py-1.5 rounded-lg bg-pink-500/80 text-xs font-semibold text-white"
            >
              <Globe className="w-3.5 h-3.5" /> Scrape Manga API
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-lg font-bold">{currentManga.title}</h2>
            <p className="text-xs text-pink-300">By {currentManga.authors} · Score {currentManga.score}</p>
            <p className="text-xs text-slate-300">{currentManga.synopsis}</p>
            <div className="space-y-2 pt-2">
              {volumes.map((v, idx) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setSelectedIdx(idx);
                    setPageIdx(0);
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-800 text-left text-xs"
                >
                  <span className="font-semibold">{v.title}</span>
                  <span className="text-amber-300"><Star className="w-3 h-3" /> {v.score}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span id="reader-caption" className="text-sm font-semibold text-pink-300">
                Page {activePage.page}: {activePage.caption}
              </span>
              <button
                id="next-page-btn"
                type="button"
                onClick={handleNextPage}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold text-white"
              >
                Next Manga Page <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <img
              src={activePage.imageUrl}
              alt={activePage.caption}
              onError={(e) => {
                e.currentTarget.src = makeMangaPageSvg(currentManga.title, activePage.caption);
              }}
              className="w-full max-h-80 object-cover rounded-xl border border-slate-800"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
`;

      const mangaTestTs = `import { test } from "node:test";
import assert from "node:assert/strict";
import { CURATED_SPY_FAMILY_MANGA, scrapeSpyFamilyManga } from "../src/scraper";

test("CURATED_SPY_FAMILY_MANGA has Spy x Family volumes, valid cover images, and reader pages", () => {
  assert.ok(CURATED_SPY_FAMILY_MANGA.length >= 2);
  assert.equal(CURATED_SPY_FAMILY_MANGA[0].title, "SPY x FAMILY");
  assert.ok(CURATED_SPY_FAMILY_MANGA[0].samplePages.length >= 3);
});

test("scrapeSpyFamilyManga returns valid MangaVolume objects from Jikan v4 API or fallback", async () => {
  const volumes = await scrapeSpyFamilyManga("Spy x Family");
  assert.ok(Array.isArray(volumes) && volumes.length > 0);
  assert.ok(volumes[0].title.toLowerCase().includes("spy"));
  assert.ok(volumes[0].coverImage.length > 10);
});
`;

      await runtime.writeFile("src/scraper.ts", mangaScraperTs);
      await runtime.writeFile("src/App.tsx", mangaAppTsx);
      await runtime.writeFile("test/manga.test.ts", mangaTestTs);

      const wf = await runAutonomousCodingWorkflow({
        chatId: runtime.chatId,
        goal: "Build a Spy x Family Manga & Web Scraper website and verify tests and reader controls",
        inspectBrowser: true,
        interactions: [{ action: "click", selector: "#next-page-btn" }],
        expectedText: [
          "SPY x FAMILY Manga Reader & Live Web Scraper",
          "Page 2: Anya Reads Loid's Mind at the Orphanage",
        ],
      });

      expect(wf.testPassed).toBe(true);
      expect(wf.ledger.testStatus).toBe("passed");
      expect(wf.browserInspection).not.toBeNull();
      expect(wf.browserInspection?.consoleErrors).toEqual([]);
      expect(wf.browserInspection?.pageErrors).toEqual([]);
      expect(wf.browserInspection?.brokenImages).toEqual([]);
      expect(wf.browserInspection?.passed).toBe(true);
      expect(wf.browserInspection?.visibleTextExcerpt).toContain("Page 2: Anya Reads Loid's Mind at the Orphanage");
    },
    60_000
  );


});
