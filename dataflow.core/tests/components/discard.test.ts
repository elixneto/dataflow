import {expect, test} from 'bun:test';
import {
  COMPONENTS, componentSummary, connectionProblem, flowFromYaml, flowRunner, flowToYaml, inputPorts, newFlowFile, outputPorts, writingComponents,
  type ExecutableFlow,
} from '../../src/index';
import {evaluate} from '../helpers';

const flow = (condition: string): ExecutableFlow => ({
  project: 'Test', flow: 'Discard', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
    {id: 'f', type: 'filter', label: 'Keep', config: {condition}},
    {id: 'd', type: 'discard', label: 'Discard', config: {}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
    {source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    {source: 'f', sourcePort: 'out-1', target: 'd', targetPort: 'in-0'},
  ],
});

test('Discard: one input (it takes several edges), no output, nothing to set, writes nothing outside the flow', () => {
  expect(inputPorts('discard')).toEqual([{id: 'in-0'}]);
  expect(outputPorts('discard')).toEqual([]);
  expect(COMPONENTS.discard?.validate({})).toEqual([]);
  expect(componentSummary('discard', {})).toEqual([{title: 'Discard', lines: [{value: 'Drops every envelope'}]}]);
  const typeOf = (id: string) => ({a: 'mapper', b: 'mapper', d: 'discard'})[id];
  const into = (source: string) => ({source, sourcePort: 'out-0', target: 'd', targetPort: 'in-0'});
  expect(connectionProblem(into('b'), [into('a')], typeOf)).toBeUndefined();
  expect(writingComponents({...newFlowFile('x'), nodes: [{id: 'd', type: 'discard', position: {x: 0, y: 0}, config: {}}]})).toEqual([]);
});

test('a run: the envelopes that reach a Discard are dropped and counted; the others go on', async () => {
  const r = await flowRunner(flow('$n > 1'), {mode: 'execution', id: 'd1', evaluate, input: [{n: 1}, {n: 2}, {n: 3}]});
  const d = r.components.find(c => c.nodeId === 'd')!;
  expect(d.inputs).toEqual({'in-0': 1});
  expect(d.outputs).toEqual({});
  expect(d.logs.map(l => l.message)).toEqual(['1 envelope(s) discarded.']);
  expect(r.components.find(c => c.nodeId === 'end')!.inputs).toEqual({'in-0': 2});
  expect(r.status).toBe('completed');
});

test('everything discarded on purpose: no "No envelope reached the End" warning', async () => {
  const r = await flowRunner(flow('false'), {mode: 'execution', id: 'd2', evaluate, input: [{n: 1}, {n: 2}]});
  expect(r.components.find(c => c.nodeId === 'd')!.inputs).toEqual({'in-0': 2});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'end')!.logs.filter(l => l.level === 'warning')).toEqual([]);
});

test('a flow with a Discard goes to YAML and back', () => {
  const file = {...newFlowFile('With discard'), nodes: [...newFlowFile('x').nodes, {id: 'd', type: 'discard', position: {x: 320, y: 160}, config: {}}],
    edges: [{source: 'start', sourcePort: 'out-0', target: 'd', targetPort: 'in-0'}]};
  expect(flowFromYaml(flowToYaml(file))).toEqual({ok: true, value: file});
});
