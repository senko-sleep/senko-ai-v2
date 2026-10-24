/** Change-driven delivery with a latest-only trailing frame. Never lose the final
 * state when a page stops changing inside the viewer's frame budget. */
export function createFramePublisher<T>(publish: (frame: T) => void, rate: () => number) {
  let last = -Infinity;
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const flush = () => {
    timer = undefined;
    if (disposed || pending === undefined) return;
    const frame = pending;
    pending = undefined;
    last = performance.now();
    publish(frame);
  };
  return {
    push(frame: T) {
      if (disposed) return;
      pending = frame;
      const wait = 1000 / rate() - (performance.now() - last);
      if (wait <= 1) { clearTimeout(timer); flush(); }
      else timer ??= setTimeout(flush, wait);
    },
    reset() { clearTimeout(timer); timer = undefined; pending = undefined; last = -Infinity; },
    dispose() { disposed = true; clearTimeout(timer); pending = undefined; },
  };
}
