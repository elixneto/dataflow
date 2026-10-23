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
