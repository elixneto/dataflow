import {expect, test} from 'bun:test';
import {workflowRunner} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate, mapperFlow} from '../helpers';

test('the record comes in flow order, not node order', async () => {
  const shuffled = {...mapperFlow, nodes: [mapperFlow.nodes[2], mapperFlow.nodes[1], mapperFlow.nodes[0]]};
  const r = await workflowRunner(shuffled, {mode: 'validation', id: 't3', evaluate});
  expect(r.components.map(c => c.nodeId)).toEqual(['start', 'm', 'end']);
});

test('a Start that accepts input puts the body in the envelope; without the option, it fails', async () => {
  const withInput = structuredClone(mapperFlow);
  withInput.nodes[0].config = {acceptsInput: true};
  withInput.nodes[1].config = {fields: [{target: 'greeting', value: '"Hello " + $name', expression: true}]};
  const r = await workflowRunner(withInput, {mode: 'validation', id: 't6', evaluate, input: {name: 'Élix'}});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'm')!.outputSample['out-0'][0]).toEqual({name: 'Élix', greeting: 'Hello Élix'});

  const withoutOption = await workflowRunner(mapperFlow, {mode: 'validation', id: 't7', evaluate, input: {name: 'x'}});
  expect(withoutOption.status).toBe('failed');
  expect(withoutOption.error).toContain('does not accept input');
});

test('an array input fires one envelope per item', async () => {
  const withInput = structuredClone(mapperFlow);
  withInput.nodes[0].config = {acceptsInput: true};
  withInput.nodes[1].config = {fields: [{target: 'greeting', value: '"Hello " + $name', expression: true}]};
  const r = await workflowRunner(withInput, {mode: 'validation', id: 't8', evaluate, input: [{name: 'Élix 1'}, {name: 'Élix 2'}]});
  expect(r.status).toBe('completed');
  const start = r.components.find(c => c.nodeId === 'start')!;
  expect(start.inputs['in-0']).toBe(2);
  expect(start.outputs['out-0']).toBe(2);
  const m = r.components.find(c => c.nodeId === 'm')!;
  expect(m.outputSample['out-0']).toEqual([{name: 'Élix 1', greeting: 'Hello Élix 1'}, {name: 'Élix 2', greeting: 'Hello Élix 2'}]);
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(2);
});

test('a cycle in the edges does not run (infinite loop)', async () => {
  const withCycle: ExecutableWorkflow = {
    project: 'Test', workflow: 'Cycle', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'union', type: 'union', label: 'Union', config: {inputCount: 2}},
      {id: 'm1', type: 'mapper', label: 'Mapper 1', config: {onError: 'divert', fields: [{target: 'x', value: '$y.z', expression: true}]}},
      {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 's', value: 'ERROR', expression: false}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'union', targetPort: 'in-0'},
      {source: 'union', sourcePort: 'out-0', target: 'm1', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'error', target: 'm2', targetPort: 'in-0'},
      {source: 'm2', sourcePort: 'out-0', target: 'union', targetPort: 'in-1'},
    ],
  };
  const r = await workflowRunner(withCycle, {mode: 'execution', id: 't13', evaluate});
  expect(r.status).toBe('failed');
  expect(r.error).toContain('Union → Mapper 1 → Mapper 2 → Union');
});

test('run cancelled by the signal', async () => {
  const control = new AbortController();
  control.abort();
  const r = await workflowRunner(mapperFlow, {mode: 'execution', id: 't14', evaluate, signal: control.signal});
  expect(r.status).toBe('failed');
  expect(r.error).toBe('Run cancelled.');
});

test('End accepts several edges into the same input', async () => {
  const twoPaths: ExecutableWorkflow = {
    project: 'Test', workflow: 'End with several edges', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'f', type: 'filter', label: 'Filter', config: {condition: '$n > 2'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-1', target: 'end', targetPort: 'in-0'},
    ],
  };
  const input = Array.from({length: 100}, (_, i) => ({n: i}));
  const r = await workflowRunner(twoPaths, {mode: 'execution', id: 'te', evaluate, input});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(100);
});
