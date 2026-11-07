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

  test('clone: a new flow under the name chosen, with a copy of the draft (revision 0), in the same folder or another', async () => {
    // a project of its own: the other tests list every flow of theirs
    const project = (await call('POST', '/projects', { name: 'Clones' })).body.id as string;
    const folder = (await call('POST', `/projects/${project}/folders`, { name: 'Clones' })).body.id as string;
    const sourceId = (await call('POST', `/projects/${project}/flows`, { name: 'Source', folderId: folder })).body.id as string;
    const draft = (await call('GET', `/flows/${sourceId}/draft`)).body as { flow: { nodes: { id: string; type: string; position: unknown; config: unknown }[]; edges: unknown[] } };
    const nodes = [...draft.flow.nodes, { id: 'log', type: 'log', label: 'Say', position: { x: 160, y: 0 }, config: { message: "'hi'" } }];
    expect((await call('PUT', `/flows/${sourceId}/draft`, { revision: 0, flow: { ...draft.flow, nodes } })).status).toBe(200);

    const cloned = await call('POST', `/flows/${sourceId}/clone`, { name: 'Source (copy)' });
    expect(cloned.status).toBe(201);
    const id = cloned.body.id as string;
    expect(id).not.toBe(sourceId);
    expect((await call('GET', `/flows/${id}`)).body).toMatchObject({ id, name: 'Source (copy)', folderId: folder });
    const copy = (await call('GET', `/flows/${id}/draft`)).body as { revision: number; flow: { id: string; name: string; nodes: { id: string }[] } };
    expect(copy.revision).toBe(0);
    expect(copy.flow).toMatchObject({ id, name: 'Source (copy)' });
    expect(copy.flow.nodes.map(n => n.id)).toEqual(nodes.map(n => n.id));
    // the original stays as it was
    expect((await call('GET', `/flows/${sourceId}/draft`)).body).toMatchObject({ revision: 1, flow: { id: sourceId, name: 'Source' } });

    // a name taken in that folder (any case): 409; another folder (the root here): fine
    expect((await call('POST', `/flows/${sourceId}/clone`, { name: 'source' })).status).toBe(409);
    expect((await call('POST', `/flows/${sourceId}/clone`, { name: 'Source', folderId: null })).status).toBe(201);
    expect((await call('POST', `/flows/${sourceId}/clone`, { name: '' })).status).toBe(400);
    expect((await call('POST', `/flows/${crypto.randomUUID()}/clone`, { name: 'X' })).status).toBe(404);
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
  test("the calls between the project's flows, from their drafts: who calls whom, the circular chains, an archived one unavailable", async () => {
    const make = async (name: string) => (await call('POST', `/projects/${projectId}/flows`, { name })).body.id as string;
    const [one, two, gone] = [await make('Calls 1'), await make('Calls 2'), await make('Calls gone')];
    const calling = (id: string, name: string, to: string[]) => ({
      revision: 1,
      flow: {
        format: 'dataflow.flow', version: 1, id, name,
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
          ...to.map((flowId, i) => ({ id: `w${i}`, type: 'flow', label: `Invoker ${i}`, position: { x: 160, y: i * 80 }, config: { flowId } })),
          { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
        ],
        edges: to.flatMap((_, i) => [
          { source: 'start', sourcePort: 'out-0', target: `w${i}`, targetPort: 'in-0' },
          { source: `w${i}`, sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
        ]),
      },
    });
    const store = (id: string, name: string, to: string[]) => db.query(`UPDATE flows SET draft_definition = $1 WHERE id = $2`, [JSON.stringify(calling(id, name, to)), id]);
    await store(one, 'Calls 1', [two, gone]);
    await store(two, 'Calls 2', [one]);
    expect((await call('POST', `/flows/${gone}/archive`)).status).toBe(200);

    const answer = await call('GET', `/projects/${projectId}/calls`);
    expect(answer.status).toBe(200);
    const body = answer.body as { flows: { id: string; available: boolean }[]; calls: { from: string; to: string; nodeLabel: string }[]; cycles: string[][] };
    expect(body.calls.map(c => [c.from, c.to, c.nodeLabel])).toEqual([[one, two, 'Invoker 0'], [one, gone, 'Invoker 1'], [two, one, 'Invoker 0']]);
    expect(body.cycles).toHaveLength(1);
    expect(body.cycles[0]).toHaveLength(3);
    expect(body.flows.find(f => f.id === gone)).toMatchObject({ available: false });
    expect(body.flows.find(f => f.id === one)).toMatchObject({ available: true, folder: '' });
    expect((await call('GET', `/projects/${crypto.randomUUID()}/calls`)).status).toBe(404);

    // the scripts: a TypeScript component that imports one, which imports another
    const uses = calling(one, 'Calls 1', [two]);
    uses.flow.nodes.splice(1, 0, { id: 'ts', type: 'typescript', label: 'Prices', position: { x: 160, y: 200 }, config: { code: "import {round} from '@myproject/scripts/lib/prices';" } } as never);
    uses.flow.edges.push({ source: 'start', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0' }, { source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' });
    await db.query(`UPDATE flows SET draft_definition = $1 WHERE id = $2`, [JSON.stringify(uses), one]);
    for (const [path, content] of [['lib/prices', "import {two} from '@myproject/scripts/lib/math';\nexport const round = 1;"], ['lib/math', 'export const two = 2;']]) {
      expect((await call('POST', `/projects/${projectId}/scripts`, { path, kind: 'script', content })).status).toBe(201);
    }
    const withScripts = (await call('GET', `/projects/${projectId}/calls`)).body as { scripts: string[]; scriptUses: { from: string; path: string; nodeId: string; nodeLabel: string; how: string }[]; scriptImports: { from: string; to: string }[] };
    expect(withScripts.scripts).toEqual(['lib/math', 'lib/prices']);
    expect(withScripts.scriptUses).toEqual([{ from: one, path: 'lib/prices', nodeId: 'ts', nodeLabel: 'Prices', how: 'import' }]);
    expect(withScripts.scriptImports).toEqual([{ from: 'lib/prices', to: 'lib/math' }]);
  });
});
