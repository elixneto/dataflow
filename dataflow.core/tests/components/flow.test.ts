import {describe, expect, test} from 'bun:test';
import {COMPONENTS, errorPort, fixedOnError, flowRunner, onErrorOf} from '../../src/index';
import type {ExecutableFlow, QueueFlow, QueueFlowRequest} from '../../src/index';
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

  test("each call's entry keeps the parameters it sent, a secret's value hidden", async () => {
    const r = await flowRunner(parent('B'), {mode: 'execution', id: 'params', evaluate, flows});
    expect(r.components.find(c => c.nodeId === 'w')!.subRuns?.map(s => s.parameters)).toEqual([{times: '2'}, {times: '3'}]);
    const withSecret = parent('B');
    withSecret.nodes = withSecret.nodes.map(n => (n.id === 'w' ? {...n, config: {...n.config, parameters: [{name: 'times', value: "'k-' + $SECRETS.KEY", expression: true}]}} : n));
    const s = await flowRunner(withSecret, {mode: 'execution', id: 'params2', evaluate, flows, secrets: {KEY: 'super-secret'}});
    expect(s.components.find(c => c.nodeId === 'w')!.subRuns?.[0]?.parameters).toEqual({times: 'k-***'});
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

  test('an input expression sends only what it gives, checked against the type; the result merges into the whole envelope', async () => {
    // E echoes its input: its End gets what its Start was given
    const echo: ExecutableFlow = {
      id: 'E', project: 'Test', flow: 'Echo', parameters: [],
      inputType: {name: 'Scaled', shape: {kind: 'object', fields: [{name: 'm', optional: false, shape: {kind: 'number'}}]}},
      nodes: [
        {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
        {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: []}},
        {id: 'end', type: 'end', label: 'End', config: {}},
      ],
      edges: [edge('start', 'm'), edge('m', 'end')],
    };
    const calling = (input: string, onError = 'throw') => {
      const p = parent('E', onError);
      return {...p, nodes: p.nodes.map(n => (n.id === 'w' ? {...n, config: {...n.config, parameters: [], inputSource: 'expression', input: {value: input, expression: true}}} : n))};
    };
    const r = await flowRunner(calling('{m: $n * 10}'), {mode: 'execution', id: 'p6', evaluate, flows: {E: echo}});
    expect(r.status).toBe('completed');
    const w = r.components.find(c => c.nodeId === 'w')!;
    expect(w.subRuns!.map(s => s.record!.components.find(c => c.nodeId === 'start')!.outputSample['out-0'])).toEqual([[{m: 10}], [{m: 20}]]);
    expect(w.outputSample['out-0']).toEqual([{n: 1, m: 10}, {n: 2, m: 20}]);
    // what does not fit the type is an error of the envelope, the flow not run
    const wrong = await flowRunner(calling('{m: "x" + $n}', 'divert'), {mode: 'execution', id: 'p6b', evaluate, flows: {E: echo}});
    const ww = wrong.components.find(c => c.nodeId === 'w')!;
    expect(ww.outputs['error']).toBe(2);
    expect(JSON.stringify(ww.outputSample['error'])).toContain('input.m: expected a number, got text \\"x1\\".');
  });

  test("an input expression is required when chosen", () => {
    const validate = COMPONENTS.flow!.validate!;
    expect(validate({flowId: 'B', sendEnvelope: true, inputSource: 'expression', input: {value: ' ', expression: true}})).toEqual(['has no input expression.']);
    expect(validate({flowId: 'B', sendEnvelope: false, inputSource: 'expression'})).toEqual([]);
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

  describe('fire and forget', () => {
    const fire = (flowId: string, onError = 'throw', extra: Record<string, unknown> = {}): ExecutableFlow => {
      const p = parent(flowId, onError);
      return {...p, nodes: p.nodes.map(n => (n.id === 'w' ? {...n, config: {...n.config, call: 'fire-and-forget', ...extra}} : n))};
    };
    /** Numbers with 5 rows: n = 1..5 */
    const five = (f: ExecutableFlow): ExecutableFlow => ({...f, nodes: f.nodes.map(n => (n.id === 'g' ? {...n, config: {...n.config, rows: [['1'], ['2'], ['3'], ['4'], ['5']]}} : n))});
    const queueing = () => {
      const asked: QueueFlowRequest[] = [];
      const queueFlow: QueueFlow = async request => {
        asked.push(request);
        return {id: `child-${asked.length}`};
      };
      return {asked, queueFlow};
    };
    const fixed = {parameters: [{name: 'times', value: '2', expression: false}]};

    test('a real run queues one run per batch (the batch its input, with the parameters, the chain, who called) and lets each envelope go on as it came', async () => {
      const {asked, queueFlow} = queueing();
      const r = await flowRunner(five(fire('B', 'throw', {...fixed, batchSize: 2})), {mode: 'execution', id: 'p10', evaluate, flows, queueFlow});
      expect(r.status).toBe('completed');
      const call = {flowId: 'B', parameters: {times: '2'}, chain: ['A', 'B'], rootName: 'Parent', nodeId: 'w', nodeLabel: 'Calls'};
      expect(asked).toEqual([{...call, input: [{n: 1}, {n: 2}]}, {...call, input: [{n: 3}, {n: 4}]}, {...call, input: [{n: 5}]}]);
      const w = r.components.find(c => c.nodeId === 'w')!;
      // not merged with what the other flow returns: it did not run here
      expect(w.outputSample['out-0']).toEqual([{n: 1}, {n: 2}, {n: 3}, {n: 4}, {n: 5}]);
      expect(w.subRuns?.map(s => [s.id, s.status, s.envelopes, s.fireAndForget])).toEqual([['child-1', 'queued', 2, true], ['child-2', 'queued', 2, true], ['child-3', 'queued', 1, true]]);
      expect(w.subRuns?.map(s => s.parameters)).toEqual([{times: '2'}, {times: '2'}, {times: '2'}]);
    });

    test('by default batches of 100; envelopes with other parameter values go in batches of their own', async () => {
      const {asked, queueFlow} = queueing();
      // times = $n % 2 + 1: odd rows 2, even rows 1
      const r = await flowRunner(five(fire('B', 'throw', {parameters: [{name: 'times', value: '$n % 2 + 1', expression: true}]})), {mode: 'execution', id: 'p10b', evaluate, flows, queueFlow});
      expect(r.status).toBe('completed');
      expect(asked.map(a => [a.parameters.times, a.input])).toEqual([['2', [{n: 1}, {n: 3}, {n: 5}]], ['1', [{n: 2}, {n: 4}]]]);
    });

    test("a flow that would fail is not this run's error: it is queued all the same", async () => {
      const {asked, queueFlow} = queueing();
      const r = await flowRunner(fire('C', 'throw', fixed), {mode: 'execution', id: 'p11', evaluate, flows, queueFlow});
      expect(r.status).toBe('completed');
      expect(asked).toHaveLength(1);
    });

    test("On error is always Throw: an envelope that would not start stops the run (circular, input type), whatever the config says", async () => {
      const {asked, queueFlow} = queueing();
      const circular = await flowRunner(fire('A'), {mode: 'execution', id: 'p12', evaluate, flows: {...flows, A: fire('A')}, queueFlow});
      expect(circular.status).toBe('failed');
      expect(circular.error).toContain('Circular flow call: Parent → Parent');
      expect(asked).toEqual([]);
      // a queued run goes on with its chain: B called from A, now calling A again, is circular
      const deep = await flowRunner(fire('A'), {mode: 'execution', id: 'p13', evaluate, flows: {A: fire('A')}, queueFlow, chain: ['A', 'B']});
      expect(deep.error).toContain('Circular flow call');
      // n must be a string: none fits; Divert in the config changes nothing (and there is no error port)
      const typed: ExecutableFlow = {...multiply, inputType: {name: 'Item', shape: {kind: 'object', fields: [{name: 'n', optional: false, shape: {kind: 'string'}}]}}};
      const divert = fire('B', 'divert');
      const wrong = await flowRunner({...divert, edges: divert.edges.filter(e => e.sourcePort !== 'error')}, {mode: 'execution', id: 'p13b', evaluate, flows: {B: typed}, queueFlow});
      expect(wrong.status).toBe('failed');
      expect(wrong.error).toContain('The input does not fit Item');
      expect(asked).toEqual([]);
      // an edge out of the error port it no longer has: the flow does not run
      const edged = await flowRunner(divert, {mode: 'execution', id: 'p13c', evaluate, flows, queueFlow});
      expect(edged.error).toContain('"Calls" has an edge out of its error port, but its On error can only be Throw with this configuration.');
      expect(fixedOnError('flow', {call: 'fire-and-forget', onError: 'divert'})).toBe('throw');
      expect(onErrorOf('flow', {call: 'fire-and-forget', onError: 'continue'})).toBe('throw');
      expect(errorPort('flow', {call: 'fire-and-forget', onError: 'divert'})).toBeUndefined();
      expect(onErrorOf('flow', {onError: 'divert'})).toBe('divert');
      expect(COMPONENTS.flow.validate({flowId: 'B', call: 'fire-and-forget', onError: 'divert'})).toEqual(['fires and forgets: its On error is always Throw (the calls answer nothing to continue or divert with).']);
      expect(COMPONENTS.flow.validate({flowId: 'B', call: 'fire-and-forget'})).toEqual([]);
    });

    test('a batch that cannot be queued is an error line of the component; the envelopes went on and the run completes', async () => {
      let tries = 0;
      const flaky: QueueFlow = async () => {
        tries += 1;
        if (tries === 1) throw new Error('the database is gone');
        return {id: `child-${tries}`};
      };
      const r = await flowRunner(five(fire('B', 'throw', {...fixed, batchSize: 2})), {mode: 'execution', id: 'p14', evaluate, flows, queueFlow: flaky});
      expect(r.status).toBe('completed');
      const w = r.components.find(c => c.nodeId === 'w')!;
      expect(w.outputs['out-0']).toBe(5);
      expect(w.subRuns?.map(s => s.id)).toEqual(['child-2', 'child-3']);
      expect(w.logs.filter(l => l.level === 'error').map(l => l.message)).toEqual(['A batch of 2 envelope(s) was not queued: the database is gone']);
      expect(w.logs.some(l => l.message.includes('3 envelope(s) in 2 run(s) queued') && l.message.includes('2 not queued'))).toBe(true);
    });

    test('at most maxFireAndForgetRuns runs: the batches stop closing on their size and the last one takes the rest; none is lost', async () => {
      const {asked, queueFlow} = queueing();
      // 5 envelopes in batches of 1, at most 3 runs: 1, 2, then 3+4+5
      const r = await flowRunner(five(fire('B', 'throw', {...fixed, batchSize: 1})), {mode: 'execution', id: 'p17', evaluate, flows, queueFlow, maxFireAndForgetRuns: 3});
      expect(r.status).toBe('completed');
      expect(asked.map(a => a.input)).toEqual([[{n: 1}], [{n: 2}], [{n: 3}, {n: 4}, {n: 5}]]);
      const w = r.components.find(c => c.nodeId === 'w')!;
      expect(w.outputs['out-0']).toBe(5);
      expect(w.logs.filter(l => l.level === 'warning').map(l => l.message)).toEqual(["Limit of 3 fire and forget runs reached (4 × the server's workers): the last batches take more than 1 envelopes each."]);
      // a test run beside it: the same limit
      const test = await flowRunner(five(fire('B', 'throw', {...fixed, batchSize: 1})), {mode: 'validation', id: 'p18', evaluate, flows, maxFireAndForgetRuns: 2});
      expect(test.components.find(c => c.nodeId === 'w')!.subRuns?.map(s => s.envelopes)).toEqual([1, 4]);
      // exactly as many batches as the limit: each its size, no warning
      const fits = await flowRunner(five(fire('B', 'throw', {...fixed, batchSize: 1})), {mode: 'execution', id: 'p20', evaluate, flows, queueFlow: queueing().queueFlow, maxFireAndForgetRuns: 5});
      const fw = fits.components.find(c => c.nodeId === 'w')!;
      expect(fw.subRuns?.map(s => s.envelopes)).toEqual([1, 1, 1, 1, 1]);
      expect(fw.logs.filter(l => l.level === 'warning')).toEqual([]);
    });

    test('parameter values that need a batch of their own past the limit stop the run', async () => {
      const {asked, queueFlow} = queueing();
      // times = $n: five different values, at most 2 runs
      const r = await flowRunner(five(fire('B', 'throw', {parameters: [{name: 'times', value: '$n', expression: true}]})), {mode: 'execution', id: 'p19', evaluate, flows, queueFlow, maxFireAndForgetRuns: 2});
      expect(r.status).toBe('failed');
      expect(r.error).toContain('More than 2 fire and forget runs');
      expect(asked).toEqual([]);
    });

    test("without Send an input: one run per batch, with no input", async () => {
      const {asked, queueFlow} = queueing();
      const r = await flowRunner(five(fire('B', 'throw', {...fixed, sendEnvelope: false, batchSize: 2})), {mode: 'execution', id: 'p14b', evaluate, flows, queueFlow});
      expect(r.status).toBe('completed');
      expect(asked.map(a => a.input)).toEqual([undefined, undefined, undefined]);
      expect(r.components.find(c => c.nodeId === 'w')!.outputs['out-0']).toBe(5);
    });

    test('an input expression: the batch holds what it gives per envelope (a list adds its items)', async () => {
      const {asked, queueFlow} = queueing();
      const byExpression = {...fixed, inputSource: 'expression', batchSize: 2, input: {value: '$n === 1 ? [{m: 1}, {m: 1.5}] : {m: $n}', expression: true}};
      const r = await flowRunner(five(fire('B', 'throw', byExpression)), {mode: 'execution', id: 'p14c', evaluate, flows, queueFlow});
      expect(r.status).toBe('completed');
      expect(asked.map(a => a.input)).toEqual([[{m: 1}, {m: 1.5}, {m: 2}], [{m: 3}, {m: 4}], [{m: 5}]]);
    });

    test('a test run queues nothing: each batch runs beside it, the envelopes going on at once, and shows as a fire and forget called run', async () => {
      const {asked, queueFlow} = queueing();
      const r = await flowRunner(five(fire('B', 'throw', {...fixed, batchSize: 3})), {mode: 'validation', id: 'p15', evaluate, flows, queueFlow});
      expect(r.status).toBe('completed');
      expect(asked).toEqual([]);
      const w = r.components.find(c => c.nodeId === 'w')!;
      expect(w.outputSample['out-0']).toHaveLength(5);
      expect(w.subRuns?.map(s => [s.flow, s.status, s.envelopes, s.fireAndForget])).toEqual([['Multiply', 'completed', 3, true], ['Multiply', 'completed', 2, true]]);
      // the batch's items are the called run's envelopes
      expect(w.subRuns![0]!.record!.components.find(c => c.nodeId === 'm')!.outputs['out-0']).toBe(3);
      // a called run that fails is its own: this run completes
      const failing = await flowRunner(fire('C', 'throw', fixed), {mode: 'validation', id: 'p16', evaluate, flows});
      expect(failing.status).toBe('completed');
      expect(failing.components.find(c => c.nodeId === 'w')!.subRuns?.map(s => s.status)).toEqual(['failed']);
    });
  });
});
