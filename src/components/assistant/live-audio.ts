// Plays the live browser's sound: Opus/WebM chunks recorded in the page (see AUDIO_SCRIPT
// in sessions.ts) are appended to a MediaSource and kept close to live.
const MIME = 'audio/webm; codecs="opus"';
const MAX_LAG_S = 0.6;

/** active: sound is streaming now; heard: this browser has played sound (keeps the mute button). */
export type LiveAudioState = { active: boolean; heard: boolean; blocked: boolean; muted: boolean };

function decode(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function liveAudioSupported() {
  return typeof window !== "undefined" && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(MIME);
}

export function createLiveAudio(onState: (s: LiveAudioState) => void) {
  const el = new Audio();
  el.preload = "auto";
  // Lets tests (and you, in devtools) check that sound is really playing.
  (window as unknown as { __senkoLiveAudio?: HTMLAudioElement }).__senkoLiveAudio = el;
  let source: MediaSource | null = null;
  let buffer: SourceBuffer | null = null;
  let url = "";
  let id: string | null = null;
  let queue: Uint8Array<ArrayBuffer>[] = [];
  const state: LiveAudioState = { active: false, heard: false, blocked: false, muted: false };
  const set = (patch: Partial<LiveAudioState>) => {
    Object.assign(state, patch);
    onState({ ...state });
  };

  const teardown = () => {
    queue = [];
    buffer = null;
    if (source?.readyState === "open") {
      try { source.endOfStream(); } catch { /* closing */ }
    }
    source = null;
    el.pause();
    el.removeAttribute("src");
    el.load();
    if (url) URL.revokeObjectURL(url);
    url = "";
    id = null;
  };

  const play = () => {
    if (state.muted) return;
    el.play().then(() => state.blocked && set({ blocked: false })).catch(() => set({ blocked: true }));
  };

  const pump = () => {
    if (!buffer || buffer.updating) return;
    const ranges = buffer.buffered;
    if (ranges.length) {
      const end = ranges.end(ranges.length - 1);
      // Stay live: skip ahead after a stall instead of drifting further behind.
      if (end - el.currentTime > MAX_LAG_S) el.currentTime = Math.max(0, end - 0.15);
      // Drop old audio so a long video doesn't grow memory.
      if (el.currentTime - ranges.start(0) > 30) {
        try { buffer.remove(0, el.currentTime - 10); } catch { /* busy */ }
        return;
      }
    }
    const next = queue.shift();
    if (!next) return;
    try {
      buffer.appendBuffer(next);
    } catch {
      teardown();
      set({ active: false });
    }
  };

  const begin = (streamId: string) => {
    teardown();
    id = streamId;
    const ms = new MediaSource();
    source = ms;
    url = URL.createObjectURL(ms);
    el.src = url;
    ms.addEventListener("sourceopen", () => {
      if (source !== ms) return;
      try {
        buffer = ms.addSourceBuffer(MIME);
        buffer.mode = "sequence";
        buffer.addEventListener("updateend", pump);
        pump();
      } catch {
        teardown();
      }
    }, { once: true });
    set({ active: true, heard: true });
    play();
  };

  return {
    handle(e: { id: string; seq?: number; data?: string; end?: boolean }) {
      if (!liveAudioSupported()) return;
      if (e.end) {
        if (e.id === id) { teardown(); set({ active: false }); }
        return;
      }
      if (!e.data) return;
      if (e.id !== id) {
        // Only a stream's first chunk carries the header; wait for one.
        if (e.seq !== 0) return;
        begin(e.id);
      }
      // A backlog this deep means the decoder stalled; dropping chunks would corrupt
      // the stream, so stop and pick up again at the next stream start.
      if (queue.length > 200) { teardown(); set({ active: false }); return; }
      queue.push(decode(e.data));
      pump();
    },
    setMuted(muted: boolean) {
      el.muted = muted;
      set({ muted });
      if (!muted && state.active) play();
    },
    /** Retry after the browser blocked autoplay (call from a click). */
    unblock() { play(); },
    reset() { teardown(); set({ active: false }); },
    dispose() { teardown(); },
  };
}
