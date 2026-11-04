import {expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

test('an output with several edges sends each envelope to every path, and one path does not touch the other', async () => {
  const fanOut: ExecutableFlow = {
    project: 'Test', flow: 'Fan out', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'x', type: 'limit', label: 'All', config: {count: 100}},
      {id: 'ts', type: 'typescript', label: 'Changes', override: true, config: {code: 'async function process($input) {}'}},
      {id: 'y', type: 'limit', label: 'Path 2', config: {count: 100}},
      {id: 'z', type: 'limit', label: 'Path 3', config: {count: 100}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'x', targetPort: 'in-0'},
      {source: 'x', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'},
      {source: 'x', sourcePort: 'out-0', target: 'y', targetPort: 'in-0'},
      {source: 'x', sourcePort: 'out-0', target: 'z', targetPort: 'in-0'},
      {source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'y', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'z', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  // the script changes its own $input (which the other paths must not see)
  const prepareScript = async () => async (input: unknown) => {
    (input as {person: {name: string}}).person.name = 'CHANGED';
    return input;
  };
  const r = await flowRunner(fanOut, {
    mode: 'execution', id: 'fan-out', evaluate, prepareScript, input: [{person: {name: 'ana'}}, {person: {name: 'bia'}}],
  });
  expect(r.status).toBe('completed');
  // the port counts each envelope once; each path got all of them
  expect(r.components.find(x => x.nodeId === 'x')!.outputs).toEqual({'out-0': 2});
  for (const path of ['ts', 'y', 'z']) expect(r.components.find(x => x.nodeId === path)!.inputs['in-0']).toBe(2);
  expect(r.components.find(x => x.nodeId === 'y')!.outputSample['out-0']).toEqual([{person: {name: 'ana'}}, {person: {name: 'bia'}}]);
  // an input with several edges takes them all (in arrival order)
  expect(r.components.find(x => x.nodeId === 'end')!.inputs['in-0']).toBe(6);
  const namesAtEnd = r.components.find(x => x.nodeId === 'end')!.inputSample.map(d => (d as {person: {name: string}}).person.name);
  expect(namesAtEnd.filter(n => n === 'CHANGED')).toHaveLength(2);
});

test('an input with several edges joins the paths, in arrival order, and ends when all of them end', async () => {
  const fanIn: ExecutableFlow = {
    project: 'Test', flow: 'Fan in', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'f', type: 'filter', label: 'Filter', config: {condition: '$price > 10'}},
      {id: 'sort', type: 'sort', label: 'Sort', config: {keys: [{value: '$price', direction: 'asc'}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-0', target: 'sort', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-1', target: 'sort', targetPort: 'in-0'},
      {source: 'sort', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const r = await flowRunner(fanIn, {mode: 'execution', id: 'fan-in', evaluate, input: [{price: 5}, {price: 20}, {price: 30}, {price: 0}]});
  expect(r.status).toBe('completed');
  const sort = r.components.find(x => x.nodeId === 'sort')!;
  expect(sort.inputs['in-0']).toBe(4);
  expect(sort.outputSample['out-0']).toEqual([{price: 0}, {price: 5}, {price: 20}, {price: 30}]);
});
