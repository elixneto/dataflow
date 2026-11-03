import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {SQL} from 'bun';
import {PGlite} from '@electric-sql/pglite';
import {lockFolder} from './pglite-lock';
import {migrate} from './migrate';

/*
 * The product's database (api, supervisor and workers): Postgres. With a URL, a real server (Bun's own client, Bun.sql); without one, PGlite,
 * Postgres compiled to WebAssembly, writing to dataflow.server/data.local/ (outside git), so nobody has to install anything to
 * develop. "memory://" keeps everything in memory (tests). Both speak the same SQL; repositories only use `query`.
 * (Same approach as the PoC: POC_v0/runner/src/storage/database.ts.)
 */

export type Database = {
  /** a single statement with $1, $2... parameters; returns the rows */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** several statements, without parameters (migrations) */
  exec(text: string): Promise<void>;
  /** runs `work` in a transaction (rolled back if it throws) */
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

const LOCAL_FOLDER = fileURLToPath(new URL('../../data.local/', import.meta.url));

function postgres(url: string): Database {
  const sql = new SQL(url);
  const wrap = (client: SQL): Database => ({
    query: async <T>(text: string, params: unknown[] = []) => [...await client.unsafe(text, params)] as T[],
    exec: async text => void await client.unsafe(text),
    transaction: work => client.begin(tx => work(wrap(tx))),
    close: () => client.close(),
  });
  return wrap(sql);
}

function embedded(folder?: string): Database {
  // a folder on disk is for one process only (pglite-lock.ts); in memory there is nothing to share
  const release = folder ? lockFolder(folder) : () => undefined;
  let db: PGlite;
  try {
    db = new PGlite(folder);
  } catch (e) {
    release();
    throw e;
  }
  // PGlite runs one query at a time; a transaction holds it until it ends
  const wrap = (client: Pick<PGlite, 'query' | 'exec'>): Database => ({
    query: async <T>(text: string, params: unknown[] = []) => (await client.query<T>(text, params)).rows,
    exec: async text => void await client.exec(text),
    transaction: work => db.transaction(tx => work(wrap(tx))),
    close: async () => {
      await db.close();
      release();
    },
  });
  return wrap(db);
}

/** Opens the database and brings the schema up to date. */
export async function openDatabase(url?: string): Promise<Database> {
  let db: Database;
  if (url === 'memory://') db = embedded();
  else if (url) db = postgres(url);
  else {
    await mkdir(LOCAL_FOLDER, {recursive: true});
    db = embedded(LOCAL_FOLDER);
  }
  try {
    await migrate(db);
  } catch (e) {
    await db.close();
    throw e;
  }
  return db;
}

/** where the data is, for the startup log (without the password) */
export function describeDatabase(url?: string): string {
  if (url === 'memory://') return 'PGlite in memory';
  if (!url) return `PGlite at ${LOCAL_FOLDER}`;
  try {
    const {protocol, host, pathname} = new URL(url);
    return `Postgres at ${protocol}//${host}${pathname}`;
  } catch {
    return 'Postgres';
  }
}
