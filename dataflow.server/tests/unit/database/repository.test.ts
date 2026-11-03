import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { asc, eq } from 'drizzle-orm';
import { openDatabase, type Database } from '#shared/database/database';
import { OrgRepository } from '#shared/database/repository';
import { projects as projectsTable } from '#features/projects/project';

setDefaultTimeout(30_000);

describe('org repository', () => {
  let db: Database;
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const projects = (orgId: string) => new OrgRepository(db, projectsTable, orgId);

  beforeAll(async () => {
    db = await openDatabase('memory://');
    for (const orgId of [orgA, orgB]) {
      await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, `org ${orgId}`]);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  test('inserts in the organization and reads the entity back', async () => {
    const id = crypto.randomUUID();
    const inserted = await projects(orgA).insert({ id, name: 'Sales', description: '' });

    expect(inserted).toMatchObject({ id, orgId: orgA, name: 'Sales', deletedAt: null, deletedBy: null });
    expect(inserted.createdAt).toBeInstanceOf(Date);
    expect(await projects(orgA).findById(id)).toEqual(inserted);
  });

  test('another organization sees nothing, even filtering by the other orgId', async () => {
    const { id } = await projects(orgA).insert({ id: crypto.randomUUID(), name: 'Hidden', description: '' });

    expect(await projects(orgB).findById(id)).toBeNull();
    expect(await projects(orgB).findOne(eq(projectsTable.orgId, orgA))).toBeNull();
    expect(await projects(orgB).update(id, { name: 'Taken' })).toBeNull();
    expect(await projects(orgB).softDelete(id, 'bia')).toBe(false);
  });

  test('insert cannot write into another organization', async () => {
    const values = { id: crypto.randomUUID(), orgId: orgA, name: 'Mine', description: '' };
    const inserted = await projects(orgB).insert(values);

    expect(inserted.orgId).toBe(orgB);
  });

  test('filters, orders and limits', async () => {
    const repo = projects(orgB);
    await repo.insert({ id: crypto.randomUUID(), name: 'Beta', description: 'x' });
    await repo.insert({ id: crypto.randomUUID(), name: 'Alpha', description: 'x' });

    expect(await repo.exists(eq(projectsTable.name, 'Beta'))).toBe(true);
    const found = await repo.findMany(eq(projectsTable.description, 'x'), { orderBy: asc(projectsTable.name), limit: 1 });
    expect(found.map(p => p.name)).toEqual(['Alpha']);
  });

  test('updates only the given fields', async () => {
    const { id } = await projects(orgA).insert({ id: crypto.randomUUID(), name: 'Old', description: 'kept' });

    expect(await projects(orgA).update(id, { name: 'New' })).toMatchObject({ name: 'New', description: 'kept' });
  });

  test('soft delete hides the row and keeps it', async () => {
    const { id } = await projects(orgA).insert({ id: crypto.randomUUID(), name: 'Gone', description: '' });

    expect(await projects(orgA).softDelete(id, 'ana')).toBe(true);
    expect(await projects(orgA).findById(id)).toBeNull();
    expect(await projects(orgA).softDelete(id, 'ana')).toBe(false);
    const [row] = await db.query<{ deleted_by: string }>('SELECT deleted_by FROM projects WHERE id = $1', [id]);
    expect(row?.deleted_by).toBe('ana');
  });

  test('works inside a transaction, and a rollback undoes it', async () => {
    const id = crypto.randomUUID();
    await expect(db.transaction(async tx => {
      await new OrgRepository(tx, projectsTable, orgA).insert({ id, name: 'Rolled back', description: '' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    expect(await projects(orgA).findById(id)).toBeNull();
  });
});
