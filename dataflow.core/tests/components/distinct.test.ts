import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

const flow = (keys: string[], withDuplicates = true): ExecutableWorkflow => ({
  project: 'Test', workflow: 'Distinct', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
    {id: 'd', type: 'distinct', label: 'Distinct', config: {keys}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'd', targetPort: 'in-0'},
    {source: 'd', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ...withDuplicates ? [{source: 'd', sourcePort: 'out-1', target: 'end', targetPort: 'in-0'}] : [],
  ],
});

const people = [
  {email: 'a@x', city: 'Recife', n: 1},
  {email: 'b@x', city: 'Recife', n: 2},
  {email: 'a@x', city: 'Natal', n: 3},
  {email: 'c@x', city: 'Natal', n: 4},
  {email: 'b@x', city: 'Recife', n: 5},
];

test('Distinct lets the first envelope of each key through and sends the repeated ones to duplicates', async () => {
  const r = await workflowRunner(flow(['$email']), {mode: 'execution', id: 'd1', evaluate, input: people});
  expect(r.status).toBe('completed');
  const d = r.components.find(c => c.nodeId === 'd')!;
  expect(d.outputSample['out-0'].map(p => p.n)).toEqual([1, 2, 4]);
  expect(d.outputSample['out-1'].map(p => p.n)).toEqual([3, 5]);
  // holds only the keys
  expect(d.memory?.peakEnvelopes).toBe(3);

  // more than one key: all of them make the combination
  const byTwo = await workflowRunner(flow(['$email', '$city']), {mode: 'execution', id: 'd2', evaluate, input: people});
  expect(byTwo.components.find(c => c.nodeId === 'd')!.outputSample['out-0'].map(p => p.n)).toEqual([1, 2, 3, 4]);
});

test('Distinct without keys compares the whole DATA, as JSON, and drops the duplicates when unconnected', async () => {
  const input = [{a: 1, b: {c: 2}}, {a: '1', b: {c: 2}}, {a: 1, b: {c: 2}}, {a: 1}];
  const r = await workflowRunner(flow([], false), {mode: 'execution', id: 'd3', evaluate, input});
  expect(r.status).toBe('completed');
  const d = r.components.find(c => c.nodeId === 'd')!;
  expect(d.outputSample['out-0']).toEqual([{a: 1, b: {c: 2}}, {a: '1', b: {c: 2}}, {a: 1}]);
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(3);
});

test('Distinct with a failing key is an error of the envelope', async () => {
  const r = await workflowRunner(flow(['$missing.x']), {mode: 'execution', id: 'd4', evaluate, input: people});
  expect(r.status).toBe('failed');
});
