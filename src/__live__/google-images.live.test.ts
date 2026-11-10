// Google Programmable Search (image mode) answers with real images for this app's engine.
import { it, expect } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { googleImagesConfigured, searchMultiEngineImages } from "@/lib/server/images";

it("Google image search returns results", async () => {
  expect(googleImagesConfigured()).toBe(true);
  // Only Google, so the result proves this engine works on its own.
  process.env.SENKO_DISABLE_IMAGE_ENGINES = "bing,ddg,wallhaven,booru,gallery,reddit,wikimedia,openverse,proxy";
  const res = await searchMultiEngineImages(process.env.GOOGLE_TEST_QUERY || "Anya Forger", 1, 60);
  console.log("google results:", res.stats.google || 0, res.images.slice(0, 3).map((i) => i.url.slice(0, 90)));
  expect(res.stats.google || 0).toBeGreaterThanOrEqual(10);
}, 60_000);
