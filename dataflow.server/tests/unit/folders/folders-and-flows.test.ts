import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseResult } from '#shared/use-cases/use-case-result';
import { ArchiveFolderHandler } from '#features/folders/archive-folder/archive-folder-handler';
import { CreateFolderHandler } from '#features/folders/create-folder/create-folder-handler';
import { GetProjectContentsHandler } from '#features/folders/get-project-contents/get-project-contents-handler';
import { MoveFolderHandler } from '#features/folders/move-folder/move-folder-handler';
import { RenameFolderHandler } from '#features/folders/rename-folder/rename-folder-handler';
import { RestoreFolderHandler } from '#features/folders/restore-folder/restore-folder-handler';
import { ArchiveFlowHandler } from '#features/flows/archive-flow/archive-flow-handler';
import { CreateFlowHandler } from '#features/flows/create-flow/create-flow-handler';
import { GetFlowHandler } from '#features/flows/get-flow/get-flow-handler';
import { MoveFlowHandler } from '#features/flows/move-flow/move-flow-handler';
import { RenameFlowHandler } from '#features/flows/rename-flow/rename-flow-handler';
import { RestoreFlowHandler } from '#features/flows/restore-flow/restore-flow-handler';
import { ProjectRepository } from '#features/projects/project-repository';

setDefaultTimeout(30_000);

describe('folders and flows', () => {
  let db: Database;
  let ctx: UseCaseContext;
  let otherOrgCtx: UseCaseContext;

  const value = <T,>(result: UseCaseResult<T>): T => {
    if (!result.ok) {
      throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
    }

    return result.value;
  };

  const newProject = async () =>
    (await new ProjectRepository(db, ctx.orgId).insert({ id: crypto.randomUUID(), name: crypto.randomUUID(), description: '' })).id;
  const folder = async (projectId: string, name: string, parentId: string | null = null) =>
    value(await new CreateFolderHandler().handle({ projectId, parentId, name }, ctx)).id;
  const flow = async (projectId: string, name: string, folderId: string | null = null) =>
    value(await new CreateFlowHandler().handle({ projectId, folderId, name }, ctx)).id;
  const contents = async (projectId: string) => value(await new GetProjectContentsHandler().handle({ projectId }, ctx));
  const active = <T extends { archivedAt: Date | null }>(items: T[]) => items.filter(i => i.archivedAt === null);

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

  test('nested folders and flows, listed flat with their places', async () => {
    const projectId = await newProject();
    const imports = await folder(projectId, 'Imports');
    const daily = await folder(projectId, 'Daily', imports);
    const orders = await flow(projectId, '  Import orders ', daily);
    await flow(projectId, 'Sync customers');

    const { folders, flows } = await contents(projectId);
    expect(folders.map(f => [f.name, f.parentId])).toEqual([['Imports', null], ['Daily', imports]]);
    expect(flows.find(f => f.id === orders)).toMatchObject({ name: 'Import orders', folderId: daily, updatedBy: 'ana', archivedAt: null });
  });

  test('names are unique among siblings (ignoring case), so the same name works in another folder', async () => {
    const projectId = await newProject();
    const a = await folder(projectId, 'A');
    await flow(projectId, 'Load');

    expect(await new CreateFlowHandler().handle({ projectId, name: 'LOAD' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'conflict', fields: { name: 'Already in use' } },
    });
    expect((await new CreateFlowHandler().handle({ projectId, folderId: a, name: 'Load' }, ctx)).ok).toBe(true);
    expect(await new CreateFolderHandler().handle({ projectId, name: 'a' }, ctx)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await new CreateFolderHandler().handle({ projectId, name: ' ' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'validation', fields: { name: 'Required' } },
    });
    expect(await new RenameFolderHandler().handle({ id: a, name: 'a' }, ctx)).toMatchObject({ ok: true, value: { name: 'a' } });
  });

  test('a folder cannot move into itself or anything under it', async () => {
    const projectId = await newProject();
    const a = await folder(projectId, 'A');
    const b = await folder(projectId, 'B', a);
    const c = await folder(projectId, 'C', b);

    expect(await new MoveFolderHandler().handle({ id: a, parentId: c }, ctx)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await new MoveFolderHandler().handle({ id: a, parentId: a }, ctx)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await new MoveFolderHandler().handle({ id: c, parentId: null }, ctx)).toMatchObject({ ok: true, value: { parentId: null } });
  });

  test('moving and renaming a flow keep its id and create no version', async () => {
    const projectId = await newProject();
    const target = await folder(projectId, 'Target');
    const id = await flow(projectId, 'Mover');

    expect(await new MoveFlowHandler().handle({ id, folderId: target }, ctx)).toMatchObject({ ok: true, value: { id, folderId: target } });
    expect(await new RenameFlowHandler().handle({ id, name: 'Moved' }, ctx)).toMatchObject({ ok: true, value: { id, name: 'Moved' } });

    const [{ count }] = (await db.query<{ count: number }>('SELECT count(*)::int AS count FROM flow_versions WHERE flow_id = $1', [id])) as [{ count: number }];
    expect(count).toBe(0);
  });

  test('moving onto a taken name or into another project\'s folder is refused', async () => {
    const projectId = await newProject();
    const otherProject = await newProject();
    const foreign = await folder(otherProject, 'Foreign');
    const target = await folder(projectId, 'Target');
    await flow(projectId, 'Same', target);
    const id = await flow(projectId, 'Same');

    expect(await new MoveFlowHandler().handle({ id, folderId: target }, ctx)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await new MoveFlowHandler().handle({ id, folderId: foreign }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  test('archiving a folder archives what is under it; restoring brings back only what went with it', async () => {
    const projectId = await newProject();
    const imports = await folder(projectId, 'Imports');
    const daily = await folder(projectId, 'Daily', imports);
    const orders = await flow(projectId, 'Orders', daily);
    const old = await flow(projectId, 'Old', daily);
    value(await new ArchiveFlowHandler().handle({ id: old }, ctx));
    await Bun.sleep(5); // the folder's archive time differs from the flow's

    value(await new ArchiveFolderHandler().handle({ id: imports }, ctx));
    let all = await contents(projectId);
    expect(active(all.folders)).toEqual([]);
    expect(active(all.flows)).toEqual([]);
    expect(await new RenameFlowHandler().handle({ id: orders, name: 'X' }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } });

    value(await new RestoreFolderHandler().handle({ id: imports }, ctx));
    all = await contents(projectId);
    expect(active(all.folders).map(f => f.name).sort()).toEqual(['Daily', 'Imports']);
    expect(active(all.flows).map(f => f.name)).toEqual(['Orders']);
  });

  test('restoring into an archived folder goes to the root', async () => {
    const projectId = await newProject();
    const reports = await folder(projectId, 'Reports');
    const report = await flow(projectId, 'Report', reports);
    value(await new ArchiveFlowHandler().handle({ id: report }, ctx));
    await Bun.sleep(5);
    value(await new ArchiveFolderHandler().handle({ id: reports }, ctx));

    expect(await new RestoreFlowHandler().handle({ id: report }, ctx)).toMatchObject({ ok: true, value: { folderId: null, archivedAt: null } });
  });

  test('an archived project takes no new folders or flows; its contents still list', async () => {
    const projectId = await newProject();
    await flow(projectId, 'Before');
    await new ProjectRepository(db, ctx.orgId).softDelete(projectId, 'ana');

    expect(await new CreateFlowHandler().handle({ projectId, name: 'After' }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await new CreateFolderHandler().handle({ projectId, name: 'After' }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect((await contents(projectId)).flows.map(f => f.name)).toEqual(['Before']);
  });

  test('another organization sees and changes nothing', async () => {
    const projectId = await newProject();
    const f = await folder(projectId, 'Mine');
    const id = await flow(projectId, 'Mine', f);

    expect(await new GetProjectContentsHandler().handle({ projectId }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await new GetFlowHandler().handle({ id }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await new RenameFlowHandler().handle({ id, name: 'Theirs' }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await new ArchiveFolderHandler().handle({ id: f }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await new CreateFlowHandler().handle({ projectId, name: 'Theirs' }, otherOrgCtx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });
});
