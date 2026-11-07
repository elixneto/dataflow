import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { newFlowFile, toExecutableFlow, type RunProgress } from '@dataflow/core';
import type { RunJob } from '#features/runs/run-job';
import { processPool } from '../../supervisor/workers/process-pool';

setDefaultTimeout(30_000);

/**
 * Worker processes for real (Bun IPC): a flow calls a local HTTP server; the worker answers with the run as it goes
 * and its end, a Stop ends it, one past the time limit is killed and replaced. Secrets travel to the worker only.
 */
describe('process pool', () => {
  let server: ReturnType<typeof Bun.serve>;
  const pool = processPool({ size: 1, cancelGraceMs: 1_000, hardTimeoutMs: 2_500 });

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/slow') {
          await Bun.sleep(Number(url.searchParams.get('ms') ?? 1_000));
        }

        return Response.json({ path: url.pathname, auth: request.headers.get('authorization') ? 'yes' : 'no' });
      },
    });
  });

  afterAll(async () => {
    await pool.close();
    server.stop(true);
  });

  const job = (path: string): RunJob => {
    const file = newFlowFile('Pool');
    const start = file.nodes[0]!;
    const end = file.nodes[1]!;
    const flow = {
      ...file,
      nodes: [
        start,
        {
          id: 'get',
          type: 'http-request',
          position: { x: 160, y: 0 },
          config: {
            url: { value: `"http://localhost:${server.port}${path}"`, expression: true },
            headers: [{ key: 'Authorization', value: { value: '"Bearer " + $SECRETS.token', expression: true } }],
          },
        },
        end,
      ],
      edges: [
        { source: start.id, sourcePort: 'out-0', target: 'get', targetPort: 'in-0' },
        { source: 'get', sourcePort: 'out-0', target: end.id, targetPort: 'in-0' },
      ],
    };
    return {
      id: crypto.randomUUID(),
      mode: 'validation',
      flow: { ...toExecutableFlow(flow, 'Project'), id: crypto.randomUUID() },
      parameters: {},
      secrets: { token: 'w0rker-s3cret' },
      variables: {},
      connections: {},
      projectName: 'Project',
      flowName: 'Pool',
    };
  };

  test('a run in a worker process: progress while it goes, then its record and what it used', async () => {
    const progress: RunProgress[] = [];
    const { done } = pool.run(job('/slow?ms=600'), p => progress.push(p));
    const { record, usage } = await done;

    expect(record.status).toBe('completed');
    expect(record.components.find(c => c.nodeId === 'get')?.outputs['out-0']).toBe(1);
    expect(progress.some(p => p.components.find(c => c.nodeId === 'get')?.status === 'running')).toBe(true);
    expect(usage.peakRssBytes).toBeGreaterThan(0);
    // CPU time comes in coarse steps (about 16 ms on Windows): a short run may count 0
    expect(usage.cpuMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(record)).not.toContain('w0rker-s3cret');
  });

  test('Stop: the run ends cancelled with what it did so far, at once (not when its worker is killed)', async () => {
    const execution = pool.run(job('/slow?ms=5000'), () => {});
    await Bun.sleep(700);
    const asked = performance.now();
    execution.cancel();
    const { record } = await execution.done;
    // the engine ends it (its call aborted, nothing waited for), well before the kill after cancelGraceMs (1 s here)
    expect(performance.now() - asked).toBeLessThan(800);
    expect(record.status).toBe('failed');
    expect(record.error).toContain('cancelled');
    expect(record.components.find(c => c.nodeId === 'start')?.status).toBe('completed');
    // its worker is replaced: the next run gets a new one, and runs
    expect((await pool.run(job('/fast'), () => {}).done).record.status).toBe('completed');
  });

  test('a run past the time limit is killed with its worker; the next run gets a new one', async () => {
    const { record } = await pool.run(job('/slow?ms=10000'), () => {}).done;
    expect(record.error).toContain('took longer');

    const next = await pool.run(job('/fast'), () => {}).done;
    expect(next.record.status).toBe('completed');
  });
});
