import {describe, expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

describe('Flow Invoker', () => {
  const edge = (source: string, target: string, sourcePort = 'out-0') => ({source, sourcePort, target, targetPort: 'in-0'});
  // B: receives the envelope and multiplies by the parameter
  const multiply: ExecutableFlow = {
    id: 'B', project: 'Test', flow: 'Multiply', parameters: [{name: 'times', type: 'number', default: '1'}],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'total', value: '$n * $PARAMETERS.times', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'm'), edge('m', 'end')],
  };
  // C: always fails
  const breaks: ExecutableFlow = {
    id: 'C', project: 'Test', flow: 'Breaks', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'x', value: '$doesNotExist.y', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'm'), edge('m', 'end')],
  };
  const parent = (flowId: string, onError = 'throw'): ExecutableFlow => ({
    id: 'A', project: 'Test', flow: 'Parent', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'g', type: 'datagrid', label: 'Numbers', config: {columns: [{name: 'n', type: 'number'}], rows: [['1'], ['2']]}},
      {id: 'w', type: 'flow', label: 'Calls', config: {
        flowId, sendEnvelope: true, onError,
        parameters: [{name: 'times', value: '$n + 1', expression: true}],
      }},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    // the error port only exists on Divert (a run refuses an edge out of it otherwise)
    edges: [edge('start', 'g'), edge('g', 'w'), edge('w', 'end'), ...(onError === 'divert' ? [edge('w', 'end', 'error')] : [])],
  });
  const flows = {B: multiply, C: breaks};

  test('calls the other flow per envelope, with the parameters and the input, and returns what reaches its End', async () => {
    const r = await flowRunner(parent('B'), {mode: 'execution', id: 'parent', evaluate, flows});
    expect(r.status).toBe('completed');
    const w = r.components.find(c => c.nodeId === 'w')!;
    // n = 1 → times 2 → total 2; n = 2 → times 3 → total 6
    expect(w.outputSample['out-0']).toEqual([{n: 1, total: 2}, {n: 2, total: 6}]);
    expect(w.subRuns?.map(s => [s.flow, s.status])).toEqual([['Multiply', 'completed'], ['Multiply', 'completed']]);
  });

  test('a failing flow is an error of the envelope (Divert sends it to the error port)', async () => {
    const stopped = await flowRunner(parent('C'), {mode: 'execution', id: 'p1', evaluate, flows});
    expect(stopped.status).toBe('failed');
    expect(stopped.error).toContain('The flow "Breaks" failed');
    const diverted = await flowRunner(parent('C', 'divert'), {mode: 'execution', id: 'p2', evaluate, flows});
    expect(diverted.status).toBe('completed');
    expect(diverted.components.find(c => c.nodeId === 'w')!.outputs['error']).toBe(2);
  });

  test('a circular call is blocked', async () => {
    const circular = await flowRunner(parent('A'), {mode: 'execution', id: 'p3', evaluate, flows: {...flows, A: parent('A')}});
    expect(circular.status).toBe('failed');
    expect(circular.error).toContain('Circular flow call: Parent → Parent');
  });
});
