import { NextRequest } from "next/server";
import { errorResponse, HttpError, identify } from "@/lib/server/identity";
import { comicChapters, comicPages, ehImage, isComicSource } from "@/lib/server/comics";
import { safeSearchFor } from "@/lib/server/persona";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET ?source=<id>&op=pages&id=<chapter id>    -> { pages }
 * GET ?source=<id>&op=chapters&id=<series id>  -> { chapters }
 * GET ?source=ehentai&op=image&id=<page url>   -> the page's image
 * Used by the chat reader to switch chapters without another chat turn.
 */
export async function GET(req: NextRequest) {
  try {
    const who = await identify(req);
    const p = req.nextUrl.searchParams;
    const source = p.get("source");
    const id = p.get("id") || "";
    if (!isComicSource(source) || !id) throw new HttpError(400, "source and id are required.");
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(50_000)]);
    if (p.get("op") === "image") {
      if (source !== "ehentai") throw new HttpError(400, "Images are only looked up for E-Hentai.");
      const safe = await safeSearchFor(who.ownerId).catch(() => "off" as const);
      if (safe === "strict") throw new HttpError(403, "SafeSearch is strict.");
      return await ehImage(id, signal);
    }
    if (p.get("op") === "chapters") {
      const safe = await safeSearchFor(who.ownerId).catch(() => "off" as const);
      return Response.json({ chapters: await comicChapters(source, id, safe, signal) });
    }
    return Response.json({ pages: await comicPages(source, id, signal) }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    return errorResponse(new HttpError(502, e instanceof Error ? e.message : String(e)));
  }
}
