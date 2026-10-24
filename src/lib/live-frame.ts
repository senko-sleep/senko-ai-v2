/** Latest-only decode pipeline. Generation tokens prevent old sessions from painting. */
export function createFrameDecoder<T, B>(decode: (frame: T) => Promise<B>, ready: (bitmap: B, frame: T) => void, close: (bitmap: B) => void) {
  let pending: T | undefined;
  let busy = false;
  let generation = 0;
  let disposed = false;
  const pump = async () => {
    if (busy || disposed || pending === undefined) return;
    const frame = pending;
    pending = undefined;
    const token = generation;
    busy = true;
    try {
      const bitmap = await decode(frame);
      if (disposed || token !== generation) close(bitmap);
      else ready(bitmap, frame);
    } catch { /* Skip a corrupt frame; the next frame must still be decodable. */ }
    finally { busy = false; void pump(); }
  };
  return {
    push(frame: T) { if (!disposed) { pending = frame; void pump(); } },
    reset() { generation++; pending = undefined; },
    dispose() { disposed = true; generation++; pending = undefined; },
  };
}
