/** A slow subscriber holds at most one queued frame, always the newest one.
 * Reliable events retain ordering, with a hard limit so a stalled viewer disconnects
 * instead of retaining an unbounded session history in memory. */
export function createLiveStream<T extends { type: string }>(subscribe: (send: (event: T) => void) => () => void, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let frame: T | undefined;
  let cursor: T | undefined;
  const reliable: T[] = [];
  let open = true;
  const cleanup = () => {
    if (!open) return;
    open = false;
    clearInterval(ping);
    unsubscribe();
    signal.removeEventListener("abort", abort);
    frame = cursor = undefined;
    reliable.length = 0;
  };
  const abort = () => { cleanup(); try { controller.close(); } catch { /* already closed */ } };
  const flush = () => {
    if (!open) return;
    while ((controller.desiredSize ?? 0) > 0) {
      let next = reliable.shift();
      if (!next && cursor) { next = cursor; cursor = undefined; }
      if (!next && frame) { next = frame; frame = undefined; }
      if (!next) break;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(next)}\n\n`));
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      unsubscribe = subscribe(event => {
        if (!open) return;
        if (event.type === "frame") frame = event;
        // Clicks are reliable; only transient cursor movement can be replaced.
        else if (event.type === "cursor" && (event as T & { kind?: string }).kind !== "click") cursor = event;
        else {
          if (event.type === "reset") { frame = cursor = undefined; }
          if (event.type === "cursor") cursor = undefined;
          reliable.push(event);
        }
        if (reliable.length > 512) {
          cleanup(); controller.error(new Error("Live viewer is too slow; reconnect to resume.")); return;
        }
        flush();
      });
      // subscribe may replay synchronously and overflow before it returns its cleanup.
      if (!open) { unsubscribe(); return; }
      ping = setInterval(() => {
        if (open && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 20_000);
    },
    pull() { flush(); },
    cancel() { cleanup(); },
  }, { highWaterMark: 1 });
  return stream;
}
