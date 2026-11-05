import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { HttpRequest, HttpResponse, RunRecord } from '@dataflow/core';
import { Keyring } from '#shared/crypto/keyring';
import { openDatabase, type Database } from '#shared/database/database';
import { followRunEvents } from '#features/runs/run-events';
import { createApp } from '../../api/app';
import { Supervisor } from '../../supervisor/supervisor';
import { createLogger, silentLogger } from '#shared/logging/logger';
import { inProcessExecutor } from '../../supervisor/workers/executor';

setDefaultTimeout(30_000);

/**
 * The editor's Run over HTTP: the api queues the saved draft, a supervisor runs it with the project's secrets,
 * connections and variables. HTTP goes to a fake (an OAuth 2.0 token endpoint and an API) instead of the network; the
 * supervisor runs in this process (its worker processes are tested in supervisor tests).
 */
describe('runs api', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  const orgId = crypto.randomUUID();
  const headers = { 'x-org-id': orgId, 'x-user-id': 'ana', 'content-type': 'application/json' };
  const sent: HttpRequest[] = [];
  let supervisor: Supervisor;
  let stopFollowing: () => Promise<void>;
  /** the supervisor's events, as it writes them in Docker (JSON) */
  const events: Record<string, unknown>[] = [];
  const logger = createLogger({ service: 'supervisor', format: 'json', write: line => events.push(JSON.parse(line)) });

  const http = async (request: HttpRequest): Promise<HttpResponse> => {
    sent.push(request);
    if (request.url.includes('/slow')) {
      await new Promise(resolve => setTimeout(resolve, 900));
    }

    if (request.url === 'https://auth.test/token') {
      return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'tok-0123456789', expires_in: 3600 }) };
    }

    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [1, 2], region: request.url.split('region=')[1] }) };
  };

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  /** until the run ended (the supervisor stored its record) */
  const ended = async (id: unknown) => {
    for (;;) {
      const run = await call('GET', `/runs/${id}`);
      if (run.body.status !== 'queued' && run.body.status !== 'running') {
        return run;
      }

      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, 'acme']);
    const keyring = new Keyring([{ version: 't', key: new Uint8Array(32).fill(5) }]);
    app = createApp(db, 'DEV', keyring);
    stopFollowing = await followRunEvents(db);
    supervisor = new Supervisor({ db, keyring, executor: inProcessExecutor({ http }), tags: ['default'], logger, pollMs: 200 });
    await supervisor.start();
    projectId = (await call('POST', '/projects', { name: 'Runs' })).body.id as string;
    await call('POST', `/projects/${projectId}/secrets`, { name: 'tasks-secret', value: 'client-s3cret' });
    await call('POST', `/projects/${projectId}/variables`, { name: 'REGION', value: 'eu' });
  });

  afterAll(async () => {
    await supervisor.stop();
    await stopFollowing();
    await db.close();
  });

  test("a test run of the saved draft: OAuth 2.0 from the project's connection, $VARIABLES, the response in the record, no secret in it", async () => {
    const connection = await call('POST', `/projects/${projectId}/connections`, {
      name: 'Tasks API',
      type: 'rest-oauth2',
      config: { grant: 'clientCredentials', tokenUrl: 'https://auth.test/token', clientId: 'app', clientSecret: 'tasks-secret' },
    });
    expect(connection.status).toBe(201);
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Tasks', folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: { nodes: { id: string }[] } & Record<string, unknown> };
    const flow = {
      ...draft.flow,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: { acceptsInput: true, testInput: '[{"id": 1}, {"id": 2}]' } },
        {
          id: 'get',
          type: 'http-request',
          label: 'Get tasks',
          position: { x: 160, y: 0 },
          config: { connection: connection.body.id, url: { value: '"https://api.test/tasks?region=" + $VARIABLES.REGION', expression: true } },
        },
        { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
      ],
      edges: [
        { source: 'start', sourcePort: 'out-0', target: 'get', targetPort: 'in-0' },
        { source: 'get', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
      ],
    };
    expect((await call('PUT', `/flows/${flowId}/draft`, { revision: 0, flow })).status).toBe(200);

    const started = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    expect(started.status).toBe(202);
    const run = await ended(started.body.id);
    expect(run.body).toMatchObject({ status: 'completed', mode: 'validation' });

    const record = run.body.record as RunRecord;
    const get = record.components.find(c => c.nodeId === 'get')!;
    expect(get.outputs).toEqual({ 'out-0': 2 });
    expect(get.outputSample['out-0']![0]).toMatchObject({ id: 1, response: { status: 200, body: { items: [1, 2], region: 'eu' } } });
    // the token asked once, with the decrypted client secret; sent as Bearer on both requests
    expect(sent.filter(r => r.url === 'https://auth.test/token')).toHaveLength(1);
    expect(sent.find(r => r.url === 'https://auth.test/token')?.body).toContain('client_secret=client-s3cret');
    expect(sent.filter(r => r.url.startsWith('https://api.test/')).map(r => r.headers.Authorization)).toEqual(['Bearer tok-0123456789', 'Bearer tok-0123456789']);
    expect(JSON.stringify(record)).not.toContain('client-s3cret');
  });

  test('a flow that cannot run (or that does not exist) is refused; an unknown run is 404', async () => {
    expect((await call('POST', `/flows/${crypto.randomUUID()}/runs`, { mode: 'validation' })).status).toBe(404);
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Empty', folderId: null })).body.id as string;
    expect((await call('POST', `/flows/${flowId}/runs`, { mode: 'sideways' })).status).toBe(400);
    expect((await call('GET', `/runs/${crypto.randomUUID()}`)).status).toBe(404);
  });

  test('Run for real of a draft is an execution run (stored with its draft hash)', async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Real', folderId: null })).body.id as string;
    const started = await call('POST', `/flows/${flowId}/runs`, { mode: 'execution' });
    expect(started.status).toBe(202);
    // Start and End only, not connected: it runs and warns that nothing reached the End
    const run = await ended(started.body.id);
    expect(run.body.mode).toBe('execution');
    expect(['completed', 'with-warnings']).toContain(run.body.status as string);
  });

  test('while it runs, the run says how it goes: the components that ended and the one still running', async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Slow', folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: Record<string, unknown> };
    const flow = {
      ...draft.flow,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'slow', type: 'http-request', position: { x: 160, y: 0 }, config: { url: { value: 'https://api.test/slow', expression: false } } },
        { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
      ],
      edges: [
        { source: 'start', sourcePort: 'out-0', target: 'slow', targetPort: 'in-0' },
        { source: 'slow', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
      ],
    };
    expect((await call('PUT', `/flows/${flowId}/draft`, { revision: 0, flow })).status).toBe(200);
    const started = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    await new Promise(resolve => setTimeout(resolve, 500));

    const during = await call('GET', `/runs/${started.body.id}`);
    expect(during.body.status).toBe('running');
    const components = (during.body.record as { status: string; components: { nodeId: string; status: string }[] }).components;
    expect((during.body.record as { status: string }).status).toBe('running');
    expect(components.find(c => c.nodeId === 'start')?.status).toBe('completed');
    expect(components.find(c => c.nodeId === 'slow')?.status).toBe('running');

    const after = await ended(started.body.id);
    expect(after.body.status).toBe('completed');
    expect((after.body.record as RunRecord).components.every(c => c.status !== 'running')).toBe(true);
  });

  test('the run as it goes over SSE: "progress" with the Start done while the slow call runs, then "done" with the record', async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Slow SSE', folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: Record<string, unknown> };
    const flow = {
      ...draft.flow,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'slow', type: 'http-request', position: { x: 160, y: 0 }, config: { url: { value: 'https://api.test/slow', expression: false } } },
        { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
      ],
      edges: [
        { source: 'start', sourcePort: 'out-0', target: 'slow', targetPort: 'in-0' },
        { source: 'slow', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
      ],
    };
    await call('PUT', `/flows/${flowId}/draft`, { revision: 0, flow });
    const started = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    const response = await app.request(`/runs/${started.body.id}/events`, { headers });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    // "event: x" + "data: {...}" blocks, in order
    const events = text.split('\n\n').filter(Boolean).map(block => ({
      type: /event: (\w+)/.exec(block)?.[1],
      data: JSON.parse(/data: (.*)/.exec(block)?.[1] ?? 'null') as { status: string; components: { nodeId: string; status: string }[] },
    }));
    const progress = events.filter(e => e.type === 'progress');
    expect(progress.length).toBeGreaterThan(0);
    // the Start already done while the slow call is running: the follower sees a component end before the run does
    expect(progress.some(e => e.data.components.find(c => c.nodeId === 'start')?.status === 'completed' && e.data.components.find(c => c.nodeId === 'slow')?.status === 'running')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
    expect(events.at(-1)?.data.status).toBe('completed');
    // what its worker used, just before "done"; and in GET /runs/:id
    const usage = events.at(-2) as unknown as { type: string; data: { startRssBytes: number; peakRssBytes: number; cpuMs: number } };
    expect(usage.type).toBe('usage');
    expect(usage.data.peakRssBytes).toBeGreaterThanOrEqual(usage.data.startRssBytes);
    expect((await call('GET', `/runs/${started.body.id}`)).body.usage).toEqual(usage.data);
    expect(text).not.toContain('client-s3cret');
    // a run that already ended: "usage" and "done" right away
    const late = await (await app.request(`/runs/${started.body.id}/events`, { headers })).text();
    expect(late.startsWith('event: usage')).toBe(true);
    expect(late.split('\n\n').filter(Boolean).map(block => /event: (\w+)/.exec(block)?.[1])).toEqual(['usage', 'done']);
  });

  test('Stop of a running run: it ends cancelled, with what it did so far', async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Stopped', folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: Record<string, unknown> };
    const flow = {
      ...draft.flow,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'slow', type: 'http-request', position: { x: 160, y: 0 }, config: { url: { value: 'https://api.test/slow', expression: false } } },
        { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
      ],
      edges: [
        { source: 'start', sourcePort: 'out-0', target: 'slow', targetPort: 'in-0' },
        { source: 'slow', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
      ],
    };
    await call('PUT', `/flows/${flowId}/draft`, { revision: 0, flow });
    const started = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect((await call('GET', `/runs/${started.body.id}`)).body.status).toBe('running');

    const stop = await call('POST', `/runs/${started.body.id}/cancel`);
    expect(stop.status).toBe(200);
    expect(stop.body.status).toBe('running');
    const run = await ended(started.body.id);
    expect(run.body.status).toBe('cancelled');
    const record = run.body.record as RunRecord;
    expect(record.error).toContain('cancelled');
    expect(record.components.find(c => c.nodeId === 'start')?.status).toBe('completed');
    // Stop again: it stays as it ended
    expect((await call('POST', `/runs/${started.body.id}/cancel`)).body.status).toBe('cancelled');
  });

  test('the run keeps the draft it was queued with: editing the flow afterwards changes nothing in it', async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Edited', folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: Record<string, unknown> };
    const flow = {
      ...draft.flow,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'slow', type: 'http-request', position: { x: 160, y: 0 }, config: { url: { value: 'https://api.test/slow', expression: false } } },
        { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
      ],
      edges: [
        { source: 'start', sourcePort: 'out-0', target: 'slow', targetPort: 'in-0' },
        { source: 'slow', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
      ],
    };
    await call('PUT', `/flows/${flowId}/draft`, { revision: 0, flow });
    const started = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    // the flow emptied while the run goes on
    const saved = (await call('GET', `/flows/${flowId}/draft`)).body as { revision: number; flow: Record<string, unknown> };
    await call('PUT', `/flows/${flowId}/draft`, { revision: saved.revision, flow: { ...saved.flow, nodes: (flow.nodes as { type: string }[]).filter(n => n.type !== 'http-request'), edges: [] } });
    const run = await ended(started.body.id);
    expect((run.body.record as RunRecord).components.some(c => c.nodeId === 'slow')).toBe(true);
  });

  test("test runs are kept apart, the latest per flow and user: a new one replaces (and stops) the previous; Run for real keeps its history", async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Replaced', folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: Record<string, unknown> };
    await call('PUT', `/flows/${flowId}/draft`, {
      revision: 0,
      flow: {
        ...draft.flow,
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
          { id: 'slow', type: 'http-request', position: { x: 160, y: 0 }, config: { url: { value: 'https://api.test/slow', expression: false } } },
          { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
        ],
        edges: [
          { source: 'start', sourcePort: 'out-0', target: 'slow', targetPort: 'in-0' },
          { source: 'slow', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
        ],
      },
    });

    const first = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    await new Promise(resolve => setTimeout(resolve, 300));
    const following = Promise.resolve(app.request(`/runs/${first.body.id}/events`, { headers })).then(r => r.text());
    await new Promise(resolve => setTimeout(resolve, 50));
    const second = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    // whoever followed the first one is told it ended
    expect(await following).toContain('A newer test run of this flow replaced it.');
    expect((await call('GET', `/runs/${first.body.id}`)).status).toBe(404);
    expect((await ended(second.body.id)).body.status).toBe('completed');

    // another user's test run of the same flow is theirs: both kept
    const other = await app.request(`/flows/${flowId}/runs`, { method: 'POST', headers: { ...headers, 'x-user-id': 'bob' }, body: JSON.stringify({ mode: 'validation' }) });
    const otherId = ((await other.json()) as { id: string }).id;
    await ended(otherId);
    const tests = await db.query<{ user_id: string }>('SELECT user_id FROM test_runs WHERE flow_id = $1 ORDER BY user_id', [flowId]);
    expect(tests.map(t => t.user_id)).toEqual(['ana', 'bob']);

    // Run for real: in runs, each one kept
    const real = [await call('POST', `/flows/${flowId}/runs`, { mode: 'execution' }), await call('POST', `/flows/${flowId}/runs`, { mode: 'execution' })];
    for (const r of real) {
      expect((await ended(r.body.id)).body.mode).toBe('execution');
    }

    expect((await db.query('SELECT id FROM runs WHERE flow_id = $1', [flowId])).length).toBe(2);
    expect((await db.query("SELECT id FROM runs WHERE mode = 'validation'")).length).toBe(0);
  });
  test("a Flow Invoker calls another flow's draft: its input checked against that flow's Start type, per envelope", async () => {
    await call('POST', `/projects/${projectId}/scripts`, { path: 'calls/types', kind: 'script' });
    await call('PUT', `/projects/${projectId}/scripts/content`, { path: 'calls/types', revision: 0, content: 'export interface Item { n: number; tag: string }' });
    const node = (id: string, type: string, config: Record<string, unknown>, x = 0) => ({ id, type, position: { x, y: 0 }, config });
    const edge = (source: string, target: string, sourcePort = 'out-0') => ({ source, sourcePort, target, targetPort: 'in-0' });
    const save = async (name: string, nodes: unknown[], edges: unknown[]) => {
      const id = (await call('POST', `/projects/${projectId}/flows`, { name })).body.id as string;
      expect((await call('PUT', `/flows/${id}/draft`, { revision: 0, flow: { version: 1, name, nodes, edges } })).status).toBe(200);
      return id;
    };
    const childId = await save(
      'Tagged',
      [
        node('start', 'start', { acceptsInput: true, inputType: 'calls/types#Item', parameters: [{ name: 'times', type: 'number', default: '1' }] }),
        node('m', 'mapper', { fields: [{ target: 'total', value: '$n * $PARAMETERS.times', expression: true }] }, 200),
        node('end', 'end', {}, 400),
      ],
      [edge('start', 'm'), edge('m', 'end')],
    );
    const parentId = await save(
      'Caller',
      [
        node('start', 'start', {}),
        node('g', 'datagrid', { columns: [{ name: 'n', type: 'number' }, { name: 'tag', type: 'text' }], rows: [['1', 'a'], ['2', '']] }, 200),
        node('m', 'mapper', { fields: [{ target: 'tag', value: '$tag || undefined', expression: true }] }, 300),
        node('w', 'flow', { flowId: childId, sendEnvelope: true, onError: 'divert', parameters: [{ name: 'times', value: '10', expression: false }] }, 400),
        node('end', 'end', {}, 600),
      ],
      [edge('start', 'g'), edge('g', 'm'), edge('m', 'w'), edge('w', 'end'), edge('w', 'end', 'error')],
    );

    const started = await call('POST', `/flows/${parentId}/runs`, { mode: 'validation' });
    expect(started.status).toBe(202);
    const record = (await ended(started.body.id)).body.record as RunRecord;
    expect(record.status).toBe('completed');
    const w = record.components.find(c => c.nodeId === 'w')!;
    // the first fits Item and runs the child (its draft, with the parameter); the second has no tag and does not run it
    expect(w.outputSample['out-0']).toEqual([{ n: 1, tag: 'a', total: 10 }]);
    expect(w.outputs['error']).toBe(1);
    expect(JSON.stringify(w.outputSample['error'])).toContain('The input does not fit Item');
    expect(w.subRuns?.map(r => [r.flow, r.status])).toEqual([['Tagged', 'completed']]);

    // the log: the run's id in its message, then the run it called, with its own id, its parent and its root
    const runId = started.body.id as string;
    const childRunId = w.subRuns![0]!.id;
    expect(events.find(e => e.run_id === runId && e.status === 'completed')).toMatchObject({
      level: 'info', msg: `Run ${runId} "Caller" completed in ${Math.round(record.durationMs)} ms`, flow: 'Caller', root_run_id: runId, called_runs: 1, test_run: true,
    });
    expect(events.find(e => e.run_id === childRunId)).toMatchObject({
      level: 'info', flow: 'Tagged', status: 'completed', parent_run_id: runId, root_run_id: runId, called_by: 'flow', called_by_node_id: 'w', trigger: 'flow-invoker',
    });
    expect(String(events.find(e => e.run_id === childRunId)!.msg)).toStartWith(`Run ${childRunId} "Tagged" completed in `);
  });

  test('fire and forget in a run for real: one run of its own per batch (its parent and root), the envelopes going on; a failing one fails alone', async () => {
    const node = (id: string, type: string, config: Record<string, unknown>, x = 0) => ({ id, type, position: { x, y: 0 }, config });
    const edge = (source: string, target: string) => ({ source, sourcePort: 'out-0', target, targetPort: 'in-0' });
    const save = async (name: string, nodes: unknown[], edges: unknown[]) => {
      const id = (await call('POST', `/projects/${projectId}/flows`, { name })).body.id as string;
      expect((await call('PUT', `/flows/${id}/draft`, { revision: 0, flow: { version: 1, name, nodes, edges } })).status).toBe(200);
      return id;
    };
    // Leaf fails; Background fires what it got to Leaf (one batch) and completes; Caller fires its 5 rows to Background in batches of 2
    const leafId = await save('Leaf', [node('start', 'start', { acceptsInput: true }), node('m', 'mapper', { fields: [{ target: 'x', value: '$nope.y', expression: true }] }, 200), node('end', 'end', {}, 400)], [edge('start', 'm'), edge('m', 'end')]);
    const backgroundId = await save(
      'Background',
      [node('start', 'start', { acceptsInput: true }), node('w', 'flow', { flowId: leafId, call: 'fire-and-forget', sendEnvelope: true }, 200), node('end', 'end', {}, 400)],
      [edge('start', 'w'), edge('w', 'end')],
    );
    const callerId = await save(
      'Fires',
      [
        node('start', 'start', {}),
        node('g', 'datagrid', { columns: [{ name: 'n', type: 'number' }], rows: [['1'], ['2'], ['3'], ['4'], ['5']] }, 200),
        node('w', 'flow', { flowId: backgroundId, call: 'fire-and-forget', sendEnvelope: true, batchSize: 2 }, 300),
        node('end', 'end', {}, 500),
      ],
      [edge('start', 'g'), edge('g', 'w'), edge('w', 'end')],
    );

    const started = await call('POST', `/flows/${callerId}/runs`, { mode: 'execution' });
    const parentId = started.body.id as string;
    const parent = await ended(parentId);
    const record = parent.body.record as RunRecord;
    expect(record.status).toBe('completed');
    const w = record.components.find(c => c.nodeId === 'w')!;
    expect(w.outputs['out-0']).toBe(5);
    expect(w.subRuns?.map(s => [s.flow, s.status, s.envelopes])).toEqual([['Background', 'queued', 2], ['Background', 'queued', 2], ['Background', 'queued', 1]]);

    // each Background run: its own, queued by the Caller's, its batch as its envelopes; it completes
    const childIds = w.subRuns!.map(s => s.id);
    const batches = [[{ n: 1 }, { n: 2 }], [{ n: 3 }, { n: 4 }], [{ n: 5 }]];
    for (const [i, id] of childIds.entries()) {
      const child = await ended(id);
      expect(child.body).toMatchObject({ status: 'completed', mode: 'execution', flowId: backgroundId, parentId, rootId: parentId, parentNodeId: 'w' });
      expect((child.body.record as RunRecord).components.find(c => c.type === 'start')!.outputSample['out-0']).toEqual(batches[i]!);
    }

    // each Background queued one Leaf with its batch: a grandchild, the Caller's run still its root; Leaf failed, alone
    const leaves = (await call('GET', `/runs/${childIds[0]}`)).body.calledRuns as { id: string; flow: string }[];
    expect(leaves.map(l => l.flow)).toEqual(['Leaf']);
    const leaf = await ended(leaves[0]!.id);
    expect(leaf.body).toMatchObject({ status: 'failed', flowId: leafId, parentId: childIds[0], rootId: parentId });

    // the parent shows the runs it queued with how each one went, apart from its own status
    const view = await call('GET', `/runs/${parentId}`);
    expect(view.body.status).toBe('completed');
    expect((view.body.calledRuns as { id: string; flow: string; status: string; parentNodeId: string }[]).map(r => [r.id, r.flow, r.status, r.parentNodeId]))
      .toEqual(childIds.map(id => [id, 'Background', 'completed', 'w']));

    // the log: queued (with its batch's size), then each one's end, all under the root
    expect(events.find(e => e.run_id === childIds[0] && e.status === 'queued')).toMatchObject({ parent_run_id: parentId, root_run_id: parentId, called_by_node_id: 'w', trigger: 'flow-invoker', envelopes: 2 });
    expect(events.find(e => e.run_id === childIds[0] && e.status === 'completed')).toMatchObject({ parent_run_id: parentId, root_run_id: parentId, flow: 'Background', envelopes_in: 2 });
    expect(events.find(e => e.run_id === leaves[0]!.id && e.status === 'failed')).toMatchObject({ level: 'error', parent_run_id: childIds[0], root_run_id: parentId, flow: 'Leaf' });
    expect(events.find(e => e.run_id === parentId && e.status === 'completed')).toMatchObject({ queued_runs: 3 });
  });

  test('fire and forget in a test run: nothing queued, the calls run beside it and show in its record', async () => {
    const node = (id: string, type: string, config: Record<string, unknown>, x = 0) => ({ id, type, position: { x, y: 0 }, config });
    const edge = (source: string, target: string) => ({ source, sourcePort: 'out-0', target, targetPort: 'in-0' });
    const save = async (name: string, nodes: unknown[], edges: unknown[]) => {
      const id = (await call('POST', `/projects/${projectId}/flows`, { name })).body.id as string;
      expect((await call('PUT', `/flows/${id}/draft`, { revision: 0, flow: { version: 1, name, nodes, edges } })).status).toBe(200);
      return id;
    };
    const quietId = await save('Quiet', [node('start', 'start', { acceptsInput: true }), node('m', 'mapper', { fields: [{ target: 'ok', value: 'true', expression: true }] }, 200), node('end', 'end', {}, 400)], [edge('start', 'm'), edge('m', 'end')]);
    const callerId = await save('Fires in a test', [node('start', 'start', {}), node('w', 'flow', { flowId: quietId, call: 'fire-and-forget', sendEnvelope: true }, 200), node('end', 'end', {}, 400)], [edge('start', 'w'), edge('w', 'end')]);
    const started = await call('POST', `/flows/${callerId}/runs`, { mode: 'validation' });
    const run = await ended(started.body.id);
    const w = (run.body.record as RunRecord).components.find(c => c.nodeId === 'w')!;
    expect(w.subRuns?.map(s => [s.flow, s.status, s.fireAndForget])).toEqual([['Quiet', 'completed', true]]);
    expect(run.body.calledRuns).toEqual([]);
    const queued = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM runs WHERE flow_id = $1', [quietId]);
    expect(queued[0]!.n).toBe(0);
  });
});

/** Pins and Run from here, through the api and a supervisor: what does not need to run does not call anything. */
describe('runs api, pins and Run from here', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let supervisor: Supervisor;
  let stopFollowing: () => Promise<void>;
  const orgId = crypto.randomUUID();
  const headers = { 'x-org-id': orgId, 'x-user-id': 'ana', 'content-type': 'application/json' };
  const calls: string[] = [];
  const http = async (request: HttpRequest): Promise<HttpResponse> => {
    calls.push(request.url);
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [1, 2, 3] }) };
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const ended = async (id: unknown) => {
    for (;;) {
      const run = await call('GET', `/runs/${id}`);
      if (run.body.status !== 'queued' && run.body.status !== 'running') {
        return run.body.record as RunRecord;
      }

      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };

  /** Start → HTTP (get) → Mapper (map) → End */
  const flowWith = async (name: string, pinned?: Record<string, unknown[]>) => {
    const projectId = (await call('POST', '/projects', { name })).body.id as string;
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name, folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: Record<string, unknown> };
    const saved = await call('PUT', `/flows/${flowId}/draft`, {
      revision: 0,
      flow: {
        ...draft.flow,
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
          { id: 'get', type: 'http-request', position: { x: 160, y: 0 }, config: { url: { value: 'https://api.test/items', expression: false } }, ...(pinned ? { pinned } : {}) },
          { id: 'map', type: 'mapper', position: { x: 320, y: 0 }, config: { fields: [{ target: 'n', value: '$response.body.items.length', expression: true }] } },
          { id: 'end', type: 'end', position: { x: 480, y: 0 }, config: {} },
        ],
        edges: [
          { source: 'start', sourcePort: 'out-0', target: 'get', targetPort: 'in-0' },
          { source: 'get', sourcePort: 'out-0', target: 'map', targetPort: 'in-0' },
          { source: 'map', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
        ],
      },
    });
    expect(saved.status).toBe(200);
    return flowId;
  };

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, 'acme']);
    const keyring = new Keyring([{ version: 't', key: new Uint8Array(32).fill(5) }]);
    app = createApp(db, 'DEV', keyring);
    stopFollowing = await followRunEvents(db);
    supervisor = new Supervisor({ db, keyring, executor: inProcessExecutor({ http }), tags: ['default'], logger: silentLogger(), pollMs: 200 });
    await supervisor.start();
  });

  afterAll(async () => {
    await supervisor.stop();
    await stopFollowing();
    await db.close();
  });

  test('a pinned HTTP Request is not called: its pinned envelopes go on, the Start that only fed it is skipped', async () => {
    const flowId = await flowWith('Pinned', { 'out-0': [{ response: { status: 200, body: { items: [9, 9] } } }] });
    calls.length = 0;
    const record = await ended((await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' })).body.id);
    expect(calls).toEqual([]);
    const byId = (id: string) => record.components.find(c => c.nodeId === id)!;
    expect(byId('start').status).toBe('skipped');
    expect(byId('get').status).toBe('pinned');
    expect(byId('map').outputSample['out-0']).toEqual([{ response: { status: 200, body: { items: [9, 9] } }, n: 2 }]);
  });

  test('Run from here: only the component and what follows run, from what reached it in the full test run', async () => {
    const flowId = await flowWith('From here');
    const rows = async () =>
      (await db.query<{ id: string; partial: boolean }>('SELECT id, run_from IS NOT NULL AS partial FROM test_runs WHERE flow_id = $1 ORDER BY partial', [flowId])).map(r => [r.id, r.partial]);
    // a run for real is the whole flow: never from a component
    const real = await call('POST', `/flows/${flowId}/runs`, { mode: 'execution', fromNodeId: 'map' });
    expect(real.status).toBe(400);
    expect((real.body.error as { message: string }).message).toContain('Run from here is a test run only');
    // nothing ran yet: refused
    const early = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation', fromNodeId: 'map' });
    expect(early.status).toBe(400);
    expect((early.body.error as { message: string }).message).toContain('Run the flow first');

    const full = (await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' })).body.id as string;
    await ended(full);
    calls.length = 0;
    const fromMap = (await call('POST', `/flows/${flowId}/runs`, { mode: 'validation', fromNodeId: 'map', fromLabel: 'Mapper' })).body.id as string;
    const record = await ended(fromMap);
    // the HTTP Request did not run: what reached the Mapper in the full run went straight into it
    expect(calls).toEqual([]);
    expect(record.from).toEqual({ nodeId: 'map', label: 'Mapper' });
    // the record is this run only
    expect(record.components.map(c => c.nodeId)).toEqual(['map', 'end']);
    const map = record.components.find(c => c.nodeId === 'map')!;
    expect(map.logs[0]!.message).toBe('Run from here: Mapper.');
    expect(map.outputSample['out-0']![0]).toMatchObject({ n: 3 });
    // the full test run stays beside it
    expect(await rows()).toEqual([[full, false], [fromMap, true]]);

    // from further up: still from the full run (the Run from here did not replace it); it replaces the Run from here
    calls.length = 0;
    const fromGet = (await call('POST', `/flows/${flowId}/runs`, { mode: 'validation', fromNodeId: 'get', fromLabel: 'HTTP Request' })).body.id as string;
    expect((await ended(fromGet)).components.map(c => c.nodeId)).toEqual(['get', 'map', 'end']);
    expect(calls).toEqual(['https://api.test/items']);
    expect(await rows()).toEqual([[full, false], [fromGet, true]]);
    expect((await call('GET', `/runs/${fromMap}`)).status).toBe(404);
    expect((await call('GET', `/runs/${full}`)).status).toBe(200);

    // a new full test run: the Run from here's base changed, it goes too
    const again = (await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' })).body.id as string;
    await ended(again);
    expect(await rows()).toEqual([[again, false]]);
    // a component that is not in the flow
    expect((await call('POST', `/flows/${flowId}/runs`, { mode: 'validation', fromNodeId: 'nope' })).status).toBe(400);
  });

  test("a flow's last run, for the editor when it opens: the latest that ended (test or real) and the full test run", async () => {
    const flowId = await flowWith('Last run');
    expect((await call('GET', `/flows/${flowId}/last-run`)).body).toEqual({ last: null, full: null });

    const test = (await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' })).body.id as string;
    await ended(test);
    const afterTest = (await call('GET', `/flows/${flowId}/last-run`)).body as { last: { id: string; mode: string; finishedAt: string; record: { run: { id: string } } }; full: { run: { id: string } } };
    expect(afterTest.last).toMatchObject({ id: test, mode: 'validation' });
    expect(afterTest.last.record.run.id).toBe(test);
    expect(new Date(afterTest.last.finishedAt).getTime()).toBeGreaterThan(0);
    expect(afterTest.full.run.id).toBe(test);

    // a Run for real after it: that one is the latest; the full test run stays for Run from here
    const real = (await call('POST', `/flows/${flowId}/runs`, { mode: 'execution' })).body.id as string;
    await ended(real);
    const afterReal = (await call('GET', `/flows/${flowId}/last-run`)).body as { last: { id: string; mode: string }; full: { run: { id: string } } };
    expect(afterReal.last).toMatchObject({ id: real, mode: 'execution' });
    expect(afterReal.full.run.id).toBe(test);
    expect((await call('GET', `/flows/${crypto.randomUUID()}/last-run`)).status).toBe(404);
  });

  test('there is no Run for real from here: refused even after a test run, nothing queued', async () => {
    const flowId = await flowWith('Real from here');
    await ended((await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' })).body.id);
    calls.length = 0;
    const refused = await call('POST', `/flows/${flowId}/runs`, { mode: 'execution', fromNodeId: 'map' });
    expect(refused.status).toBe(400);
    expect(calls).toEqual([]);
    expect((await db.query('SELECT id FROM runs WHERE flow_id = $1', [flowId])).length).toBe(0);
  });
});

/** Without a supervisor (none started, or all busy), a run waits queued; Stop cancels it at once. */
describe('runs api, queued runs', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let stopFollowing: () => Promise<void>;
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
    stopFollowing = await followRunEvents(db);
  });

  afterAll(async () => {
    await stopFollowing();
    await db.close();
  });

  test('queued until a supervisor takes it: no record yet; Stop cancels it and its followers get "done"', async () => {
    const projectId = (await call('POST', '/projects', { name: 'Waiting' })).body.id as string;
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Waits', folderId: null })).body.id as string;
    const started = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    expect(started.status).toBe(202);
    expect((await call('GET', `/runs/${started.body.id}`)).body).toMatchObject({ status: 'queued', record: null });

    const events = Promise.resolve(app.request(`/runs/${started.body.id}/events`, { headers })).then(r => r.text());
    await new Promise(resolve => setTimeout(resolve, 100));
    const stop = await call('POST', `/runs/${started.body.id}/cancel`);
    expect(stop.body.status).toBe('cancelled');
    const text = await events;
    expect(text).toContain('event: done');
    expect(text).toContain('Run cancelled before it started.');
    expect((await call('GET', `/runs/${started.body.id}`)).body.status).toBe('cancelled');
    expect((await call('POST', `/runs/${crypto.randomUUID()}/cancel`)).status).toBe(404);
  });

  test("a Start typed by a script's type: the input (its default or the one given) must fit it, or the run is refused with why", async () => {
    const projectId = (await call('POST', '/projects', { name: 'Typed' })).body.id as string;
    await call('POST', `/projects/${projectId}/scripts`, { path: 'orders/types', kind: 'script' });
    const saved = await call('PUT', `/projects/${projectId}/scripts/content`, {
      path: 'orders/types',
      revision: 0,
      content: "export interface Order { id: number; status: 'new' | 'paid'; items: { sku: string; qty: number }[] }",
    });
    expect(saved.status).toBe(200);
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Orders' })).body.id as string;
    const draft = (start: Record<string, unknown>, revision: number) =>
      call('PUT', `/flows/${flowId}/draft`, {
        revision,
        flow: {
          version: 1,
          name: 'Orders',
          nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: start },
            { id: 'log', type: 'log', position: { x: 200, y: 0 }, config: { message: '$id' } },
            { id: 'end', type: 'end', position: { x: 400, y: 0 }, config: {} },
          ],
          edges: [
            { source: 'start', sourcePort: 'out-0', target: 'log', targetPort: 'in-0' },
            { source: 'log', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
          ],
        },
      });
    const typed = { acceptsInput: true, inputType: 'orders/types#Order' };
    expect((await draft({ ...typed, testInput: JSON.stringify({ id: '7', status: 'lost', items: [{ sku: 'A' }] }) }, 0)).status).toBe(200);

    const refused = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    expect(refused.status).toBe(400);
    const message = (refused.body.error as { message: string }).message;
    expect(message).toStartWith('The input does not fit Order: ');
    expect(message).toContain('input.id: expected a number, got text "7".');
    expect(message).toContain('input.status: expected one of "new", "paid", got text "lost".');
    expect(message).toContain('input.items[0].qty: missing (required).');

    // the input given for the run: checked the same way, and kept with the run when it fits
    const givenBad = await call('POST', `/flows/${flowId}/runs`, { mode: 'execution', input: { id: 1, status: 'paid' } });
    expect((givenBad.body.error as { message: string }).message).toContain('input.items: missing (required).');
    const order = { id: 1, status: 'paid', items: [{ sku: 'A', qty: 2 }] };
    const accepted = await call('POST', `/flows/${flowId}/runs`, { mode: 'execution', input: order });
    expect(accepted.status).toBe(202);
    expect((await db.query<{ input: unknown }>('SELECT input FROM runs WHERE id = $1', [accepted.body.id]))[0]?.input).toEqual(order);

    // a default input that fits: it runs
    expect((await draft({ ...typed, testInput: JSON.stringify(order) }, 1)).status).toBe(200);
    expect((await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' })).status).toBe(202);

    // the type gone from the script: said so
    await call('PUT', `/projects/${projectId}/scripts/content`, { path: 'orders/types', revision: 1, content: 'export const nothing = 1;' });
    expect(((await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' })).body.error as { message: string }).message).toBe(
      "The Start's input type Order no longer exists in the script orders/types.",
    );

    // a flow that takes no input: an input given is refused
    expect((await draft({ acceptsInput: false }, 2)).status).toBe(200);
    const noInput = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation', input: order });
    expect((noInput.body.error as { message: string }).message).toContain('This flow does not take an input');
  });
});
