import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import sharp from "sharp";
import { assertPublicHttpUrl, isPrivateAddress } from "./net-guard";
import type { ScrapedImage } from "./images";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CANDIDATES = 72;
const CONCURRENCY = 10;

function withAbort<T>(job: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void job.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export interface VerifiedImage {
  candidate: ScrapedImage;
  data: Buffer;
  width: number;
  height: number;
  fingerprint: bigint;
}

async function download(raw: string, signal: AbortSignal, hops = 0, headersOnly = false): Promise<Buffer> {
  if (hops > 3) throw new Error("Too many image redirects");
  signal.throwIfAborted();
  const url = await withAbort(assertPublicHttpUrl(raw), signal);
  if (url.port) throw new Error("Nonstandard image port");
  // Pin the checked address so a second DNS lookup cannot redirect the connection.
  const address = await withAbort(lookup(url.hostname, { family: 4 }), signal);
  if (isPrivateAddress(address.address)) throw new Error("Private image host");
  signal.throwIfAborted();
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const req = send(url, {
      signal,
      family: 4,
      lookup: (_host, opts, callback) => {
        if (opts.all) callback(null, [address]);
        else callback(null, address.address, 4);
      },
      headers: { Accept: "image/*", "User-Agent": "Mozilla/5.0 (compatible; SenkoImage/1.0)" },
    }, resolve);
    req.on("error", reject);
    req.end();
  });
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400 && response.headers.location) {
    response.destroy();
    return download(new URL(response.headers.location, url).href, signal, hops + 1, headersOnly);
  }
  const contentType = response.headers["content-type"] || "";
  if (status !== 200 || !/^image\/(?:jpeg|png|webp|gif|avif|apng|bmp|tiff|x-ms-bmp)\b/i.test(contentType) ||
    (!headersOnly && Number(response.headers["content-length"]) > MAX_BYTES)) {
    response.destroy();
    throw new Error("Image response unavailable or unsupported");
  }
  if (headersOnly) {
    response.destroy();
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("Image exceeds download limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Shrink to at most 1080px as WebP. GIFs and animated WebPs keep every frame (WebP animates),
 * so they still move in the chat; a huge animation falls back to its first frame.
 */
export async function toWebp(input: Buffer) {
  const still = () =>
    sharp(input, { limitInputPixels: 24_000_000 })
      .timeout({ seconds: 3 }).rotate().resize(1080, 1080, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 83 }).toBuffer({ resolveWithObject: true });
  const pages = await sharp(input).metadata().then((m) => m.pages || 1, () => 1);
  if (pages <= 1) return still();
  try {
    return await sharp(input, { animated: true, limitInputPixels: 120_000_000 })
      .timeout({ seconds: 8 }).resize(720, 720, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75, effort: 2 }).toBuffer({ resolveWithObject: true });
  } catch {
    return still();
  }
}

async function verify(candidate: ScrapedImage, signal: AbortSignal): Promise<VerifiedImage | undefined> {
  try {
    const input = await download(candidate.url, AbortSignal.any([signal, AbortSignal.timeout(4_500)]));
    signal.throwIfAborted();
    const { data, info } = await toWebp(input);
    const height = info.pageHeight || info.height;
    if (info.width < 120 || height < 120) return;
    const pixels = await sharp(data).resize(9, 8, { fit: "fill" }).flatten().greyscale().raw().toBuffer();
    let fingerprint = BigInt(0);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        fingerprint = (fingerprint << BigInt(1)) | BigInt(pixels[row * 9 + col] > pixels[row * 9 + col + 1]);
      }
    }
    return { candidate, data, width: info.width, height, fingerprint };
  } catch {
    return undefined;
  }
}

function similar(a: VerifiedImage, b: VerifiedImage): boolean {
  if (Math.abs(Math.log((a.width * b.height) / (b.width * a.height))) > 0.12) return false;
  let bits = a.fingerprint ^ b.fingerprint;
  for (let differences = 0; bits; differences++) {
    if (differences === 4) return false;
    bits &= bits - BigInt(1);
  }
  return true;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []);
}

export function relevantImageCandidates(query: string, images: ScrapedImage[]): ScrapedImage[] {
  const tokens = [...words(query)].filter((word) => !/^(a|an|and|the|of|in|on|at|to|for|by|from|with|art|fanart|wallpaper|illustration|official|images|photos|pictures|pics)$/.test(word));
  // Names need every word ("Anya Forger"). Longer descriptive searches ("Eiffel Tower at night",
  // "Tokyo street food") may miss one word; full matches still rank first.
  const allowedMisses = tokens.length >= 3 ? 1 : 0;
  const labeled: ScrapedImage[] = [];
  const nearly: ScrapedImage[] = [];
  const matchedByUrl: ScrapedImage[] = [];
  for (const image of images) {
    const title = words(image.alt);
    let path = "";
    try { path = decodeURIComponent(new URL(image.url).pathname); } catch { /* URL validation follows */ }
    const urlWords = words(path);
    const misses = tokens.filter((token) => !title.has(token) && !urlWords.has(token)).length;
    if (image.engine !== "gallery" && tokens.every((token) => title.has(token))) labeled.push(image);
    else if (title.size <= 5 && tokens.every((token) => urlWords.has(token))) matchedByUrl.push(image);
    // The first word is usually the subject itself; it must always match.
    else if (image.engine !== "gallery" && misses <= allowedMisses && tokens[0] && (title.has(tokens[0]) || urlWords.has(tokens[0]))) nearly.push(image);
  }
  const incidental = /\b(?:cosplay\w*|tapestry|merchandise|wall decor|plush\w*|figurine\w*)\b/i;
  const ranked = [...labeled, ...matchedByUrl, ...nearly];
  if (incidental.test(query)) return ranked;
  return ranked.sort((a, b) => Number(incidental.test(a.alt)) - Number(incidental.test(b.alt)));
}

/** Stream ranked batches of decoded, distinct images. Probe additional candidates when a batch is short. */
export async function* verifyGalleryImages(query: string, candidates: ScrapedImage[], limit: number, signal: AbortSignal) {
  const ranked = relevantImageCandidates(query, candidates).slice(0, MAX_CANDIDATES);
  const accepted: VerifiedImage[] = [];
  const series = new Set<string>();
  for (let offset = 0; offset < ranked.length && !signal.aborted && accepted.length < limit; offset += CONCURRENCY) {
    const batch = await Promise.all(ranked.slice(offset, offset + CONCURRENCY).map((image) => verify(image, signal)));
    const distinct = [];
    for (const image of batch) {
      if (!image || accepted.some((previous) => similar(previous, image))) continue;
      const sequence = /^(.*\b\d{8})[a-z]$/i.exec(image.candidate.alt.trim())?.[1]?.toLowerCase();
      if (sequence && series.has(sequence)) continue;
      if (sequence) series.add(sequence);
      accepted.push(image);
      distinct.push(image);
      if (accepted.length === limit) break;
    }
    if (distinct.length) yield distinct;
  }
}

/** Download, decode and re-encode one image URL. Undefined when it isn't a real, usable image. */
export function verifyImageUrl(url: string, signal: AbortSignal, alt = ""): Promise<VerifiedImage | undefined> {
  return verify({ url, alt, source: url, engine: "direct" }, signal);
}

/** True when two verified images are near-duplicates (same picture, different size/crop). */
export function sameImage(a: VerifiedImage, b: VerifiedImage): boolean {
  return similar(a, b);
}

const reachable = new Map<string, { ok: boolean; at: number }>();
const REACHABLE_TTL_MS = 30 * 60_000;

/** True when the URL answers 200 with an image (headers only, nothing is downloaded). Cached. */
export async function imageReachable(url: string, signal: AbortSignal, timeoutMs = 3_000): Promise<boolean> {
  const hit = reachable.get(url);
  if (hit && Date.now() - hit.at < REACHABLE_TTL_MS) return hit.ok;
  let ok = false;
  try {
    await download(url, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), 0, true);
    ok = true;
  } catch {
    // An abort from the caller says nothing about the image: don't remember it.
    if (signal.aborted) return false;
  }
  if (reachable.size > 5000) reachable.clear();
  reachable.set(url, { ok, at: Date.now() });
  return ok;
}

/**
 * Keep only images whose URL really serves a picture (HTTP 200 + image content type), in their
 * original order. Checks run in parallel; whatever isn't confirmed by the deadline is dropped,
 * so the browser is never handed a broken link.
 */
export async function onlyReachableImages<T extends { url: string }>(images: T[], signal?: AbortSignal, opts: { max?: number; budgetMs?: number; concurrency?: number } = {}): Promise<T[]> {
  const list = images.slice(0, opts.max ?? images.length);
  const deadline = AbortSignal.timeout(opts.budgetMs ?? 6_000);
  const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const ok = new Array<boolean>(list.length).fill(false);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 24, list.length) }, async () => {
    while (next < list.length && !sig.aborted) {
      const i = next++;
      ok[i] = await imageReachable(list[i].url, sig);
    }
  }));
  return list.filter((_, i) => ok[i]);
}
