import {describe, expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

describe('Flow Invoker', () => {
  const edge = (source: string, target: string, sourcePort = 'out-0') => ({source, sourcePort, target, targetPort: 'in-0'});
  // B: receives the envelope and multiplies by the parameter
  const multiply: ExecutableFlow = {
    id: 'B', project: 'Test', flow: 'Multiply', parameters: [{name: 'times', type: 'number', default: '1'}],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'total', value: '$n * $PARAMETERS.times', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'm'), edge('m', 'end')],
  };
  // C: always fails
  const breaks: ExecutableFlow = {
    id: 'C', project: 'Test', flow: 'Breaks', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'x', value: '$doesNotExist.y', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'm'), edge('m', 'end')],
  };
  const parent = (flowId: string, onError = 'throw'): ExecutableFlow => ({
    id: 'A', project: 'Test', flow: 'Parent', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'g', type: 'datagrid', label: 'Numbers', config: {columns: [{name: 'n', type: 'number'}], rows: [['1'], ['2']]}},
      {id: 'w', type: 'flow', label: 'Calls', config: {
        flowId, sendEnvelope: true, onError,
        parameters: [{name: 'times', value: '$n + 1', expression: true}],
      }},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    // the error port only exists on Divert (a run refuses an edge out of it otherwise)
    edges: [edge('start', 'g'), edge('g', 'w'), edge('w', 'end'), ...(onError === 'divert' ? [edge('w', 'end', 'error')] : [])],
  });
  const flows = {B: multiply, C: breaks};

  test('calls the other flow per envelope, with the parameters and the input, and returns what reaches its End', async () => {
    const r = await flowRunner(parent('B'), {mode: 'execution', id: 'parent', evaluate, flows});
    expect(r.status).toBe('completed');
    const w = r.components.find(c => c.nodeId === 'w')!;
    // n = 1 → times 2 → total 2; n = 2 → times 3 → total 6
    expect(w.outputSample['out-0']).toEqual([{n: 1, total: 2}, {n: 2, total: 6}]);
    expect(w.subRuns?.map(s => [s.flow, s.status])).toEqual([['Multiply', 'completed'], ['Multiply', 'completed']]);
  });

  test('a failing flow is an error of the envelope (Divert sends it to the error port)', async () => {
    const stopped = await flowRunner(parent('C'), {mode: 'execution', id: 'p1', evaluate, flows});
    expect(stopped.status).toBe('failed');
    expect(stopped.error).toContain('The flow "Breaks" failed');
    const diverted = await flowRunner(parent('C', 'divert'), {mode: 'execution', id: 'p2', evaluate, flows});
    expect(diverted.status).toBe('completed');
    expect(diverted.components.find(c => c.nodeId === 'w')!.outputs['error']).toBe(2);
  });

  test('a circular call is blocked, with the chain: a flow calling itself, or one that calls back the run\'s own flow (not among the callable ones)', async () => {
    const circular = await flowRunner(parent('A'), {mode: 'execution', id: 'p3', evaluate, flows: {...flows, A: parent('A')}});
    expect(circular.status).toBe('failed');
    expect(circular.error).toContain('Circular flow call: Parent → Parent');
    // D calls A (the root): the server does not put the root among the flows a run can call
    const back: ExecutableFlow = {...multiply, id: 'D', flow: 'Back', nodes: multiply.nodes.map(n => n.id === 'm'
      ? {id: 'w', type: 'flow', label: 'Calls', config: {flowId: 'A', sendEnvelope: true, onError: 'throw', parameters: []}}
      : n), edges: [edge('start', 'w'), edge('w', 'end')]};
    const two = await flowRunner(parent('D'), {mode: 'execution', id: 'p3b', evaluate, flows: {D: back}});
    expect(two.status).toBe('failed');
    expect(two.error).toContain('Circular flow call: Parent → Back → Parent');
  });

  test("an input that does not fit the other flow's Start type is an error of the envelope, without running it", async () => {
    // B's Start takes {n: number, tag: string}: the grid's envelopes have no tag
    const typed: ExecutableFlow = {...multiply, inputType: {name: 'Item', shape: {kind: 'object', fields: [
      {name: 'n', optional: false, shape: {kind: 'number'}},
      {name: 'tag', optional: false, shape: {kind: 'string'}},
    ]}}};
    const r = await flowRunner(parent('B', 'divert'), {mode: 'execution', id: 'p4', evaluate, flows: {B: typed}});
    expect(r.status).toBe('completed');
    const w = r.components.find(c => c.nodeId === 'w')!;
    expect(w.outputs['error']).toBe(2);
    expect(w.subRuns ?? []).toEqual([]);
    expect(JSON.stringify(w.outputSample['error'])).toContain('The input does not fit Item (the Start of \\"Multiply\\"): input.tag: missing (required).');
    // the fitting ones run
    const fits = {...typed, inputType: {name: 'Item', shape: {kind: 'object' as const, fields: [{name: 'n', optional: false, shape: {kind: 'number' as const}}]}}};
    const ok = await flowRunner(parent('B'), {mode: 'execution', id: 'p5', evaluate, flows: {B: fits}});
    expect(ok.status).toBe('completed');
    expect(ok.components.find(c => c.nodeId === 'w')!.subRuns?.length).toBe(2);
  });

  test("each call keeps the other flow's record (its components' logs, counts and times), with its samples cut short", async () => {
    // a child with 7 rows at its End: the record keeps 5 per port
    const wide: ExecutableFlow = {...multiply, id: 'W', flow: 'Wide', nodes: multiply.nodes.map(n => n.id === 'm'
      ? {id: 'g', type: 'datagrid', label: 'Seven', config: {columns: [{name: 'k', type: 'number'}], rows: [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7']]}}
      : n), edges: [edge('start', 'g'), edge('g', 'end')]};
    const r = await flowRunner(parent('W'), {mode: 'execution', id: 'p7', evaluate, flows: {W: wide}});
    expect(r.status).toBe('completed');
    const w = r.components.find(c => c.nodeId === 'w')!;
    expect(w.outputs['out-0']).toBe(14);
    const sub = w.subRuns![0]!;
    expect(sub.status).toBe('completed');
    expect(sub.record?.run.flow).toBe('Wide');
    expect(sub.record?.run.parentId).toBe('p7');
    const grid = sub.record!.components.find(c => c.nodeId === 'g')!;
    expect(grid.outputs['out-0']).toBe(7);
    expect(grid.outputSample['out-0']).toHaveLength(5);
    expect(grid.logs.length).toBeGreaterThan(0);
    // the failing child's error line is in its record too (its Mapper's: it takes the input and fails on it)
    const takes: ExecutableFlow = {...breaks, nodes: breaks.nodes.map(n => (n.type === 'start' ? {...n, config: {acceptsInput: true}} : n))};
    const failed = await flowRunner(parent('C', 'divert'), {mode: 'execution', id: 'p8', evaluate, flows: {C: takes}});
    const calls = failed.components.find(c => c.nodeId === 'w')!.subRuns!;
    expect(calls.map(s => s.status)).toEqual(['failed', 'failed']);
    expect(calls[0]!.record!.components.find(c => c.nodeId === 'm')!.logs.some(l => l.level === 'error' && l.message.includes('$doesNotExist'))).toBe(true);
  });

  test("the parent's progress is the parent's: the child's progress goes into the call's entry, not out as the parent's", async () => {
    const seen: string[] = [];
    await flowRunner(parent('B'), {mode: 'execution', id: 'p9', evaluate, flows, onProgress: p => seen.push(p.run.flow)});
    expect(new Set(seen)).toEqual(new Set(seen.length ? ['Parent'] : []));
  });

  test('a flow that cannot be called (unavailable) is an error of each call', async () => {
    const r = await flowRunner(parent('B'), {mode: 'execution', id: 'p6', evaluate, flows: {B: {...multiply, unavailable: 'it has no End.'}}});
    expect(r.status).toBe('failed');
    expect(r.error).toContain('The flow "Multiply" cannot be called: it has no End.');
  });
});
