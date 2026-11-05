import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { forgetOAuthTokens, newFlowFile, toExecutableFlow } from '@dataflow/core';
import type { RunJob } from '#features/runs/run-job';
import { processPool } from '../../supervisor/workers/process-pool';

setDefaultTimeout(30_000);

/**
 * The OAuth 2.0 tokens of the workers' runs, kept by the supervisor (worker processes for real, Bun IPC): one token for
 * all the workers, kept when a worker is replaced, asked again when the API refuses it.
 */
describe('OAuth 2.0 tokens kept by the supervisor', () => {
  let server: ReturnType<typeof Bun.serve>;
  let tokens = 0;
  /** the tokens the API refuses (401) */
  const refused = new Set<string>();
  // two workers, each replaced after every run
  const pool = processPool({ size: 2, maxRunsPerWorker: 1 });

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/token') {
          tokens++;
          // a slow provider: asks at the same time wait for the same answer
          await Bun.sleep(300);
          return Response.json({ access_token: `tok-pool-${tokens}`, expires_in: 3600 });
        }

        const token = request.headers.get('authorization')?.replace('Bearer ', '') ?? '';
        return refused.has(token) ? new Response('expired', { status: 401 }) : Response.json({ token });
      },
    });
  });

  afterAll(async () => {
    await pool.close();
    server.stop(true);
  });

  beforeEach(() => {
    forgetOAuthTokens();
    tokens = 0;
    refused.clear();
  });

  const job = (): RunJob => {
    const file = newFlowFile('Tokens');
    const start = file.nodes[0]!;
    const end = file.nodes[1]!;
    const flow = {
      ...file,
      nodes: [
        start,
        { id: 'get', type: 'http-request', position: { x: 160, y: 0 }, config: { connection: 'api', url: { value: `http://localhost:${server.port}/items`, expression: false } } },
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
      secrets: { CS: 'pool-client-s3cret' },
      variables: {},
      connections: {
        api: { name: 'Partner API', type: 'rest-oauth2', config: { grant: 'clientCredentials', tokenUrl: `http://localhost:${server.port}/token`, clientId: 'app', clientSecret: 'CS' } },
      },
      projectName: 'Project',
      flowName: 'Tokens',
    };
  };

  test('two workers at the same time: one token request; the next runs, on new workers, take the same token', async () => {
    const [a, b] = await Promise.all([pool.run(job(), () => {}).done, pool.run(job(), () => {}).done]);
    expect(a.record.status).toBe('completed');
    expect(b.record.status).toBe('completed');
    expect(tokens).toBe(1);

    // each worker ran its one run and was replaced: the token is still in the supervisor
    const next = await pool.run(job(), () => {}).done;
    expect(next.record.status).toBe('completed');
    expect(tokens).toBe(1);
    // the token is hidden in the records like a secret
    for (const r of [a, b, next]) {
      expect(JSON.stringify(r.record)).not.toContain('tok-pool-1');
      expect(JSON.stringify(r.record)).not.toContain('pool-client-s3cret');
    }
  });

  test('the API refuses the token (401): the supervisor asks a new one, the request goes once more; later runs use the new one', async () => {
    refused.add('tok-pool-1');
    const first = await pool.run(job(), () => {}).done;
    expect(first.record.status).toBe('completed');
    expect(tokens).toBe(2);

    const later = await pool.run(job(), () => {}).done;
    expect(later.record.status).toBe('completed');
    expect(tokens).toBe(2);
  });

  test('refused again with the new token: the run fails naming the connection', async () => {
    refused.add('tok-pool-1');
    refused.add('tok-pool-2');
    const { record } = await pool.run(job(), () => {}).done;
    expect(record.status).toBe('failed');
    expect(JSON.stringify(record)).toContain('answered 401 (Unauthorized) again with a new OAuth 2.0 token of the connection');
    expect(tokens).toBe(2);
  });
});
