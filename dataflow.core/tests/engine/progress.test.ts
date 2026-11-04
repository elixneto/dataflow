import {expect, test} from 'bun:test';
import {flowRunner, type RunProgress} from '../../src/index';
import {evaluate} from '../helpers';

test("a run's progress: each component's status as it goes (running, then how it ended), counts so far; the final record has no running", async () => {
  const seen: RunProgress[] = [];
  const record = await flowRunner({
    project: 'Test', flow: 'Slow', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'h', type: 'http-request', label: 'Slow API', config: {url: {value: 'https://api.test/x', expression: false}}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'h', targetPort: 'in-0'},
      {source: 'h', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }, {
    mode: 'validation', id: 'p1', evaluate, input: [{n: 1}],
    http: async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      return {status: 200, headers: {}, body: '{}'};
    },
    onProgress: progress => void seen.push(progress),
  });

  expect(seen.length).toBeGreaterThan(1);
  const status = (p: RunProgress, id: string) => p.components.find(c => c.nodeId === id)!.status;
  // while the API is slow: the Start already done (1 out), the HTTP Request running
  const during = seen.find(p => status(p, 'h') === 'running')!;
  expect(during.status).toBe('running');
  expect(status(during, 'start')).toBe('completed');
  expect(during.components.find(c => c.nodeId === 'start')!.outputs).toEqual({'out-0': 1});
  // a copy: the run goes on without changing what was sent
  expect(during.components.find(c => c.nodeId === 'h')!.outputs).toEqual({});
  expect(record.components.every(c => c.status !== 'running')).toBe(true);
  expect(record.components.find(c => c.nodeId === 'h')!.outputs).toEqual({'out-0': 1});
});
