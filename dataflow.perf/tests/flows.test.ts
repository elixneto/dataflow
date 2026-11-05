import { describe, expect, test } from 'bun:test';
import { componentIssues, START } from '@dataflow/core';
import { runJob } from '@dataflow/server/run-job';
import { DEFAULT_PARAMS, parseParams } from '#fake-api/params';
import { executableFlows, loadFlowFiles, PERF_CONNECTIONS, PERF_SECRETS } from '#perf/flows';
import { SCENARIOS } from '#perf/scenarios';
import { FAKE_API_PARAMS } from '#scenarios/http-slow-api/scenario';

/*
 * The scenarios' flows, in the everyday `bun run test` (no Docker): they read with the core's own functions, so a
 * change to the flow format breaks here, not in a perf run months later; and the settings the engine reads loosely
 * (spread list items, profile ids, the throughput node) are checked here because the core's validation does not.
 */

const SPREAD_LISTS: Record<string, string> = { mapper: 'fields', sqlserver: 'parameters', 'mongodb-upsert': 'filter', flow: 'parameters' };

describe.each(SCENARIOS.map(s => [s.id, s] as const))('scenario %s', (id, scenario) => {
  const files = loadFlowFiles(id);
  const nodes = files.flatMap(f => f.file.nodes.map(n => ({ path: f.path, ...n })));

  test('its flows read as flow files, with fixed ids and one named after the scenario', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.map(f => f.file.id)).toContain(id);
    expect(() => executableFlows(files, id)).not.toThrow();
  });

  test('every component is valid for the core', () => {
    for (const n of nodes) {
      expect({ node: `${n.path} ${n.id}`, issues: componentIssues(n.type, n.config) }).toEqual({ node: `${n.path} ${n.id}`, issues: [] });
    }
  });

  test('called flows, connections and secrets exist; spread list items are flat', () => {
    const ids = files.map(f => f.file.id);
    for (const n of nodes) {
      if (n.type === 'flow') {
        expect(ids).toContain(n.config.flowId as string);
      }

      if (typeof n.config.connection === 'string' && n.config.connection) {
        expect(Object.keys(PERF_CONNECTIONS)).toContain(n.config.connection);
      }

      const list = SPREAD_LISTS[n.type];
      for (const item of list ? ((n.config[list] as Record<string, unknown>[] | undefined) ?? []) : []) {
        expect({ node: n.id, value: typeof item.value, expression: typeof item.expression }).toEqual({ node: n.id, value: 'string', expression: 'boolean' });
      }
    }

    for (const profile of Object.values(PERF_CONNECTIONS)) {
      for (const secret of [profile.config.password, profile.config.connectionString].filter(Boolean)) {
        expect(Object.keys(PERF_SECRETS)).toContain(secret!);
      }
    }
  });

  test('the throughput node is a component of the main flow', () => {
    const { main } = executableFlows(files, id);
    expect(main.nodes.map(n => n.label)).toContain(scenario.throughputNode);
  });

  test('the engine takes the flow: a run already stopped ends failed, without throwing', async () => {
    const { main, flows } = executableFlows(files, id);
    const accepts = main.nodes.find(n => n.type === START)?.config.acceptsInput === true;
    const stopped = new AbortController();
    stopped.abort();
    const record = await runJob(
      {
        id: crypto.randomUUID(),
        mode: 'execution',
        flow: main,
        flows,
        parameters: { size: '1' },
        ...(accepts && scenario.input ? { input: scenario.input(1, scenario.seed) } : {}),
        secrets: PERF_SECRETS,
        variables: {},
        connections: PERF_CONNECTIONS,
        projectName: 'perf',
        flowName: main.flow,
      },
      { signal: stopped.signal },
    );
    expect(record.status).toBe('failed');
  });
});

test('the HTTP scenario asks the fake API for what its scenario says', () => {
  const [file] = loadFlowFiles('http-slow-api');
  const http = file!.file.nodes.find(n => n.type === 'http-request')!;
  const url = (http.config.url as { value: string }).value.replace(/^`|`$/g, '').replace('${$id}', '1');
  expect(parseParams(new URL(url))).toEqual({ ...DEFAULT_PARAMS, ...FAKE_API_PARAMS });
});
