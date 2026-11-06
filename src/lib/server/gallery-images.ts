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

async function download(raw: string, signal: AbortSignal, hops = 0): Promise<Buffer> {
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
    return download(new URL(response.headers.location, url).href, signal, hops + 1);
  }
  const contentType = response.headers["content-type"] || "";
  if (status !== 200 || !/^image\/(?:jpeg|png|webp|gif|avif|apng|bmp|tiff|x-ms-bmp)\b/i.test(contentType) ||
    Number(response.headers["content-length"]) > MAX_BYTES) {
    response.destroy();
    throw new Error("Image response unavailable or unsupported");
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

async function verify(candidate: ScrapedImage, signal: AbortSignal): Promise<VerifiedImage | undefined> {
  try {
    const input = await download(candidate.url, AbortSignal.any([signal, AbortSignal.timeout(4_500)]));
    signal.throwIfAborted();
    const decoded = sharp(input, { limitInputPixels: 24_000_000 })
      .timeout({ seconds: 3 }).rotate().resize(1080, 1080, { fit: "inside", withoutEnlargement: true });
    const { data, info } = await decoded.webp({ quality: 83 }).toBuffer({ resolveWithObject: true });
    if (info.width < 120 || info.height < 120) return;
    const pixels = await sharp(data).resize(9, 8, { fit: "fill" }).flatten().greyscale().raw().toBuffer();
    let fingerprint = BigInt(0);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        fingerprint = (fingerprint << BigInt(1)) | BigInt(pixels[row * 9 + col] > pixels[row * 9 + col + 1]);
      }
    }
    return { candidate, data, width: info.width, height: info.height, fingerprint };
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
  const tokens = [...words(query)].filter((word) => !/^(a|an|and|the|of|in|with|art|fanart|wallpaper|illustration|official|images|photos)$/.test(word));
  const labeled: ScrapedImage[] = [];
  const matchedByUrl: ScrapedImage[] = [];
  for (const image of images) {
    const title = words(image.alt);
    let path = "";
    try { path = decodeURIComponent(new URL(image.url).pathname); } catch { /* URL validation follows */ }
    const urlWords = words(path);
    if (image.engine !== "gallery" && tokens.every((token) => title.has(token))) labeled.push(image);
    else if (title.size <= 5 && tokens.every((token) => urlWords.has(token))) matchedByUrl.push(image);
  }
  const incidental = /\b(?:cosplay\w*|tapestry|merchandise|wall decor|plush\w*|figurine\w*)\b/i;
  const ranked = [...labeled, ...matchedByUrl];
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
