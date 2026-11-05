import {expect, test} from 'bun:test';
import {flowRunner} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate, mapperFlow} from '../helpers';

test('an expression with an error stops the run (default policy)', async () => {
  const withError = structuredClone(mapperFlow);
  withError.nodes[1].config = {fields: [{target: 'x', value: '$doesNotExist.y', expression: true}]};
  const r = await flowRunner(withError, {mode: 'execution', id: 't2', evaluate});
  expect(r.status).toBe('failed');
  const m = r.components.find(c => c.nodeId === 'm')!;
  expect(m.status).toBe('failed');
  // the error once in its log (not again when the run stops)
  expect(m.logs.filter(l => l.level === 'error')).toHaveLength(1);
});

test('Continue: on error, the incoming envelope moves on unchanged', async () => {
  const withError = structuredClone(mapperFlow);
  withError.nodes[0].config = {acceptsInput: true};
  withError.nodes[1].config = {onError: 'continue', fields: [{target: 'x', value: '$doesNotExist.y', expression: true}]};
  const r = await flowRunner(withError, {mode: 'validation', id: 't9', evaluate, input: [{name: 'A'}, {name: 'B'}]});
  expect(r.status).toBe('with-errors');
  const m = r.components.find(c => c.nodeId === 'm')!;
  expect(m.status).toBe('with-errors');
  expect(m.outputs['out-0']).toBe(2);
  expect(m.outputSample['out-0']).toEqual([{name: 'A'}, {name: 'B'}]);
  expect(m.logs.filter(l => l.level === 'error')).toHaveLength(2);
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(2);
});

test('disabled with a loose output: bypass, dropped envelope and nothing at the End become warnings', async () => {
  const loose: ExecutableFlow = {
    project: 'Test', flow: 'Loose', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm1', type: 'mapper', label: 'Mapper 1', disabled: true, config: {onError: 'divert', fields: [{target: 'x', value: 'a', expression: true}]}},
      {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 'status', value: 'ERR', expression: false}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'm1', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'error', target: 'm2', targetPort: 'in-0'},
      {source: 'm2', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const r = await flowRunner(loose, {mode: 'execution', id: 't10', evaluate});
  const m1 = r.components.find(c => c.nodeId === 'm1')!;
  expect(m1.status).toBe('disabled');
  expect(m1.logs.some(l => l.message.includes('dropped'))).toBe(true);
  expect(r.components.find(c => c.nodeId === 'end')!.status).toBe('with-warnings');
  expect(r.status).toBe('with-warnings');
});

function flowJoiningError(): ExecutableFlow {
  return {
    project: 'Test', flow: 'Join', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'ok', type: 'mapper', label: 'Mapper', config: {onError: 'divert', fields: [{target: 'double', value: '$n * 2 + $failure.x', expression: true}]}},
      {id: 'handle', type: 'mapper', label: 'Handle error', config: {fields: [{target: 'status', value: 'ERROR', expression: false}]}},
      {id: 'join', type: 'limit', label: 'Join', config: {count: 100}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'ok', targetPort: 'in-0'},
      {source: 'ok', sourcePort: 'out-0', target: 'join', targetPort: 'in-0'},
      {source: 'ok', sourcePort: 'error', target: 'handle', targetPort: 'in-0'},
      {source: 'handle', sourcePort: 'out-0', target: 'join', targetPort: 'in-0'},
      {source: 'join', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
}

test('an input with two edges joins the normal output and the error handling one', async () => {
  const wf = flowJoiningError();
  // $failure only exists in the 2nd envelope: the 1st one fails (goes to "handle"), the 2nd passes
  const r = await flowRunner(wf, {mode: 'execution', id: 't11', evaluate, input: [{n: 1}, {n: 2, failure: {x: 0}}]});
  const joined = r.components.find(c => c.nodeId === 'join')!;
  expect(joined.inputs).toEqual({'in-0': 2});
  expect(joined.outputs['out-0']).toBe(2);
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(2);
  // what goes out through the error port carries DATA.errors
  expect(r.components.find(c => c.nodeId === 'handle')!.inputSample[0].errors).toEqual([
    {error: 'ReferenceError', message: expect.stringContaining('$failure is not defined'), component: 'Mapper'},
  ]);
  // the error was diverted and handled: the run is a success
  expect(r.components.find(c => c.nodeId === 'ok')!.status).toBe('completed');
  expect(r.status).toBe('completed');
});
