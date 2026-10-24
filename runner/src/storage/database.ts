import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {SQL} from 'bun';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from './migrations';

/*
 * The runner's database: Postgres. With DATABASE_URL, a real server (Bun's own client, Bun.sql); without it, PGlite,
 * Postgres compiled to WebAssembly, writing to runner/data.local/ (outside git), so nobody has to install anything to
 * develop. "memory://" keeps everything in memory (tests). Both speak the same SQL; only `query` is used.
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
  const db = new PGlite(folder);
  // PGlite runs one query at a time; a transaction holds it until it ends
  const wrap = (client: Pick<PGlite, 'query' | 'exec'>): Database => ({
    query: async <T>(text: string, params: unknown[] = []) => (await client.query<T>(text, params)).rows,
    exec: async text => void await client.exec(text),
    transaction: work => db.transaction(tx => work(wrap(tx))),
    close: () => db.close(),
  });
  return wrap(db);
}

/** Opens the database and brings the schema up to date. */
export async function openDatabase(url = process.env.DATABASE_URL): Promise<Database> {
  let db: Database;
  if (url === 'memory://') db = embedded();
  else if (url) db = postgres(url);
  else {
    await mkdir(LOCAL_FOLDER, {recursive: true});
    db = embedded(LOCAL_FOLDER);
  }
  await migrate(db);
  return db;
}

/** where the data is, for the startup log (without the password) */
export function describeDatabase(url = process.env.DATABASE_URL): string {
  if (url === 'memory://') return 'PGlite in memory';
  if (!url) return `PGlite at ${LOCAL_FOLDER}`;
  try {
    const {protocol, host, pathname} = new URL(url);
    return `Postgres at ${protocol}//${host}${pathname}`;
  } catch {
    return 'Postgres';
  }
}
