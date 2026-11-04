import {expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow, PrepareScript} from '../../src/index';
import {evaluate} from '../helpers';

const spin = (ms: number) => {
  const until = performance.now() + ms;
  while (performance.now() < until) { /* working */ }
};

/** Start → TypeScript (compiles first, then waits per envelope) → End */
const flow: ExecutableFlow = {
  project: 'Test', flow: 'Open time', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
    {id: 'ts', type: 'typescript', label: 'Script', config: {code: 'async function process($input) { return 1; }'}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'},
    {source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
};

test('a component that works before its first envelope (compiling its script): that work is inside its open time; active + waiting fit in it', async () => {
  const prepareScript: PrepareScript = async (_code, globals) => {
    spin(30);
    return async () => {
      spin(10);
      await globals.wait(new Promise(resolve => setTimeout(resolve, 60)));
      return 1;
    };
  };
  const record = await flowRunner(flow, {mode: 'validation', id: 'o1', evaluate, input: [{a: 1}, {a: 2}], prepareScript});
  const ts = record.components.find(c => c.nodeId === 'ts')!;
  expect(record.status).toBe('completed');
  expect(ts.activeTimeMs!).toBeGreaterThanOrEqual(50);
  expect(ts.waitingMs!).toBeGreaterThanOrEqual(115);
  expect(ts.activeTimeMs! + ts.waitingMs!).toBeLessThanOrEqual(ts.durationMs! + 0.02);
  // the start and the end as dates, the duration between them
  expect(Date.parse(ts.end!) - Date.parse(ts.start!)).toBeCloseTo(ts.durationMs!, -1);
});

test('for every kind of component, active + waiting fit in its open time: an HTTP call that waits, a plain mapper, a script', async () => {
  const several: ExecutableFlow = {
    project: 'Test', flow: 'Open time, several', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'http', type: 'http-request', label: 'Get', config: {url: {value: 'https://api.test/items', expression: false}}},
      {id: 'map', type: 'mapper', label: 'Map', config: {fields: [{target: 'x', value: '$response.status', expression: true}]}},
      {id: 'ts', type: 'typescript', label: 'Script', config: {code: 'async function process($input) { return 1; }'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'http', targetPort: 'in-0'},
      {source: 'http', sourcePort: 'out-0', target: 'map', targetPort: 'in-0'},
      {source: 'map', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'},
      {source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const prepareScript: PrepareScript = async (_code, globals) => {
    spin(20);
    return async () => {
      await globals.wait(new Promise(resolve => setTimeout(resolve, 15)));
      return 1;
    };
  };
  const record = await flowRunner(several, {
    mode: 'validation', id: 'o2', evaluate, input: [{a: 1}, {a: 2}, {a: 3}], prepareScript,
    http: async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return {status: 200, headers: {'content-type': 'application/json'}, body: '{"ok":true}'};
    },
  });
  expect(record.status).toBe('completed');
  for (const c of record.components) {
    expect((c.activeTimeMs ?? 0) + (c.waitingMs ?? 0)).toBeLessThanOrEqual(c.durationMs! + 0.02);
  }
  expect(record.components.find(c => c.nodeId === 'http')!.waitingMs!).toBeGreaterThanOrEqual(110);
});

test("a component's start and end are on the run's clock: inside the run, even when the process's high-resolution clock drifted", async () => {
  const realOrigin = performance.timeOrigin;
  // a worker alive for hours: its timeOrigin no longer matches Date.now() (here, 5 s behind)
  Object.defineProperty(performance, 'timeOrigin', {value: realOrigin - 5_000, configurable: true});
  try {
    const prepareScript: PrepareScript = async () => async () => 1;
    const record = await flowRunner(flow, {mode: 'validation', id: 'o3', evaluate, input: [{a: 1}], prepareScript});
    const runStart = Date.parse(record.run.startedAt);
    for (const c of record.components.filter(x => x.start)) {
      expect(Date.parse(c.start!)).toBeGreaterThanOrEqual(runStart);
      expect(Date.parse(c.end!)).toBeLessThanOrEqual(runStart + record.durationMs + 2);
    }
  } finally {
    Object.defineProperty(performance, 'timeOrigin', {value: realOrigin, configurable: true});
  }
});
