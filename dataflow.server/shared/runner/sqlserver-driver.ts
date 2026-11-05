import type { QueryDatabase } from '@dataflow/core';
import type { ConnectionPool } from 'mssql';

/*
 * SQL Server Query's driver, in the worker (mssql): the rows streamed one by one with backpressure (the request pauses
 * while the flow does not take them), the parameters bound as parameters (@name, never pasted into the text), the
 * query's own timeout, and Stop cancelling it in the database. The connections are pooled per connection string in
 * this worker (the process is recycled after a number of runs, the pools with it).
 */

/** how many rows wait for the flow before the request pauses, and how few before it goes on */
const HIGH_WATER = 500;
const LOW_WATER = 100;
/** pools kept by this worker (the least recently used goes past it) */
const KEPT_POOLS = 8;

const pools = new Map<string, Promise<ConnectionPool>>();

/** the pool of a connection string, connected once and kept */
async function poolOf(connection: string): Promise<ConnectionPool> {
  const known = pools.get(connection);
  if (known) {
    pools.delete(connection);
    pools.set(connection, known);
    return known;
  }

  const { default: sql } = await import('mssql');
  const pool = new sql.ConnectionPool(connection);
  const connected = pool.connect().catch(e => {
    pools.delete(connection);
    throw e;
  });
  pools.set(connection, connected);
  if (pools.size > KEPT_POOLS) {
    const [oldest, gone] = pools.entries().next().value!;
    pools.delete(oldest);
    void gone.then(p => p.close()).catch(() => undefined);
  }

  return connected;
}

/** closes this worker's pools (when it stops) */
export async function closeSqlServerPools() {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map(p => p.then(pool => pool.close()).catch(() => undefined)));
}

export const querySqlServer: QueryDatabase = async function* ({ connection, sql: text, parameters, timeoutMs, signal }) {
  if (signal.aborted) {
    return;
  }

  const pool = await poolOf(connection);
  const request = pool.request();
  request.stream = true;
  (request as unknown as { timeout: number }).timeout = timeoutMs;
  for (const [name, value] of Object.entries(parameters)) {
    request.input(name, value ?? null);
  }

  const rows: Record<string, unknown>[] = [];
  let done = false;
  let failure: unknown;
  let paused = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  request.on('row', (row: Record<string, unknown>) => {
    rows.push(row);
    if (rows.length >= HIGH_WATER && !paused) {
      paused = true;
      request.pause();
    }

    notify();
  });
  request.on('error', (e: unknown) => {
    failure ??= e;
    notify();
  });
  request.on('done', () => {
    done = true;
    notify();
  });
  const cancel = () => request.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  request.query(text);
  try {
    while (true) {
      const row = rows.shift();
      if (row) {
        if (paused && rows.length <= LOW_WATER) {
          paused = false;
          request.resume();
        }

        yield row;
        continue;
      }

      if (failure) {
        throw failure;
      }

      if (done || signal.aborted) {
        return;
      }

      await new Promise<void>(resolve => (wake = resolve));
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    // the flow stopped taking rows (a Limit, a failure further on): the rest is not read
    if (!done) {
      request.cancel();
    }
  }
};
