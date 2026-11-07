import { CodingWorkspaceRuntime } from "@/lib/agent/coding-runtime";
import { describe, it, expect } from "vitest";
import { runAutonomousCodingWorkflow } from "@/lib/agent/coding-agent";

// Explicit live checks against saved local workspaces; excluded from npm test.
describe("saved coding workspaces", () => {
  it(
    "verifies the live Anime Playlist workspace (c_KxbGD8X9OWVn4let) remembers its primaryGoal, bundles with CSS imports, passes scraper/API tests, and renders playably in Chromium",
    async () => {
      const ws = new CodingWorkspaceRuntime("c_KxbGD8X9OWVn4let");
      const goal = await ws.syncPrimaryGoal();
      expect(goal.toLowerCase()).toContain("anime");
      expect(goal.toLowerCase()).toContain("scraper");

      const wf = await runAutonomousCodingWorkflow({
        chatId: "c_KxbGD8X9OWVn4let",
        goal: "Verify Anime Playlist website, tests, images, and audio scraper",
        inspectBrowser: true,
        maxRepairAttempts: 1,
      });

      expect(wf.testPassed).toBe(true);
      expect(wf.ledger.testStatus).toBe("passed");
      expect(wf.browserInspection).not.toBeNull();
      expect(wf.browserInspection?.consoleErrors).toEqual([]);
      expect(wf.browserInspection?.pageErrors).toEqual([]);
      expect(wf.browserInspection?.brokenImages).toEqual([]);
      expect(wf.browserInspection?.passed).toBe(true);
      expect(wf.browserInspection?.visibleTextExcerpt).toContain("Senko Anime OST Playlist");
      expect(wf.ledger.issues?.filter((i) => i.status !== "fixed") || []).toEqual([]);
    },
    60_000
  );

  it(
    "verifies the live Manga Chapter Web Scraper Reader workspace (c_LqRjG7_hKhcQisOC) passes node --test test/scraper.test.ts and renders playably in Chromium",
    async () => {
      const wf = await runAutonomousCodingWorkflow({
        chatId: "c_LqRjG7_hKhcQisOC",
        goal: "Verify Manga Chapter Web Scraper & Reader website, JSDOM scraper unit tests, and page reader controls",
        inspectBrowser: true,
        interactions: [{ action: "click", selector: "#next-page-btn" }],
        expectedText: ["How To Make Love In A Fantasy World", "Chapter 62 · Page 2 of 8"],
        maxRepairAttempts: 1,
      });

      expect(wf.testPassed).toBe(true);
      expect(wf.ledger.testStatus).toBe("passed");
      expect(wf.browserInspection).not.toBeNull();
      expect(wf.browserInspection?.consoleErrors).toEqual([]);
      expect(wf.browserInspection?.pageErrors).toEqual([]);
      expect(wf.browserInspection?.brokenImages).toEqual([]);
      expect(wf.browserInspection?.passed).toBe(true);
      expect(wf.browserInspection?.visibleTextExcerpt).toContain("Chapter 62 · Page 2 of 8");
      expect(wf.ledger.issues?.filter((i) => i.status !== "fixed") || []).toEqual([]);
    },
    60_000
  );
});
