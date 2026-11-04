import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '#shared/database/database';
import { users } from './user';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The rows with the name of who last changed them (`updatedByName`), for the lists ("Updated ... by Dev"): the
 * organization's users by id. A row changed by someone who is not a user keeps only `updatedBy`.
 */
export async function withUpdatedByName<T extends { updatedBy: string | null }>(db: Database, orgId: string, rows: T[]): Promise<(T & { updatedByName?: string })[]> {
  const ids = [...new Set(rows.map(r => r.updatedBy).filter((id): id is string => !!id && UUID.test(id)))];
  if (ids.length === 0) {
    return rows;
  }

  const found = await db.orm
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.orgId, orgId), inArray(users.id, ids)));
  const names = new Map(found.map(u => [u.id, u.name]));
  return rows.map(row => {
    const name = row.updatedBy ? names.get(row.updatedBy) : undefined;
    return name ? { ...row, updatedByName: name } : row;
  });
}
