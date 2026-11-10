import type { Page } from "playwright";

export interface UiQualityResult { checks: { name: string; passed: boolean; detail: string }[]; passed: boolean }

/** Independent browser acceptance contract for the image-gallery coding benchmark. */
export async function evaluateImageGallery(page: Page, url: string, screenshot?: (name: string) => Promise<void>): Promise<UiQualityResult> {
  page.setDefaultTimeout(2000);
  const checks: UiQualityResult["checks"] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const check = async (name: string, run: () => Promise<string>) => {
    try { checks.push({ name, passed: true, detail: await run() }); }
    catch (error) { checks.push({ name, passed: false, detail: error instanceof Error ? error.message.slice(0, 600) : String(error) }); }
  };
  for (const [name, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
    await check(`${name}: real images and accessible descriptions`, async () => {
      const images = page.locator('[data-testid="card"] img');
      if (await images.count() !== 3) throw new Error("Expected three card images.");
      for (const image of await images.all()) { await image.scrollIntoViewIfNeeded(); await image.evaluate((img) => (img as HTMLImageElement).decode()); }
      const stats = await images.evaluateAll((nodes) => nodes.map((node) => { const img = node as HTMLImageElement; const rect = img.getBoundingClientRect(); return { src: img.currentSrc, loaded: img.complete && img.naturalWidth > 10, alt: img.alt.trim(), width: rect.width, height: rect.height, fit: getComputedStyle(img).objectFit }; }));
      if (stats.some((img) => !img.loaded || img.alt.length < 8 || img.width < 100 || img.height < 80 || !["cover", "contain"].includes(img.fit))) throw new Error(JSON.stringify(stats));
      return JSON.stringify(stats);
    });
    await check(`${name}: responsive layout and no overlapping images`, async () => {
      const layout = await page.locator('[data-testid="card"] img').evaluateAll((nodes) => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, boxes: nodes.map((node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) }));
      if (layout.document > layout.viewport + 1) throw new Error(`Document overflow: ${JSON.stringify(layout)}`);
      if (layout.boxes.length !== 3) throw new Error("Missing card image geometry.");
      const [a, b] = layout.boxes;
      if (name === "desktop" && Math.abs(a.y - b.y) > 2) throw new Error("Desktop gallery did not lay out cards alongside one another.");
      if (name === "mobile" && Math.abs(a.x - b.x) > 2) throw new Error("Mobile gallery did not become a single column.");
      for (let i = 0; i < layout.boxes.length; i++) for (let j = i + 1; j < layout.boxes.length; j++) {
        const a = layout.boxes[i], b = layout.boxes[j];
        if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1) throw new Error("Images overlap.");
      }
      return JSON.stringify(layout);
    });
    await page.evaluate(() => scrollTo(0, 0));
    await screenshot?.(name);
  }
  await check("filter changes the rendered card collection", async () => {
    await page.getByTestId("filter-mars").click({ timeout: 2000 });
    if (await page.locator('[data-testid="card"]:visible').count() !== 1) throw new Error("Mars filter did not show exactly one card.");
    await page.getByTestId("filter-all").click();
    if (await page.locator('[data-testid="card"]:visible').count() !== 3) throw new Error("All filter did not restore three cards.");
    return "Three → one → three visible cards.";
  });
  await check("favorite changes real state and persists after reload", async () => {
    const favorite = page.getByTestId("favorite-earth");
    const before = await favorite.getAttribute("aria-pressed");
    await favorite.click({ timeout: 2000 });
    const after = await favorite.getAttribute("aria-pressed");
    if (after === before || !["true", "false"].includes(after || "")) throw new Error("Favorite did not change aria-pressed state.");
    await page.reload({ waitUntil: "networkidle" });
    if (await page.getByTestId("favorite-earth").getAttribute("aria-pressed") !== after) throw new Error("Favorite state was lost on reload.");
    return "State changed and survived reload.";
  });
  await check("image details open and Escape closes the dialog", async () => {
    await page.getByTestId("detail-earth").click({ timeout: 2000 });
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 2000 });
    if (!(await dialog.innerText()).toLowerCase().includes("earth")) throw new Error("Dialog does not describe the selected Earth image.");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 2000 });
    return "Earth details visible; Escape dismissed the dialog.";
  });
  checks.push({ name: "no uncaught browser exceptions", passed: errors.length === 0, detail: errors.join("\n") || "No uncaught page errors." });
  return { checks, passed: checks.every((check) => check.passed) };
}
