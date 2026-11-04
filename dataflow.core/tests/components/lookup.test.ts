import {expect, test} from 'bun:test';
import {flowRunner, outputPorts} from '../../src/index';
import type {ExecutableFlow} from '../../src/index';
import {evaluate} from '../helpers';

test('Lookup writes the found envelope into the output key (null when not found) and the Mapper picks the fields', async () => {
  // both inputs come from the same Router: the main one must not deadlock waiting for the lookup to finish
  const withLookup: ExecutableFlow = {
    project: 'Test', flow: 'Lookup', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'r', type: 'router', label: 'Router', config: {cases: [{label: 'company', condition: '$kind === "company"'}]}},
      {id: 'l', type: 'lookup', label: 'Lookup', outputKey: 'company', config: {keys: [{main: '$companyCode', lookup: '$code'}]}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [
        {target: 'companyId', value: '$company?.id ?? null', expression: true},
        {target: 'companyName', value: '$company?.name ?? "(no company)"', expression: true},
      ]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'r', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-1', target: 'l', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-0', target: 'l', targetPort: 'in-1'},
      {source: 'l', sourcePort: 'out-0', target: 'm', targetPort: 'in-0'},
      {source: 'm', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const tickets = Array.from({length: 200}, (_, i) => ({kind: 'ticket', id: i, companyCode: i % 3 === 2 ? 99 : String(i % 3)}));
  const companies = [{kind: 'company', code: 0, id: 'A', name: 'Alpha'}, {kind: 'company', code: 1, id: 'B', name: 'Beta'}];
  const r = await flowRunner(withLookup, {mode: 'execution', id: 'tl', evaluate, input: [...tickets, ...companies]});
  expect(r.status).toBe('completed');
  const l = r.components.find(c => c.nodeId === 'l')!;
  expect(l.outputs['out-0']).toBe(200);
  const sample = l.outputSample['out-0'] as {company: {id: string} | null}[];
  expect(sample.slice(0, 3).map(a => a.company?.id ?? null)).toEqual(['A', 'B', null]);
  const mapped = r.components.find(c => c.nodeId === 'm')!.outputSample['out-0'] as {companyId: unknown; companyName: string}[];
  expect(mapped.slice(0, 3).map(a => [a.companyId, a.companyName])).toEqual([['A', 'Alpha'], ['B', 'Beta'], [null, '(no company)']]);

  // with Override, DATA becomes only the found envelope
  withLookup.nodes[2].override = true;
  withLookup.nodes[3].config = {fields: [{target: 'x', value: '1', expression: false}]};
  const onlyFound = await flowRunner(withLookup, {mode: 'execution', id: 'tlo', evaluate, input: [...tickets, ...companies]});
  expect(onlyFound.components.find(c => c.nodeId === 'l')!.outputSample['out-0'].slice(0, 3))
    .toEqual([{kind: 'company', code: 0, id: 'A', name: 'Alpha'}, {kind: 'company', code: 1, id: 'B', name: 'Beta'}, {}]);
  withLookup.nodes[2].override = false;

});

test('Lookup with the not found output: found (out-0) and not found (out-1), the envelope as it came in; unconnected, it is dropped and said', async () => {
  const wf = (ifNotFound: string, connected: boolean): ExecutableFlow => ({
    project: 'Test', flow: 'Lookup not found', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'r', type: 'router', label: 'Router', config: {cases: [{label: 'company', condition: '$kind === "company"'}]}},
      {id: 'l', type: 'lookup', label: 'Lookup', outputKey: 'company', config: {keys: [{main: '$companyCode', lookup: '$code'}], ifNotFound}},
      {id: 'end', type: 'end', label: 'End', config: {}},
      {id: 'miss', type: 'end', label: 'Missing', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'r', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-1', target: 'l', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-0', target: 'l', targetPort: 'in-1'},
      {source: 'l', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      ...(connected ? [{source: 'l', sourcePort: 'out-1', target: 'miss', targetPort: 'in-0'}] : []),
    ],
  });
  const input = [{kind: 'company', code: 0, id: 'A'}, {kind: 'ticket', companyCode: 0}, {kind: 'ticket', companyCode: 7}];
  const r = await flowRunner(wf('output', true), {mode: 'validation', id: 'tn1', evaluate, input});
  expect(r.status).toBe('completed');
  const l = r.components.find(c => c.nodeId === 'l')!;
  expect(l.outputs).toEqual({'out-0': 1, 'out-1': 1});
  expect(l.outputSample['out-0']).toEqual([{kind: 'ticket', companyCode: 0, company: {kind: 'company', code: 0, id: 'A'}}]);
  expect(l.outputSample['out-1']).toEqual([{kind: 'ticket', companyCode: 7}]);
  expect(l.logs.map(x => x.message)).toContain('1 envelope(s) found and 1 not found in the lookup.');

  // not connected: dropped, and the log says where
  const dropped = await flowRunner(wf('output', false), {mode: 'validation', id: 'tn2', evaluate, input});
  expect(dropped.status).toBe('completed');
  expect(dropped.components.find(c => c.nodeId === 'l')!.logs.map(x => x.message)).toContain('1 envelope(s) dropped by the output not found, which is not connected.');

  // "Error" of earlier versions is the not found output now
  const earlier = await flowRunner(wf('error', true), {mode: 'validation', id: 'tn3', evaluate, input});
  expect(earlier.components.find(c => c.nodeId === 'l')!.outputs).toEqual({'out-0': 1, 'out-1': 1});
});

test("Lookup's ports: one output with Null (as before), found and not found with the not found output", () => {
  expect(outputPorts('lookup', {})).toEqual([{id: 'out-0'}]);
  expect(outputPorts('lookup', {ifNotFound: 'output'})).toEqual([{id: 'out-0', label: 'found'}, {id: 'out-1', label: 'not found', optional: true}]);
});

test('Lookup matches dates by their instant (a millisecond apart is another key)', async () => {
  const wf: ExecutableFlow = {
    project: 'Test', flow: 'Lookup dates', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'l', type: 'lookup', label: 'Lookup', outputKey: 'shift', config: {keys: [{main: '$at', lookup: '$at'}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      // the Start's output to both inputs (each gets its own copy)
      {source: 'start', sourcePort: 'out-0', target: 'l', targetPort: 'in-0'},
      {source: 'start', sourcePort: 'out-0', target: 'l', targetPort: 'in-1'},
      {source: 'l', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const reached: Record<string, unknown>[] = [];
  await flowRunner(wf, {mode: 'execution', id: 'lookup-dates', evaluate, onReachEnd: async doc => void reached.push(doc.DATA),
    input: [{id: 1, at: new Date('2026-10-25T18:00:00.000Z')}, {id: 2, at: new Date('2026-10-25T18:00:00.001Z')}]});
  // each one finds itself, not the other one (String() of both dates is the same text)
  expect(reached.map(d => [d.id, (d.shift as {id: number} | null)?.id])).toEqual([[1, 1], [2, 2]]);
});
