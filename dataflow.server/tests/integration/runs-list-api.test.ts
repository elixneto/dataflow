import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { Keyring } from '#shared/crypto/keyring';
import { openDatabase, type Database } from '#shared/database/database';
import { silentLogger } from '#shared/logging/logger';
import { followRunEvents } from '#features/runs/run-events';
import type { RunListItem, RunListPage, RunOverview } from '#features/runs/list-runs/list-runs-handler';
import { createApp } from '../../api/app';
import { Supervisor } from '../../supervisor/supervisor';
import { inProcessExecutor } from '../../supervisor/workers/executor';

setDefaultTimeout(30_000);

/**
 * The Runs page's api (GET /runs, /runs/overview, /runs/:id/tree, /runs/events) over runs a supervisor really ran: a
 * Caller that fires and forgets a Background flow in batches (one worker: at most 4 runs per Flow Invoker), a flow that
 * fails, and test runs (never listed).
 */
describe('the Runs page api', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let supervisor: Supervisor;
  let stopFollowing: () => Promise<void>;
  let projectId: string;
  const orgId = crypto.randomUUID();
  const headers = { 'x-org-id': orgId, 'x-user-id': 'ana', 'content-type': 'application/json' };
  const ids: Record<string, string> = {};

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => {
    const response = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as T };
  };
  const ended = async (id: string) => {
    for (;;) {
      const run = await call<{ status: string }>('GET', `/runs/${id}`);
      if (run.body.status !== 'queued' && run.body.status !== 'running') return run;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  /** until every run of the organization ended */
  const settled = async () => {
    for (;;) {
      const [open] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM runs WHERE org_id = $1 AND status IN ('queued', 'running')`, [orgId]);
      if (open!.n === 0) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const node = (id: string, type: string, config: Record<string, unknown>, x = 0, label?: string) => ({ id, type, position: { x, y: 0 }, config, ...(label ? { label } : {}) });
  const edge = (source: string, target: string) => ({ source, sourcePort: 'out-0', target, targetPort: 'in-0' });
  const save = async (name: string, nodes: unknown[], edges: unknown[]) => {
    const id = (await call<{ id: string }>('POST', `/projects/${projectId}/flows`, { name })).body.id;
    expect((await call('PUT', `/flows/${id}/draft`, { revision: 0, flow: { version: 1, name, nodes, edges } })).status).toBe(200);
    return id;
  };
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [String(i + 1)]);

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, 'acme']);
    const keyring = new Keyring([{ version: 't', key: new Uint8Array(32).fill(5) }]);
    app = createApp(db, 'DEV', keyring);
    stopFollowing = await followRunEvents(db);
    // one worker: at most 4 fire and forget runs per Flow Invoker
    supervisor = new Supervisor({ db, keyring, executor: inProcessExecutor({ size: 1 }), tags: ['default'], logger: silentLogger(), pollMs: 100 });
    await supervisor.start();
    projectId = (await call<{ id: string }>('POST', '/projects', { name: 'Imports' })).body.id;

    ids.background = await save(
      'Background',
      [node('start', 'start', { acceptsInput: true }), node('m', 'mapper', { fields: [{ target: 'ok', value: 'true', expression: true }] }, 200), node('end', 'end', {}, 400)],
      [edge('start', 'm'), edge('m', 'end')],
    );
    ids.caller = await save(
      'Import orders',
      [
        node('start', 'start', {}),
        node('g', 'datagrid', { columns: [{ name: 'n', type: 'number' }], rows: rows(6) }, 200),
        node('w', 'flow', { flowId: ids.background, call: 'fire-and-forget', sendEnvelope: true, batchSize: 1 }, 300, 'Enrich in batches'),
        node('end', 'end', {}, 500),
      ],
      [edge('start', 'g'), edge('g', 'w'), edge('w', 'end')],
    );
    ids.broken = await save(
      'Sync partners',
      [node('start', 'start', {}), node('m', 'mapper', { fields: [{ target: 'x', value: '$nope.y', expression: true }] }, 200), node('end', 'end', {}, 400)],
      [edge('start', 'm'), edge('m', 'end')],
    );

    ids.brokenRun = (await call<{ id: string }>('POST', `/flows/${ids.broken}/runs`, { mode: 'execution' })).body.id;
    await ended(ids.brokenRun);
    ids.callerRun = (await call<{ id: string }>('POST', `/flows/${ids.caller}/runs`, { mode: 'execution' })).body.id;
    await ended(ids.callerRun);
    await settled();
    // a test run: the editor's, not history
    await ended((await call<{ id: string }>('POST', `/flows/${ids.broken}/runs`, { mode: 'validation' })).body.id);
  });

  afterAll(async () => {
    await supervisor.stop();
    await stopFollowing();
    await db.close();
  });

  test("the top runs, newest first, each with its tree: names, who started it, envelopes, the batch and who queued it; no test runs", async () => {
    const page = (await call<RunListPage>('GET', '/runs')).body;
    const top = page.runs.filter(r => !r.parentId);
    expect(top.map(r => r.flowName)).toEqual(['Import orders', 'Sync partners']);
    const caller = top[0]!;
    // Start → End, as the editor's panel: the Start sends 1, its Data Grid makes 6 of it
    expect(caller).toMatchObject({ status: 'completed', trigger: 'manual', projectName: 'Imports', startedBy: 'ana', envelopesIn: 1, envelopesOut: 6, error: null });
    // one worker: at most 4 runs; the last batch took the rest (3 envelopes)
    const children = page.runs.filter(r => r.parentId === ids.callerRun);
    expect(children.map(r => [r.flowName, r.status, r.calledBy, r.batchSize, r.envelopesIn, r.rootId])).toEqual([
      ['Background', 'completed', 'Enrich in batches', 1, 1, ids.callerRun],
      ['Background', 'completed', 'Enrich in batches', 1, 1, ids.callerRun],
      ['Background', 'completed', 'Enrich in batches', 1, 1, ids.callerRun],
      ['Background', 'completed', 'Enrich in batches', 3, 3, ids.callerRun],
    ]);
    expect(page.treeSizes).toEqual({ [ids.callerRun!]: 4, [ids.brokenRun!]: 0 });
    expect(top[1]).toMatchObject({ status: 'failed', envelopesIn: 1, envelopesOut: 0 });
    expect(top[1]!.error).toContain('$nope');
    expect(page.next).toBeNull();
  });

  test('a filter keeps a top run when it or a run of its tree fits; the search by id start or flow name; a page at a time', async () => {
    const tops = async (query: string) => (await call<RunListPage>('GET', `/runs?${query}`)).body.runs.filter(r => !r.parentId).map(r => r.flowName);
    expect(await tops('status=problems')).toEqual(['Sync partners']);
    expect(await tops('status=completed')).toEqual(['Import orders']);
    // only its batches are fire and forget: the top run shows for them
    expect(await tops('trigger=flow-invoker')).toEqual(['Import orders']);
    expect(await tops(`q=${ids.brokenRun!.slice(0, 8)}`)).toEqual(['Sync partners']);
    expect(await tops('q=backgr')).toEqual(['Import orders']);
    expect(await tops(`project=${crypto.randomUUID()}`)).toEqual([]);
    const first = (await call<RunListPage>('GET', '/runs?limit=1')).body;
    expect(first.runs.filter(r => !r.parentId).map(r => r.flowName)).toEqual(['Import orders']);
    const second = (await call<RunListPage>('GET', `/runs?limit=1&before=${encodeURIComponent(first.next!)}`)).body;
    expect(second.runs.map(r => r.flowName)).toEqual(['Sync partners']);
    expect(second.next).toBeNull();
    expect((await call('GET', '/runs?status=nope')).status).toBe(400);
    // a period: the top runs queued in it (these were queued just now)
    expect(await tops('period=24h')).toEqual(['Import orders', 'Sync partners']);
    expect(await tops('period=7d')).toEqual(['Import orders', 'Sync partners']);
    expect((await call('GET', '/runs?period=1y')).status).toBe(400);
  });

  test('the numbers above the list, and the tree of a run (from any run of it)', async () => {
    const overview = (await call<RunOverview>('GET', '/runs/overview')).body;
    expect(overview).toEqual({ all: 2, running: 0, inFlight: 0, queued: 0, oldestWaitMs: 0, problems: 1, completed: 5 });
    expect((await call<RunOverview>('GET', '/runs/overview?period=7d')).body).toEqual(overview);
    expect((await call('GET', '/runs/overview?period=1y')).status).toBe(400);
    const child = (await call<RunListPage>('GET', '/runs')).body.runs.find(r => r.parentId)!;
    const tree = (await call<{ runs: RunListItem[]; treeSizes: Record<string, number> }>('GET', `/runs/${child.id}/tree`)).body;
    expect(tree.runs[0]!.id).toBe(ids.callerRun);
    expect(tree.runs).toHaveLength(5);
    expect((await call('GET', `/runs/${crypto.randomUUID()}/tree`)).status).toBe(404);
  });

  test("the organization's changes over SSE: queued, taken by a worker, ended; never another organization's", async () => {
    const response = await app.request('/runs/events', { headers });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    const until = async (done: () => boolean) => {
      while (!done()) {
        const { value } = await reader.read();
        text += value ?? '';
      }
    };
    await until(() => text.includes('event: ready'));
    const other = crypto.randomUUID();
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, 'other')`, [other]);
    const runId = (await call<{ id: string }>('POST', `/flows/${ids.broken}/runs`, { mode: 'execution' })).body.id;
    await until(() => text.includes(`"id":"${runId}","rootId":"${runId}","status":"failed"`));
    await reader.cancel();
    const changes = text.split('\n\n').filter(b => b.startsWith('event: change')).map(b => JSON.parse(/data: (.*)/.exec(b)![1]!) as { id: string; status: string });
    expect(changes.filter(c => c.id === runId).map(c => c.status)).toEqual(['queued', 'running', 'failed']);
  });
});
