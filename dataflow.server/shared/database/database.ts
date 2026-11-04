import { SQL } from 'bun';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzleBunSql } from 'drizzle-orm/bun-sql';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate } from './migrate';

/*
 * The product's database (api, supervisor and workers): Postgres, at DATABASE_URL (Bun's own client, Bun.sql); in
 * development the one of docker-compose.yml (`docker compose up -d`). "memory://" is PGlite (Postgres compiled to
 * WebAssembly) in memory, for the tests: the same SQL, nothing to start. Repositories use `orm` (Drizzle, built on the
 * same client); `query` and `exec` are for raw SQL (migrations).
 */

/** Drizzle, on whichever driver is open; in a `transaction`, bound to it */
export type Orm = PgDatabase<PgQueryResultHKT>;

export type Database = {
  orm: Orm;
  /** a single statement with $1, $2... parameters; returns the rows */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** several statements, without parameters (migrations) */
  exec(text: string): Promise<void>;
  /** runs `work` in a transaction (rolled back if it throws) */
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
  /**
   * Postgres NOTIFY: wakes whoever listens on `channel`, in this process or another (the api and the supervisor). In a
   * transaction it is sent on commit. Keep `payload` short (an id): Postgres takes at most 8000 bytes.
   */
  notify(channel: string, payload?: string): Promise<void>;
  /** Postgres LISTEN: `onPayload` gets every notification on `channel`; the answer stops listening */
  listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
};

function postgres(url: string): Database {
  const sql = new SQL(url);
  const wrap = (client: SQL): Database => ({
    orm: drizzleBunSql({ client }) as unknown as Orm,
    query: async <T>(text: string, params: unknown[] = []) => [...await client.unsafe(text, params)] as T[],
    exec: async text => void await client.unsafe(text),
    transaction: work => client.begin(tx => work(wrap(tx))),
    notify: (channel, payload = '') => client.notify(channel, payload),
    // one connection of its own for every LISTEN of this process, reconnected (and subscribed again) by Bun when it drops
    listen: async (channel, onPayload) => {
      const subscription = await sql.listen(channel, onPayload);
      return () => subscription.unlisten();
    },
    close: () => client.close(),
  });
  return wrap(sql);
}

/** PGlite in memory (the tests) */
function inMemory(): Database {
  const db = new PGlite();

  // PGlite runs one query at a time; a transaction holds it until it ends
  const wrap = (client: Pick<PGlite, 'query' | 'exec'>): Database => ({
    // in a transaction the client is PGlite's Transaction: same `query`, which is all Drizzle calls outside orm.transaction
    orm: drizzlePglite({ client: client as PGlite }) as unknown as Orm,
    query: async <T>(text: string, params: unknown[] = []) => (await client.query<T>(text, params)).rows,
    exec: async text => void await client.exec(text),
    transaction: work => db.transaction(tx => work(wrap(tx))),
    notify: async (channel, payload = '') => void await client.query('SELECT pg_notify($1, $2)', [channel, payload]),
    listen: async (channel, onPayload) => db.listen(channel, onPayload),
    close: () => db.close(),
  });

  return wrap(db);
}

export class DatabaseUnavailableError extends Error {
  override name = 'DatabaseUnavailableError';
}

/** Opens the database and brings the schema up to date; says what to do when there is none or it does not answer. */
export async function openDatabase(url?: string): Promise<Database> {
  if (!url) {
    throw new DatabaseUnavailableError('DATABASE_URL is not set. Start Postgres with `docker compose up -d` (at the repository root) and set DATABASE_URL in dataflow.server/.env (see .env.example).');
  }

  const db = url === 'memory://' ? inMemory() : postgres(url);
  try {
    await migrate(db);
  } catch (e) {
    await db.close().catch(() => undefined);
    const code = (e as { code?: string }).code ?? '';
    if (url !== 'memory://' && /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ERR_POSTGRES_CONNECTION|connection/i.test(`${code} ${(e as Error).message}`)) {
      throw new DatabaseUnavailableError(`${describeDatabase(url)} does not answer. Is it running? Start it with \`docker compose up -d\` at the repository root.`);
    }
    throw e;
  }
  return db;
}

/** where the data is, for the startup log (without the password) */
export function describeDatabase(url?: string): string {
  if (url === 'memory://') {
    return 'PGlite in memory';
  }

  if (!url) {
    return 'no database';
  }

  try {
    const { protocol, host, pathname } = new URL(url);
    return `Postgres at ${protocol}//${host}${pathname}`;
  } catch {
    return 'Postgres';
  }
}
