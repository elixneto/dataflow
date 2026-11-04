import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import { ArchiveProjectHandler } from '#features/projects/archive-project/archive-project-handler';
import { ListProjectsHandler } from '#features/projects/list-projects/list-projects-handler';
import { ProjectRepository } from '#features/projects/project-repository';
import { RestoreProjectHandler } from '#features/projects/restore-project/restore-project-handler';
import { UpdateProjectHandler } from '#features/projects/update-project/update-project-handler';

setDefaultTimeout(30_000);

describe('update, archive and restore projects', () => {
  let db: Database;
  let ctx: UseCaseContext;
  let otherOrgCtx: UseCaseContext;
  const update = new UpdateProjectHandler();
  const archive = new ArchiveProjectHandler();
  const restore = new RestoreProjectHandler();
  const list = new ListProjectsHandler();

  const newProject = async (name: string, orgCtx = ctx) =>
    (await new ProjectRepository(db, orgCtx.orgId).insert({ id: crypto.randomUUID(), name, description: '' })).id;

  const names = async (status: 'active' | 'archived') => {
    const result = await list.handle({ status }, ctx);
    if (!result.ok) {
      throw new Error('expected success');
    }

    return result.value.items.map(p => p.name);
  };

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

  test('update changes only the given fields', async () => {
    const id = await newProject('Draft');

    const result = await update.handle({ id, name: '  Sales  ', icon: 'cart' }, ctx);

    expect(result).toMatchObject({ ok: true, value: { id, name: 'Sales', description: '', icon: 'cart', color: 'blue', archivedAt: null } });
  });

  test('update keeps its own name (any case) but not another project\'s', async () => {
    const id = await newProject('Finance');
    await newProject('Taken');

    expect((await update.handle({ id, name: 'FINANCE' }, ctx)).ok).toBe(true);
    expect(await update.handle({ id, name: 'taken' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'conflict', fields: { name: 'Already in use' } },
    });
  });

  test('update validates the fields and needs at least one', async () => {
    const id = await newProject('Valid');

    expect(await update.handle({ id, name: ' ', color: 'Blue!' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'validation', fields: { name: 'Required', color: 'Invalid' } },
    });
    expect(await update.handle({ id }, ctx)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await update.handle({ id: 'not-a-uuid', name: 'X' }, ctx)).toMatchObject({ ok: false, error: { fields: { id: 'Invalid' } } });
  });

  test('archive moves the project to the archived list, once', async () => {
    const id = await newProject('Old stuff');

    expect(await archive.handle({ id }, ctx)).toEqual({ ok: true, value: { id } });
    expect(await names('active')).not.toContain('Old stuff');
    expect(await names('archived')).toContain('Old stuff');
    expect(await archive.handle({ id }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } });

    const [row] = await db.query<{ deleted_by: string }>('SELECT deleted_by FROM projects WHERE id = $1', [id]);
    expect(row?.deleted_by).toBe('ana');
  });

  test('an archived project cannot be edited', async () => {
    const id = await newProject('Frozen');
    await archive.handle({ id }, ctx);

    expect(await update.handle({ id, name: 'Thawed' }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  test('restore brings it back, unless an active project took its name', async () => {
    const id = await newProject('Comeback');
    await archive.handle({ id }, ctx);

    const restored = await restore.handle({ id }, ctx);
    expect(restored).toMatchObject({ ok: true, value: { id, name: 'Comeback', archivedAt: null } });
    expect(await restore.handle({ id }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } });

    await archive.handle({ id }, ctx);
    await newProject('Comeback');
    expect(await restore.handle({ id }, ctx)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  test('archived list: last archived first, with archivedAt', async () => {
    const first = await newProject('First archived');
    const second = await newProject('Second archived');
    await archive.handle({ id: first }, ctx);
    await Bun.sleep(5); // distinct archive times
    await archive.handle({ id: second }, ctx);

    const result = await list.handle({ status: 'archived' }, ctx);
    if (!result.ok) {
      throw new Error('expected success');
    }

    const archived = result.value.items.filter(p => p.name.endsWith('archived'));
    expect(archived.map(p => p.name)).toEqual(['Second archived', 'First archived']);
    expect(archived[0]!.archivedAt).toBeInstanceOf(Date);
  });

  test('list refuses an unknown status', async () => {
    expect(await list.handle({ status: 'deleted' }, ctx)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  test('another organization can neither change, archive nor restore', async () => {
    const id = await newProject('Private');

    expect(await update.handle({ id, name: 'Mine' }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await archive.handle({ id }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    await archive.handle({ id }, ctx);
    expect(await restore.handle({ id }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });
});
