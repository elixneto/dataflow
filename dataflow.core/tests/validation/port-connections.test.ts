import {expect, test} from 'bun:test';
import {connectionProblem, errorEdgeIssues, errorPort, inputPorts, outputPorts, portConnectionIssues, flowRunner} from '../../src/index';
import type {Envelope, ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({source, sourcePort, target, targetPort});
const types: Record<string, string> = {start: 'start', end: 'end', a: 'mapper', b: 'sort', agg: 'aggregate', log: 'log', l: 'lookup', limit: 'limit'};
const typeOf = (id: string) => types[id];

test('ports come from the components: names, single edges, the Router, Start and End', () => {
  expect(outputPorts('filter')).toEqual([{id: 'out-0', label: 'true'}, {id: 'out-1', label: 'false', optional: true}]);
  expect(inputPorts('lookup')).toEqual([{id: 'in-0', label: 'input', single: true}, {id: 'in-1', label: 'lookup', single: true}]);
  expect(outputPorts('router', {cases: [{label: 'BR', condition: 'x'}, {label: '', condition: 'y'}]})).toEqual([
    {id: 'out-0', label: 'BR'}, {id: 'out-1', label: 'case 2'}, {id: 'out-2', label: 'else', optional: true},
  ]);
  expect([inputPorts('start'), outputPorts('start')]).toEqual([[], [{id: 'out-0'}]]);
  expect([inputPorts('end'), outputPorts('end')]).toEqual([[{id: 'in-0'}], []]);
  expect(inputPorts('nope')).toEqual([]);
  expect(inputPorts('copy')).toEqual([]);
  expect(inputPorts('union')).toEqual([]);
});

test("every port takes several edges, except the single ones (Lookup's inputs)", () => {
  expect(portConnectionIssues([
    edge('start', 'out-0', 'a', 'in-0'), edge('start', 'out-0', 'b', 'in-0'),
    edge('a', 'out-0', 'agg', 'in-0'), edge('b', 'out-0', 'agg', 'in-0'), edge('a', 'error', 'log', 'in-0'), edge('a', 'error', 'end', 'in-0'),
    edge('agg', 'out-0', 'end', 'in-0'), edge('log', 'out-0', 'end', 'in-0'),
  ], typeOf)).toEqual([]);

  expect(portConnectionIssues([edge('a', 'out-0', 'l', 'in-1'), edge('b', 'out-0', 'l', 'in-1'), edge('a', 'out-0', 'l', 'in-0')], typeOf)).toEqual([
    {nodeId: 'l', message: 'has input 2 with 2 connections: it takes one only.'},
  ]);
});

test('never Start straight to End, never the same two ports twice', () => {
  expect(portConnectionIssues([edge('start', 'out-0', 'end', 'in-0')], typeOf)).toEqual([
    {nodeId: 'start', message: 'goes straight to the End: put at least one component between them.'},
  ]);
  expect(portConnectionIssues([edge('start', 'out-0', 'a', 'in-0'), edge('start', 'out-0', 'a', 'in-0')], typeOf).map(i => i.message)).toContain(
    'has output 1 connected 2 times to the same input.',
  );
});

test('an edge being drawn: the same rules, one at a time', () => {
  const edges = [edge('start', 'out-0', 'a', 'in-0'), edge('a', 'out-0', 'end', 'in-0'), edge('b', 'out-0', 'l', 'in-1')];
  expect(connectionProblem(edge('start', 'out-0', 'b', 'in-0'), edges, typeOf)).toBeUndefined();
  expect(connectionProblem(edge('a', 'out-0', 'b', 'in-0'), edges, typeOf)).toBeUndefined();
  expect(connectionProblem(edge('b', 'out-0', 'a', 'in-0'), edges, typeOf)).toBeUndefined();
  expect(connectionProblem(edge('a', 'out-0', 'l', 'in-0'), edges, typeOf)).toBeUndefined();
  expect(connectionProblem(edge('a', 'out-0', 'l', 'in-1'), edges, typeOf)).toBe('This input takes one edge only.');
  expect(connectionProblem(edge('start', 'out-0', 'end', 'in-0'), edges, typeOf)).toBe('The Start does not go straight to the End.');
  expect(connectionProblem(edge('start', 'out-0', 'a', 'in-0'), edges, typeOf)).toBe('These two ports are already connected.');
  expect(connectionProblem(edge('a', 'out-0', 'a', 'in-0'), [], typeOf)).toBe('A component does not connect to itself.');
});

test("a run refuses a flow with two edges on one of Lookup's inputs", async () => {
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Crowded', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'a', type: 'limit', label: 'A', config: {count: 1}},
      {id: 'b', type: 'limit', label: 'B', config: {count: 1}},
      {id: 'l', type: 'lookup', label: 'Lookup', config: {keys: [{main: '$x', lookup: '$x'}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      edge('start', 'out-0', 'a', 'in-0'), edge('start', 'out-0', 'b', 'in-0'),
      edge('a', 'out-0', 'l', 'in-0'), edge('a', 'out-0', 'l', 'in-1'), edge('b', 'out-0', 'l', 'in-1'),
      edge('l', 'out-0', 'end', 'in-0'),
    ],
  };
  const r = await flowRunner(wf, {mode: 'execution', id: 'crowded', evaluate});
  expect(r.status).toBe('failed');
  expect(r.error).toBe('"Lookup" has input 2 with 2 connections: it takes one only.');
});
test('a run refuses Start straight to End', async () => {
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Empty', parameters: [],
    nodes: [{id: 'start', type: 'start', label: 'Start', config: {}}, {id: 'end', type: 'end', label: 'End', config: {}}],
    edges: [edge('start', 'out-0', 'end', 'in-0')],
  };
  const r = await flowRunner(wf, {mode: 'execution', id: 'straight', evaluate});
  expect(r.status).toBe('failed');
  expect(r.error).toBe('"Start" goes straight to the End: put at least one component between them.');
});

test("the Start's output to several paths: each gets the same envelopes, in its own copy", async () => {
  const mapper = (id: string, value: string) => ({
    id, type: 'mapper', label: id, config: {fields: [{target: 'path', value, expression: false}]},
  });
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Fan out', parameters: [{name: 'region', type: 'text', default: 'eu'}],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      mapper('a', 'A'), mapper('b', 'B'), mapper('c', 'C'),
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      edge('start', 'out-0', 'a', 'in-0'), edge('start', 'out-0', 'b', 'in-0'), edge('start', 'out-0', 'c', 'in-0'),
      edge('a', 'out-0', 'end', 'in-0'), edge('b', 'out-0', 'end', 'in-0'), edge('c', 'out-0', 'end', 'in-0'),
    ],
  };
  const reached: Envelope[] = [];
  const r = await flowRunner(wf, {mode: 'execution', id: 'fan-out', evaluate, onReachEnd: async doc => void reached.push(doc)});

  expect(r.status).toBe('completed');
  // one envelope each, with the same run and parameters, and each path's own change only
  expect(reached.map(d => d.DATA.path).sort()).toEqual(['A', 'B', 'C']);
  expect(new Set(reached.map(d => d.FLOW_CURRENT_RUN.id))).toEqual(new Set(['fan-out']));
  expect(reached.every(d => d.PARAMETERS.region === 'eu')).toBe(true);
  expect(new Set(reached).size).toBe(3);
});

test("the copies are real: paths that pass the envelope on untouched still deliver three objects, equal in content", async () => {
  const limit = (id: string) => ({id, type: 'limit', label: id, config: {count: 10}});
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Fan out as is', parameters: [],
    nodes: [{id: 'start', type: 'start', label: 'Start', config: {}}, limit('a'), limit('b'), limit('c'), {id: 'end', type: 'end', label: 'End', config: {}}],
    edges: [
      edge('start', 'out-0', 'a', 'in-0'), edge('start', 'out-0', 'b', 'in-0'), edge('start', 'out-0', 'c', 'in-0'),
      edge('a', 'out-0', 'end', 'in-0'), edge('b', 'out-0', 'end', 'in-0'), edge('c', 'out-0', 'end', 'in-0'),
    ],
  };
  const reached: Envelope[] = [];
  const r = await flowRunner(wf, {mode: 'execution', id: 'as-is', evaluate, onReachEnd: async doc => void reached.push(doc)});

  expect(r.status).toBe('completed');
  expect(reached).toHaveLength(3);
  expect(reached[1]).toEqual(reached[0]!);
  expect(reached[2]).toEqual(reached[0]!);
  // three objects: changing one (as a script in one path could) leaves the others as they were
  expect(new Set(reached).size).toBe(3);
  expect(new Set(reached.map(d => d.DATA)).size).toBe(3);
});

test('the error port is there only on Divert (never on Start or End), and a run refuses an edge out of one that is not', async () => {
  expect(errorPort('mapper', {onError: 'divert'})).toEqual({id: 'error'});
  expect(errorPort('mapper', {onError: 'continue'})).toBeUndefined();
  expect(errorPort('mapper')).toBeUndefined();
  expect(errorPort('start', {onError: 'divert'})).toBeUndefined();

  const nodes = {m: {type: 'mapper', config: {onError: 'divert'}}, s: {type: 'sort', config: {}}};
  const nodeOf = (id: string) => nodes[id as keyof typeof nodes];
  expect(errorEdgeIssues([edge('m', 'error', 'log', 'in-0'), edge('s', 'error', 'log', 'in-0')], nodeOf)).toEqual([
    {nodeId: 's', message: 'has an edge out of its error port, but its On error is not Divert.'},
  ]);

  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Error edge', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: []}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'out-0', 'm', 'in-0'), edge('m', 'out-0', 'end', 'in-0'), edge('m', 'error', 'end', 'in-0')],
  };
  const r = await flowRunner(wf, {mode: 'execution', id: 'error-edge', evaluate});
  expect(r.status).toBe('failed');
  expect(r.error).toBe('"Mapper" has an edge out of its error port, but its On error is not Divert.');
});
