import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { Cookie } from "playwright";

process.env.DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
delete process.env.SENKO_DATABASE_URL;

const { clearanceCookies, isClearanceCookie, loadClearance, mergeJar, rememberClearance, resetClearanceCache } = await import("@/lib/agent/clearance-jar");

const future = Math.floor(Date.now() / 1000) + 3600;
const cookie = (name: string, domain: string, value = "v", expires = future): Cookie =>
  ({ name, value, domain, path: "/", expires, httpOnly: true, secure: false, sameSite: "Lax" }) as Cookie;

describe("which cookies are remembered", () => {
  it("keeps human-check clearances, never logins", () => {
    expect(isClearanceCookie(cookie("cf_clearance", ".site.com"))).toBe(true);
    expect(isClearanceCookie(cookie("datadome", ".shop.com"))).toBe(true);
    expect(isClearanceCookie(cookie("_abck", ".store.com"))).toBe(true);
    expect(isClearanceCookie(cookie("visid_incap_12345", ".bank.com"))).toBe(true);
    expect(isClearanceCookie(cookie("aws-waf-token", ".app.com"))).toBe(true);
    expect(isClearanceCookie(cookie("GOOGLE_ABUSE_EXEMPTION", ".google.com"))).toBe(true);
    expect(isClearanceCookie(cookie("NID", ".google.com"))).toBe(true);
    // Logins and Google cookie names on other sites are never kept.
    expect(isClearanceCookie(cookie("SID", ".google.com"))).toBe(false);
    expect(isClearanceCookie(cookie("session_token", ".site.com"))).toBe(false);
    expect(isClearanceCookie(cookie("NID", ".evil.com"))).toBe(false);
  });

  it("drops expired cookies and lets the newer value win", () => {
    const old = cookie("cf_clearance", ".a.com", "old");
    const expired = cookie("cf_clearance", ".b.com", "x", Math.floor(Date.now() / 1000) - 10);
    expect(clearanceCookies([old, expired]).map((c) => c.domain)).toEqual([".a.com"]);
    const merged = mergeJar([old], [cookie("cf_clearance", ".a.com", "new"), cookie("datadome", ".c.com")]);
    expect(merged.find((c) => c.domain === ".a.com")?.value).toBe("new");
    expect(merged).toHaveLength(2);
  });
});

describe("remembered across chats and restarts", () => {
  it("adds up clearances from every chat instead of keeping only the last one", async () => {
    resetClearanceCache();
    await rememberClearance("owner-1", [cookie("cf_clearance", ".a.com"), cookie("session", ".a.com")]);
    await rememberClearance("owner-1", [cookie("datadome", ".b.com")]);
    expect((await loadClearance("owner-1")).map((c) => c.name).sort()).toEqual(["cf_clearance", "datadome"]);
    // A server restart (empty cache) reads them back from the database.
    resetClearanceCache();
    expect((await loadClearance("owner-1")).map((c) => c.domain).sort()).toEqual([".a.com", ".b.com"]);
    // Other accounts don't get them.
    expect(await loadClearance("owner-2")).toEqual([]);
  });
});

describe("a captcha solved once stays solved (real Chrome)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    // A site behind a "human check": /solve is the check being passed (sets cf_clearance);
    // every other page shows the wall unless the browser already has the clearance.
    server = createServer((req, res) => {
      const cleared = /(?:^|;\s*)cf_clearance=ok/.test(req.headers.cookie || "");
      if (req.url === "/solve") {
        res.setHeader("Set-Cookie", "cf_clearance=ok; Path=/; Max-Age=3600; HttpOnly");
        res.end("<title>Thanks</title>solved");
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end(cleared ? "<title>Site</title>welcome back" : "<title>Just a moment...</title>verify you are human");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    server.close();
    const { getBrowser } = await import("@/lib/agent/browser");
    await (await getBrowser()).close().catch(() => {});
  });

  it("a new chat skips the check after you solved it in another chat", async () => {
    resetClearanceCache();
    const { BrowserSession } = await import("@/lib/agent/sessions");
    const { ensureDevice } = await import("@/lib/server/identity");
    const { ownerId } = await ensureDevice("cleartestdevice00000001");

    const first = new BrowserSession("chat-a", ownerId);
    await first.start(null);
    await first.active().goto(`${base}/page`);
    expect(await first.active().title()).toBe("Just a moment...");
    await first.active().goto(`${base}/solve`); // you solve the captcha
    await first.persist();
    await first.close();

    resetClearanceCache(); // even across a server restart
    const second = new BrowserSession("chat-b", ownerId);
    await second.start(null);
    await second.active().goto(`${base}/page`);
    expect(await second.active().title()).toBe("Site");
    await second.close();
  }, 90_000);
});
