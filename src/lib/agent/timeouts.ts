// Bounded waits for browser calls.
//
// Playwright's page.evaluate() and page.title() have no timeout: on a tab whose renderer is
// hung (a runaway script, a crashed GPU process, a page stuck in a dialog) they never settle,
// and everything awaiting them freezes with it. Every routine read goes through these helpers.

/** Resolve with `fallback` if `work` hasn't settled within `ms` (rejections also give `fallback`). */
export function withTimeout<T, F = T>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise<T | F>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`Timeout ${ms}ms exceeded while ${what}`);
  }
}

/** Reject with a TimeoutError if `work` hasn't settled within `ms`. */
export function orTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Sleep that ends early (without throwing) when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
