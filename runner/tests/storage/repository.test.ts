import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import type {RunRecord} from '@dataflow/core';
import {openDatabase, type Database} from '../../src/storage/database';
import {repository, type Repository} from '../../src/storage/repository';
import {storageRoutes} from '../../src/storage/routes';

// always against PGlite in memory; with TEST_DATABASE_URL, also against a real Postgres (its tables are dropped first)
const targets: [string, string][] = [['PGlite', 'memory://']];
if (process.env.TEST_DATABASE_URL) targets.push(['Postgres', process.env.TEST_DATABASE_URL]);

const run = (id: string, projectId: string, startedAt: string): RunRecord & {projectId: string; workflowId: string} => ({
  run: {id, mode: 'execution', project: 'Sales', workflow: 'Invoices', startedAt},
  parameters: {},
  status: 'completed',
  end: startedAt,
  durationMs: 12.6,
  components: [],
  projectId,
  workflowId: 'f-1',
});

for (const [name, url] of targets) {
  describe(`storage (${name})`, () => {
    let db: Database;
    let repo: Repository;

    beforeAll(async () => {
      if (url !== 'memory://') {
        const clean = await openDatabase(url);
        await clean.exec('DROP TABLE IF EXISTS runs, flows, projects, schema_migrations');
        await clean.close();
      }
      db = await openDatabase(url);
      repo = repository(db);
    });

    afterAll(() => db.close());

    test('starts with the examples project, and migrating again changes nothing', async () => {
      expect((await repo.listProjects()).map(p => p.id)).toEqual(['examples']);
      expect((await repo.getProject('examples'))?.description).toBe('An example flow for each component, and showcase flows that use them all.');
      const again = await openDatabase(url);
      expect((await again.query('SELECT count(*)::int AS n FROM schema_migrations'))[0]).toEqual({n: 2});
      if (url !== 'memory://') await again.close();
    });

    test('saves, reads and deletes projects and flows', async () => {
      await repo.saveProject({id: 'sales', name: 'Sales', description: '', folders: ['Invoices'], updatedAt: '2026-10-24T10:00:00.000Z'});
      expect(await repo.getProject('sales')).toEqual({id: 'sales', name: 'Sales', description: '', folders: ['Invoices'], updatedAt: '2026-10-24T10:00:00.000Z'});

      const flow = {id: 'f-1', projectId: 'sales', folder: 'Invoices', name: 'Today', status: 'draft', version: 1, nodes: [{id: 'start', data: {}}]};
      await repo.saveFlow(flow);
      await repo.saveFlow({...flow, version: 2});
      expect(await repo.getFlow('f-1')).toEqual({...flow, version: 2});
      expect(await repo.listFlows('sales')).toHaveLength(1);
      expect(await repo.listFlows('examples')).toHaveLength(0);

      // deleting the project takes its flows along
      expect(await repo.deleteProject('sales')).toBe(true);
      expect(await repo.getFlow('f-1')).toBeUndefined();
      expect(await repo.deleteProject('sales')).toBe(false);
    });

    test('import keeps what exists and sends orphan flows to the examples project', async () => {
      await repo.saveProject({id: 'kept', name: 'Kept', description: 'db', updatedAt: '2026-10-24T10:00:00.000Z'});
      const result = await repo.importWorkspace(
        [{id: 'kept', name: 'Browser', description: 'browser', updatedAt: '2026-10-24T10:00:00.000Z'},
          {id: 'new', name: 'New', description: '', updatedAt: '2026-10-24T10:00:00.000Z'}],
        [{id: 'f-a', projectId: 'new', name: 'A', nodes: []}, {id: 'f-b', projectId: 'gone', name: 'B', nodes: []}],
      );
      expect(result).toEqual({projects: 1, flows: 2});
      expect((await repo.getProject('kept'))?.description).toBe('db');
      expect((await repo.getFlow('f-b'))?.projectId).toBe('examples');
      expect(await repo.importWorkspace([], [{id: 'f-a', projectId: 'new', name: 'Changed', nodes: []}])).toEqual({projects: 0, flows: 0});
      expect((await repo.getFlow('f-a'))?.name).toBe('A');
    });

    test('stores runs and lists the latest, without the components', async () => {
      await repo.saveRun(run('r-1', 'sales', '2026-10-24T10:00:00.000Z'));
      await repo.saveRun(run('r-2', 'sales', '2026-10-24T11:00:00.000Z'));
      await repo.saveRun(run('r-3', 'other', '2026-10-24T12:00:00.000Z'));
      expect((await repo.listRuns('sales', 50)).map(r => r.run.id)).toEqual(['r-2', 'r-1']);
      expect((await repo.listRuns(undefined, 2)).map(r => r.run.id)).toEqual(['r-3', 'r-2']);
      expect(await repo.listRuns('sales', 1)).toEqual([expect.not.objectContaining({components: expect.anything()})]);
      expect((await repo.getRun('r-1'))?.components).toEqual([]);
      expect(await repo.getRun('missing')).toBeUndefined();
    });

    test('does not store editor test runs (validation)', async () => {
      const test = run('r-test', 'tests', '2026-10-24T13:00:00.000Z');
      expect(await repo.saveRun({...test, run: {...test.run, mode: 'validation'}})).toBe(false);
      expect(await repo.saveRun(run('r-real', 'tests', '2026-10-24T14:00:00.000Z'))).toBe(true);
      expect((await repo.listRuns('tests', 50)).map(r => r.run.id)).toEqual(['r-real']);
      expect(await repo.getRun('r-test')).toBeUndefined();
    });

    test('API validates ids and the flow\'s project', async () => {
      const api = storageRoutes(repo);
      const put = (path: string, body: unknown) => api.request(path, {method: 'PUT', body: JSON.stringify(body), headers: {'content-type': 'application/json'}});
      expect((await put('/projects/..%2Fx', {name: 'Bad'})).status).toBe(400);
      expect((await put('/projects/api', {name: 'API', description: ''})).status).toBe(200);
      expect((await put('/flows/f-x', {name: 'X', projectId: 'missing', nodes: []})).status).toBe(400);
      expect((await put('/flows/f-x', {name: 'X', projectId: 'api', nodes: []})).status).toBe(200);
      expect(await (await api.request('/flows?project=api')).json()).toEqual([{id: 'f-x', name: 'X', projectId: 'api', nodes: []}]);
      expect((await api.request('/flows/f-x', {method: 'DELETE'})).status).toBe(200);
      expect((await api.request('/flows/f-x')).status).toBe(404);
    });
  });
}
