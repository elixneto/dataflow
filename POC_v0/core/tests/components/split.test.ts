import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

test('split undoes an aggregate and a value that is not a list is an error of the envelope', async () => {
  const roundTrip: ExecutableWorkflow = {
    project: 'Test', workflow: 'Split', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'ag', type: 'aggregate', label: 'Aggregate', config: {size: 3}},
      {id: 'sp', type: 'split', label: 'Split', config: {list: '$items'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'ag', targetPort: 'in-0'},
      {source: 'ag', sourcePort: 'out-0', target: 'sp', targetPort: 'in-0'},
      {source: 'sp', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const input = Array.from({length: 7}, (_, i) => ({id: i}));
  const r = await workflowRunner(roundTrip, {mode: 'execution', id: 'split', evaluate, input});
  expect(r.status).toBe('completed');
  const sp = r.components.find(c => c.nodeId === 'sp')!;
  expect(sp.inputs['in-0']).toBe(3);
  expect(sp.outputs['out-0']).toBe(7);
  expect(sp.outputSample['out-0'].slice(0, 4)).toEqual([{id: 0}, {id: 1}, {id: 2}, {id: 3}]);

  // a value that is not a list (or a list with something else) is an error of the envelope, diverted to the error port
  const direct: ExecutableWorkflow = {
    project: 'Test', workflow: 'Split errors', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'sp', type: 'split', label: 'Split', config: {onError: 'divert', list: '$items'}},
      {id: 'handle', type: 'mapper', label: 'Handle error', config: {fields: [{target: 'status', value: 'ERROR', expression: false}]}},
      {id: 'union', type: 'union', label: 'Union', config: {inputCount: 2}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'sp', targetPort: 'in-0'},
      {source: 'sp', sourcePort: 'out-0', target: 'union', targetPort: 'in-0'},
      {source: 'sp', sourcePort: 'error', target: 'handle', targetPort: 'in-0'},
      {source: 'handle', sourcePort: 'out-0', target: 'union', targetPort: 'in-1'},
      {source: 'union', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const diverted = await workflowRunner(direct, {mode: 'execution', id: 'split2', evaluate, input: [{items: 'x'}, {items: [{a: 1}, 2]}, {items: []}, {items: [{a: 2}]}]});
  expect(diverted.status).toBe('completed');
  const handled = diverted.components.find(c => c.nodeId === 'handle')!;
  expect(handled.inputs['in-0']).toBe(2);
  expect(handled.inputSample.map(d => (d.errors as {message: string}[])[0].message)).toEqual(['$items is not a list (string).', '$items[1] is not an object.']);
  expect(diverted.components.find(c => c.nodeId === 'sp')!.outputSample['out-0']).toEqual([{a: 2}]);
});
