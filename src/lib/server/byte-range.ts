// HTTP Range parsing for media served from the database (audio needs it to play and seek).

/** "bytes=100-199" / "bytes=100-" / "bytes=-500" -> [start, end] inside a body of `size` bytes. */
export function byteRange(header: string | null, size: number): [number, number] | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? [start, end] : null;
}
