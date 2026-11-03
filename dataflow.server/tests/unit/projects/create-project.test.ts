import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import { CreateProjectHandler } from '#features/projects/create-project/create-project-handler';
import { ProjectRepository } from '#features/projects/project-repository';

setDefaultTimeout(30_000);

describe('create project', () => {
  let db: Database;
  let ctx: UseCaseContext;
  let otherOrgCtx: UseCaseContext;
  const handler = new CreateProjectHandler();

  beforeAll(async () => {
    db = await openDatabase('memory://');
    ctx = { orgId: crypto.randomUUID(), userId: 'ana', db };
    otherOrgCtx = { orgId: crypto.randomUUID(), userId: 'bia', db };
    for (const orgId of [ctx.orgId, otherOrgCtx.orgId]) {
      await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, `org ${orgId}`]);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  test('creates the project in the caller organization', async () => {
    const result = await handler.handle({ name: '  Sales  ', description: 'Daily sales flows' }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const project = await new ProjectRepository(db, ctx.orgId).findById(result.value.id);
    expect(project).toMatchObject({ orgId: ctx.orgId, name: 'Sales', description: 'Daily sales flows', deletedAt: null });
  });

  test('description is optional', async () => {
    const result = await handler.handle({ name: 'Finance' }, ctx);

    expect(result.ok).toBe(true);
  });

  test('rejects invalid fields', async () => {
    const result = await handler.handle({ name: '   ', description: 'x'.repeat(501) }, ctx);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'validation',
        message: 'The request has invalid fields.',
        fields: { name: 'Required', description: 'At most 500 characters' },
      },
    });
  });

  test('rejects a body that is not an object', async () => {
    const result = await handler.handle(undefined, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });

  test('rejects a name already used in the organization, ignoring case', async () => {
    const result = await handler.handle({ name: 'SALES' }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('conflict');
      expect(result.error.fields).toEqual({ name: 'Already in use' });
    }
  });

  test('another organization can use the same name', async () => {
    const result = await handler.handle({ name: 'Sales' }, otherOrgCtx);

    expect(result.ok).toBe(true);
  });

  test('a project of one organization is not visible to another', async () => {
    const result = await handler.handle({ name: 'Private' }, ctx);
    if (!result.ok) {
      throw new Error('expected success');
    }

    expect(await new ProjectRepository(db, otherOrgCtx.orgId).findById(result.value.id)).toBeNull();
  });
});
