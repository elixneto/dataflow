import {expect, test} from 'bun:test';
import {COMPONENTS, flowFromYaml, flowRunner, flowToYaml, toExecutableFlow} from '../../src/index';
import type {ExecutableFlow, FlowFile, HttpResponse, PrepareScript} from '../../src/index';
import {evaluate} from '../helpers';

test('Override is offered by the components that produce data, as in the PoC, and by no other', () => {
  const offered = Object.values(COMPONENTS).filter(c => c.usesOverride).map(c => c.type).sort();
  expect(offered).toEqual(['datagrid', 'flow', 'http-request', 'lookup', 'mapper', 'mongodb-delete', 'mongodb-pipeline', 'mongodb-upsert', 'script', 'sqlserver', 'typescript']);
});

/** Start (one envelope {a: 1}) → the node → End */
const around = (node: ExecutableFlow['nodes'][number]): ExecutableFlow => ({
  project: 'Test', flow: 'Override', parameters: [],
  nodes: [{id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}}, node, {id: 'end', type: 'end', label: 'End', config: {}}],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: node.id, targetPort: 'in-0'},
    {source: node.id, sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});
const output = (r: Awaited<ReturnType<typeof flowRunner>>, id: string) => r.components.find(c => c.nodeId === id)!.outputSample['out-0'];

test('Data Grid: its rows join the envelope; with Override they are the envelope', async () => {
  const grid = (override: boolean) => around({id: 'g', type: 'datagrid', label: 'Grid', override, config: {columns: [{name: 'id', type: 'number'}], rows: [['1']]}});
  expect(output(await flowRunner(grid(false), {mode: 'validation', id: 'g1', evaluate, input: [{a: 1}]}), 'g')).toEqual([{a: 1, id: 1}]);
  expect(output(await flowRunner(grid(true), {mode: 'validation', id: 'g2', evaluate, input: [{a: 1}]}), 'g')).toEqual([{id: 1}]);
});

test('HTTP Request: the answer goes in its key; with Override only the key is left', async () => {
  const http = async (): Promise<HttpResponse> => ({status: 200, headers: {'content-type': 'text/plain'}, body: 'pong'});
  const call = (override: boolean) => around({id: 'h', type: 'http-request', label: 'Ping', override, config: {method: 'GET', url: {value: 'https://example.com/ping', expression: false}}});
  const response = {status: 200, headers: {'content-type': 'text/plain'}, body: 'pong'};
  expect(output(await flowRunner(call(false), {mode: 'validation', id: 'h1', evaluate, http, input: [{a: 1}]}), 'h')).toEqual([{a: 1, response}]);
  expect(output(await flowRunner(call(true), {mode: 'validation', id: 'h2', evaluate, http, input: [{a: 1}]}), 'h')).toEqual([{response}]);
});

test('TypeScript: what process returns goes in its key; with Override the object(s) it returns are the envelopes', async () => {
  const prepareScript: PrepareScript = async () => async () => [{x: 1}, {x: 2}];
  const script = (override: boolean) => around({id: 't', type: 'typescript', label: 'Script', override, config: {code: 'async function process($input) { return []; }'}});
  expect(output(await flowRunner(script(false), {mode: 'validation', id: 't1', evaluate, prepareScript, input: [{a: 1}]}), 't')).toEqual([{a: 1, result: [{x: 1}, {x: 2}]}]);
  expect(output(await flowRunner(script(true), {mode: 'validation', id: 't2', evaluate, prepareScript, input: [{a: 1}]}), 't')).toEqual([{x: 1}, {x: 2}]);
});

test('the flow file keeps Override (off when absent, the behavior flows had so far), and the runner gets it only where the component offers it', () => {
  const file: FlowFile = {
    version: 1, name: 'Override',
    nodes: [
      {id: 'start', type: 'start', position: {x: 0, y: 0}, config: {}},
      {id: 'm', type: 'mapper', position: {x: 160, y: 0}, config: {fields: []}, override: true},
      {id: 'f', type: 'filter', position: {x: 320, y: 0}, config: {}, override: true},
      {id: 'l', type: 'log', position: {x: 480, y: 0}, config: {}},
      {id: 'end', type: 'end', position: {x: 640, y: 0}, config: {}},
    ],
    edges: [],
  };
  const text = flowToYaml(file);
  expect(text).toContain('override: true');
  const back = flowFromYaml(text);
  expect(back.ok && back.value.nodes.map(n => n.override)).toEqual([undefined, true, true, undefined, undefined]);
  const nodes = toExecutableFlow(file, 'p').nodes;
  expect(nodes.find(n => n.id === 'm')!.override).toBe(true);
  expect(nodes.find(n => n.id === 'f')!.override).toBeUndefined();
  expect(nodes.find(n => n.id === 'l')!.override).toBeUndefined();
});
