import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

const edge = (source: string, target: string, sourcePort = 'out-0', targetPort = 'in-0') => ({source, sourcePort, target, targetPort});

/** Start → Mapper 1 (fails without $a) → Mapper 2 (doubles) → End */
const chain = (): ExecutableWorkflow => ({
  project: 'Test', workflow: 'Pins', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'm1', type: 'mapper', label: 'Mapper 1', config: {fields: [{target: 'b', value: '$a.x', expression: true}]}},
    {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 'double', value: '$b * 2', expression: true}]}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [edge('start', 'm1'), edge('m1', 'm2'), edge('m2', 'end')],
});

test('a pinned node replays its output without executing, and what only feeds it does not run', async () => {
  const wf = chain();
  // without the pin, Mapper 1 fails ($a does not exist)
  expect((await workflowRunner(wf, {mode: 'execution', id: 'p0', evaluate})).status).toBe('failed');

  wf.nodes[1].pinned = {'out-0': [{b: 1}, {b: 2}, {b: 3}]};
  const r = await workflowRunner(wf, {mode: 'execution', id: 'p1', evaluate});
  expect(r.status).toBe('completed');
  const byId = (id: string) => r.components.find(c => c.nodeId === id)!;
  expect(byId('start').status).toBe('not-run');
  expect(byId('m1').status).toBe('pinned');
  expect(byId('m1').outputs['out-0']).toBe(3);
  expect(byId('m2').outputSample['out-0']).toEqual([{b: 1, double: 2}, {b: 2, double: 4}, {b: 3, double: 6}]);
  expect(byId('end').inputs['in-0']).toBe(3);
});

test('a node that feeds a pinned node and a running one still runs, and the pinned one drops its input', async () => {
  const wf: ExecutableWorkflow = {
    project: 'Test', workflow: 'Pins and Copy', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'c', type: 'copy', label: 'Copy', config: {outputCount: 2}},
      {id: 'p', type: 'mapper', label: 'Pinned', config: {fields: [{target: 'x', value: '1', expression: true}]}, pinned: {'out-0': [{pinned: true}]}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'x', value: '2', expression: true}]}},
      {id: 'u', type: 'union', label: 'Union', config: {inputCount: 2}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'c'), edge('c', 'p'), edge('c', 'm', 'out-1'), edge('p', 'u'), edge('m', 'u', 'out-0', 'in-1'), edge('u', 'end')],
  };
  // more envelopes than a channel holds: the pinned node must keep reading so the Copy does not get stuck
  const input = Array.from({length: 300}, (_, i) => ({i}));
  const r = await workflowRunner(wf, {mode: 'execution', id: 'p2', evaluate, input});
  expect(r.status).toBe('completed');
  const byId = (id: string) => r.components.find(c => c.nodeId === id)!;
  expect(byId('c').status).toBe('completed');
  expect(byId('p').inputs['in-0']).toBe(300);
  expect(byId('p').outputs['out-0']).toBe(1);
  expect(byId('u').outputs['out-0']).toBe(301);
});
