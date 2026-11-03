import {afterEach, expect, spyOn, test} from 'bun:test';
import {COMPONENTS, workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

/** Data Grid (2 orders) → Log → End. */
const flow = (config: Record<string, unknown>): ExecutableWorkflow => ({
  project: 'Test', workflow: 'Orders', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'grid', type: 'datagrid', label: 'Orders', override: true, config: {
      columns: [{name: 'id', type: 'number'}, {name: 'total', type: 'number'}],
      rows: [['1', '10'], ['2', '25']],
    }},
    {id: 'log', type: 'log', label: 'Trace', config},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'grid', targetPort: 'in-0'},
    {source: 'grid', sourcePort: 'out-0', target: 'log', targetPort: 'in-0'},
    {source: 'log', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

const spies = [spyOn(console, 'debug'), spyOn(console, 'info'), spyOn(console, 'warn'), spyOn(console, 'error')];
for (const spy of spies) spy.mockImplementation(() => undefined);
afterEach(() => spies.forEach(spy => spy.mockClear()));

const logOf = (r: Awaited<ReturnType<typeof workflowRunner>>) => r.components.find(c => c.nodeId === 'log')!;

test('Log validates its message', () => {
  expect(COMPONENTS.log.validate({level: 'info', message: ''})).toEqual(['has no message.']);
  expect(COMPONENTS.log.validate({level: 'info', message: '$id'})).toEqual([]);
});

test('Log records each message in the run and on the console, and lets the envelopes through', async () => {
  const r = await workflowRunner(flow({level: 'warn', message: '`Order ${$id}: ${$total}`'}), {mode: 'execution', id: 'l1', evaluate});
  const node = logOf(r);
  expect(node.logs.map(l => [l.level, l.message])).toEqual([['warning', 'Order 1: 10'], ['warning', 'Order 2: 25']]);
  expect(node.outputSample['out-0']).toEqual([{id: 1, total: 10}, {id: 2, total: 25}]);
  expect(spies[2].mock.calls.map(c => c[0])).toEqual(['[Orders / Trace] Order 1: 10', '[Orders / Trace] Order 2: 25']);
});

test('Log debug is recorded in test runs only', async () => {
  const testRun = await workflowRunner(flow({level: 'debug', message: '$id'}), {mode: 'validation', id: 'l2', evaluate});
  expect(logOf(testRun).logs.map(l => [l.level, l.message])).toEqual([['debug', '1'], ['debug', '2']]);
  expect(spies[0].mock.calls.length).toBe(2);

  spies[0].mockClear();
  const real = await workflowRunner(flow({level: 'debug', message: '$id'}), {mode: 'execution', id: 'l3', evaluate});
  expect(logOf(real).logs).toEqual([]);
  expect(spies[0].mock.calls.length).toBe(0);
  expect(logOf(real).outputSample['out-0']).toEqual([{id: 1, total: 10}, {id: 2, total: 25}]);
});

test('Log: a message that fails is an error of the envelope', async () => {
  const r = await workflowRunner(flow({level: 'info', message: '$missing.field', onError: 'continue'}), {mode: 'execution', id: 'l4', evaluate});
  const node = logOf(r);
  expect(node.status).toBe('with-errors');
  expect(node.logs.filter(l => l.level === 'error')).toHaveLength(2);
  expect(node.outputs['out-0']).toBe(2);
});
