import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow, SortKey} from '../../src/index';
import {evaluate} from '../helpers';

const flow = (keys: SortKey[]): ExecutableWorkflow => ({
  project: 'Test', workflow: 'Sort', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
    {id: 's', type: 'sort', label: 'Sort', config: {keys}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 's', targetPort: 'in-0'},
    {source: 's', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

const sorted = async (keys: SortKey[], input: unknown[]) => {
  const r = await workflowRunner(flow(keys), {mode: 'execution', id: 'sort', evaluate, input});
  expect(r.status).toBe('completed');
  return r.components.find(c => c.nodeId === 's')!;
};

test('Sort orders by the first key, breaks ties with the next and keeps the arrival order of what is still tied', async () => {
  const input = [
    {id: 1, city: 'Recife', total: 10},
    {id: 2, city: 'Natal', total: 5},
    {id: 3, city: 'Recife', total: 30},
    {id: 4, city: 'Natal', total: 5},
    {id: 5, city: 'Aracaju', total: 9},
  ];
  const s = await sorted([{value: '$city', direction: 'asc'}, {value: '$total', direction: 'desc'}], input);
  expect(s.outputSample['out-0'].map(d => d.id)).toEqual([5, 2, 4, 3, 1]);
  expect(s.memory?.peakEnvelopes).toBe(5);
});

test('Sort compares numbers as numbers and puts null and undefined last in both directions', async () => {
  const input = [{n: 10}, {n: null}, {n: 9}, {n: undefined}, {n: 100}];
  const asc = await sorted([{value: '$n', direction: 'asc'}], input);
  expect(asc.outputSample['out-0']).toEqual([{n: 9}, {n: 10}, {n: 100}, {n: null}, {n: undefined}]);
  const desc = await sorted([{value: '$n', direction: 'desc'}], input);
  expect(desc.outputSample['out-0']).toEqual([{n: 100}, {n: 10}, {n: 9}, {n: null}, {n: undefined}]);
});

test('Sort with a failing key is an error of the envelope', async () => {
  const r = await workflowRunner(flow([{value: '$missing.x', direction: 'asc'}]), {mode: 'execution', id: 'sort2', evaluate, input: [{a: 1}]});
  expect(r.status).toBe('failed');
});

test('Sort orders dates by time (not by their text)', async () => {
  // as text, "Sat ..." would come before "Wed ..."; by time, January comes first
  const input = [
    {id: 1, at: new Date('2026-10-24T10:00:00.000Z')},
    {id: 2, at: new Date('2026-01-07T10:00:00.000Z')},
    {id: 3, at: new Date('2026-10-24T09:59:59.999Z')},
  ];
  const node = await sorted([{value: '$at', direction: 'asc'}], input);
  expect(node.outputSample['out-0'].map(d => d.id)).toEqual([2, 3, 1]);
});
