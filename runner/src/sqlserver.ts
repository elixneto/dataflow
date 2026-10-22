import sql from 'mssql';
import {sqlServerReadOnlyIssue, type QuerySqlServer} from '@dataflow/core';

/*
 * SQL Server Query: read-only query with the mssql driver (tedious), streaming and with backpressure.
 * Read-only, on top of the core's check (only SELECT/WITH): the query runs inside a transaction that always
 * ends in a rollback, and the connection goes with ApplicationIntent=ReadOnly. Ideally the login has only db_datareader.
 */

/** Above this the database pauses until the flow consumes; below RESUME, it sends again. */
const PAUSE = 500;
const RESUME = 100;

/** One pool per connection string, opened on the first query and reused across runs. */
const pools = new Map<string, Promise<sql.ConnectionPool>>();

function pool(connection: string) {
  let p = pools.get(connection);
  if (!p) {
    const config = sql.ConnectionPool.parseConnectionString(connection);
    config.options = {...config.options, readOnlyIntent: true};
    p = new sql.ConnectionPool(config).connect();
    // a connection that failed is not cached (the next attempt opens it again)
    p.catch(() => pools.delete(connection));
    pools.set(connection, p);
  }
  return p;
}

/** A value that fits in the envelope (JSON): a date becomes ISO, binary becomes base64. */
function toEnvelopeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return value;
}

/** Driver error with a helpful message (without the connection string). */
function errorMessage(e: unknown): Error {
  const error = e instanceof Error ? e : new Error(String(e));
  const code = (e as {code?: string})?.code;
  if (code === 'ELOGIN') return Object.assign(new Error(`Login refused by SQL Server: ${error.message}`), {name: 'LoginError'});
  if (code === 'ESOCKET' || (code === 'ETIMEOUT' && /connect/i.test(error.message))) {
    return Object.assign(new Error(`Could not connect to SQL Server: ${error.message}`), {name: 'ConnectionError'});
  }
  if (code === 'ETIMEOUT') return Object.assign(new Error(`The query exceeded the maximum time: ${error.message}`), {name: 'TimeoutError'});
  if (code === 'ECANCEL') return Object.assign(new Error('Query cancelled.'), {name: 'AbortError'});
  return error;
}

export const querySqlServer: QuerySqlServer = async function* ({connection, sql: text, parameters, timeoutMs, signal}) {
  const issue = sqlServerReadOnlyIssue(text);
  if (issue) throw new Error(`The query ${issue}.`);
  if (signal.aborted) return;

  let connected: sql.ConnectionPool;
  try {
    connected = await pool(connection);
  } catch (e) {
    throw errorMessage(e);
  }

  const transaction = new sql.Transaction(connected);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  const request = new sql.Request(transaction);
  request.stream = true;
  for (const [name, value] of Object.entries(parameters)) request.input(name, value ?? null);

  // queue between the driver's events and the consumer; pauses the database when it fills up
  const queue: Record<string, unknown>[] = [];
  let finished = false;
  let error: unknown;
  let paused = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    const w = wake;
    wake = undefined;
    w?.();
  };

  request.on('row', (row: Record<string, unknown>) => {
    const converted: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) converted[column] = toEnvelopeValue(value);
    queue.push(converted);
    if (!paused && queue.length >= PAUSE) {
      paused = true;
      request.pause();
    }
    notify();
  });
  // the driver always ends with done (also after an error or a cancellation): only then can it roll back
  let done = false;
  const end = new Promise<void>(resolve => request.on('done', () => {
    done = true;
    resolve();
  }));
  request.on('error', e => {
    error ??= e;
    notify();
  });
  request.on('done', () => {
    finished = true;
    notify();
  });
  const cancel = () => request.cancel();
  signal.addEventListener('abort', cancel);
  const limit = setTimeout(() => {
    error ??= Object.assign(new Error(`this component's limit is ${Math.round(timeoutMs / 1000)} s.`), {code: 'ETIMEOUT'});
    request.cancel();
    notify();
  }, timeoutMs);

  request.query(text);
  try {
    while (true) {
      // Stop: does not yield what was still in the queue
      if (signal.aborted) return;
      if (queue.length) {
        yield queue.shift()!;
        if (paused && queue.length <= RESUME) {
          paused = false;
          request.resume();
        }
        continue;
      }
      if (error) throw errorMessage(error);
      if (finished || signal.aborted) return;
      await new Promise<void>(resolve => (wake = resolve));
    }
  } finally {
    clearTimeout(limit);
    signal.removeEventListener('abort', cancel);
    // stopped before the end (error, cancelled, the consumer gave up): cancels what is left in the database and waits for the driver to let go
    if (!done) {
      if (paused) request.resume();
      request.cancel();
      await Promise.race([end, new Promise(r => setTimeout(r, 5_000))]);
    }
    // read-only: never commits anything
    await transaction.rollback().catch(() => {});
  }
};
