import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// Loads keys from .env.local, uses a throwaway in-memory database, and serves the
// test pages locally. Screenshots of every test land in test-results/<test id>/.
for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
process.env.DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
process.env.IDLE_TEST_MINUTES ||= "1";

let server: http.Server;
let base = "";

beforeAll(async () => {
  const { FIXTURES } = await import("@/lib/testing/fixtures");
  server = http.createServer((req, res) => {
    const name = (req.url || "").split("?")[0].replace(/^\/test-fixtures\//, "");
    const html = FIXTURES[name];
    res.writeHead(html ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" }).end(html || "not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  process.env.PORT = String(port); // lets the agent's browser open our own fixture server
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server?.close();
  const { sessions } = await import("@/lib/agent/sessions");
  void sessions;
});

const { SCENARIOS } = await import("@/lib/testing/scenarios");
const only = (process.env.TEST_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const group = process.env.TEST_GROUP;
const selected = SCENARIOS.filter(
  (s) => (only.length ? only.includes(s.id) : s.id !== "session-idle" || !!process.env.RUN_IDLE) && (!group || s.group === group)
);

describe("Senko end-to-end", () => {
  for (const sc of selected) {
    it(`[${sc.group}] ${sc.title}`, async () => {
      const { execute } = await import("@/lib/testing/runner");
      const run = {
        id: sc.id, scenarioId: sc.id, title: sc.title, state: "running" as const,
        startedAt: Date.now(), logs: [] as { at: number; text: string }[], shots: [] as { label: string; mime: string; data: string }[],
      };
      await execute(run, base, {}, new AbortController().signal);
      const dir = path.join("test-results", sc.id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      run.shots.forEach((s, i) => fs.writeFileSync(path.join(dir, `${i + 1}-${s.label.replace(/[^a-z0-9]+/gi, "-")}.${s.mime.includes("png") ? "png" : "jpg"}`), Buffer.from(s.data, "base64")));
      fs.writeFileSync(path.join(dir, "log.txt"), run.logs.map((l) => l.text).join("\n") + `\n\nRESULT: ${run.status} — ${run.summary}\n`);
      console.log(`\n${run.status?.toUpperCase()} ${sc.id}: ${run.summary}\n${run.logs.map((l) => "  " + l.text).join("\n")}`);
      if (run.status === "skip") return;
      expect(run.status, run.summary).toBe("pass");
    });
  }
});
