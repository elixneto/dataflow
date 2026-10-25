import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow, LimitMode} from '../../src/index';
import {evaluate} from '../helpers';

const flow = (mode: LimitMode, count: number): ExecutableWorkflow => ({
  project: 'Test', workflow: 'Limit', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
    {id: 'l', type: 'limit', label: 'Limit', config: {mode, count}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'l', targetPort: 'in-0'},
    {source: 'l', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

const limited = async (mode: LimitMode, count: number, length: number) => {
  const input = Array.from({length}, (_, i) => ({n: i + 1}));
  const r = await workflowRunner(flow(mode, count), {mode: 'execution', id: 'limit', evaluate, input});
  expect(r.status).toBe('completed');
  const l = r.components.find(c => c.nodeId === 'l')!;
  expect(l.inputs['in-0']).toBe(length);
  return l;
};

test('Limit top lets the first N through and reads the rest of the input', async () => {
  const l = await limited('top', 3, 200);
  expect(l.outputs['out-0']).toBe(3);
  expect(l.outputSample['out-0'].map(d => d.n)).toEqual([1, 2, 3]);
  expect(l.memory).toBeUndefined();
});

test('Limit bottom lets the last N through, in arrival order, and holds only N', async () => {
  const l = await limited('bottom', 3, 200);
  expect(l.outputSample['out-0'].map(d => d.n)).toEqual([198, 199, 200]);
  expect(l.memory?.peakEnvelopes).toBe(3);
});

test('Limit with fewer envelopes than N lets them all through', async () => {
  expect((await limited('top', 10, 4)).outputSample['out-0'].map(d => d.n)).toEqual([1, 2, 3, 4]);
  expect((await limited('bottom', 10, 4)).outputSample['out-0'].map(d => d.n)).toEqual([1, 2, 3, 4]);
});
