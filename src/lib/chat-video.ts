/** A video the chat can play: a file, an HLS stream, or a player page to embed. */
export interface ChatVideo {
  src: string;
  kind: "file" | "hls" | "embed";
  /** The page the video came from (sent as the Referer when the chat proxies it). */
  pageUrl?: string;
  poster?: string;
  title?: string;
}

/** Our proxy URL for a video (or stream piece), sent with the page it came from as Referer. */
export function videoProxyUrl(src: string, referer?: string): string {
  const q = new URLSearchParams({ url: src });
  if (referer) q.set("referer", referer);
  return `/api/video-proxy?${q.toString()}`;
}

/** Point every URI in an HLS playlist back through this proxy (with the same Referer). */
export function rewritePlaylist(text: string, base: string, referer?: string): string {
  const abs = (u: string) => {
    try {
      return new URL(u, base).href;
    } catch {
      return u;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${videoProxyUrl(abs(u), referer)}"`);
      return videoProxyUrl(abs(t), referer);
    })
    .join("\n");
}
