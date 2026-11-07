import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchResearchPage, publicResearchUrl } from "@/lib/agent/coding-research";

vi.mock("node:dns/promises", () => ({ default: { lookup: vi.fn(async () => [{ address: "93.184.216.34" }]) } }));
afterEach(() => vi.unstubAllGlobals());
describe("public coding research", () => {
  it("rejects private hosts and credentials, including the app's own localhost", () => {
    for (const url of ["http://localhost:3000/api/settings", "http://127.0.0.1:3000", "http://10.0.0.1", "http://169.254.169.254", "http://[::1]", "file:///etc/passwd", "https://user:password@example.com"]) expect(() => publicResearchUrl(url)).toThrow();
    expect(publicResearchUrl("https://example.com/docs").hostname).toBe("example.com");
  });
  it("rechecks redirect destinations before making another request", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3000/api/settings" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchResearchPage("https://example.com")).rejects.toThrow(/public HTTP/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
