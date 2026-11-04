import {expect, test} from 'bun:test';
import {flowCalls, flowDependencies} from '#validation/flow-dependencies';
import type {ExecutableFlow} from '#types/executable-flow.type';

const flow = (id: string, calls: string[]): ExecutableFlow => ({
  id, project: 'P', flow: id.toUpperCase(), parameters: [], edges: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    ...calls.map((to, i) => ({id: `call${i}`, type: 'flow', label: `Call ${to}`, config: {flowId: to}})),
    {id: 'empty', type: 'flow', label: 'Not chosen', config: {flowId: ''}},
  ],
});

test('dependencies: what a flow uses and who uses it, directly', () => {
  const flows = [flow('a', ['b', 'c']), flow('b', ['c']), flow('c', []), flow('d', ['a', 'gone'])];
  expect(flowCalls(flows)).toHaveLength(5);
  const a = flowDependencies(flows, 'a');
  expect(a.uses.map(c => [c.to, c.nodeLabel])).toEqual([['b', 'Call b'], ['c', 'Call c']]);
  expect(a.usedBy.map(c => c.from)).toEqual(['d']);
  expect(flowDependencies(flows, 'c').usedBy.map(c => c.from)).toEqual(['a', 'b']);
  // a call to a flow that no longer exists still shows up (the editor marks it)
  expect(flowDependencies(flows, 'd').uses.map(c => c.to)).toEqual(['a', 'gone']);
});

test('dependencies: an invoker on the error port of another one handles its errors', () => {
  const parent: ExecutableFlow = {
    id: 'parent', project: 'P', flow: 'Parent', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'multiply', type: 'flow', label: 'Multiply', config: {flowId: 'mult'}},
      {id: 'handling', type: 'flow', label: 'Error handling', config: {flowId: 'errors'}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'multiply', targetPort: 'in-0'},
      {source: 'multiply', sourcePort: 'error', target: 'handling', targetPort: 'in-0'},
    ],
  };
  const [multiply, handling] = flowCalls([parent]);
  expect(multiply.onErrorOf).toBeUndefined();
  expect(handling).toEqual({from: 'parent', to: 'errors', nodeId: 'handling', nodeLabel: 'Error handling', onErrorOf: 'mult', onErrorOfLabel: 'Multiply'});
});
