import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { rankVideos, kindOf, youtubeEmbed } from "@/lib/agent/page-videos";
import { rewritePlaylist, videoProxyUrl } from "@/lib/chat-video";
import { parseBrowserDecision } from "@/lib/agent/action-protocol";
import { toWebp } from "@/lib/server/gallery-images";

describe("videos sent to chat", () => {
  it("knows files, streams and embeds", () => {
    expect(kindOf("https://cdn.x/v/1.mp4?t=1")).toBe("file");
    expect(kindOf("https://cdn.x/hls/master.m3u8")).toBe("hls");
    expect(kindOf("https://player.vimeo.com/video/123")).toBe("embed");
    expect(kindOf("https://x.com/page")).toBeNull();
    expect(youtubeEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(youtubeEmbed("https://youtube.com/shorts/dQw4w9WgXcQ")).toContain("dQw4w9WgXcQ");
  });

  it("puts the best video first and drops stream pieces and duplicates", () => {
    const out = rankVideos([
      { src: "https://cdn.x/seg-1.ts", kind: "file", score: 99 },
      { src: "https://cdn.x/a.mp4", kind: "file", score: 50 },
      { src: "https://cdn.x/b.m3u8", kind: "hls", score: 80 },
      { src: "https://cdn.x/a.mp4", kind: "file", score: 40 },
      { src: "blob:https://x/123", kind: "file", score: 100 },
    ]);
    expect(out.map((v) => v.src)).toEqual(["https://cdn.x/b.m3u8", "https://cdn.x/a.mp4"]);
  });

  it("routes every playlist entry back through the proxy with the page as referer", () => {
    const text = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg0.ts\nhttps://other.cdn/seg1.ts\n';
    const out = rewritePlaylist(text, "https://cdn.x/hls/index.m3u8", "https://site.x/post/1").split("\n");
    expect(out[1]).toContain(`URI="${videoProxyUrl("https://cdn.x/hls/key.bin", "https://site.x/post/1")}"`);
    expect(out[3]).toBe(videoProxyUrl("https://cdn.x/hls/seg0.ts", "https://site.x/post/1"));
    expect(out[4]).toBe(videoProxyUrl("https://other.cdn/seg1.ts", "https://site.x/post/1"));
    expect(out[0]).toBe("#EXTM3U");
  });

  it("accepts the send_video action", () => {
    expect(parseBrowserDecision('{"action":"send_video"}')).toMatchObject({ action: "send_video" });
    expect(parseBrowserDecision('{"action":"send_video","index":"2"}')).toMatchObject({ action: "send_video", index: 2 });
    expect(parseBrowserDecision('{"action":"send_video","index":0}')).toBeNull();
  });
});

describe("GIFs stay animated", () => {
  it("keeps every frame of an animated GIF", async () => {
    const frame = (r: number) => ({ create: { width: 200, height: 160, channels: 3 as const, background: { r, g: 0, b: 0 } } });
    const frames = await Promise.all([0, 120, 240].map((r) => sharp(frame(r)).png().toBuffer()));
    const gif = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
    expect((await sharp(gif).metadata()).pages).toBe(3);
    const { data, info } = await toWebp(gif);
    expect((await sharp(data).metadata()).pages).toBe(3);
    expect(info.pageHeight || info.height).toBe(160);
  });

  it("still images stay single-frame", async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#08f" } }).png().toBuffer();
    const { data } = await toWebp(png);
    expect((await sharp(data).metadata()).pages || 1).toBe(1);
  });
});
