import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import { ProjectRepository } from '#features/projects/project-repository';
import { ListProjectsHandler } from '#features/projects/list-projects/list-projects-handler';

setDefaultTimeout(30_000);

describe('list projects', () => {
  let db: Database;
  let ctx: UseCaseContext;
  const handler = new ListProjectsHandler();

  beforeAll(async () => {
    db = await openDatabase('memory://');
    ctx = { orgId: crypto.randomUUID(), userId: 'ana', db };
    const otherOrgId = crypto.randomUUID();
    for (const orgId of [ctx.orgId, otherOrgId]) {
      await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, `org ${orgId}`]);
    }

    const projects = new ProjectRepository(db, ctx.orgId);
    await projects.insert({ id: crypto.randomUUID(), name: 'Old', description: '', createdAt: new Date('2026-01-01T00:00:00Z') });
    await projects.insert({ id: crypto.randomUUID(), name: 'New', description: 'Latest', icon: 'cart', color: 'green' });
    const { id } = await projects.insert({ id: crypto.randomUUID(), name: 'Gone', description: '' });
    await projects.softDelete(id, 'ana');
    await new ProjectRepository(db, otherOrgId).insert({ id: crypto.randomUUID(), name: 'Theirs', description: '' });
  });

  afterAll(async () => {
    await db.close();
  });

  test('the live projects of the organization, newest first', async () => {
    const result = await handler.handle(undefined, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.items.map(p => p.name)).toEqual(['New', 'Old']);
    expect(result.value.items[0]).toMatchObject({ description: 'Latest', icon: 'cart', color: 'green' });
    expect(result.value.items[1]).toMatchObject({ icon: 'folder', color: 'blue' });
    expect(result.value.items[0]!.createdAt).toBeInstanceOf(Date);
  });

  test('only the listed fields (no org or deleted_by columns)', async () => {
    const result = await handler.handle(undefined, ctx);
    if (!result.ok) {
      throw new Error('expected success');
    }

    expect(Object.keys(result.value.items[0]!).sort()).toEqual(['archivedAt', 'color', 'createdAt', 'description', 'icon', 'id', 'name']);
  });
});
