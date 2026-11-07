import {expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate, mapperFlow} from '../helpers';

test('the record comes in flow order, not node order', async () => {
  const shuffled = {...mapperFlow, nodes: [mapperFlow.nodes[2], mapperFlow.nodes[1], mapperFlow.nodes[0]]};
  const r = await flowRunner(shuffled, {mode: 'validation', id: 't3', evaluate});
  expect(r.components.map(c => c.nodeId)).toEqual(['start', 'm', 'end']);
});

test('a Start that accepts input puts the body in the envelope; without the option, it fails', async () => {
  const withInput = structuredClone(mapperFlow);
  withInput.nodes[0].config = {acceptsInput: true};
  withInput.nodes[1].config = {fields: [{target: 'greeting', value: '"Hello " + $name', expression: true}]};
  const r = await flowRunner(withInput, {mode: 'validation', id: 't6', evaluate, input: {name: 'Élix'}});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'm')!.outputSample['out-0'][0]).toEqual({name: 'Élix', greeting: 'Hello Élix'});

  const withoutOption = await flowRunner(mapperFlow, {mode: 'validation', id: 't7', evaluate, input: {name: 'x'}});
  expect(withoutOption.status).toBe('failed');
  expect(withoutOption.error).toContain('does not accept input');
});

test('an array input fires one envelope per item', async () => {
  const withInput = structuredClone(mapperFlow);
  withInput.nodes[0].config = {acceptsInput: true};
  withInput.nodes[1].config = {fields: [{target: 'greeting', value: '"Hello " + $name', expression: true}]};
  const r = await flowRunner(withInput, {mode: 'validation', id: 't8', evaluate, input: [{name: 'Élix 1'}, {name: 'Élix 2'}]});
  expect(r.status).toBe('completed');
  const start = r.components.find(c => c.nodeId === 'start')!;
  expect(start.inputs['in-0']).toBe(2);
  expect(start.outputs['out-0']).toBe(2);
  const m = r.components.find(c => c.nodeId === 'm')!;
  expect(m.outputSample['out-0']).toEqual([{name: 'Élix 1', greeting: 'Hello Élix 1'}, {name: 'Élix 2', greeting: 'Hello Élix 2'}]);
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(2);
});

test('a cycle in the edges does not run (infinite loop)', async () => {
  const withCycle: ExecutableFlow = {
    project: 'Test', flow: 'Cycle', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'join', type: 'limit', label: 'Join', config: {count: 100}},
      {id: 'm1', type: 'mapper', label: 'Mapper 1', config: {onError: 'divert', fields: [{target: 'x', value: '$y.z', expression: true}]}},
      {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 's', value: 'ERROR', expression: false}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'join', targetPort: 'in-0'},
      {source: 'join', sourcePort: 'out-0', target: 'm1', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'error', target: 'm2', targetPort: 'in-0'},
      {source: 'm2', sourcePort: 'out-0', target: 'join', targetPort: 'in-0'},
    ],
  };
  const r = await flowRunner(withCycle, {mode: 'execution', id: 't13', evaluate});
  expect(r.status).toBe('failed');
  expect(r.error).toContain('Join → Mapper 1 → Mapper 2 → Join');
});

test('run cancelled by the signal', async () => {
  const control = new AbortController();
  control.abort();
  const r = await flowRunner(mapperFlow, {mode: 'execution', id: 't14', evaluate, signal: control.signal});
  expect(r.status).toBe('failed');
  expect(r.error).toBe('Run cancelled.');
});

test('Stop does not wait for a component stuck on something that ignores it: the run ends at once, that component stopped', async () => {
  const stuck: ExecutableFlow = {
    project: 'Test', flow: 'Stuck', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'ts', type: 'typescript', label: 'Waits forever', config: {code: 'async function process($input) { return null; }'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'},
      {source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const control = new AbortController();
  // a script's own wait (its timer, a fetch of its own): the run's signal does not reach it
  const prepareScript = async () => () => new Promise<never>(() => {});
  setTimeout(() => control.abort(), 50);
  const t0 = performance.now();
  const r = await flowRunner(stuck, {mode: 'execution', id: 't14b', evaluate, signal: control.signal, prepareScript, input: [{a: 1}]});
  expect(performance.now() - t0).toBeLessThan(1000);
  expect(r.status).toBe('failed');
  expect(r.error).toBe('Run cancelled.');
  const ts = r.components.find(c => c.nodeId === 'ts')!;
  expect(ts.status).toBe('failed');
  expect(ts.logs.at(-1)?.message).toBe('Stopped while it was running (Run cancelled.)');
  expect(ts.end).toBeDefined();
});

test('End accepts several edges into the same input', async () => {
  const twoPaths: ExecutableFlow = {
    project: 'Test', flow: 'End with several edges', parameters: [],
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
  const r = await flowRunner(twoPaths, {mode: 'execution', id: 'te', evaluate, input});
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(100);
});
