import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import { createApp } from '../../api/app';

setDefaultTimeout(30_000);

describe('folders and flows api', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  const orgId = crypto.randomUUID();
  const headers = { 'x-org-id': orgId, 'x-user-id': 'ana', 'content-type': 'application/json' };

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, 'acme']);
    app = createApp(db, 'DEV');
    projectId = (await call('POST', '/projects', { name: 'Api' })).body.id as string;
  });

  afterAll(async () => {
    await db.close();
  });

  test('create, list, rename, move, archive and restore over HTTP', async () => {
    const folder = await call('POST', `/projects/${projectId}/folders`, { name: 'Imports' });
    expect(folder.status).toBe(201);
    const flow = await call('POST', `/projects/${projectId}/flows`, { name: 'Orders', folderId: folder.body.id });
    expect(flow.status).toBe(201);
    const flowId = flow.body.id as string;

    const listed = await call('GET', `/projects/${projectId}/contents`);
    expect(listed.status).toBe(200);
    expect((listed.body.flows as { id: string; folderId: string }[])[0]).toMatchObject({ id: flowId, folderId: folder.body.id });

    expect((await call('PATCH', `/flows/${flowId}`, { name: 'Orders v2' })).body).toMatchObject({ id: flowId, name: 'Orders v2' });
    expect((await call('POST', `/flows/${flowId}/move`, { folderId: null })).body).toMatchObject({ id: flowId, folderId: null });
    expect((await call('PATCH', `/folders/${folder.body.id}`, { name: 'Imported' })).body).toMatchObject({ name: 'Imported' });
    expect((await call('GET', `/flows/${flowId}`)).body).toMatchObject({ id: flowId, name: 'Orders v2' });

    expect((await call('POST', `/folders/${folder.body.id}/archive`)).status).toBe(200);
    expect((await call('POST', `/folders/${folder.body.id}/restore`)).status).toBe(200);
    expect((await call('POST', `/flows/${flowId}/archive`)).status).toBe(200);
    expect((await call('POST', `/flows/${flowId}/restore`)).body).toMatchObject({ archivedAt: null });
  });

  test('errors: 409 for a taken name, 400 for a cycle, 404 for unknown ids', async () => {
    const a = (await call('POST', `/projects/${projectId}/folders`, { name: 'A' })).body.id as string;
    const b = (await call('POST', `/projects/${projectId}/folders`, { name: 'B', parentId: a })).body.id as string;

    expect((await call('POST', `/projects/${projectId}/folders`, { name: 'a' })).status).toBe(409);
    expect((await call('POST', `/folders/${a}/move`, { parentId: b })).status).toBe(400);
    expect((await call('GET', `/flows/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await call('GET', `/projects/${crypto.randomUUID()}/contents`)).status).toBe(404);
  });
});
