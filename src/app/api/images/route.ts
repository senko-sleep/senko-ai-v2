import { NextRequest } from "next/server";
import { IMAGES_BATCH_SIZE, scrapeImagesFromPageUrl, searchMultiEngineImages } from "@/lib/server/images";
import { onlyReachableImages } from "@/lib/server/gallery-images";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const scrapeUrl = req.nextUrl.searchParams.get("url");
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10));
  const limit = Math.max(20, Math.min(500, parseInt(req.nextUrl.searchParams.get("limit") || String(IMAGES_BATCH_SIZE), 10) || IMAGES_BATCH_SIZE));

  if (scrapeUrl) {
    const images = await scrapeImagesFromPageUrl(scrapeUrl);
    return Response.json({
      images: images.slice(0, limit),
      query: scrapeUrl,
      page: 1,
      hasMore: false,
      stats: { gallery: images.length },
    });
  }

  if (!query?.trim()) {
    return Response.json({ error: "q or url required", images: [] }, { status: 400 });
  }

  const start = Date.now();
  const res = await searchMultiEngineImages(query, page, limit, AbortSignal.any([req.signal, AbortSignal.timeout(12_000)]));
  // ?verified=1: only URLs that answer 200 with an image (the chat's inline pictures use this).
  if (req.nextUrl.searchParams.get("verified") === "1") {
    res.images = await onlyReachableImages(res.images, req.signal, { budgetMs: 5_000 });
  }
  const ms = Date.now() - start;

  return Response.json({
    ...res,
    stats: { ...res.stats, ms },
  });
}
