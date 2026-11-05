/**
 * Time of a component, started and stopped by the engine. An active stopwatch (`exclusive`) is the component's own work:
 * it starts when its code runs again (the engine asked for the next result, an envelope arrived) and stops when it is
 * waiting (input, next component, ctx.wait). There is a single thread, so only one component's code runs at a time:
 * starting an active stopwatch stops the one that was running, in any run of the process, and the components' active
 * times add up to no more than the time that passed. Without that, the time other components ran in between (between
 * a `yield` and the engine taking the result) counted for every component that had its stopwatch on, more for those in
 * the middle of a flow. A waiting stopwatch (waits on databases, APIs, called flows) is not exclusive: waits overlap.
 */
export class Stopwatch {
  /** the active stopwatch running now, if any */
  private static current?: Stopwatch;
  total = 0;
  /** when it first ran (performance.now()) */
  firstAt?: number;
  private since?: number;

  constructor(private readonly exclusive = false) {}

  get running() { return this.since !== undefined; }

  resume() {
    if (this.exclusive && Stopwatch.current !== this) {
      Stopwatch.current?.stop();
      Stopwatch.current = this;
    }
    this.since ??= performance.now();
    this.firstAt ??= this.since;
  }

  stop() {
    if (Stopwatch.current === this) Stopwatch.current = undefined;
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
