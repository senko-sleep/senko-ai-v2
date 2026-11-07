import type { Page, Frame } from "playwright";

export interface MediaPlaybackCheck {
  kind: "native" | "youtube";
  url: string;
  currentTime: number;
  advancedSeconds: number;
  paused: boolean;
  muted: boolean;
  readyState: number;
  error?: string;
  verified: boolean;
}

/** Observes the browser media element itself, including cross-origin provider frames. */
export async function inspectMediaPlayback(page: Page): Promise<MediaPlaybackCheck[]> {
  const surfaces: { frame: Page | Frame; kind: MediaPlaybackCheck["kind"]; url: string }[] = [
    { frame: page, kind: "native", url: page.url() },
    ...page.frames().filter((frame) => { try { const url = new URL(frame.url()); return /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(url.hostname) && url.pathname.startsWith("/embed/"); } catch { return false; } })
      .map((frame) => ({ frame, kind: "youtube" as const, url: frame.url() })),
  ];
  const sample = async (surface: typeof surfaces[number]) => surface.frame.evaluate(() => Array.from(document.querySelectorAll("audio,video")).map((node) => {
    const media = node as HTMLMediaElement;
    return { currentTime: media.currentTime, paused: media.paused, muted: media.muted || media.volume === 0, readyState: media.readyState, error: media.error ? `MediaError ${media.error.code}: ${media.error.message}` : undefined };
  })).catch(() => []);
  const before = await Promise.all(surfaces.map(sample));
  await page.waitForTimeout(1200);
  const after = await Promise.all(surfaces.map(sample));
  const providerErrors = await Promise.all(surfaces.map(async (surface) => surface.kind === "youtube" ? surface.frame.locator("body").innerText({ timeout: 1000 }).then((text) => text.replace(/\s+/g, " ").trim().slice(0, 500)).catch(() => "") : ""));
  return surfaces.flatMap((surface, index) => {
    const values = after[index];
    if (!values.length && surface.kind === "youtube") return [{ kind: surface.kind, url: surface.url, currentTime: 0, advancedSeconds: 0, paused: true, muted: false, readyState: 0, error: providerErrors[index] || "Embedded provider exposed no playable media; inspect its restriction or loading state.", verified: false }];
    return values.map((value, mediaIndex) => ({ ...value, kind: surface.kind, url: surface.url,
      advancedSeconds: Math.max(0, value.currentTime - (before[index][mediaIndex]?.currentTime ?? value.currentTime)),
      verified: !value.paused && !value.muted && value.readyState >= 2 && !value.error && value.currentTime - (before[index][mediaIndex]?.currentTime ?? value.currentTime) >= 0.2 }));
  });
}
