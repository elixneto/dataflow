import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

test('Filter sends each envelope to true or false by the condition', async () => {
  const withFilter: ExecutableWorkflow = {
    project: 'Test', workflow: 'Filter', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'f', type: 'filter', label: 'Filter', config: {condition: '$price > 10'}},
      {id: 'u', type: 'union', label: 'Union', config: {inputCount: 2}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-0', target: 'u', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-1', target: 'u', targetPort: 'in-1'},
      {source: 'u', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const input = [{price: 5}, {price: 20}, {price: 30}, {price: 0}, {price: 11}];
  const r = await workflowRunner(withFilter, {mode: 'execution', id: 'tf', evaluate, input});
  expect(r.status).toBe('completed');
  const f = r.components.find(c => c.nodeId === 'f')!;
  expect(f.outputs).toEqual({'out-0': 3, 'out-1': 2});
  expect(f.outputSample['out-1']).toEqual([{price: 5}, {price: 0}]);

  // a failing condition is an error of the envelope (default policy: stop)
  withFilter.nodes[1].config = {condition: '$doesNotExist > 1'};
  const withError = await workflowRunner(withFilter, {mode: 'execution', id: 'tf2', evaluate, input});
  expect(withError.status).toBe('failed');
});

test('Filter with an unconnected false drops without a warning', async () => {
  const onlyTrue: ExecutableWorkflow = {
    project: 'Test', workflow: 'Filter only true', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'f', type: 'filter', label: 'Filter', config: {condition: '$price > 10'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const r = await workflowRunner(onlyTrue, {mode: 'execution', id: 'tf3', evaluate, input: [{price: 5}, {price: 20}]});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'f')!.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(1);
});
