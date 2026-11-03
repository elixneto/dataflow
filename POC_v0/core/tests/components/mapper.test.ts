import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate, mapperFlow} from '../helpers';

test('mapper concatenates a parameter with startedAt', async () => {
  const r = await workflowRunner(mapperFlow, {mode: 'validation', id: 'test', evaluate, parameterValues: {prefix: 'ABC'}});
  expect(r.status).toBe('completed');
  const m = r.components.find(c => c.nodeId === 'm')!;
  expect(m.inputs['in-0']).toBe(1);
  expect(m.outputs['out-0']).toBe(1);
  const output = m.outputSample['out-0'][0] as {value: string; fixed: string};
  expect(output.value).toBe(`ABC-${r.run.startedAt}`);
  expect(output.fixed).toBe('plain text');
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(1);
});

test('mapper writes directly into the envelope and the next one sees it', async () => {
  const twoMappers: ExecutableWorkflow = {
    project: 'Test', workflow: 'Two mappers', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm1', type: 'mapper', label: 'Mapper 1', config: {fields: [{target: 'field', value: 'PINEAPPLE', expression: false}]}},
      {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 'otherField', value: '$field + " 123"', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'm1', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'out-0', target: 'm2', targetPort: 'in-0'},
      {source: 'm2', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const r = await workflowRunner(twoMappers, {mode: 'validation', id: 't4', evaluate});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'm2')!.outputSample['out-0'][0]).toEqual({field: 'PINEAPPLE', otherField: 'PINEAPPLE 123'});

  // Override on the second one: only what it mapped
  twoMappers.nodes[2].override = true;
  const r2 = await workflowRunner(twoMappers, {mode: 'validation', id: 't5', evaluate});
  expect(r2.components.find(c => c.nodeId === 'm2')!.outputSample['out-0'][0]).toEqual({otherField: 'PINEAPPLE 123'});
});
