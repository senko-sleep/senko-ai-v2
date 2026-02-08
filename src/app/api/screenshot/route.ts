import { NextRequest } from "next/server";
import puppeteer from "puppeteer";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,800",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 15000,
    });

    // Wait a bit for dynamic content to load
    await new Promise((r) => setTimeout(r, 2000));

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
      encoding: "base64",
    });

    const title = await page.title();

    await browser.close();

    return Response.json({
      screenshot: `data:image/png;base64,${screenshot}`,
      title,
      url,
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return Response.json({
      error: err instanceof Error ? err.message : "Screenshot failed",
    }, { status: 500 });
  }
}
