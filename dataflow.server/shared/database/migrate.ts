import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {Database} from './database';

/*
 * The schema, one file at a time: migrations/<number>_<description>.sql, applied in numeric order, each in its own
 * transaction. A file is never edited after it is committed: a change becomes a new file at the end. The checksum
 * recorded in `schema_migrations` makes an edited file an error instead of a silent difference between databases.
 * The api and the worker may start together, so each step takes an advisory lock and checks again before applying.
 */

const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations/', import.meta.url));
/** any constant: identifies "the server is migrating" among Postgres advisory locks */
const MIGRATION_LOCK = 4_771_190;

export type Migration = {name: string; sql: string; checksum: string};

const checksumOf = (sql: string) => new Bun.CryptoHasher('sha256').update(sql).digest('hex');

/** The migration files, in the order they are applied. */
export async function readMigrations(folder = MIGRATIONS_FOLDER): Promise<Migration[]> {
  // <number>_<description>.sql, in numeric order (1_initial.sql, 2_..., 10_... comes after 9_...)
  const files = (await readdir(folder))
    .map(name => ({name, number: Number(/^(\d+)_[\w-]+\.sql$/.exec(name)?.[1])}))
    .filter(file => Number.isInteger(file.number))
    .sort((a, b) => a.number - b.number);
  const repeated = files.find((file, i) => i > 0 && file.number === files[i - 1]!.number);
  if (repeated) {
    throw new Error(`Two migrations share the number ${repeated.number}; each file needs its own.`);
  }

  const names = files.map(file => file.name);
  return Promise.all(names.map(async name => {
    // line endings normalized, so a Windows checkout (CRLF) has the same checksum as a Linux one
    const sql = (await Bun.file(`${folder}${name}`).text()).replace(/\r\n/g, '\n');
    return {name, sql, checksum: checksumOf(sql)};
  }));
}

/** Applies the migrations that are missing. Returns the names it applied. */
export async function migrate(db: Database, migrations?: Migration[]): Promise<string[]> {
  const steps = migrations ?? await readMigrations();
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const appliedNow: string[] = [];
  for (const step of steps) {
    const done = await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      const [row] = await tx.query<{checksum: string}>('SELECT checksum FROM schema_migrations WHERE name = $1', [step.name]);
      if (row) {
        if (row.checksum !== step.checksum) {
          throw new Error(`Migration ${step.name} was edited after it was applied. Revert the edit and add a new migration instead.`);
        }
        return false;
      }
      await tx.exec(step.sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [step.name, step.checksum]);
      return true;
    });
    if (done) appliedNow.push(step.name);
  }
  return appliedNow;
}
