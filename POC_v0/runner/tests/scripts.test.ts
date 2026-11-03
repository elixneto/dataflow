import {expect, test} from 'bun:test';
import {workflowRunner, type ExecutableWorkflow} from '@dataflow/core';
import {evaluate} from '../src/expressions';
import {prepareScript} from '../src/scripts';

/** Start → (Aggregate, if there is a batch) → TypeScript → End */
const flow = (code: string, batch?: number, override = true): ExecutableWorkflow => ({
  project: 'Test', workflow: 'TypeScript', parameters: [{name: 'suffix', type: 'text', default: '!'}],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
    ...(batch ? [{id: 'agg', type: 'aggregate', label: 'Aggregate', config: {size: batch}}] : []),
    {id: 'ts', type: 'typescript', label: 'TypeScript', config: {code}, override, outputKey: 'calculation'},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    ...(batch
      ? [{source: 'start', sourcePort: 'out-0', target: 'agg', targetPort: 'in-0'}, {source: 'agg', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'}]
      : [{source: 'start', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'}]),
    {source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

const run = (code: string, input: unknown, batch?: number, override = true) =>
  workflowRunner(flow(code, batch, override), {mode: 'execution', id: 't', evaluate, prepareScript, secrets: {token: 'abc'}, input});

test('process with types, a helper function, parameters and secrets', async () => {
  const r = await run(`
    type Person = {name: string}
    function upper(text: string): string { return text.toUpperCase() }
    async function process($input: Person) {
      log('processing', $input.name)
      return {name: upper($input.name) + $PARAMETERS.suffix, token: $SECRETS.token}
    }`, [{name: 'ana'}, {name: 'bia'}]);
  expect(r.status).toBe('completed');
  const ts = r.components.find(c => c.nodeId === 'ts')!;
  expect(ts.outputSample['out-0']).toEqual([{name: 'ANA!', token: 'abc'}, {name: 'BIA!', token: 'abc'}]);
  expect(ts.logs.some(l => l.message === 'processing ana')).toBe(true);
});

test('Aggregate before: $input.items is the batch and the return can become many envelopes or none', async () => {
  const r = await run(`
    async function process($input: {items: {n: number}[]}) {
      const evens = $input.items.filter(i => i.n % 2 === 0)
      return evens.length ? evens.map(i => ({n: i.n, batch: $input.items.length})) : null
    }`, Array.from({length: 7}, (_, n) => ({n})), 3);
  expect(r.status).toBe('completed');
  const ts = r.components.find(c => c.nodeId === 'ts')!;
  expect(ts.outputSample['out-0']).toEqual([{n: 0, batch: 3}, {n: 2, batch: 3}, {n: 4, batch: 3}, {n: 6, batch: 1}]);
  expect(ts.logs.at(-1)!.message).toBe('3 envelope(s) in and 4 out.');
  expect(r.components.find(c => c.nodeId === 'agg')!.outputs['out-0']).toBe(3);
});

test('compile error, exception and infinite loop', async () => {
  expect((await run('async function process($input) { return {', [{}])).status).toBe('failed');
  const withException = await run('async function process($input) { throw new TypeError("bad") }', [{}]);
  expect(withException.error).toContain('bad');
  const withLoop = await run('async function process($input) { while (true) {} }', [{}]);
  expect(withLoop.status).toBe('failed');
}, 20_000);

test('without Override, the return goes to the output key and the rest of DATA moves on', async () => {
  const r = await run('async function process($input) { return $input.a * 2 }', [{a: 1, b: 'x'}, {a: 5, b: 'y'}], undefined, false);
  expect(r.status).toBe('completed');
  expect(r.components.find(c => c.nodeId === 'ts')!.outputSample['out-0']).toEqual([{a: 1, b: 'x', calculation: 2}, {a: 5, b: 'y', calculation: 10}]);
});
