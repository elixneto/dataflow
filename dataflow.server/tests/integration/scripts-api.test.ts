import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { RunRecord } from '@dataflow/core';
import { followRunEvents } from '#features/runs/run-events';
import { Keyring } from '#shared/crypto/keyring';
import { openDatabase, type Database } from '#shared/database/database';
import { createApp } from '../../api/app';
import { Supervisor } from '../../supervisor/supervisor';
import { silentLogger } from '#shared/logging/logger';
import { inProcessExecutor } from '../../supervisor/workers/executor';

setDefaultTimeout(30_000);

/**
 * A project's scripts over HTTP (paths in folders, revisions as the flow drafts, moves and deletes with who imports
 * them), and a TypeScript component that imports one, run by a supervisor: the run keeps the scripts as they were
 * when it was queued.
 */
describe('scripts api', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let supervisor: Supervisor;
  let stopFollowing: () => Promise<void>;
  let projectId: string;
  const orgId = crypto.randomUUID();
  const headers = { 'x-org-id': orgId, 'x-user-id': 'ana', 'content-type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const scripts = async () =>
    (await call('GET', `/projects/${projectId}/scripts`)).body as { scripts: { path: string; revision: number; exports: { name: string; typeOnly: boolean }[] }[]; folders: string[] };
  const content = async (path: string) => (await call('GET', `/projects/${projectId}/scripts/content?path=${encodeURIComponent(path)}`)).body;

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, 'acme']);
    const keyring = new Keyring([{ version: 't', key: new Uint8Array(32).fill(5) }]);
    app = createApp(db, 'DEV', keyring);
    stopFollowing = await followRunEvents(db);
    supervisor = new Supervisor({ db, keyring, executor: inProcessExecutor(), tags: ['default'], logger: silentLogger(), pollMs: 200 });
    await supervisor.start();
    projectId = (await call('POST', '/projects', { name: 'Scripts' })).body.id as string;
  });

  afterAll(async () => {
    await supervisor.stop();
    await stopFollowing();
    await db.close();
  });

  test('scripts and folders by path: listed with what each exports (not their code), the path rules, what is taken, 1 MB at most', async () => {
    expect((await call('POST', `/projects/${projectId}/scripts`, { kind: 'script', path: '/upload/types.ts', content: 'export const a = 1;' })).status).toBe(201);
    expect((await call('POST', `/projects/${projectId}/scripts`, { kind: 'folder', path: 'empty/inner' })).status).toBe(201);
    const list = await scripts();
    expect(list.scripts.map(s => [s.path, s.revision, s.exports])).toEqual([['upload/types', 0, [{ name: 'a', typeOnly: false }]]]);
    expect(list.folders).toEqual(['empty', 'empty/inner', 'upload']);
    // the code, on its own
    expect(await content('upload/types')).toEqual({ path: 'upload/types', content: 'export const a = 1;', revision: 0 });
    expect((await call('GET', `/projects/${projectId}/scripts/content?path=nope`)).status).toBe(404);
    const huge = await call('POST', `/projects/${projectId}/scripts`, { kind: 'script', path: 'huge', content: 'x'.repeat(1024 * 1024 + 1) });
    expect(huge.status).toBe(400);
    expect((huge.body.error as { fields: { content: string } }).fields.content).toContain('at most 1 MB');

    const taken = await call('POST', `/projects/${projectId}/scripts`, { kind: 'script', path: 'upload/types' });
    expect(taken.status).toBe(409);
    const bad = await call('POST', `/projects/${projectId}/scripts`, { kind: 'script', path: 'bad name' });
    expect(bad.status).toBe(400);
    expect((bad.body.error as { fields: { path: string } }).fields.path).toContain('is not a valid name');
  });

  test('a save over the revision it read; one from elsewhere in between is a conflict', async () => {
    const saved = await call('PUT', `/projects/${projectId}/scripts/content`, { path: 'upload/types', content: 'export const a = 2;', revision: 0 });
    expect(saved.body).toEqual({ revision: 1 });
    expect((await call('PUT', `/projects/${projectId}/scripts/content`, { path: 'upload/types', content: 'stale', revision: 0 })).status).toBe(409);
    expect((await call('PUT', `/projects/${projectId}/scripts/content`, { path: 'nope', content: '', revision: 0 })).status).toBe(404);
    expect((await call('PUT', `/projects/${projectId}/scripts/content`, { path: 'upload/types', content: 'x'.repeat(1024 * 1024 + 1), revision: 1 })).status).toBe(400);
    // what it exports follows its code
    expect((await scripts()).scripts[0]!.exports).toEqual([{ name: 'a', typeOnly: false }]);
  });

  test('a TypeScript component imports a script; the run takes only what it imports, by hash, as it was when queued', async () => {
    await call('POST', `/projects/${projectId}/scripts`, { kind: 'script', path: 'unused/big', content: 'export const big = 1;' });
    await call('PUT', `/projects/${projectId}/scripts/content`, {
      path: 'upload/types',
      content: `export interface IItem { n: number }\nexport function double(item: IItem): number { return item.n * 2; }\n`,
      revision: 1,
    });
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Uses a script', folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: Record<string, unknown> };
    const code = `import { double, type IItem } from '@myproject/scripts/upload/types';
async function process($input: IItem) {
  log('doubling ' + $input.n);
  return double($input);
}`;
    await call('PUT', `/flows/${flowId}/draft`, {
      revision: 0,
      flow: {
        ...draft.flow,
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: { acceptsInput: true, testInput: '[{"n": 2}, {"n": 5}]' } },
          { id: 'ts', type: 'typescript', position: { x: 160, y: 0 }, config: { code } },
          { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
        ],
        edges: [
          { source: 'start', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0' },
          { source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
        ],
      },
    });

    // who imports the script (before a move or a delete)
    expect((await call('GET', `/projects/${projectId}/scripts/usage?path=upload`)).body).toEqual({ flows: [{ id: flowId, name: 'Uses a script' }], scripts: [] });

    const id = (await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' })).body.id;
    // only the script it imports went with the run, by the hash of its code
    const [queued] = await db.query<{ scripts: Record<string, string> }>('SELECT scripts FROM test_runs WHERE id = $1', [id]);
    expect(Object.keys(queued!.scripts)).toEqual(['upload/types']);
    expect(queued!.scripts['upload/types']).toMatch(/^[0-9a-f]{64}$/);
    // changed right after: the run keeps what it was queued with
    await call('PUT', `/projects/${projectId}/scripts/content`, { path: 'upload/types', content: 'export const broken = ;', revision: 2 });
    let record: RunRecord | null = null;
    for (let i = 0; i < 200 && !record; i++) {
      const run = await call('GET', `/runs/${id}`);
      record = run.body.status === 'queued' || run.body.status === 'running' ? null : (run.body.record as RunRecord);
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    const ts = record!.components.find(c => c.nodeId === 'ts')!;
    expect(record!.status).toBe('completed');
    expect(ts.outputSample['out-0']).toEqual([
      { n: 2, result: 4 },
      { n: 5, result: 10 },
    ]);
    expect(ts.logs.map(l => l.message)).toEqual(['doubling 2', 'doubling 5', expect.any(String)]);
  });

  test('a folder moved takes its scripts (and the empty folders); deleted, everything in it goes', async () => {
    expect((await call('POST', `/projects/${projectId}/scripts/move`, { from: 'upload', to: 'files/upload' })).body).toEqual({ path: 'files/upload' });
    expect((await scripts()).scripts.map(s => s.path)).toEqual(['files/upload/types', 'unused/big']);
    expect((await call('POST', `/projects/${projectId}/scripts/move`, { from: 'empty', to: 'files/upload/types' })).status).toBe(409);
    await call('POST', `/projects/${projectId}/scripts/delete`, { path: 'files' });
    await call('POST', `/projects/${projectId}/scripts/delete`, { path: 'empty' });
    await call('POST', `/projects/${projectId}/scripts/delete`, { path: 'unused' });
    expect(await scripts()).toEqual({ scripts: [], folders: [] });
  });

  test('a flow importing a script that does not exist does not run: it says which component and which import', async () => {
    const flowId = (await call('POST', `/projects/${projectId}/flows`, { name: 'Broken import', folderId: null })).body.id as string;
    const draft = (await call('GET', `/flows/${flowId}/draft`)).body as { flow: Record<string, unknown> };
    await call('PUT', `/flows/${flowId}/draft`, {
      revision: 0,
      flow: {
        ...draft.flow,
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
          { id: 'ts', type: 'typescript', label: 'Shape', position: { x: 160, y: 0 }, config: { code: `import { x } from '@myproject/scripts/missing/one';\nasync function process($input) { return x; }` } },
          { id: 'end', type: 'end', position: { x: 320, y: 0 }, config: {} },
        ],
        edges: [
          { source: 'start', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0' },
          { source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0' },
        ],
      },
    });
    const refused = await call('POST', `/flows/${flowId}/runs`, { mode: 'validation' });
    expect(refused.status).toBe(400);
    expect((refused.body.error as { message: string }).message).toBe('The flow cannot run: "Shape" imports @myproject/scripts/missing/one, which does not exist.');
  });
});
