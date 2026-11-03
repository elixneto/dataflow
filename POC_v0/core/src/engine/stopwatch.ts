/**
 * Active time of a component: starts when its code runs again (the engine asked for the next result, an envelope
 * arrived) and stops when it is waiting (input, next component, ctx.wait). Since there is a single thread,
 * the sum is practically the component's CPU.
 */
export class Stopwatch {
  total = 0;
  private since?: number;

  get running() { return this.since !== undefined; }

  resume() {
    this.since ??= performance.now();
  }

  stop() {
    if (this.since === undefined) return;
    this.total += performance.now() - this.since;
    this.since = undefined;
  }
}

/** Reads a source starting the stopwatch on each item and stopping it while waiting for the next. */
export async function* timed<T>(source: AsyncIterable<T>, stopwatch: Stopwatch): AsyncIterable<T> {
  const it = source[Symbol.asyncIterator]();
  try {
    while (true) {
      stopwatch.stop();
      const r = await it.next();
      if (r.done) return;
      stopwatch.resume();
      yield r.value;
    }
  } finally {
    await it.return?.();
  }
}

/** Starts the stopwatch on each request for the next result and stops it when the result comes out. */
export async function* timedRequests<T>(source: AsyncIterable<T>, stopwatch: Stopwatch): AsyncIterable<T> {
  const it = source[Symbol.asyncIterator]();
  try {
    while (true) {
      stopwatch.resume();
      const r = await it.next();
      stopwatch.stop();
      if (r.done) return;
      yield r.value;
    }
  } finally {
    await it.return?.();
  }
}
