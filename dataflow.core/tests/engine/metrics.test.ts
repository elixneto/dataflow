import {expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

test('active time does not count the wait, and Aggregate reports the batch peak', async () => {
  const slow: ExecutableFlow = {
    project: 'Test', flow: 'Metrics', parameters: [],
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
  const r = await flowRunner(slow, {
    mode: 'execution', id: 'metrics', evaluate, prepareScript, input: Array.from({length: 6}, (_, i) => ({a: i})),
  });
  expect(r.status).toBe('completed');
  const byId = (id: string) => r.components.find(c => c.nodeId === id)!;
  // the script sleeps 30 ms per envelope without passing it through the engine's wait (the server's runner does, and
  // it shows as Waiting): sleeping is not its own work, so it is not active either; it shows in its open time
  expect(byId('ts').activeTimeMs!).toBeLessThan(30);
  expect(byId('ts').durationMs!).toBeGreaterThan(150);
  // one thread runs one component at a time: the components' active times add up to no more than the run
  expect(r.components.reduce((sum, c) => sum + (c.activeTimeMs ?? 0), 0)).toBeLessThanOrEqual(r.durationMs);
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
