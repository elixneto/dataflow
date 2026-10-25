import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

test('copy sends each envelope to every output, and one path does not touch the other', async () => {
  const withCopy: ExecutableWorkflow = {
    project: 'Test', workflow: 'Copy', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'c', type: 'copy', label: 'Copy', config: {outputCount: 3}},
      {id: 'ts', type: 'typescript', label: 'Changes', override: true, config: {code: 'async function process($input) {}'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'c', targetPort: 'in-0'},
      {source: 'c', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'},
      {source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'c', sourcePort: 'out-1', target: 'end', targetPort: 'in-0'},
      {source: 'c', sourcePort: 'out-2', target: 'end', targetPort: 'in-0'},
    ],
  };
  // the script changes its own $input (which one path must not see in the other)
  const prepareScript = async () => async (input: unknown) => {
    (input as {person: {name: string}}).person.name = 'CHANGED';
    return input;
  };
  const r = await workflowRunner(withCopy, {
    mode: 'execution', id: 'copy', evaluate, prepareScript, input: [{person: {name: 'ana'}}, {person: {name: 'bia'}}],
  });
  expect(r.status).toBe('completed');
  const c = r.components.find(x => x.nodeId === 'c')!;
  expect(c.outputs).toEqual({'out-0': 2, 'out-1': 2, 'out-2': 2});
  expect(r.components.find(x => x.nodeId === 'end')!.inputs['in-0']).toBe(6);
  expect(c.outputSample['out-1']).toEqual([{person: {name: 'ana'}}, {person: {name: 'bia'}}]);
  const namesAtEnd = r.components.find(x => x.nodeId === 'end')!.inputSample.map(d => (d as {person: {name: string}}).person.name);
  expect(namesAtEnd.filter(n => n === 'CHANGED')).toHaveLength(2);
});
