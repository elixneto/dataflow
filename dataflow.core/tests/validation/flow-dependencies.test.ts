import {expect, test} from 'bun:test';
import {callCycles, callPath, callTree, flowCalls, flowDependencies} from '#validation/flow-dependencies';
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

test('call paths, cycles and the call tree: down the chain, a cycle closed where it comes back, past the depth limit marked', () => {
  const flows = [flow('a', ['b', 'c']), flow('b', ['c']), flow('c', ['a']), flow('d', ['d'])];
  const calls = flowCalls(flows);
  expect(callPath(calls, 'a', 'c')).toEqual(['a', 'c']);
  expect(callPath(calls, 'b', 'a')).toEqual(['b', 'c', 'a']);
  expect(callPath(calls, 'd', 'a')).toBeNull();
  // a → c → a and a → b → c → a, and d calling itself; each once
  expect(callCycles(calls)).toEqual([['a', 'b', 'c', 'a'], ['a', 'c', 'a'], ['d', 'd']]);

  const {nodes, truncated} = callTree(calls, 'a');
  expect(truncated).toBe(false);
  const shape = (n: ReturnType<typeof callTree>['nodes']): unknown[] => n.map(x => [x.call.to, x.depth, x.cycle ? 'cycle' : '', shape(x.children)]);
  expect(shape(nodes)).toEqual([
    ['b', 1, '', [['c', 2, '', [['a', 3, 'cycle', []]]]]],
    ['c', 1, '', [['a', 2, 'cycle', []]]],
  ]);

  // a chain longer than the engine follows: the call past it is marked, not followed
  const chain = Array.from({length: 13}, (_, i) => flow(`f${i}`, i < 12 ? [`f${i + 1}`] : []));
  let deepest = callTree(flowCalls(chain), 'f0').nodes[0]!;
  while (deepest.children.length) deepest = deepest.children[0]!;
  expect(deepest.depth).toBe(11);
  expect(deepest.tooDeep).toBe(true);
});
