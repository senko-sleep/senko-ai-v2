import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";

// The agent normally refuses private addresses; this test's fake sites live on localhost.
vi.mock("@/lib/agent/safety", async (original) => ({
  ...(await original<typeof import("@/lib/agent/safety")>()),
  isPrivateUrl: () => false,
}));

process.env.DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
delete process.env.SENKO_DATABASE_URL;
for (const key of ["BROWSERBASE_API_KEY", "STEEL_API_KEY", "BROWSERLESS_TOKEN", "BROWSER_CDP_URL"]) delete process.env[key];

const { BrowserSession } = await import("@/lib/agent/sessions");
const { getBrowser } = await import("@/lib/agent/browser");
const { ensureDevice } = await import("@/lib/server/identity");

type Saved = Parameters<InstanceType<typeof BrowserSession>["start"]>[0];

describe("restoring a saved browser session (real Chrome)", () => {
  let server: Server;
  let base = "";
  let ownerId = "";
  const hanging = new Set<ServerResponse>();

  beforeAll(async () => {
    // /hang is a site that never answers.
    server = createServer((req, res) => {
      if (req.url === "/hang") {
        hanging.add(res);
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end("<title>Fast</title>ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    ({ ownerId } = await ensureDevice("restorespeeddevice000001"));
    await getBrowser(); // Measure the restore, not Chrome's cold start.
  }, 60_000);

  afterAll(async () => {
    for (const res of hanging) res.destroy();
    server.closeAllConnections();
    server.close();
    await (await getBrowser()).close().catch(() => {});
  });

  it("doesn't wait for a background tab that never loads", async () => {
    const session = new BrowserSession("restore-background", ownerId);
    const saved = { tabs: [{ url: `${base}/hang` }, { url: `${base}/hang` }, { url: `${base}/fast` }], activeIndex: 2 } as Saved;
    const started = Date.now();
    await session.start(saved);
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(session.active().url()).toBe(`${base}/fast`);
    expect(await session.active().title()).toBe("Fast");
    await session.close();
  }, 45_000);

  it("starts anyway when the active tab never loads", async () => {
    const session = new BrowserSession("restore-active", ownerId);
    const saved = { tabs: [{ url: `${base}/hang` }], activeIndex: 0 } as Saved;
    const started = Date.now();
    await session.start(saved);
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(session.status).toBe("active");
    await session.close();
  }, 45_000);
});
