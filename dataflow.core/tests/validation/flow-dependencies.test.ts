import {expect, test} from 'bun:test';
import {workflowCalls, workflowDependencies} from '#validation/workflow-dependencies';
import type {ExecutableWorkflow} from '#types/executable-workflow.type';

const flow = (id: string, calls: string[]): ExecutableWorkflow => ({
  id, project: 'P', workflow: id.toUpperCase(), parameters: [], edges: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    ...calls.map((to, i) => ({id: `call${i}`, type: 'workflow', label: `Call ${to}`, config: {workflowId: to}})),
    {id: 'empty', type: 'workflow', label: 'Not chosen', config: {workflowId: ''}},
  ],
});

test('dependencies: what a workflow uses and who uses it, directly', () => {
  const flows = [flow('a', ['b', 'c']), flow('b', ['c']), flow('c', []), flow('d', ['a', 'gone'])];
  expect(workflowCalls(flows)).toHaveLength(5);
  const a = workflowDependencies(flows, 'a');
  expect(a.uses.map(c => [c.to, c.nodeLabel])).toEqual([['b', 'Call b'], ['c', 'Call c']]);
  expect(a.usedBy.map(c => c.from)).toEqual(['d']);
  expect(workflowDependencies(flows, 'c').usedBy.map(c => c.from)).toEqual(['a', 'b']);
  // a call to a workflow that no longer exists still shows up (the editor marks it)
  expect(workflowDependencies(flows, 'd').uses.map(c => c.to)).toEqual(['a', 'gone']);
});

test('dependencies: an invoker on the error port of another one handles its errors', () => {
  const parent: ExecutableWorkflow = {
    id: 'parent', project: 'P', workflow: 'Parent', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'multiply', type: 'workflow', label: 'Multiply', config: {workflowId: 'mult'}},
      {id: 'handling', type: 'workflow', label: 'Error handling', config: {workflowId: 'errors'}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'multiply', targetPort: 'in-0'},
      {source: 'multiply', sourcePort: 'error', target: 'handling', targetPort: 'in-0'},
    ],
  };
  const [multiply, handling] = workflowCalls([parent]);
  expect(multiply.onErrorOf).toBeUndefined();
  expect(handling).toEqual({from: 'parent', to: 'errors', nodeId: 'handling', nodeLabel: 'Error handling', onErrorOf: 'mult', onErrorOfLabel: 'Multiply'});
});
