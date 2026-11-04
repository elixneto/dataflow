import {expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

test('Filter sends each envelope to true or false by the condition', async () => {
  const withFilter: ExecutableFlow = {
    project: 'Test', flow: 'Filter', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'f', type: 'filter', label: 'Filter', config: {condition: '$price > 10'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-1', target: 'end', targetPort: 'in-0'},
    ],
  };
  const input = [{price: 5}, {price: 20}, {price: 30}, {price: 0}, {price: 11}];
  const r = await flowRunner(withFilter, {mode: 'execution', id: 'tf', evaluate, input});
  expect(r.status).toBe('completed');
  const f = r.components.find(c => c.nodeId === 'f')!;
  expect(f.outputs).toEqual({'out-0': 3, 'out-1': 2});
  expect(f.outputSample['out-1']).toEqual([{price: 5}, {price: 0}]);

  // a failing condition is an error of the envelope (default policy: throw)
  withFilter.nodes[1].config = {condition: '$doesNotExist > 1'};
  const withError = await flowRunner(withFilter, {mode: 'execution', id: 'tf2', evaluate, input});
  expect(withError.status).toBe('failed');
});

test('Filter with an unconnected false drops without a warning', async () => {
  const onlyTrue: ExecutableFlow = {
    project: 'Test', flow: 'Filter only true', parameters: [],
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
  const r = await flowRunner(onlyTrue, {mode: 'execution', id: 'tf3', evaluate, input: [{price: 5}, {price: 20}]});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'f')!.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(1);
});
