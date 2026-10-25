/**
 * The rows of a query, adding up the time spent waiting for the server (not the time the flow takes to consume them).
 * Used by the database sources to say, in their log, how much of a query was the server.
 */
export async function* serverTimed<T>(rows: AsyncIterable<T>, add: (ms: number) => void): AsyncIterable<T> {
  const it = rows[Symbol.asyncIterator]();
  try {
    while (true) {
      const t0 = performance.now();
      const r = await it.next();
      add(performance.now() - t0);
      if (r.done) return;
      yield r.value;
    }
  } finally {
    await it.return?.();
  }
}
