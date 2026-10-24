/** A slow subscriber holds at most one queued frame, always the newest one.
 * Reliable events retain ordering, with a hard limit so a stalled viewer disconnects
 * instead of retaining an unbounded session history in memory. */
export function createLiveStream<T extends { type: string }>(subscribe: (send: (event: T) => void) => () => void, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let frame: T | undefined;
  const reliable: T[] = [];
  let open = true;
  const cleanup = () => {
    if (!open) return;
    open = false;
    clearInterval(ping);
    unsubscribe();
    signal.removeEventListener("abort", abort);
    frame = undefined;
    reliable.length = 0;
  };
  const abort = () => { cleanup(); try { controller.close(); } catch { /* already closed */ } };
  const flush = () => {
    if (!open) return;
    while ((controller.desiredSize ?? 0) > 0) {
      let next = reliable.shift();
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
        else {
          if (event.type === "reset") {
            frame = undefined;
            // Discard pointer waypoints for a document that is no longer visible.
            for (let i = reliable.length - 1; i >= 0; i--) if (reliable[i].type === "cursor") reliable.splice(i, 1);
          }
          // Pointer waypoints are produced only while the agent performs real
          // mouse moves. Keep their order so the live cursor follows that path.
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
