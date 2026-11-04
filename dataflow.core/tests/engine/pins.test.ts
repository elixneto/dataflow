import {describe, expect, test} from 'bun:test';
import {applyRunFrom, flowRunner, planRunFrom} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

const edge = (source: string, target: string, sourcePort = 'out-0', targetPort = 'in-0') => ({source, sourcePort, target, targetPort});

/** Start → Mapper 1 (fails without $a) → Mapper 2 (doubles) → End */
const chain = (): ExecutableFlow => ({
  project: 'Test', flow: 'Pins', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'm1', type: 'mapper', label: 'Mapper 1', config: {fields: [{target: 'b', value: '$a.x', expression: true}]}},
    {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 'double', value: '$b * 2', expression: true}]}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [edge('start', 'm1'), edge('m1', 'm2'), edge('m2', 'end')],
});

test('in a test run, a pinned node replays its output without executing; what only feeds it is skipped', async () => {
  const wf = chain();
  // without the pin, Mapper 1 fails ($a does not exist)
  expect((await flowRunner(wf, {mode: 'validation', id: 'p0', evaluate})).status).toBe('failed');

  wf.nodes[1].pinned = {'out-0': [{b: 1}, {b: 2}, {b: 3}]};
  const r = await flowRunner(wf, {mode: 'validation', id: 'p1', evaluate});
  expect(r.status).toBe('completed');
  const byId = (id: string) => r.components.find(c => c.nodeId === id)!;
  // the Start only fed the pinned Mapper: it did not run
  expect(byId('start').status).toBe('skipped');
  expect(byId('start').outputs).toEqual({});
  expect(byId('m1').status).toBe('pinned');
  expect(byId('m1').inputs).toEqual({});
  expect(byId('m1').outputs['out-0']).toBe(3);
  expect(byId('m2').outputSample['out-0']).toEqual([{b: 1, double: 2}, {b: 2, double: 4}, {b: 3, double: 6}]);
  expect(byId('end').inputs['in-0']).toBe(3);
});

test('a real run ignores the pin and executes the node', async () => {
  const wf = chain();
  wf.nodes[1].pinned = {'out-0': [{b: 1}]};
  const r = await flowRunner(wf, {mode: 'execution', id: 'p3', evaluate});
  expect(r.status).toBe('failed');
  expect(r.components.find(c => c.nodeId === 'm1')!.status).toBe('failed');
});

test('a node that feeds a pinned node and a running one still runs, and the pinned one drops its input', async () => {
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Pins and fan-out', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'c', type: 'limit', label: 'All', config: {count: 1000}},
      {id: 'p', type: 'mapper', label: 'Pinned', config: {fields: [{target: 'x', value: '1', expression: true}]}, pinned: {'out-0': [{pinned: true}]}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'x', value: '2', expression: true}]}},
      {id: 'u', type: 'limit', label: 'Join', config: {count: 1000}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    // c's output to both p and m; p and m into u's one input
    edges: [edge('start', 'c'), edge('c', 'p'), edge('c', 'm'), edge('p', 'u'), edge('m', 'u'), edge('u', 'end')],
  };
  // more envelopes than a channel holds: the pinned node must keep reading so the fan-out does not get stuck
  const input = Array.from({length: 300}, (_, i) => ({i}));
  const r = await flowRunner(wf, {mode: 'validation', id: 'p2', evaluate, input});
  expect(r.status).toBe('completed');
  const byId = (id: string) => r.components.find(c => c.nodeId === id)!;
  expect(byId('c').status).toBe('completed');
  expect(byId('p').inputs['in-0']).toBe(300);
  expect(byId('p').outputs['out-0']).toBe(1);
  expect(byId('u').outputs['out-0']).toBe(301);
});

test('skipped: only what feeds nothing but pins; a branch that reaches the End still runs', async () => {
  const {skippedNodes} = await import('../../src/index');
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Skip', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'a', type: 'mapper', label: 'A', config: {fields: []}},
      {id: 'http', type: 'mapper', label: 'HTTP', config: {fields: []}, pinned: {'out-0': [{x: 1}]}},
      {id: 'b', type: 'mapper', label: 'B', config: {fields: []}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    // start → a → http (pinned) → end; start → b → end
    edges: [edge('start', 'a'), edge('a', 'http'), edge('http', 'end'), edge('start', 'b'), edge('b', 'end')],
  };
  expect([...skippedNodes(wf, 'validation')]).toEqual(['a']);
  expect([...skippedNodes({...wf, edges: wf.edges.filter(e => e.source !== 'b' && e.target !== 'b')}, 'validation')].sort()).toEqual(['a', 'start']);
  // a real run ignores pins: nothing skipped
  expect([...skippedNodes(wf, 'execution')]).toEqual([]);
});

describe('Run from here', () => {
  /** like the editor's test flow: Start → Split → Is big? (true) → Log → End, and a Lookup with two inputs */
  const flow = (): ExecutableFlow => ({
    project: 'Test', flow: 'From here', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'split', type: 'split', label: 'Split', config: {list: '$items'}},
      {id: 'big', type: 'filter', label: 'Is big?', config: {condition: '$n > 1'}},
      {id: 'log', type: 'log', label: 'Log', config: {level: 'info', message: '"item " + $n'}},
      {id: 'rows', type: 'datagrid', label: 'Rows', config: {columns: [{name: 'k', type: 'number'}, {name: 'name', type: 'text'}], rows: [['2', 'two'], ['3', 'three']]}},
      {id: 'lookup', type: 'lookup', label: 'Lookup', config: {keys: [{main: '$n', lookup: '$k'}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      edge('start', 'split'), edge('split', 'big'), edge('big', 'log'), edge('log', 'lookup'),
      edge('start', 'rows'), edge('rows', 'lookup', 'out-0', 'in-1'), edge('lookup', 'end'),
    ],
  });
  const ranOnce = async () => {
    const wf = flow();
    const first = await flowRunner(wf, {mode: 'validation', id: 'r1', evaluate, input: [{items: [{n: 1}, {n: 2}, {n: 3}]}]});
    return {wf, first};
  };

  test('only the component and what follows it run, from what reached it last time; nothing before it is in the record', async () => {
    const {wf, first} = await ranOnce();
    expect(first.status).toBe('completed');
    const planned = planRunFrom(wf, 'log', first.components);
    if (!planned.ok) throw new Error(planned.error);
    expect(planned.plan).toEqual({nodeId: 'log', label: 'Log', inputs: {'in-0': [{n: 2}, {n: 3}]}, totals: {'in-0': 2}});

    const r = await flowRunner(applyRunFrom(wf, planned.plan), {mode: 'validation', id: 'r2', evaluate, runFrom: planned.plan});
    expect(r.from).toEqual({nodeId: 'log', label: 'Log'});
    // the record is this run only: Log and what follows it
    expect(r.components.map(c => c.nodeId).sort()).toEqual(['end', 'log', 'lookup']);
    const log = r.components.find(c => c.nodeId === 'log')!;
    expect(log.inputs).toEqual({'in-0': 2});
    expect(log.logs[0]!.message).toBe('Run from here: Log.');
    // the Lookup's other input came from outside the part (Rows did not run): it got nothing, so nothing matched
    const lookup = r.components.find(c => c.nodeId === 'lookup')!;
    expect(lookup.inputs).toEqual({'in-0': 2});
    expect(lookup.outputSample['out-0']).toEqual([{n: 2, lookup: null}, {n: 3, lookup: null}]);
  });

  test('a component with several inputs gets each one back on its own input', async () => {
    const {wf, first} = await ranOnce();
    const lookup = first.components.find(c => c.nodeId === 'lookup')!;
    expect(Object.keys(lookup.inputSampleByPort ?? {}).sort()).toEqual(['in-0', 'in-1']);
    const planned = planRunFrom(wf, 'lookup', first.components);
    if (!planned.ok) throw new Error(planned.error);
    expect(planned.plan.totals).toEqual({'in-0': 2, 'in-1': 2});
    const r = await flowRunner(applyRunFrom(wf, planned.plan), {mode: 'validation', id: 'r3', evaluate, runFrom: planned.plan});
    expect(r.components.find(c => c.nodeId === 'lookup')!.outputs['out-0']).toBe(lookup.outputs['out-0']);
    expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(first.components.find(c => c.nodeId === 'end')!.inputs['in-0']);
  });

  test('also in a real run', async () => {
    const {wf, first} = await ranOnce();
    const planned = planRunFrom(wf, 'log', first.components);
    if (!planned.ok) throw new Error(planned.error);
    const r = await flowRunner(applyRunFrom(wf, planned.plan), {mode: 'execution', id: 'r4', evaluate, runFrom: planned.plan});
    expect(r.status).toBe('completed');
    expect(r.components.find(c => c.nodeId === 'log')!.inputs['in-0']).toBe(2);
  });

  test('refused when nothing reached it last time; more envelopes than a run keeps are said', async () => {
    const {wf, first} = await ranOnce();
    expect(planRunFrom(wf, 'log', [])).toEqual({ok: false, error: 'Nothing reached "Log" in the last run: run the flow first.'});
    expect(planRunFrom(wf, 'nope', first.components)).toEqual({ok: false, error: 'The component is not in the flow.'});

    const cut = first.components.map(c => (c.nodeId === 'log' ? {...c, inputs: {'in-0': 120}} : c));
    const planned = planRunFrom(wf, 'log', cut);
    if (!planned.ok) throw new Error(planned.error);
    const r = await flowRunner(applyRunFrom(wf, planned.plan), {mode: 'validation', id: 'r5', evaluate, runFrom: planned.plan});
    expect(r.components.find(c => c.nodeId === 'log')!.logs.map(l => l.message)).toContain('Only the first 2 of the 120 envelopes that reached in-0 in the last run came in: a run keeps 2 per port.');
  });
});
