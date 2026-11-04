import { and, eq, isNotNull, isNull, type InferInsertModel, type InferSelectModel, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Database } from './database';

/*
 * The repository pattern, written once on top of Drizzle: insert, find, exists, update and soft delete of a table
 * that belongs to an organization. A feature's repository extends OrgRepository with its table and only adds its
 * own queries (with this.scope(...), so they keep the same filters).
 */

/** a table with id and org_id; with deleted_at/deleted_by it is soft deleted */
export type OrgTable = PgTable & {
  id: AnyPgColumn;
  orgId: AnyPgColumn;
  deletedAt?: AnyPgColumn;
  deletedBy?: AnyPgColumn;
};

export type FindOptions = {
  orderBy?: SQL | AnyPgColumn | (SQL | AnyPgColumn)[];
  limit?: number;
};

/** which rows a query sees: the live ones (the default) or the soft deleted ones */
type Rows = 'live' | 'deleted' | 'all';

/**
 * The rows of ONE organization: the orgId comes in the constructor, every query filters by it and every insert writes
 * it, so a repository built for org A cannot see or change org B's rows. Deleted rows are left out.
 */
export class OrgRepository<TTable extends OrgTable> {
  constructor(protected readonly db: Database, protected readonly table: TTable, protected readonly orgId: string) {}

  async insert(values: Omit<InferInsertModel<TTable>, 'orgId'>): Promise<InferSelectModel<TTable>> {
    const rows = await this.db.orm
      .insert(this.table)
      .values({ ...values, orgId: this.orgId } as PgInsertValue<TTable>)
      .returning();

    return (rows as InferSelectModel<TTable>[])[0]!;
  }

  async findById(id: string): Promise<InferSelectModel<TTable> | null> {
    const [row] = await this.findMany(eq(this.table.id, id), { limit: 1 });
    return row ?? null;
  }

  async findOne(where: SQL): Promise<InferSelectModel<TTable> | null> {
    const [row] = await this.findMany(where, { limit: 1 });
    return row ?? null;
  }

  async findMany(where?: SQL, options: FindOptions = {}): Promise<InferSelectModel<TTable>[]> {
    return this.select('live', where, options);
  }

  /** the soft deleted rows (archived, trash...), with the same filters and options as findMany */
  async findDeleted(where?: SQL, options: FindOptions = {}): Promise<InferSelectModel<TTable>[]> {
    return this.select('deleted', where, options);
  }

  /** live and soft deleted rows together (e.g. a whole tree, to apply its rules in memory) */
  async findAll(where?: SQL, options: FindOptions = {}): Promise<InferSelectModel<TTable>[]> {
    return this.select('all', where, options);
  }

  private async select(rows: Rows, where: SQL | undefined, options: FindOptions): Promise<InferSelectModel<TTable>[]> {
    if (rows === 'deleted' && !this.table.deletedAt) {
      return [];
    }

    const query = this.db.orm.select().from(this.table as PgTable).where(this.scope(where, rows)).$dynamic();
    if (options.orderBy) {
      query.orderBy(...[options.orderBy].flat());
    }

    if (options.limit !== undefined) {
      query.limit(options.limit);
    }

    return (await query) as InferSelectModel<TTable>[];
  }

  async exists(where: SQL): Promise<boolean> {
    const rows = await this.db.orm.select({ id: this.table.id }).from(this.table as PgTable).where(this.scope(where)).limit(1);
    return rows.length > 0;
  }

  /** changes the given fields; null when there is no such (live) row */
  async update(id: string, values: Partial<Omit<InferInsertModel<TTable>, 'id' | 'orgId'>>): Promise<InferSelectModel<TTable> | null> {
    const rows = await this.db.orm
      .update(this.table)
      .set(values as PgUpdateSetSource<TTable>)
      .where(this.scope(eq(this.table.id, id)))
      .returning();

    return (rows as InferSelectModel<TTable>[])[0] ?? null;
  }

  /** marks the row deleted (the row stays); false when there is no such live row */
  async softDelete(id: string, by: string): Promise<boolean> {
    if (!this.table.deletedAt || !this.table.deletedBy) {
      throw new Error('This table has no soft delete.');
    }

    const rows = await this.db.orm
      .update(this.table)
      .set({ deletedAt: new Date(), deletedBy: by } as PgUpdateSetSource<TTable>)
      .where(this.scope(eq(this.table.id, id)))
      .returning({ id: this.table.id });

    return rows.length > 0;
  }

  /** deletes the row for good (tables without soft delete); false when there is no such row */
  async remove(id: string): Promise<boolean> {
    const rows = await this.db.orm
      .delete(this.table)
      .where(this.scope(eq(this.table.id, id), 'all'))
      .returning({ id: this.table.id });

    return rows.length > 0;
  }

  /** brings a soft deleted row back (clears deleted_at/deleted_by); null when there is no such deleted row */
  async restore(id: string): Promise<InferSelectModel<TTable> | null> {
    if (!this.table.deletedAt || !this.table.deletedBy) {
      throw new Error('This table has no soft delete.');
    }

    const rows = await this.db.orm
      .update(this.table)
      .set({ deletedAt: null, deletedBy: null } as PgUpdateSetSource<TTable>)
      .where(this.scope(eq(this.table.id, id), 'deleted'))
      .returning();

    return (rows as InferSelectModel<TTable>[])[0] ?? null;
  }

  /** `where` plus the organization and "not deleted" (or "deleted", or both): every query of this repository goes through it */
  protected scope(where?: SQL, rows: Rows = 'live'): SQL {
    const deletedAt = this.table.deletedAt;
    return and(
      eq(this.table.orgId, this.orgId),
      deletedAt && rows !== 'all' ? (rows === 'live' ? isNull(deletedAt) : isNotNull(deletedAt)) : undefined,
      where,
    )!;
  }
}
