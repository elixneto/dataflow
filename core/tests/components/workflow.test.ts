import {describe, expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

describe('Workflow Invoker', () => {
  const edge = (source: string, target: string, sourcePort = 'out-0') => ({source, sourcePort, target, targetPort: 'in-0'});
  // B: receives the envelope and multiplies by the parameter
  const multiply: ExecutableWorkflow = {
    id: 'B', project: 'Test', workflow: 'Multiply', parameters: [{name: 'times', type: 'number', default: '1'}],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'total', value: '$n * $PARAMETERS.times', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'm'), edge('m', 'end')],
  };
  // C: always fails
  const breaks: ExecutableWorkflow = {
    id: 'C', project: 'Test', workflow: 'Breaks', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'x', value: '$doesNotExist.y', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'm'), edge('m', 'end')],
  };
  const parent = (workflowId: string, onError = 'stop'): ExecutableWorkflow => ({
    id: 'A', project: 'Test', workflow: 'Parent', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'g', type: 'datagrid', label: 'Numbers', config: {columns: [{name: 'n', type: 'number'}], rows: [['1'], ['2']]}},
      {id: 'w', type: 'workflow', label: 'Calls', config: {
        workflowId, sendEnvelope: true, onError,
        parameters: [{name: 'times', value: '$n + 1', expression: true}],
      }},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'g'), edge('g', 'w'), edge('w', 'end'), edge('w', 'end', 'error')],
  });
  const workflows = {B: multiply, C: breaks};

  test('calls the other workflow per envelope, with the parameters and the input, and returns what reaches its End', async () => {
    const r = await workflowRunner(parent('B'), {mode: 'execution', id: 'parent', evaluate, workflows});
    expect(r.status).toBe('completed');
    const w = r.components.find(c => c.nodeId === 'w')!;
    // n = 1 → times 2 → total 2; n = 2 → times 3 → total 6
    expect(w.outputSample['out-0']).toEqual([{n: 1, total: 2}, {n: 2, total: 6}]);
    expect(w.subRuns?.map(s => [s.workflow, s.status])).toEqual([['Multiply', 'completed'], ['Multiply', 'completed']]);
  });

  test('a failing workflow is an error of the envelope (Divert sends it to the error port)', async () => {
    const stopped = await workflowRunner(parent('C'), {mode: 'execution', id: 'p1', evaluate, workflows});
    expect(stopped.status).toBe('failed');
    expect(stopped.error).toContain('The workflow "Breaks" failed');
    const diverted = await workflowRunner(parent('C', 'divert'), {mode: 'execution', id: 'p2', evaluate, workflows});
    expect(diverted.status).toBe('completed');
    expect(diverted.components.find(c => c.nodeId === 'w')!.outputs['error']).toBe(2);
  });

  test('a circular call is blocked', async () => {
    const circular = await workflowRunner(parent('A'), {mode: 'execution', id: 'p3', evaluate, workflows: {...workflows, A: parent('A')}});
    expect(circular.status).toBe('failed');
    expect(circular.error).toContain('Circular workflow call: Parent → Parent');
  });
});
