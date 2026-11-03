import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

test('active time does not count the wait, and Aggregate reports the batch peak', async () => {
  const slow: ExecutableWorkflow = {
    project: 'Test', workflow: 'Metrics', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'ts', type: 'typescript', label: 'Slow', override: true, config: {code: 'async function process($input) {}'}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'b', value: '$a * 2', expression: true}]}},
      {id: 'ag', type: 'aggregate', label: 'Aggregate', config: {size: 4}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'},
      {source: 'ts', sourcePort: 'out-0', target: 'm', targetPort: 'in-0'},
      {source: 'm', sourcePort: 'out-0', target: 'ag', targetPort: 'in-0'},
      {source: 'ag', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  // the "script" waits 30 ms per envelope (like an HTTP call) and returns its own DATA
  const prepareScript = async () => async (input: unknown) => {
    await new Promise(r => setTimeout(r, 30));
    return input;
  };
  const r = await workflowRunner(slow, {
    mode: 'execution', id: 'metrics', evaluate, prepareScript, input: Array.from({length: 6}, (_, i) => ({a: i})),
  });
  expect(r.status).toBe('completed');
  const byId = (id: string) => r.components.find(c => c.nodeId === id)!;
  // the script awaits inside: counts as active
  expect(byId('ts').activeTimeMs!).toBeGreaterThan(150);
  // the Mapper spent the run waiting for the script: it is active much less than it lasted
  expect(byId('m').durationMs!).toBeGreaterThan(100);
  expect(byId('m').activeTimeMs!).toBeLessThan(byId('m').durationMs! / 2);
  expect(byId('ag').memory?.peakEnvelopes).toBe(4);
  // peak × average size of the DATA JSON ({"a":0,"b":0} has 13; with b = 10, 14)
  expect(byId('ag').memory!.peakBytes).toBeGreaterThanOrEqual(4 * 13);
  expect(byId('ag').memory!.peakBytes).toBeLessThanOrEqual(4 * 14);
  // whoever holds nothing has no memory
  expect(byId('m').memory).toBeUndefined();
});
