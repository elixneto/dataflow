import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { openDatabase, type Database } from '#shared/database/database';
import { organizations } from '#features/organizations/organization';
import { connections } from '#features/connections/connection';
import { folders } from '#features/folders/folder';
import { flows } from '#features/flows/flow';
import { projects } from '#features/projects/project';
import { secrets } from '#features/secrets/secret';
import { variables } from '#features/variables/variable';

setDefaultTimeout(30_000);

/** every Drizzle table: a new pgTable goes here, so it is checked against the migrations */
const TABLES: PgTable[] = [organizations, projects, folders, flows, secrets, variables, connections];

type DbColumn = { column_name: string; data_type: string; is_nullable: 'YES' | 'NO'; column_default: string | null };

// the .sql migrations are the schema; the Drizzle tables only describe it, so they must not drift apart
describe('drizzle tables match the migrated database', () => {
  let db: Database;

  beforeAll(async () => {
    db = await openDatabase('memory://');
  });

  afterAll(async () => {
    await db.close();
  });

  for (const table of TABLES) {
    const { name, columns } = getTableConfig(table);

    test(name, async () => {
      const rows = await db.query<DbColumn>(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [name],
      );
      const fromDatabase = rows
        .map(c => ({ name: c.column_name, type: c.data_type, notNull: c.is_nullable === 'NO', hasDefault: c.column_default !== null }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const fromDrizzle = columns
        .map(c => ({ name: c.name, type: c.getSQLType(), notNull: c.notNull, hasDefault: c.hasDefault }))
        .sort((a, b) => a.name.localeCompare(b.name));

      expect(fromDrizzle).toEqual(fromDatabase);
    });
  }
});
