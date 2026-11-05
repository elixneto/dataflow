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

  test('an edge on a port its component no longer has: a save is refused; a stored draft opens without it (not as a new flow)', async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Ports' })).body.id as string;
    const opened = (await call('GET', `/flows/${flowId}/draft`)).body.flow as { nodes: object[] };
    const flow = {
      ...opened,
      nodes: [...opened.nodes, { id: 'f', type: 'filter', position: { x: 320, y: 0 }, config: { condition: 'true' } }],
      edges: [
        { source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0' },
        { source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
        // a Filter has no third output
        { source: 'f', sourcePort: 'out-2', target: 'end', targetPort: 'in-0' },
      ],
    };
    const refused = await call('PUT', `/flows/${flowId}/draft`, { revision: 0, flow });
    expect(refused.status).toBe(400);
    expect((refused.body.error as { message: string }).message).toContain('is on a port its component does not have');

    // saved before such edges were taken out: it opens with the rest of the flow
    await db.query(`UPDATE flows SET draft_definition = $1 WHERE id = $2`, [JSON.stringify({ revision: 3, flow }), flowId]);
    const reopened = await call('GET', `/flows/${flowId}/draft`);
    expect(reopened.body.revision).toBe(3);
    expect((reopened.body.flow as { edges: { sourcePort: string }[] }).edges.map(e => e.sourcePort)).toEqual(['out-0', 'out-0']);
  });

  test("a flow's draft: a new flow opens with its Start and End; a save checks it, grows the revision, and a stale one is refused", async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Drafts' })).body.id as string;
    const opened = await call('GET', `/flows/${flowId}/draft`);
    expect(opened.status).toBe(200);
    expect(opened.body.revision).toBe(0);
    const flow = opened.body.flow as { name: string; nodes: { id: string; type: string; position: { x: number; y: number }; config: object }[]; edges: unknown[] };
    expect(flow.name).toBe('Drafts');
    expect(flow.nodes.map(n => n.type)).toEqual(['start', 'end']);

    // a component in between, saved
    const edited = {
      ...flow,
      name: 'ignored (the name is the row one)',
      nodes: [...flow.nodes, { id: 'm', type: 'mapper', position: { x: 320, y: 0 }, config: {} }],
      edges: [
        { source: 'start', sourcePort: 'out-0', target: 'm', targetPort: 'in-0' },
        { source: 'm', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
      ],
    };
    const saved = await call('PUT', `/flows/${flowId}/draft`, { revision: 0, flow: edited });
    expect(saved).toEqual({ status: 200, body: { revision: 1 } });
    const reopened = await call('GET', `/flows/${flowId}/draft`);
    expect(reopened.body.revision).toBe(1);
    expect((reopened.body.flow as { name: string; nodes: unknown[] }).nodes).toHaveLength(3);
    expect((reopened.body.flow as { name: string }).name).toBe('Drafts');

    // another tab still at revision 0: refused, nothing overwritten
    const stale = await call('PUT', `/flows/${flowId}/draft`, { revision: 0, flow });
    expect(stale.status).toBe(409);
    expect((await call('GET', `/flows/${flowId}/draft`)).body.revision).toBe(1);

    // a broken flow (Start straight to End) is refused with the reason
    const broken = await call('PUT', `/flows/${flowId}/draft`, {
      revision: 1,
      flow: { ...flow, edges: [{ source: 'start', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' }] },
    });
    expect(broken.status).toBe(400);
    expect((broken.body.error as { message: string }).message).toContain('The flow is not valid');

    // an archived flow is read, not saved
    await call('POST', `/flows/${flowId}/archive`);
    expect((await call('GET', `/flows/${flowId}/draft`)).status).toBe(200);
    expect((await call('PUT', `/flows/${flowId}/draft`, { revision: 1, flow })).status).toBe(404);
  });
});
